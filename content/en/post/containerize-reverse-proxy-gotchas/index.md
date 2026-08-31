---
date: "2026-08-29T00:00:00+05:30"
description: The three network failures I hit after moving Traefik from a native NixOS service into rootful Podman
featured_image: ""
tags:
- guide
- reverse-proxy
- containers
- traefik
- networking
title: Containerizing Traefik Broke Three Different Network Boundaries
draft: true
---

Traefik was healthy. Its container was running, its health check passed, and it
was listening on ports 80 and 443. Some applications opened normally.

Others returned `502 Bad Gateway`. Requests from a different VLAN timed out
without reaching Traefik at all. After one recreation, ingress worked briefly and
then disappeared again.

Those symptoms arrived together because I had moved Traefik from a native NixOS
service into a rootful Podman container. They were not one bug. Containerization
crossed three independent boundaries:

1. loopback stopped meaning the host;
2. a multi-homed network namespace chose the wrong return route;
3. the macvlan MAC changed while the gateway still remembered the old one.

The container image was never the hard part. The network namespace was.

## Why I moved Traefik

Native Traefik had accumulated proxy shims to reach services spread across host
processes, Podman bridges, and network containers. Moving Traefik itself into
Podman let it join application networks directly and removed a layer of socket
forwarding.

The resulting Traefik container joined three networks:

- `podman_network_vlan_100` for the ingress VIP `10.100.100.21`;
- `podman_rproxy` at `10.89.0.2` for host and internal backends;
- an internet bridge at `172.28.0.12` for outbound access.

{{< mermaid caption="Containerized Traefik is multi-homed: ingress, private backends, and Internet access are separate network legs." >}}
flowchart TB
	CLIENTS[Clients and OPNsense] -->|HTTPS to 10.100.100.21| VLAN[macvlan VLAN 100]
	VLAN --> T[Traefik 3.7.5]
	T -->|10.89.0.1 backend ports| HOST[podman_rproxy host gateway]
	HOST --> SERVICES[Netdata, Glances, Cockpit, go2rtc, Home Assistant]
	T -->|container DNS and updates| INET[172.28.0.0/24 Internet bridge]
{{< /mermaid >}}

That topology was intentional. What I underestimated was how much native
Traefik had inherited from the host namespace for free.

## Failure one: localhost moved

Several file-provider routes still targeted backends such as:

```yaml
servers:
  - url: http://127.0.0.1:19999
```

That URL worked when Traefik was a host process. Inside the container,
`127.0.0.1` referred to the Traefik container itself. Netdata, go2rtc, Cockpit,
and other host services had not moved with it.

The mixed result was misleading. Services sharing a Podman bridge continued to
work, while host-namespace and systemd-nspawn backends failed. Traefik remained
healthy because its own process and listeners were fine.

I tested from both sides of the namespace boundary:

```sh
# Works from the NixOS host
curl -fsS http://10.89.0.1:8123/

# Initially failed from Traefik's namespace
podman exec traefik wget -qO- -T2 http://10.89.0.1:8123/
```

The second command was the discriminating check. It removed DNS, TLS, and the
external firewall from the investigation.

The fix had three parts:

1. Bind host services to the `podman_rproxy` gateway, `10.89.0.1`, rather than
   relying on loopback.
2. Allow only the required backend ports on the `podman_rproxy` interface in the
   NixOS firewall.
3. Change Traefik's backend URLs from `127.0.0.1` to `10.89.0.1`.

For Netdata, I also widened its application-level allow list from localhost to
the `10.89.0.0/24` proxy subnet. Opening the host firewall alone would not have
overridden the service's own filter.

{{< mermaid caption="The same URL points at a different machine after Traefik crosses into a container namespace." >}}
flowchart TB
	subgraph NATIVE[Native Traefik]
		NT[Traefik process] -->|127.0.0.1| NS[Host service]
	end
	subgraph CONTAINER[Containerized Traefik]
		CT[Traefik container] -->|127.0.0.1| SELF[Traefik container loopback]
		CT -->|10.89.0.1| HS[Host service on podman_rproxy]
	end
	NT -. moved into container .-> CT
{{< /mermaid >}}

