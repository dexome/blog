---
date: "2026-07-30T00:00:00+05:30"
description: What went wrong when I moved my PPPoE WAN through an Omada switch and VLAN 999
featured_image: ""
tags:
- guide
- networking
- pppoe
- isp
- wan
title: Moving My PPPoE WAN to VLAN 999
---

I wanted to move the WAN connection from a dedicated port on OPNsense to VLAN
999 through my Omada switch. This would allow both OPNsense nodes to reach the
same ONT connection and was needed for the HA setup.

The PPPoE username, password and ONT were not changing. I had already configured
the VLAN and expected the Internet to be down only for the time needed to move
the cable and connect again.

It did not work that way. The first connection failed because I had left the old
PPPoE session active at the ISP. Once I fixed that, the connection dropped again
because the Omada switch was sending loop-detection packets towards the ONT.

This post covers both issues and the order I now use for a PPPoE cutover.

## The setup

The old topology was direct. The Syrotech GPON ONT connected to the bare-metal
OPNsense firewall's `igc0` interface. The new design moved that Ethernet segment
onto VLAN 999 through a TP-Link Omada TL-SG2008P, then carried the tag over a
trunk to OPNsense as `igc2_vlan999`.

{{< mermaid caption="The WAN migration inserted an Omada switch and VLAN 999 between the Syrotech ONT and OPNsense." >}}
flowchart TB
	BEFORE["Before<br/>Syrotech ONT to OPNsense igc0 to PPPoE"]
	AFTER["After<br/>Syrotech ONT to Omada TL-SG2008P to VLAN 999 to OPNsense igc2_vlan999 to PPPoE"]
	BEFORE -->|Move WAN onto the managed-switch trunk| AFTER
{{< /mermaid >}}

The VLAN setup looked correct. A test device on the same path could reach the
management IP of the ONT and packet captures showed the expected VLAN traffic.
So I pulled the cable from the old port, moved it and enabled the new interface.

The connection never completed.

Packet captures showed PADI discovery frames leaving the firewall, but the
expected PADO response did not come back. At other points the logs showed LCP
negotiation repeating with new magic numbers, never reaching a usable session.
It looked close enough to working to keep sending me down the wrong paths.

## Checking the VLAN first

VLANs are an obvious suspect because they can fail silently. An access port can
be untagged in the wrong VLAN, a trunk can omit the tag, or a native VLAN can
consume traffic that was supposed to remain tagged.

I tested the transport independently of PPPoE. A client attached to the same
logical path could reach the optical terminal's management network. Captures on
the firewall showed the expected Ethernet discovery frames on the expected VLAN.
That did not prove every switch behavior was correct, but it proved that this was
not simply a missing tag.

## Checking the WAN MAC

Many providers bind service to a router or ONT MAC address, so MAC locking was
the next theory. I tried preserving the previous WAN MAC and inspected the
provider-facing frames. It was a reasonable theory, but it did not explain the
behavior.

Some ISPs lock the connection to a MAC address, so this was still worth checking.
There are three separate things which can cause a new router or port to fail:

1. Does the provider authenticate only with a username and password?
2. Does it also remember the client MAC?
3. Does it permit more than one simultaneous PPPoE session on the line?

All three look similar from OPNsense. In my case, the third one was the problem.

## Closing the old PPPoE session

I had moved the cable while PPPoE was still active. That is not a clean session
shutdown.

A graceful PPPoE disconnect sends a PADT (PPPoE Active Discovery Terminate), or
terminates the link through PPP before removing the carrier. A cable pull sends
neither. From the ISP access concentrator's point of view, the old session can
remain alive until its own timeout expires.

The provider allowed one session on the line. My new firewall interface was not
replacing the old session; it was asking for a second one while the first still
existed upstream.

That explained why waiting sometimes appeared to fix the problem. A long
power-off interval gave the stale session time to age out. It also explained why
rechecking credentials and VLAN tags accomplished nothing. The obstacle was not
in my current configuration at all.

The reliable cutover was:

1. Leave the old WAN connected.
2. Disconnect or disable PPPoE on the old interface.
3. Verify that a PADT leaves the old interface.
4. Move the cable or change the VLAN assignment.
5. Enable PPPoE on the new interface.

{{< mermaid caption="The cable pull left the old session alive at the ISP; a PADT-first cutover explicitly closed it before the new interface dialled." >}}
sequenceDiagram
	participant Old as OPNsense igc0
	participant BRAS as ISP access concentrator
	participant New as OPNsense igc2_vlan999

	Old->>BRAS: PPPoE session established
	Note over Old,BRAS: Cable pulled without LCP Terminate or PADT
	New->>BRAS: PADI from VLAN 999
	BRAS--xNew: One-session policy blocks new session
	Note over BRAS: Old session remains until timeout
	Old->>BRAS: PADT during controlled retry
	BRAS-->>Old: Old session removed
	New->>BRAS: PADI then PADR
	BRAS-->>New: PADO then PADS
	Note over New,BRAS: New PPPoE session succeeds
{{< /mermaid >}}

