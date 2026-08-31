---
date: "2026-08-04T00:00:00+05:30"
description: Issues I faced while setting up OPNsense HA with CARP, pfsync and Kea
featured_image: ""
tags:
- guide
- networking
- firewall
- high-availability
- carp
title: Setting up OPNsense HA with CARP and pfsync
---

I run two OPNsense VMs, one on `metalbox` and another on `heavymetal`. I wanted
the second firewall to take over the gateway, DNS, DHCP and existing connections
when the first host was unavailable.

CARP itself was the easy part. The difficult parts were the services around it.
When I first booted the backup firewall, the network reached around 160,000
packets per second and became unusable. Later, CARP moved the IP correctly but
DNS stopped and existing TCP connections were lost.

Below is how I configured the full setup and the issues I found while testing it.

## The HA setup

The finished design runs two OPNsense VMs on separate NixOS hypervisors. Node A
runs on `metalbox`; node B runs on `heavymetal`. Clients keep using the familiar
`.1` gateways on each internal VLAN, now implemented as CARP VIPs. The nodes have
real `.6` and `.7` management addresses, and a dedicated VLAN 67 sync link at
`10.100.67.6/28` and `10.100.67.7/28`.

{{< mermaid caption="The completed OPNsense HA topology separates client VIPs from node management and the VLAN 67 control plane." >}}
flowchart TB
	CLIENTS[LAN, THINGS, QUANTUM and SERVERS clients] --> VIPS[CARP gateway VIPs ending in .1]
	INTERNET[PPPoE uplink] --> WANVIP[WAN CARP VIP 192.168.1.5]

	subgraph M[metalbox NixOS hypervisor]
		A[OPNsense A - preferred MASTER]
		AREAL[Real addresses ending in .6]
		A --- AREAL
	end

	subgraph H[heavymetal NixOS hypervisor]
		B[OPNsense B - BACKUP]
		BREAL[Real addresses ending in .7]
		B --- BREAL
	end

	VIPS --> A
	VIPS -. failover .-> B
	WANVIP --> A
	WANVIP -. failover .-> B
	A ==>|VLAN 67: XMLRPC, pfsync, Kea HA| B
{{< /mermaid >}}

There are four separate parts in this setup:

- CARP moves gateway and service IP addresses between nodes.
- Configuration sync keeps rules and services aligned.
- State sync copies the firewall state table so established connections live.
- Application-level HA makes services such as DHCP and mDNS behave correctly.

I configured and tested them one at a time.

## Configure CARP on the first node

Before introducing a backup, I converted the existing firewall into a single
CARP master. Its old gateway addresses became virtual IPs, while the firewall
received separate real addresses for management. The WAN source-NAT rule also
changed to use the WAN virtual IP, so outbound traffic would retain the same
source after a failover.

This stage sounds redundant: why configure failover with only one node? Because
it isolates the address migration from the redundancy problem. I could prove that
clients still reached their familiar gateways, outbound NAT used the expected
address, and management remained available before another system was allowed to
advertise anything.

It also established a useful naming pattern:

- one stable name for the firewall service, resolving to the virtual IP;
- one node-specific name per firewall, resolving to its real address.

When HA itself is broken, the node-specific addresses are the way back in.

## Booting the backup caused an mDNS storm

The second node started from a copy of the first node's configuration. Its CARP
advertisement priority was lower, so it should have stayed in BACKUP. Within
roughly 30 to 60 seconds, however, the network flooded.

The timing made a split-brain theory persuasive. I checked the usual suspects:

- shared CARP passwords matched;
- virtual host IDs matched;
- the master and backup had the intended advertisement skew;
- multicast advertisements arrived on every VLAN;
- the backup remained silent in BACKUP instead of advertising as another master.

These checks showed CARP was working as expected. I then captured the traffic
causing the packet storm.

The breakthrough was to stop looking only at CARP packets and inspect the storm
itself. Almost all of it was UDP port 5353: multicast DNS. Both node MAC addresses
were flooding at similar rates.