The 502s disappeared, but off-subnet clients still timed out.

## Failure two: the request arrived on one leg and left on another

Traefik had more than one default route because netavark attached multiple
networks. The route selected during one container creation was not guaranteed to
be the same route selected after another.

Clients on VLAN 100 were on-link with the macvlan VIP, so replies used the
connected route and worked. A client from another VLAN reached `10.100.100.21`
through OPNsense, but Traefik's reply followed the internet bridge's default
route. The request entered through the macvlan and the response tried to leave
through a different gateway.

```text
off-subnet request: client -> OPNsense -> Traefik macvlan
wrong reply:        Traefik -> Podman Internet bridge -> nowhere useful
```

This produced an empty access log for some tests because the return-path failure
happened before the client could complete a useful HTTP exchange. An on-subnet
test gave a false sense of success.

Inside Traefik's network namespace, `ip route get <client-address>` exposed the
selected gateway. I installed an explicit lower-metric default route through the
VLAN 100 gateway:

```sh
ip route replace default via 10.100.100.1 metric 50
```

The internet-bridge route remained at metric 100. This was applied by the NixOS
unit after Podman created the namespace, so every recreation restored the same
decision.

{{< mermaid caption="Equal default routes made off-subnet replies nondeterministic; the lower-metric VLAN route restored symmetry." >}}
flowchart TB
	C[Client on another VLAN] -->|request| FW[OPNsense]
	FW -->|10.100.100.21| T[Traefik]
	T -. wrong default before fix .-> I[Internet bridge gateway]
	I -. dropped reply .-> C
	T -->|metric 50 after fix| FW
	FW -->|symmetric reply| C
{{< /mermaid >}}

After the route fix, off-subnet curls returned HTTP 200 and `ip route get`
showed the macvlan gateway. Then a later container recreation broke ingress once
more.

## Failure three: the IP stayed, the MAC changed

The macvlan attachment had a static IP but no static MAC. Podman generated a new
MAC when Traefik was recreated. OPNsense and the upstream switching path still
associated `10.100.100.21` with the previous MAC.

That explains the odd timing: the new container could work during a short window
when neighbor discovery happened to refresh, then traffic fell into the stale
entry. Container health and route tables looked correct because the black hole
was outside the namespace.

I pinned the attachment identity in the Podman network specification:

```nix
"podman_network_vlan_100:ip=10.100.100.21,mac=02:42:0a:64:64:15"
```

The locally administered `02:42` prefix avoids claiming a vendor identity. The
remaining octets encode the private address, which makes the value easy to audit.
More importantly, recreation no longer changes the layer-2 identity.

## The acceptance test I should have started with

A reverse proxy health check proves only that Traefik can answer inside its own
namespace. My final test matrix covered each boundary explicitly:

| Test | What it proves |
|---|---|
| Curl backend from NixOS host | Backend process is listening |
| Curl backend from Traefik container | Host firewall, bind address, and app allow list work |
| Request ingress from VLAN 100 | Macvlan listener and on-link return path work |
| Request ingress from a different VLAN | Routed return path uses the correct gateway |
| Inspect `ip route get` in the namespace | Route choice is deterministic |
| Recreate Traefik and repeat all tests | MAC and post-start route configuration persist |

I also checked the gateway neighbor entry after recreation rather than waiting
for a browser symptom.

## What changed in my mental model

I had treated containerizing Traefik as a packaging change: same binary, same
configuration, different process supervisor. It was actually a network redesign.

The native process could see host loopback, host routes, and host-bound services.
The container saw only the interfaces Podman attached. Once it had multiple
interfaces, route selection became part of the application deployment. Once a
macvlan carried a stable service IP, its MAC became persistent service state too.

My rule now is:

> Before containerizing an ingress service, inventory every namespace, route,
> bind address, firewall layer, and layer-2 identity it currently inherits.

The image may start on the first try. That does not mean the network followed it.