On a BSD-based firewall, a capture like this is enough to observe the discovery
traffic:

```sh
tcpdump -ni <wan-interface> -e ether proto 0x8863
```

The exact command used to disconnect varies by platform. I prefer the firewall's
normal interface disconnect action because it follows the same control path the
system uses in production. The capture is there to prove the shutdown emitted a
termination frame before any cable moved.

With the old session closed first, the new interface authenticated normally.

The connection came up on VLAN 999 after this. But it did not stay up.

## Omada loop detection on the ONT port

The PPPoE session later failed again, this time after it had already been stable.
The pattern was different: discovery could be blocked outright, or an established
session would disappear several minutes later.

The managed switch between the firewall and optical terminal had loop-detection
features enabled. It injected control traffic into the provider-facing bridged
segment: first spanning-tree-style frames, then vendor loopback-detection probes.
On an ordinary LAN those features can be useful. On a transparent WAN transport,
the ISP side is not an ordinary LAN and did not appreciate the extra frames.

The fix was not to disable protection across the whole switch. I disabled
loopback control only on the port connected to the optical terminal. The WAN
VLAN remained isolated and tagged exactly as before; only the switch's active
probing stopped.

{{< mermaid caption="Two independent faults occupied the same WAN path and failed on different timelines." >}}
flowchart TD
	MOVE[Move ONT cable from igc0 to VLAN 999] --> IMMEDIATE{When does it fail?}
	IMMEDIATE -->|Immediately| STALE[Old PPPoE session still held by ISP]
	STALE --> PADT[Disconnect old WAN and verify PADT]
	PADT --> UP[PPPoE connects on igc2_vlan999]
	IMMEDIATE -->|Minutes after connecting| PROBES[Omada loopback-control probes enter WAN segment]
	PROBES --> DROP[Established PPPoE session drops]
	DROP --> PORT[Disable Loopback Control on ONT-facing port]
	PORT --> STABLE[Session remains stable through soak and reboot]
{{< /mermaid >}}

After that per-port change, the PPPoE session stayed up through the observation
window and survived reboots of the relevant equipment.

Initially I thought the earlier fix was incomplete, but this was a separate
problem on the same path:

- the cutover failed immediately because the old PPPoE session was never closed;
- the repaired connection later failed because the switch injected control
  traffic into the WAN bridge.

## The migration steps I use now

Below is the order I now use when moving a live PPPoE WAN between ports, VLANs or
firewall nodes.

### Before the maintenance window

- Record the working parent interface, VLAN ID, MTU, credentials source, and WAN
  MAC.
- Confirm whether the provider documents MAC binding or single-session limits.
- Preconfigure the destination interface without enabling it.
- Verify the VLAN at layer 2 independently of PPPoE when possible.
- Review the ISP-facing switch port for spanning tree, loop detection, LLDP,
  discovery, or other active control protocols.
- Keep a management path that does not depend on the WAN being migrated.

### During the cutover

```text
old PPPoE connected
	│
	▼
disconnect old PPPoE cleanly
	│
	▼
observe PADT / termination
	│
	▼
move cable or VLAN ownership
	│
	▼
enable new PPPoE interface
	│
	▼
verify discovery, LCP, IPCP, route and DNS
```

Do not clone the MAC reflexively. Preserve it only when you know the provider
requires it or when a controlled test demonstrates that it matters. Unnecessary
MAC duplication is especially hazardous if old and new devices can be online at
the same time.

### After the session comes up

Do more than check that a public IP appeared:

- inspect the PPP logs for successful LCP and IPCP negotiation;
- confirm the default route uses the new interface;
- test DNS through the normal client path;
- verify the negotiated MTU with don't-fragment pings;
- keep the session under observation long enough to catch periodic switch probes;
- reboot the switch or firewall if reboot survival is part of the acceptance
  criteria.

The distinction between "connected once" and "operationally complete" saved me
from calling the migration finished before the loop-detection failure surfaced.

## Key things to check

The immediate failure and the delayed failure had different causes. If PPPoE
does not connect after moving a cable, first check whether the old session was
closed properly. If it connects and drops later, check what the switch is sending
on the WAN VLAN.

Also, a managed switch is not always transparent. Disable STP, loop detection or
similar active features on the ONT-facing port unless you know the ISP path can
handle them.

Most importantly, disconnect PPPoE before moving the cable and verify the PADT in
a packet capture. Waiting for the ISP timeout also worked, but it made a simple
cutover take much longer than needed.