The copied configuration had enabled an mDNS repeater on both firewalls. Each
reflector received packets repeated by the other and reflected them again across
the same interfaces. A small amount of multicast became an exponential loop.

{{< mermaid caption="OPNsense B inherited the active mDNS repeater configuration. Each node reflected the other's reflected packets until the LAN reached roughly 160,000 packets per second." >}}
sequenceDiagram
	participant Device as mDNS device
	participant A as OPNsense A reflector
	participant B as OPNsense B reflector
	participant LAN as Other VLANs

	Device->>A: Multicast query on UDP 5353
	A->>LAN: Reflect query
	LAN->>B: Reflected query arrives
	B->>LAN: Reflect it again
	LAN->>A: Re-reflected query arrives
	loop Exponential amplification
		A->>LAN: Reflect B's copy
		LAN->>B: Deliver A's copy
		B->>LAN: Reflect A's copy
		LAN->>A: Deliver B's copy
	end
{{< /mermaid >}}

The firewall software had the correct feature for this situation: enable the
repeater only while the node is CARP master. I configured the service identically
on both nodes but enabled its CARP-aware failover mode. The backup retained the
configuration without running the reflector until promotion.

The same check is needed for any service that broadcasts or reflects traffic.
Copying the configuration to the backup can make both instances active at the
same time.

## Dedicated network between the firewalls

I added VLAN 67 between the firewalls for control traffic. It had no client
gateway and no virtual IP. OPNsense A used `10.100.67.6/28`, OPNsense B used
`10.100.67.7/28`, and a tightly scoped firewall rule allowed traffic only within
that sync subnet.

The lack of a default pass rule on a newly assigned firewall interface was an
early trap. Both addresses existed, but all layer-3 traffic was silently dropped
until the sync-network rule was installed. Link state and correct addresses do
not prove that the control plane can communicate.

The dedicated link carried config sync, pfsync, and DHCP peer communication. It
also kept that traffic away from client VLANs and gave packet captures a much
cleaner place to answer "did the peers actually talk?"

{{< mermaid caption="CARP is only the address-ownership layer; three separate protocols cross VLAN 67 to preserve configuration, leases, and live connections." >}}
flowchart LR
	A[OPNsense A 10.100.67.6] ==>|XMLRPC: configuration A to B| B[OPNsense B 10.100.67.7]
	A <-->|pfsync: firewall states| B
	A <-->|Kea HA: leases and peer health| B

	CARP[CARP advertisements on client VLANs] -.-> A
	CARP -.-> B
{{< /mermaid >}}

## Problems with configuration sync

The config-sync page looked straightforward: peer address, username, password,
and a list of areas to synchronize. It failed for five independent reasons.

### Management ports were different

One node exposed its GUI directly on the default HTTPS port. The other listened
on a non-default local port behind a reverse proxy. Config sync contacted the
peer's real address, not the public proxy name, so both web services needed a
reachable and explicitly matching port.

### GUI was not listening on the sync interface

The backup's web server listened only on its LAN interface. A TCP connection over
the dedicated sync address therefore had nowhere to land. Adding the sync
interface to the GUI's listen scope fixed the transport without widening client
access.

### Certificate verification failed

The peers used a self-signed management certificate over a private, dedicated L2
link. Certificate verification failed before credentials were considered. In
this topology I disabled peer verification for the sync call. A better option,
when supported, is to give each node a certificate chaining to an internal CA.

### The sync user needed another privilege

The user could open the HA configuration page but could not call the XMLRPC
library. "High Availability" GUI access and XMLRPC execution were separate
permissions. Granting only the narrowly required library privilege fixed the API
call without turning the account into an administrator.

### Changes were not pushed automatically

The largest conceptual surprise was that saving a configuration did not
necessarily push it to the backup. The GUI's explicit "synchronize all" action
worked, but ordinary changes and infrastructure-as-code applies did not invoke it.

I added a post-apply hook that calls the firewall's sync endpoint. GUI-only edits
still require the operator to trigger synchronization, so the operating rule is
simple: one node is authoritative; the backup is not a second place to edit.

The reusable lesson is to test config sync as an action, not as a checkbox. Change
a harmless object on the primary, trigger the documented sync path, and prove it
appears on the backup.

