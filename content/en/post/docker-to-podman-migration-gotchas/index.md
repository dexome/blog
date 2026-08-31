---
date: "2026-08-29T00:00:00+05:30"
description: What broke when I moved a 36-container NixOS host from Docker to rootful Podman, and the checks that made the migration repeatable
featured_image: ""
tags:
- guide
- containers
- docker
- podman
- linux
title: "Docker to Podman: The Runtime Swap Was the Easy Part"
draft: true
---

The line that started the migration looked almost trivial:

```nix
virtualisation.oci-containers.backend = "podman";
```

On my NixOS host, that line sat underneath 36 containers, custom bridge and
macvlan networks, static addresses, shared network namespaces, health checks,
GPU devices, bind mounts, and several services consuming the Docker API.

Podman was compatible with most of it. "Most" was enough to build a dangerous
first impression and not enough to complete an activation.

The useful way to tell this story is not as a Docker-versus-Podman feature list.
It is the sequence in which compatibility assumptions failed.

## Why make the change

I wanted a runtime that fit the host's existing systemd ownership model. Podman
gave me generated `podman-<name>.service` units, native health actions, a rootful
socket at `/run/podman/podman.sock`, and no long-running Docker daemon.

I intentionally did not enable `dockerCompat`. Traefik, Netdata, Glances, and
Dozzle were pointed at Podman's Docker-compatible API explicitly. Portainer and
the autoheal sidecar were removed; Cockpit Podman and
`--health-on-failure=kill` took their places.

{{< mermaid caption="The runtime changed under a declarative NixOS service graph; every explicit Docker unit and socket edge had to move with it." >}}
flowchart LR
	NIX[NixOS OCI declarations] --> UNITS[Generated systemd units]
	UNITS -->|before| D[Docker containers]
	UNITS -->|after| P[Podman containers]
	API[Traefik, Netdata, Glances, Dozzle] -->|before| DS["/var/run/docker.sock"]
	API -->|after| PS["/run/podman/podman.sock"]
	NET[Declared networks] --> NAV[netavark and aardvark-dns]
	NAV --> P
{{< /mermaid >}}

The migration began with mechanical changes: rename unit references from
`docker-*` to `podman-*`, change supplementary group membership from `docker` to
`podman`, and replace socket paths. Then the behavioral differences appeared.

## Gotcha one: Podman validates combinations Docker ignored

I replaced autoheal with Podman's native unhealthy action:

```text
--health-on-failure=kill
```

That option is valid only when the container has an explicit health command or
the image contains a baked `HEALTHCHECK`. Docker had tolerated the old setup.
Podman refused to create affected containers with exit 125:

```text
Error: cannot set on-failure action to kill without a health check
```

Documentation and upstream Dockerfiles were not reliable enough because the
pinned image was the thing actually being executed. This became the
authoritative test:

```sh
podman image inspect IMAGE \
  --format '{{if .Config.Healthcheck}}HAS{{else}}NONE{{end}}'
```

Only Plex had the baked health check I expected. Images for Dozzle, Gluetun,
qBittorrent, Stirling PDF, Gogs, MeTube, and several Immich components did not.
For those I either added a real `--health-cmd` or removed the unhealthy action.

Two more parser differences stopped containers before their applications even
started:

| Docker-era option | Podman result | Replacement |
|---|---|---|
| `--tmpfs=/transcode:uid=912,gid=912` | Unknown mount option | `mode=1777` where appropriate |
| `--network=name=NET,ip=IP` | Comma split into two network names | `--network=NET:ip=IP` |

These were useful failures: deterministic, immediate, and visible in the unit
journal. The later failures were more deceptive.

## Gotcha two: a successful activation can still report failure

Podman implements periodic health checks using transient systemd services. On
the first activation, containers were pulling images and warming up while these
checks began to run. Some transient `podman healthcheck run <id>` services
returned non-zero during `health_status=starting`.

`switch-to-configuration` saw failed units and returned exit code 4. A minute
later, the declared network unit had succeeded, every container was healthy,
and `systemctl --failed` was empty.

