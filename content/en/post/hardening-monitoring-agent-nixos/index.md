---
date: "2026-08-10T00:00:00+05:30"
description: Fixing Netdata SMART, ZFS and Traefik collectors after applying systemd restrictions on NixOS
featured_image: ""
tags:
- guide
- monitoring
- netdata
- systemd
- hardening
- nixos
title: Running Netdata with systemd Hardening on NixOS
---

I run Netdata as a native NixOS service and restrict its network and device
access using systemd. After updating to Netdata 2.10.3, the dashboard worked but
the SMART, ZFS pool and Traefik collectors did not create any charts.

All three appeared as missing collectors in the UI, but each one had a different
problem. Below are the settings I needed on NixOS while keeping the service
restricted.

## Restricting network and device access

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

Once `DeviceAllow` is set, all devices not listed there are denied. This caused
the first collector failure.

## SMART collector could not open the disk

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

Running `smartctl` as root did not bypass this rule because the device cgroup
applies to the complete Netdata service.

## ZFS collector used `/usr/bin/zpool`

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

## Traefik was not ready during the first check

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

## How I checked each failure

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

Instead of removing all restrictions, I added only what each collector needed:

- one device-node allow entry;
- one NixOS-native binary path;
- one retry interval;
- only the bridge ranges used for dashboard ingress and local notifications.

After these changes, SMART could read `/dev/sda`, ZFS used the NixOS `zpool`
path and Traefik registered itself after its endpoint became ready. The useful
check here is the go.d collector log; a working Netdata service and dashboard do
not mean every configured collector started successfully.
