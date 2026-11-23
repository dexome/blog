---
pubDatetime: "2026-07-07T00:00:00+05:30"
description: How I moved my existing OPNsense and Omada configuration into OpenTofu without rebuilding it
tags:
- guide
- networking
- firewall
- terraform
- opentofu
- iac
- opnsense
title: Managing My Existing OPNsense Setup with OpenTofu
---

I wanted to manage my existing OPNsense configuration using OpenTofu. The
firewall was already running DNS, DHCP, several VLANs, VPN connections and all
the rules for my home network. Recreating everything from code was not an option.

I used the `browningluke/opnsense` provider and started with one Unbound DNS
setting. After importing it, I did not continue until the plan showed:

```text
No changes. Your infrastructure matches the configuration.
```

This worked for DNS, but the next step caused a DHCP outage because one provider
default removed the gateway and DNS options from client leases. This post covers
the order I used after that incident and the provider limitations I found.

## Import first and make no changes

There are two separate things we may want to do during this migration:

1. represent the current system in code;
2. clean up the system while doing it.

I would not combine them.

The first goal is adoption. Its success criterion is boring: after import, the
configuration describes the live object exactly enough that a plan proposes no
change. Only after that baseline is stable should a separate change improve the
object.

This matters most for routers and firewalls because the management path is one
of the resources being changed. An incorrect web-server deployment can return a
500. An incorrect gateway, DHCP option, or anti-lockout rule can remove the path
you need to repair it.

I used four gates for every subsystem:

```text
inventory ──> import ──> zero-diff plan ──> one-object apply
		│             │             │                  │
		└── stop ─────┴── stop ─────┴── stop on drift ─┘
```

The first real apply was always deliberately small.

```mermaid caption="The adoption moved outward from lower-risk DNS objects to connectivity-critical filters and NAT, with a stop gate after every phase."
flowchart TB
	U[Unbound DNS: 66 objects] -->|zero-diff plan| K[Kea DHCP: 64 objects]
	K -->|client lease test| O[Omada VLANs, profiles, ports and SSIDs]
	O -->|controller no-op| C[Guest firewall canary]
	C -->|compiled pf order| F[Per-interface filter migration]
	F --> N[NAT and VPN resources]
```

## Start with Unbound DNS

Resolver settings and host overrides were a good first target. Sixty-six Unbound
objects were numerous enough to test import automation but less dangerous than
rewriting the firewall ruleset.

The import revealed an important category of provider behavior: fields that
exist on the appliance but not in the provider schema. One host override generated
a reverse record, yet the provider did not expose that switch. Importing and
planning the resource produced no change, so the appliance-only field survived.

That was acceptable. IaC coverage does not need to be 100 percent to be useful.
It does need to be honest.

Another DNS feature exposed the opposite problem: the provider could read a
blocklist setting but failed when writing it. Rather than force ownership, I left
that feature GUI-managed and documented the boundary. A provider that cannot
round-trip a field does not own that field.

The first phase ended with dozens of objects imported and a no-op plan. The point
was not the count. It was proving the API credentials, import identifiers, schema,
and state storage before touching client connectivity.

## Kea DHCP and the `auto_collect` issue

Kea DHCP import covered 64 objects and looked equally clean until the first apply.
Clients on THINGS and QUANTUM renewed and still received valid addresses, but
they lost their default gateway and DNS server.

The provider exposed an `auto_collect` option. Its default was enabled, suggesting
that the appliance would derive subnet options automatically. On this system it
did not. Applying the resource removed the stored router, DNS, and NTP values.

A simplified version of the dangerous assumption looked like this:

```hcl
resource "firewall_dhcp_subnet" "clients" {
	subnet       = "10.20.0.0/24"
	auto_collect = true
}
```

The repaired declaration made every client-visible option explicit. This is a
simplified version of the QUANTUM subnet, whose gateway and resolver are
`10.100.30.1`:

```hcl
resource "firewall_dhcp_subnet" "clients" {
	subnet       = "10.100.30.0/24"
	auto_collect = false

	routers     = ["10.100.30.1"]
	dns_servers = ["10.100.30.1"]
	ntp_servers = ["10.100.30.1"]
}
```

~~~mermaid caption="The DHCP daemon stayed healthy while `auto_collect` removed the information clients needed to use their leases."
flowchart LR
		CLIENT[QUANTUM client] -->|DHCP Discover| KEA[OPNsense Kea]
		KEA -->|Offer: address only| CLIENT
		CLIENT --> IP[Client has a 10.100.30.x address]
		CLIENT -. missing .-> GW[Default gateway 10.100.30.1]
		CLIENT -. missing .-> DNS[DNS server 10.100.30.1]
		IP --> SYMPTOM[Looks connected but cannot route or resolve]
~~~

The important thing here is that the provider default did not match the existing
OPNsense behavior. I now set every client-visible DHCP option explicitly.

After restoring the option data, I verified DHCP as a client would:

- obtain a new lease;
- inspect the offered router and DNS options;
- reach the gateway;
- resolve a name;
- cross the firewall to an external address.

"The service is running" would not have caught this failure. DHCP was running
perfectly while handing out incomplete leases.

## Importing Omada configuration

The managed-switch controller added another translation layer. The API endpoint
behind the normal reverse-proxy address redirected login requests, while the
provider expected to talk directly to the controller. Connecting to the direct
management origin fixed authentication.

Imports then showed several values whose controller defaults differed from the
provider defaults: multicast snooping, relay booleans, and profile flags. To
reach a zero-diff plan, I had to write values that the GUI had previously left
implicit.

Wireless credentials were particularly important. The controller returned a
non-null pre-shared key. Omitting the field in code did not mean "leave it alone";
it meant "clear it." The secret therefore had to be supplied at runtime from an
encrypted source so the plan could preserve the live network without committing
the key.

