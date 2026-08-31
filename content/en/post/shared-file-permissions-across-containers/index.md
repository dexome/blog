---
date: "2026-08-17T00:00:00+05:30"
description: How I share media between Copyparty, Radarr and Frigate when each container uses a different UID
featured_image: ""
tags:
- guide
- containers
- permissions
- acl
- idmap
- linux
title: Sharing Files Between Containers with Different UIDs
---

I have multiple containers which need to write into the same media folders.
Copyparty runs as UID 924, the arr applications run as UID 911 and Frigate uses
UID/GID 914 on the host. They need to create, rename and delete each other's
files without running all services as the same user.

I faced three related issues:

- Copyparty ran as UID 924 and shared media with the arr stack at UID 911.
- Frigate had to initialize as root in its container while retaining host
	ownership as UID/GID 914.
- A mergerfs view combined two branches whose copies of the same directory had
	different modes.

Fixing only the owner or group was not enough. I needed idmapped mounts, correct
directory modes, application-specific chmod settings and inherited ACLs.

## Why a writable file could not be replaced

For a process to replace `movies/title/video.mkv`, it needs write and execute on
`movies/title/`. Write permission on `video.mkv` controls modification of the
file's contents; it does not grant permission to remove that directory entry.

Three inputs decide the normal Unix permission check:

1. UID/GID ownership chooses the owner, group, or other class.
2. The inode mode or access ACL says what that class may do.
3. The containing directory controls create, rename, and delete.

{{< mermaid caption="Ownership chooses a permission class; directory permissions decide whether another service can rename or delete an entry." >}}
flowchart TB
		PROC[Radarr uid 911, media group] --> CLASS{Matching class?}
		CLASS -->|directory gid media| GROUP[Use group mode or ACL]
		GROUP -->|r-x on directory| DENY[Read and traverse, cannot replace]
		GROUP -->|rwx on directory| ALLOW[Create, rename, and delete]
		FILE[Writable target file] -. does not decide unlink .-> DENY
{{< /mermaid >}}

So the first check was the owner and mode of the parent directory, not only the
movie file.

## Copyparty rename blocked a Radarr import

Radarr failed while upgrading a movie:

```text
Access to the path '.../Run (2002)/Run (2002) SDTV.mp4' is denied
```

The destination directory told the story:

```text
drwxr-sr-x  924 media  Run (2002)/
```

UID 924 was Copyparty. GID `media` was correct, and the setgid bit ensured new
children inherited that group. But the group had `r-x`, not `rwx`. Radarr's UID
911 could enter the directory and read the old file but could not unlink it.

I had set `UMASK=002` on the container. Copyparty's image did not honor that for
this operation and produced a `0755` directory. The permanent fix was
application-level creation policy:

```yaml
flags:
	chmod_f: 664
	chmod_d: 775
```

I applied that policy to the Copyparty volumes shared with the arr stack,
qBittorrent, and Picard. Existing entries needed a one-time repair because
creation policy is not retroactive.

## Fixing both mergerfs branches

My first repair changed the affected directory under the `btank` backing tree.
The error persisted. The visible media path was a mergerfs union of `btank` and
`btwo`, and the directory existed on both branches:

```text
btank branch:  drwxrwsr-x 924 media
btwo branch:   drwxr-sr-x 924 media
merged view:   drwxr-sr-x
```

mergerfs surfaced metadata from the stale `btwo` copy. With
`default_permissions`, the kernel enforced the mode visible through the union.
The branch containing the media file was not necessarily the branch supplying
the directory metadata.

{{< mermaid caption="Repairing only the branch with the file left a stale directory mode on the other mergerfs branch." >}}
flowchart TB
		VIEW["/mnt/merged-media/title"] --> PICK{Metadata selected by mergerfs}
		B1["/mnt/btank/@media/title: 2775"] --> PICK
		B2["/mnt/btwo/@media/title: 2755"] --> PICK
		PICK -->|stale branch wins| MODE[Visible mode 2755]
		MODE --> DENIED[Radarr group write denied]
{{< /mermaid >}}

The correct repair swept every raw backing branch, never only the merged view:

```sh
find /mnt/btank/@media/movies /mnt/btwo/@media/movies \
	-type d ! -perm -2775 -exec chmod 2775 {} +
```

After both branch copies were corrected, Radarr deleted the old file and
completed the import.

## Frigate runs as root inside the container

Frigate's official image starts through s6-overlay and needs container root for
initialization. Forcing `--user 914:914` broke startup. Running it rootful with a
plain bind mount would create host `root:root` state, which would break the
native rollback path and Copyparty access.

A per-bind idmapped mount solved ownership without changing the process:

```text
idmap=uids=914-0-1;gids=914-0-1
```

Podman's triplet is backing ID, mapped ID, length. Through that mount, host
`914:914` appears as `0:0` to the container. Frigate can initialize as root and
its files still land on btrfs and ZFS as host `914:914`.

{{< mermaid caption="A per-bind idmap changes the ownership view for one mount; it does not recursively mutate the backing files." >}}
flowchart LR
		F[Frigate container root 0:0] --> M[Idmapped bind mount]
		M -->|uids 914-0-1, gids 914-0-1| DISK[Backing files 914:914]
		N[Native rollback process 914:914] --> DISK
		C[Copyparty uid 924 plus group 914] --> DISK
{{< /mermaid >}}

This is different from the alternatives:

| Mechanism | What it changes | Why I did or did not use it |
|---|---|---|
| `--user 914:914` | Process identity | Broke Frigate's root-requiring init |
| `:U` | Recursively changes backing ownership | Mutates data and is expensive |
| Whole-container user namespace | Ownership view for the container | Complicated GPU and group mappings |
| Per-bind idmap | Ownership view for one mount | Preserved both image and host contracts |

## s6 reset the process umask

In a disposable directory, `--umask=0002` produced directories at `0775` and
files at `0664`. Copyparty, running as UID 924 with supplementary GID 914, could
create, rename, and delete them.

The real Frigate processes produced `2755` directories and `0644` files.
s6-overlay had reset the live process umask to `0022` after Podman launched the
container. A shell test that bypassed the supervisor had proved the kernel and
idmap mechanics, not the application's final runtime behavior.

The reliable check was the live process state:

```sh
grep '^Umask:' /proc/PID/status
```

Because the image did not preserve the desired umask, I used default ACLs on
the recordings tree. Newly created directories inherit group write even when
the process requests a stricter base mode. Copyparty also joins supplementary
GID 914, and its own creation policy emits group-writable entries when it writes
into the same tree.

## Final permission setup

The working setup uses:

- stable host ownership through Frigate's per-bind idmap;
- shared or supplementary groups selecting the intended permission class;
- setgid directories preserving group ownership;
- application `chmod_f` and `chmod_d` policy where the image ignored `UMASK`;
- inherited default ACLs where s6 reset the process umask;
- repairs performed on every mergerfs backing branch.

For each shared mount, I test read, create, modify, rename, delete, `mkdir` and
`rmdir` using the real service UIDs and groups. I also test files created by the
actual application, not only a shell started in the same image. This was important
for Frigate because s6 changed the umask after Podman started the container.

If mergerfs is involved, check and repair every backing branch. The permissions
shown through the merged path may come from a different branch than the file
being modified.