## Kea DHCP hot standby

CARP moving the gateway does not automatically make the backup DHCP server safe.
Two independent DHCP servers with copied configuration can both answer clients,
while a master-only DHCP service can leave an availability gap during promotion.

I used Kea's hot-standby mode over the sync network. The primary serves leases
under normal conditions; the standby receives lease updates and takes over after
it decides the partner is down.

The configuration failed when both peers used the same server name. Kea requires
`this-server-name` to match one of the declared peer names. Explicitly writing the
primary's name into synchronized configuration made both nodes identify as the
primary.

I gave the firewalls distinct hostnames, declared those as peer names, and left
`this-server-name` empty so each node derives its identity locally. The node
identity cannot be copied from primary to backup.

Hot standby also has a detection interval. In this case the standby waited about
a minute before entering partner-down mode. Existing clients with leases stayed
online; a new or renewing client might wait. That is not a broken failover, but it
is part of the service-level objective and should be measured rather than assumed.

## Unbound stopped answering after failover

With CARP working, the virtual gateway moved cleanly to the backup. Clients could
route, but DNS queries to the gateway timed out.

The resolver had been configured to bind selected interfaces. On the backup,
virtual IPs do not exist while it is in BACKUP. When the resolver configuration
was regenerated, the absent virtual address disappeared from the generated
listen set. CARP later promoted the node and created the address, but the resolver
was not listening there.

The fix was to let the resolver listen on all local interfaces using its automatic
interface behavior. Firewall policy, rather than a brittle application bind list,
controlled which networks could reach port 53.

This is a broader HA pattern: applications should not permanently compile a list
of addresses whose presence changes with ownership. Either bind wildcard/automatic
and enforce access in the firewall, or use a service hook that reacts correctly
to every promotion and demotion.

## Keeping connections with pfsync

At this point a cable pull promoted the backup, moved the virtual IPs, and kept
DNS and DHCP available. Yet established TCP sessions still died.

That was expected in retrospect. A stateful firewall tracks sequence numbers,
NAT translations, timeouts, and policy decisions in a state table. The backup
cannot infer that state from a newly arrived midstream packet.

I enabled pfsync on both nodes using explicit unicast peer addresses on the sync
network. Configuring only one direction was not sufficient; each node needed to
send and receive state because either could be active after maintenance or a
second failure.

The acceptance test was deliberately mundane: start a long-lived transfer, pull
the active firewall's network cable, and watch whether the transfer continues.
After bidirectional state sync was working, it did.

That test proved something a successful ping never could.

## How I tested the failover

I ended with a matrix instead of a single "HA works" result:

| Test | What it proves |
|---|---|
| Primary enters maintenance mode | Graceful CARP demotion and backup promotion |
| Primary loses its cable | Failure detection without operator help |
| Fail back to the original node | Prior master can safely resume ownership |
| DNS query during promotion | Resolver listens correctly on the new owner |
| New DHCP request after peer timeout | Standby has leases and enters partner-down |
| Long TCP transfer during cable pull | State and NAT translations were synchronized |
| Config change on primary | Explicit sync path updates the backup |
| Boot both nodes from cold | Broadcast services do not duplicate or loop |

Running the matrix in both directions exposed assumptions hidden by testing only
the preferred primary.

## Final checks

Moving the virtual IP was only one of the checks. The setup was complete when:

- there is exactly one active owner for each singleton or broadcast service;
- both nodes carry compatible configuration without becoming competing writers;
- DHCP and DNS continue according to measured failover timing;
- established stateful connections survive a hard loss;
- operators can reach either node through a real, node-specific address;
- the behavior has been proven by removing the active node, not inferred from a
	green status page.

The main issue I found was assuming that copying a service configuration also
made the service HA-aware. The mDNS repeater had to run only on the CARP master,
Kea needed its own peer state and Unbound needed to listen on an address which
appears only after promotion.

Finally, test with a real cable pull and a long-running connection. A successful
ping after pressing the CARP maintenance button does not verify pfsync or the
hard-failure path.