Hardware controls deserve the same caution. On this controller, Power over
Ethernet belonged to a port profile. Applying a profile with PoE disabled to a
live access point would cut power to the device carrying the management traffic.
I treated profile changes as physical operations, not harmless metadata edits.

## Firewall rules and their real order

Firewall filters were the highest-risk phase because the appliance had two rule
stores:

- legacy rules created in the traditional per-interface GUI;
- automation rules created through the API and managed by OpenTofu.

The provider could not import legacy rules because they were not the same kind of
object. They had to be recreated in the automation store.

That raised a more important question than whether the declarations looked
equivalent: where would the new rules land in the effective packet-filter order?

Firewall evaluation is ordered. Two identical sets of rules can behave
differently if a broad pass or block moves above a specific exception. The GUI's
visual order was not enough because it separated the two stores.

I found an API endpoint that returned the compiled packet-filter rules in actual
evaluation order, including labels that distinguished automation objects from
legacy objects. I wrapped it in a small read-only script and made its output a
mandatory gate for every interface migration.

```mermaid caption="OPNsense displayed legacy and Automation rules separately, so I queried the compiled pf order before removing any legacy rule."
flowchart TB
	TF[OpenTofu resources] --> AUTO[os-firewall Automation store]
	GUI[Existing GUI rules] --> LEGACY[Legacy interface store]
	AUTO --> COMPILE[OPNsense rule compiler]
	LEGACY --> COMPILE
	SYSTEM[Anti-lockout and generated rules] --> COMPILE
	COMPILE --> PF[Effective pf rules in @N order]
	PF --> CHECK[pf-rule-order.sh verification]
	CHECK -->|Automation safely shadows legacy| REMOVE[Remove legacy twin]
	CHECK -->|Unexpected order| STOP[Stop and repair sequence]
```

The sequence per interface became:

1. Recreate a small set of legacy rules as automation resources.
2. Apply them while the legacy originals remain enabled.
3. Query the compiled ruleset.
4. Confirm the automation rules sit in the intended order and shadow the legacy
	 copies safely.
5. Test traffic through that interface.
6. Disable, then remove, the legacy copies.
7. Plan again and confirm no unexpected drift.

I started with a low-risk guest network containing only three rules. It was a
canary for the ordering model. Only after its compiled order and behavior were
correct did I migrate management, server, VPN, and WAN interfaces one at a time.

Explicit sequence values were essential. Relying on every resource's default
sequence created ties and non-deterministic placement. I reserved sequence ranges
per interface so both humans and the provider had one stable ordering model.

## Disabled rules can still block deletion

One migration exposed another appliance quirk. A disabled legacy rule still
referenced an alias, and that reference prevented OpenTofu from deleting the
alias. From an operator's perspective the rule was inactive. From the appliance's
validation perspective it still existed.

The fix was to remove the obsolete legacy rule, not merely disable it.

This is why I avoided bulk cleanup during adoption. Relationships that do not
affect packet evaluation can still affect schema validation and deletion order.

## Migrating NAT separately

Filter rules and NAT rules may appear together in the GUI, but they are not the
same ownership boundary. Some legacy firewall rules carried an association to a
generated NAT rule that the provider could not preserve. I migrated NAT in a
later phase after filter behavior was stable.

The NAT provider also had schema gaps: some labels were unavailable, some port
fields rejected aliases, and protocol values normalized differently from the
appliance. These limitations did not invalidate the whole migration. They defined
which details stayed appliance-managed and which needed a different expression.

I left settings in the GUI when the provider could not safely read and write
them. It is better to document that boundary than force an incomplete resource
to own it.

## Secrets and state

An API-driven firewall migration touches credentials in several places:

- firewall API keys;
- VPN static keys and certificates;
- wireless pre-shared keys;
- remote-state access credentials.

I kept secrets encrypted outside the HCL and injected them into provider or
resource variables only for the command that needed them. That keeps plaintext
out of source files, but it does not automatically keep secrets out of state.
Provider schemas may still serialize sensitive values into the state backend.

The state backend therefore needs the same protection as the firewall backup:
access control, encryption, and a tested recovery procedure. If the backend has
no locking, only one writer can safely apply at a time.

Import declarations are worth retaining as disaster-recovery documentation. A
state loss otherwise also loses the mapping between stable resource names and
opaque appliance UUIDs.

## Checks used for each resource type

For every new resource family, I now ask:

### Before import

- Does the provider read and write the same API representation?
- Which live fields are absent from the schema?
- Which provider defaults differ from appliance defaults?
- Can this resource interrupt the management path, power, DHCP, DNS, or WAN?
- Is there a read-only way to inspect the compiled/effective result?

### Before the first apply

- Is the plan a no-op after import?
- Are secret values present at runtime but absent from source?
- Is the first apply limited to one object or one low-risk segment?
- Is there an independent management path and a rollback artifact?

### After apply

- Did a real client receive the expected service, not merely a green status?
- Does the compiled firewall order match the intended order?
- Did the appliance preserve fields the provider does not expose?
- Does a second plan return to no changes?

## Final setup

Not every OPNsense setting is managed by OpenTofu. Some remain in the GUI because
the provider cannot represent or write them safely. What I have now is a clear
list of which tool owns each resource and a repeatable process:

- import live state;
- insist on zero drift;
- change one boundary at a time;
- inspect the effective system, not just the tool's model;
- preserve a way back in.

The main rule is to get a no-change plan after import and then apply one small
change. Also verify from a real client. In the DHCP incident, the daemon was
healthy and the apply succeeded, but clients received leases without a gateway
or DNS server.