{{< mermaid caption="An activation-time health probe can fail while the final steady state becomes healthy." >}}
sequenceDiagram
	participant A as NixOS activation
	participant S as systemd
	participant C as Podman container
	A->>S: restart generated units
	S->>C: start container
	C-->>S: health_status=starting
	S->>C: transient healthcheck
	C-->>S: non-zero while warming
	S-->>A: failed transient unit, exit 4
	C-->>S: health_status=healthy
	Note over S,C: Final state is healthy despite activation result
{{< /mermaid >}}

That does not make exit 4 safe to ignore. It changes the triage order. I check
the failed unit, the declared network service, and current container health
separately:

```sh
systemctl --failed --no-pager
systemctl status podman-networks.service --no-pager --full
podman ps --format 'table {{.Names}}\t{{.Status}}'
```

A transient probe that has already cleared is different from a network
reconciler that is still failed.

## Gotcha three: stopped is not detached

I wrote a declarative network reconciler so changes to subnet, gateway, or
interface name would recreate a drifted Podman network. Container units were
`partOf` the network service, so restarting the network stopped its users first.

The assumption was plausible and wrong. A stopped container remains associated
with its network. The reconciler ran:

```sh
podman network rm podman_network_rproxy
```

Podman correctly refused:

```text
network is being used
```

The drift path needed `podman network rm -f`. Force removal disconnected and
removed the stopped container records; systemd recreated them after the network
returned.

## Gotcha four: recreating a network resets the allocator

The force-removal fix exposed the next bug. Recreating the proxy bridge erased
netavark's IPAM leases. A dynamic container started first and received
`10.89.0.2`, the static address reserved in configuration for Traefik.

Traefik then looped with:

```text
IPAM error: requested ip address 10.89.0.2 is already allocated
```

The old network had worked only because its historical lease happened to keep
`.2` occupied by the intended container. Start order became visible after a
cold reconstruction.

The durable fix separated static and dynamic address space:

```nix
subnet = "10.89.0.0/24";
gateway = "10.89.0.1";
ipRange = "10.89.0.128/25";
leaseRange = "10.89.0.129-10.89.0.255";
```

Addresses `.2` through `.127` are available for deliberate static assignments;
dynamic leases begin at `.129`. I verified the expanded lease range with a
disposable network before trusting it in the drift comparison.

{{< mermaid caption="A network rebuild forgets historical leases. Reserving separate static and dynamic ranges removes start-order dependence." >}}
flowchart TB
	R[Recreate 10.89.0.0/24 network] --> EMPTY[IPAM lease table is empty]
	EMPTY -->|without range separation| DYN[Dynamic backend starts first and takes .2]
	DYN --> FAIL[Traefik static .2 fails]
	EMPTY -->|dynamic pool .129-.255| HIGH[Backend receives a high address]
	HIGH --> OK[Traefik always claims static .2]
{{< /mermaid >}}

## Gotcha five: firewall reloads removed embedded DNS access

aardvark-dns listens on each netavark bridge gateway. Netavark inserted rules
allowing DNS, but the NixOS firewall reload flushed those runtime-generated
rules. Existing internal bridges were not recreated afterward, so their rules
did not return.

Containers began timing out on names served by the bridge gateway. OAuth2 Proxy
and Immich crash-looped; containers with explicit DNS servers were unaffected.

The fix was to make bridge DNS part of the host firewall declaration. My bridge
interfaces deliberately retain a `podman` prefix, so the NixOS `podman+`
interface wildcard can allow TCP and UDP port 53 after every reload.

This incident also taught me that `--internal` does not mean "DNS-free." An
internal bridge may need its embedded resolver for other names on that same
private network even when it has no Internet route.

## The migration test I would use next time

I would split validation into four layers:

1. **Image contract:** inspect the pinned image for health checks, users, entry
   point behavior, and baked metadata.
2. **Creation contract:** create every container and catch option-parser
   incompatibilities before evaluating application health.
3. **Network reconstruction:** delete and recreate networks from empty IPAM state,
   then vary container start order.
4. **Host integration:** reload the firewall, restart the network reconciler,
   reboot, and confirm systemd reaches the same steady state each time.

The key word is *reconstruction*. A migration that works only with inherited
bridges, leases, and already-pulled images has not yet proved its declarations.

Podman did become the boring, systemd-native runtime I wanted. Getting there
required treating Docker compatibility as a starting hypothesis, not a promise.
