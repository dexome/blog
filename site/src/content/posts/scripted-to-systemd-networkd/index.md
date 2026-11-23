---
pubDatetime: "2026-06-18T00:00:00+05:30"
description: How I moved my NixOS VLAN setup from startup scripts to systemd-networkd and a VLAN-aware bridge
tags:
- guide
- networking
- linux
- systemd-networkd
- bridge
- vlan
title: Moving My NixOS Network to systemd-networkd
---

My NixOS server `heavymetal` already had multiple VLANs, static IP addresses and
macvlans used by containers. They were created using startup scripts and worked,
but restarts and NixOS activations did not always recreate them in the correct
order.

I first moved the same setup to systemd-networkd. Later, when I needed to attach
VM tap interfaces to the VLANs, I added per-VLAN bridges and finally replaced
them with one VLAN-aware bridge.

The migration happened in three steps:

1. replace imperative networking with networkd units;
2. move host addresses from VLAN devices onto stable per-VLAN bridges;
3. consolidate those bridges into a single VLAN-aware trunk.

I did not apply the bridge migrations live because they moved the same management
IP used by SSH. Those changes were staged for boot with console access available.

```mermaid caption="The network evolved in three controlled steps rather than jumping directly from scripts to the final VLAN-aware bridge."
flowchart TB
	S["Scripted VLAN and<br/>macvlan devices"] --> N["systemd-networkd owns<br/>the same topology"]
	N -->|Parent restart exposes child lifecycle| P["Per-VLAN bridges<br/>brvlan20 / brvlan30 / brvlan100"]
	P -->|Stable parents enable VM taps| T["VLAN-aware bridge<br/>brtrunk"]
```

## The old startup scripts

The old system created VLAN and macvlan devices through a mixture of higher-level
configuration and startup services. Conceptually it did this:

```sh
ip link add link enp5s0 name enp5s0.100 type vlan id 100
ip address add 10.100.100.20/24 dev enp5s0.100
ip link set enp5s0.100 up

ip link add link enp5s0.100 name tfkshim type macvlan mode bridge
ip link set tfkshim up
```

Imperative commands are easy to prototype, but they hide ownership questions:

- Which service owns the VLAN device?
- What should restart when the parent disappears?
- Is the address ready before a dependent service binds it?
- What removes stale devices after a failed partial run?
- Does a config reload destroy children created by another service?

The scripts encoded answers in execution order rather than in the topology.

## Recreate the same network with networkd

I moved each concern into an explicit networkd object: VLAN `.netdev` units,
matching `.network` units for addresses and routes, and dependencies for services
that needed those links.

On NixOS, a simplified VLAN looks like this:

```nix
systemd.network.netdevs."10-vlan20" = {
	netdevConfig = {
		Name = "vlan20";
		Kind = "vlan";
	};
	vlanConfig.Id = 20;
};

systemd.network.networks."40-vlan20" = {
	matchConfig.Name = "vlan20";
	address = [ "10.20.0.10/24" ];
	routes = [ { Gateway = "10.20.0.1"; } ];
	networkConfig.RequiredForOnline = "routable";
};
```

The exact syntax is distribution-specific; the systemd concepts are not. A
`.netdev` creates a virtual device. A `.network` matches a device and assigns
addresses, routes, VLAN membership, bridge membership, and online-state
requirements.

The important part was preserving topology exactly. This was not the moment to
rename every interface or collapse five networks into one bridge. First I needed
networkd to reproduce the working system.

## systemd-resolved broke container DNS

Enabling networkd on NixOS also enabled systemd-resolved through a distribution
default. The host continued to resolve names, so the change initially looked
healthy. But `/etc/resolv.conf` now pointed at the loopback stub:

```text
nameserver 127.0.0.53
```

Containers copied that file into their own network namespaces. From inside a
container, `127.0.0.53` meant the container itself, not the host's resolved
service. External name resolution failed even though host DNS worked.

I explicitly disabled resolved and retained a static resolver address reachable
from both the host and containers. Running resolved would also have been valid if
the container DNS path had been designed for it. The failure came from changing
resolver architecture as an accidental side effect of changing interface
management.

The check I added was simple:

