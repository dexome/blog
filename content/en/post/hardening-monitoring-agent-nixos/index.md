---
date: "2026-08-29T00:00:00+05:30"
description: How three Netdata collectors failed under systemd hardening on NixOS, and why each needed a different narrow exception
featured_image: ""
tags:
- guide
- monitoring
- netdata
- systemd
- hardening
- nixos
title: Hardening Netdata Without Blinding It
draft: true
---

A monitoring agent is an awkward process to sandbox. Its job is to observe
things ordinary services should not touch: block devices, GPU nodes, kernel
interfaces, storage control devices, local APIs, and other systemd units.

That does not justify giving it the whole host. It means every exception needs a
collector attached to it.

I learned this while bringing up native Netdata 2.10.3 on NixOS. The service was
running and the dashboard loaded, but SMART, ZFS pool, and Traefik charts were
missing. All three appeared as "zero charts." Each had a different root cause.

## The security boundary

The service could reach only the network ranges it actually used:

```nix
IPAddressDeny = [ "any" ];
IPAddressAllow = [
	"localhost"
	rproxyBridgeSubnet
	notifyBridgeSubnet
];
```

That blocked cloud connectivity, telemetry, and arbitrary egress independently
of package build flags. Device access was also explicit so the Intel GPU
collector could read its render node:

```nix
DeviceAllow = [ "/dev/dri/renderD128 rw" ];
```

The second setting caused the first missing collector.

## Collector one: SMART failed despite running the helper as root

Adding any `DeviceAllow` entry makes systemd's device policy deny-by-default.
The render node was allowed; every unlisted block and character device was not.

Netdata's privileged helper ran `smartctl` as root and still received:

```text
Smartctl open device: /dev/sda failed: Operation not permitted
```

UID 0 could not override the device cgroup. The denial applied to every process
in the service cgroup, including privileged helpers.

The narrow fix was to allow the disk collector's device too:

```nix
DeviceAllow = [
	"/dev/dri/renderD128 rw"
	"/dev/sda rw"
	"/dev/zfs rw"
];
```

{{< mermaid caption="Once DeviceAllow is present, the service cgroup denies every device that is not named, regardless of the helper's UID." >}}
flowchart LR
		N[Netdata service cgroup] --> GPU["/dev/dri/renderD128 allowed"]
		N --> S{smartctl as root}
		S -->|before| DENY["/dev/sda denied by cgroup"]
		S -->|after explicit allow| DISK["/dev/sda readable"]
		N -->|after explicit allow| ZFS["/dev/zfs accessible"]
{{< /mermaid >}}

This is why "but it runs as root" was the wrong debugging branch. The failure
was below normal discretionary permissions.

## Collector two: ZFS assumed an FHS path

After allowing `/dev/zfs`, the ZFS pool collector still registered nothing. Its
initialization error was precise:

```text
stat /usr/bin/zpool: no such file or directory
```

NixOS does not install `zpool` under `/usr/bin`. Netdata's go.d collector in
this version used that fixed default instead of searching the service path.

The job needed an explicit binary location:

```yaml
jobs:
	- name: zfspool
		binary_path: /run/current-system/sw/bin/zpool
```

Now the collector could execute `zpool`, and the previous `/dev/zfs` exception
allowed the command to reach the kernel module. Fixing only the path would have
changed the failure from "not found" to a timeout or permission error.

## Collector three: Traefik lost a startup race once

During the same activation, containerized Traefik was restarting. Netdata
checked its metrics endpoint before it was ready and reported:

```text
check failed: unexpected metrics (not Traefik)
```

The endpoint recovered. The charts did not. A failed initial go.d `check()` can
disable that job until Netdata itself restarts.

The fix was not another systemd dependency. Netdata and Traefik may legitimately
restart independently. The collector needed to tolerate temporary absence:

```yaml
jobs:
	- name: traefik
		url: http://10.89.0.2:8083/metrics
		autodetection_retry: 60
```

I used the same retry behavior for NUT, whose endpoint may appear in a later
configuration phase.

{{< mermaid caption="A one-shot discovery check turns a temporary dependency outage into permanently missing charts; periodic autodetection heals it." >}}
sequenceDiagram
		participant N as Netdata go.d
		participant T as Traefik metrics
		N->>T: initial check during restart
		T-->>N: not ready
		Note over N: Without retry, job remains disabled
		N->>T: retry after 60 seconds
		T-->>N: valid Prometheus metrics
		Note over N: Collector registers charts
{{< /mermaid >}}

## Debug in layers, not by weakening the sandbox

The three symptoms all looked like absent charts, but their evidence lived at
different layers:

| Layer | Question | Evidence |
|---|---|---|
| Collector | Did the job parse and initialize? | go.d debug log |
| Executable | Does its configured binary exist? | `stat` and exact error |
| Device cgroup | Can the service open the device? | EPERM despite helper UID |
| Filesystem permissions | Is the node accessible after cgroup policy? | mode and group |
| Network filter | Can this cgroup reach the endpoint? | request from service context |
| Lifecycle | Was the endpoint merely late? | retry succeeds without config change |

My first impulse was to remove device restrictions and widen network access.
That would have restored charts while erasing the reason for hardening the
agent. Instead, each collector earned the smallest capability it needed:

- one device-node allow entry;
- one NixOS-native binary path;
- one retry interval;
- only the bridge ranges used for dashboard ingress and local notifications.

The result is not a perfectly isolated monitoring process. Such a process could
not monitor much. It is an auditable one: every opening names the chart or alert
that would disappear without it, and every missing chart can be traced through
the same layered checks.
