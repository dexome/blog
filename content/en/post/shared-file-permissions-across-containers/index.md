---
date: "2026-08-29T00:00:00+05:30"
description: How I combined per-bind idmaps, real process umasks, application chmod policy, and inherited ACLs across Copyparty, the arr stack, and Frigate
featured_image: ""
tags:
- guide
- containers
- permissions
- acl
- idmap
- linux
title: Shared Container Storage Needs More Than the Right UID
draft: true
---

The file was writable. Radarr still could not replace it.

That sentence captures most of what makes shared container permissions
frustrating. We inspect the target file, see group write, and miss that rename
and deletion are operations on the containing directory.

My host had three versions of this problem:

- Copyparty ran as UID 924 and shared media with the arr stack at UID 911.
- Frigate had to initialize as root in its container while retaining host
	ownership as UID/GID 914.
- A mergerfs view combined two branches whose copies of the same directory had
	different modes.

They looked like one ownership bug. They required four different controls.

## Start with the Linux permission model

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

That model prevented me from trying random recursive `chown` commands. The next
step was to identify who created the directory and what mode it actually had.

## Incident one: a Copyparty rename broke a Radarr import

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

## The mergerfs trap: one path, two sets of metadata

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

## Incident two: Frigate needed root inside and 914 outside

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

## The synthetic test passed and production still failed

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

## The complete contract

No single setting solved every direction of collaboration. The working design
was:

- stable host ownership through Frigate's per-bind idmap;
- shared or supplementary groups selecting the intended permission class;
- setgid directories preserving group ownership;
- application `chmod_f` and `chmod_d` policy where the image ignored `UMASK`;
- inherited default ACLs where s6 reset the process umask;
- repairs performed on every mergerfs backing branch.

For each shared mount, I now test the operations separately: read, create,
modify, rename, delete, `mkdir`, and `rmdir`. I run those tests as the real UIDs
and groups on the real filesystem type, then repeat them with output created by
the actual supervised application.

The durable lesson is that "correct owner" is only one line in the contract.
You also need to know the creator's real umask, later `chmod` behavior, the
consumer's supplementary groups, the parent directory mode, inherited ACLs,
and whether a union filesystem is hiding another copy of the metadata.