```sh
cat /etc/resolv.conf
podman exec <container> cat /etc/resolv.conf
podman exec <container> getent hosts example.com
```

A host-only lookup is not enough after a network-manager migration.

## Restarting a VLAN removed its macvlan children

An older deployment had already revealed a more disruptive lifecycle problem.
When the service owning a VLAN netdev restarted, it deleted and recreated the
parent device. Linux also deleted every macvlan child attached to that parent.

The container runtime's database still believed the container was attached. The
actual network namespace contained only loopback and an unrelated bridge. The
reverse proxy logged that its interface had been removed and lost its virtual
address.

The journal made the sequence visible:

```text
VLAN netdev service stopped
parent link deleted
macvlan child removed by kernel
container remains running without expected interface
```

```mermaid caption="Deleting and recreating the VLAN parent also deleted the live macvlan child, while Podman's stored attachment remained stale."
sequenceDiagram
	participant Apply as NixOS activation
	participant Parent as enp5s0.100 netdev
	participant Kernel as Linux kernel
	participant Child as tfkshim macvlan
	participant Podman as Traefik container

	Apply->>Parent: Stop and delete VLAN netdev
	Parent->>Kernel: ip link del enp5s0.100
	Kernel--xChild: Delete every macvlan child
	Child--xPodman: eth0 removed from namespace
	Note over Podman: Container keeps running and DB still says attached
	Apply->>Parent: Recreate VLAN netdev
	Note over Parent,Podman: Parent returns but child does not
```

At first I coupled the container-network service lifecycle to the parent netdev
service: if the parent restarted, the container networks and their consumers
restarted and reattached. That repaired the immediate inconsistency.

It also made the weakness of the topology clear. Long-lived workloads were
attached directly to a device that configuration reconciliation was allowed to
destroy.

## Adding one bridge per VLAN

I needed the same VLANs to be shared with ThingsHQ microVM tap devices. A macvlan
parent cannot serve that role cleanly, so I created always-on host bridges such
as `brvlan20` and `brvlan100`.

The VLAN uplink became an addressless bridge port. The host address moved to the
bridge. Containers and VMs attached to the bridge rather than directly to the
VLAN netdev.

A simplified networkd definition looks like:

```nix
systemd.network.netdevs."10-br-vlan20" = {
	netdevConfig = {
		Name = "br-vlan20";
		Kind = "bridge";
	};
};

systemd.network.networks."40-vlan20" = {
	matchConfig.Name = "vlan20";
	networkConfig.Bridge = "br-vlan20";
	linkConfig.RequiredForOnline = "enslaved";
};

systemd.network.networks."40-br-vlan20" = {
	matchConfig.Name = "br-vlan20";
	address = [ "10.20.0.10/24" ];
	routes = [ { Gateway = "10.20.0.1"; } ];
	networkConfig.RequiredForOnline = "routable";
};
```

This transition could not be safely applied live. A macvlan cannot be re-parented
in place. Networkd could not enslave the VLAN uplink to the new bridge while the
live macvlan child still depended on it, and deleting the child would remove the
remote management path carried by the reverse proxy.

Instead of a live configuration switch, I staged the new boot generation and
rebooted through a console-backed maintenance path. At boot, every device was
created in the new topology from an empty state. The previous generation remained
selectable in the boot menu if the new management address did not come up.

That was not excessive caution. "Same IP, different owning device" is still a
remote access migration.

## Moving to one VLAN-aware bridge

Per-VLAN bridges solved the VM-sharing problem, but the host eventually needed a
larger trunk topology. Five bridges and five VLAN uplinks repeated the same
structure and made VM trunk attachment awkward.

The next design used a single bridge named `brtrunk` with VLAN filtering.

```mermaid caption="In the final design, enp5s0 is a bridge port; brtrunk owns VLAN filtering, while host L3 exists only on selected VLAN interfaces."
flowchart LR
	SWITCH[Omada trunk] ==>|tagged VLANs| NIC[enp5s0]
	NIC --> BR[brtrunk VLAN-aware bridge]
	BR --> ADMIN[brtrunk.100: host admin 10.100.100.20]
	BR --> THINGS[brtrunk.20: Things services]
	BR --> QUANTUM[brtrunk.30: VPN services]
	BR --> VMS[OPNsense and ThingsHQ VM tap ports]
	BR --> ISOLATED[VLAN 67 sync and VLAN 999 WAN transport: no host L3]
```

In networkd terms, the bridge enables VLAN filtering and the physical interface
is enslaved as a trunk port:

```nix
systemd.network.netdevs."10-br-trunk" = {
	netdevConfig = {
		Name = "brtrunk";
		Kind = "bridge";
	};
	bridgeConfig = {
		VLANFiltering = true;
		DefaultPVID = 1;
	};
};

systemd.network.networks."40-physical-trunk" = {
	matchConfig.Name = "enp5s0";
	networkConfig.Bridge = "brtrunk";
	linkConfig.RequiredForOnline = "enslaved";
};
```

The host's management address moved from a per-VLAN bridge onto a VLAN interface
of the trunk bridge. Some transport VLANs existed only inside the bridge and had
no host-layer address at all.

Again, I staged the configuration for the next boot rather than attempting to
replace the bridge beneath an active SSH session. The migration changed the
master of the physical NIC, removed several bridges, recreated VLAN interfaces,
and moved the default route. A reboot was the deterministic path.

## Conflicting forwarding sysctls

After one deployment, host-to-container routing failed even though
`net.ipv4.ip_forward` appeared in the configuration.

Linux exposes closely related forwarding sysctls:

```text
net.ipv4.ip_forward
net.ipv4.conf.all.forwarding
```

Modules had written both aliases with conflicting values. The canonical
per-family setting remained zero at runtime, leaving forwarding disabled. I made
both values explicit:

```nix
boot.kernel.sysctl = {
	"net.ipv4.ip_forward" = 1;
	"net.ipv4.conf.all.forwarding" = 1;
	"net.ipv6.conf.all.forwarding" = 1;
};
```

Both names refer to closely related kernel settings and another module can write
one after the other. So I check the runtime values after activation:

```sh
sysctl net.ipv4.ip_forward
sysctl net.ipv4.conf.all.forwarding
sysctl net.ipv6.conf.all.forwarding
```

The kernel is the final source of truth.

## Source-only addresses and automatic routes

The host also had secondary interfaces used only to originate scans or reach
macvlan workloads. Those addresses must not automatically install connected
prefix routes if another interface owns the real return path.

I set `AddPrefixRoute=false` on those source-only legs and kept reverse-path
filtering loose where asymmetric routes were intentional. Otherwise Linux could
prefer the newly connected `/24`, send replies out the wrong interface, and turn
a harmless scan address into an SSH lockout.

This is a niche detail with a broad principle: every new address can also create
a route. During migrations, compare the routing table, not just the address list.

## Checks after each migration

After each stage I checked the system from the bottom up.

### Link ownership

```sh
networkctl status
ip -br link
ip -br address
```

- Is the physical NIC enslaved to the intended bridge?
- Are VLAN devices attached to the intended parent?
- Is each host address on the bridge/VLAN device, not the addressless port?

### Routes and forwarding

```sh
ip route
ip -6 route
sysctl net.ipv4.conf.all.forwarding
```

- Is there exactly one intended default route?
- Did source-only addresses add unwanted connected routes?
- Is forwarding enabled in runtime state?

### Namespaces

- Can a container resolve DNS?
- Does its namespace contain every expected interface?
- Can it reach both an internal backend and an external endpoint?
- Does restarting the parent/network service reattach the child cleanly?

### Reboot behavior

- Does the host return on the management address without manual intervention?
- Do services wait for the interface state they actually require?
- Does a second ordinary configuration apply leave the topology intact?

## Final setup

systemd-networkd did not make the network itself simple, but it made device
ownership and startup dependencies visible. The order I would use again is:

1. reproduce the working topology declaratively;
2. observe the lifecycle failures that the old scripts concealed;
3. introduce stable bridge ownership;
4. consolidate only after the dependencies are understood;
5. stage non-live-reparentable changes for reboot with console rollback.

Do not assume a declarative network change is safe to apply over SSH. Moving a
management IP from a VLAN to a bridge still removes and recreates interfaces. For
those changes, I used a boot-time migration and kept the previous NixOS generation
available from the console.
