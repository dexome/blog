---
date: "2026-06-05T00:00:00+05:30"
description: The short incident-note format I use to keep exact homelab fixes and verification steps
featured_image: ""
tags:
- guide
- documentation
- postmortem
- ops
- workflow
title: How I Write Incident Notes for My Homelab
---

I keep short incident notes for problems in my homelab. I normally write them
after the service is stable and before closing the terminals used during the
investigation.

Shell history can show the commands I ran, but it does not explain which output
ruled out the firewall, why one repair did not work or which configuration change
was the permanent fix. By the next day, those details are already harder to write
down correctly.

## Start with the symptom, cause and fix

I force the incident into a problem-to-outcome sentence:

> Off-subnet Traefik ingress timed out because its multi-homed container replied
> through the Internet bridge; a lower-metric default route through the ingress
> VLAN restored symmetric routing.

This gives me enough information to decide later whether the complete note is
related to a new problem.

A weak summary sounds like this:

> Fixed Traefik networking.

It is short but cannot route a future investigation. It does not distinguish
DNS failure, backend reachability, stale ARP, firewall policy, or asymmetric
routing.

If I can only write “fixed Traefik networking,” I may have restored the service
without finding the actual cause.

## The format I use

The useful reader is tired, under time pressure, and staring at a similar but
not necessarily identical symptom. That reader needs discriminating evidence,
not a polished chronology of every command.

My note structure is small:

```markdown
# Specific incident title

## Symptom
What users and monitoring observed.

## Evidence
The few checks that separated plausible causes.

## Root cause
The mechanism, not only the broken component.

## Fix
The exact durable change and any one-time repair.

## Verify and undo
How to prove the fix, and how to back it out.
```

{{< mermaid caption="A useful incident note compresses the investigation around the evidence that changed the decision." >}}
flowchart TB
	S[Symptom] --> H[Competing hypotheses]
	H --> E[Discriminating evidence]
	E --> R[Root cause mechanism]
	R --> F[Durable fix]
	F --> V[Verification and rollback]
{{< /mermaid >}}

Most of my notes are short. The important part is keeping the evidence which
changed the diagnosis.

## Example from Radarr and mergerfs

Radarr could not replace a movie after Copyparty renamed its directory. The
directory was owned by Copyparty's UID and the shared media group, but group
write was missing.

The first diagnosis was correct: change the directory from `2755` to `2775`.
The first repair was incomplete because I changed only the `btank` backing path.
Radarr still failed.

The visible path was a mergerfs union. A duplicate directory under the `btwo`
branch still had mode `2755`, and mergerfs exposed that metadata. Repairing only
the branch containing the media file was not enough.

A poor incident note would say:

```text
Radarr permissions fixed with chmod 2775.
```

The operational note says:

```text
Copyparty-created 0755 directories blocked Radarr replacement through mergerfs.
Repair every raw backing branch, never only the merged view, then enforce
Copyparty chmod_d 775 and chmod_f 664 for future entries.
```

The second note records both the existing filesystem repair and the Copyparty
configuration required for new files and directories.

## Failed attempts worth keeping

An incident can contain dozens of checks. Most do not deserve permanent space.
I keep a failed attempt when it explains a recurring trap:

- root privileges did not bypass Netdata's systemd device cgroup;
- a stopped Podman container remained associated with its network;
- a healthy container did not prove off-subnet return routing;
- setting a flow to disabled did not stop its persisted realtime subscription;
- a synthetic shell respected the umask while the real s6-supervised process
  reset it.

I omit typos and checks which did not add any information. I keep a failed attempt
when it explains why a reasonable fix did not change the result.

## Keep the diagnostic sequence

There is the incident timeline: what happened in production. There is also the
reasoning timeline: which evidence changed the hypothesis.

{{< mermaid caption="Operational chronology and diagnostic reasoning overlap, but the note should preserve the decisions, not every event." >}}
flowchart TB
	subgraph INCIDENT[Production timeline]
		I1[Change activated] --> I2[Service degraded] --> I3[Service restored]
	end
	subgraph REASONING[Reasoning timeline]
		R1[Suspect firewall] --> R2[Packet arrives on ingress]
		R2 --> R3[Route lookup selects wrong gateway]
		R3 --> R4[Pin lower-metric ingress route]
	end
	I2 -. starts .-> R1
	R4 -. produces .-> I3
{{< /mermaid >}}

For future debugging, `packet arrives` and `route lookup selects wrong gateway`
are more useful than the exact minute when each `curl` command ran.

## Write the note before cleaning up

I start the note after service is stable but before deleting scratch files,
closing logs, or relying on memory. The fastest workflow is:

1. Write the one-line outcome.
2. Paste only the decisive errors and commands.
3. Explain the mechanism in plain language.
4. Separate temporary recovery from the permanent fix.
5. Add verification and rollback.
6. Remove secrets and irrelevant identifiers.
7. Link the note from a small topic index.

I can edit the wording later. Recreating the decisive command output is more
difficult after the containers, logs and temporary files have changed.

## Record the recovery and permanent fix separately

Several incidents taught me to record two fixes explicitly.

| Recovery action | Durable correction |
|---|---|
| Clear a stale neighbor entry | Pin the macvlan MAC across recreations |
| Repair existing directories | Change creation policy and inherited ACLs |
| Restart Netdata | Configure collector autodetection retry |
| Delete a stuck KV key | Replace TTL presence with timestamp comparison |
| Manually restart a container | Correct its systemd dependency or health contract |

This prevents a one-time recovery command from being mistaken for the permanent
configuration change.

## Add it to the topic index

A folder full of excellent postmortems still fails if nobody knows what is in
it. I keep a routing index grouped by service. Each note contributes its
problem-to-outcome sentence.

{{< mermaid caption="The cost of a postmortem includes writing it and finding it again; a compact index reduces the second cost." >}}
flowchart LR
	N[Short dated incident note] --> I[One-line entry in topic index]
	Q[Future symptom] --> I
	I -->|summary matches| N
	N --> A[Apply prior check or avoid prior mistake]
{{< /mermaid >}}

I use full-text search for exact errors. The index helps when the new symptom is
similar but does not contain the same error message.

## Keep old notes but mark them superseded

Operational knowledge changes. A note may describe a temporary architecture, a
version-specific bug, or a test later disproved in production.

I do not silently rewrite the old conclusion. I mark it superseded and link it
to the replacement; the replacement links back. That preserves why the earlier
decision was reasonable while making the current instruction obvious.

Periodically, I scan for stale statuses, contradictory guidance, duplicated
incidents, broken links, and notes that should be promoted into stable service
documentation. A tiny coverage script checks that every dated note appears in
the index. Humans still decide whether the summaries are true.

## When I create a note

I write an operational note when at least one of these is true:

- the symptom had more than one plausible cause;
- the winning check was non-obvious;
- a reasonable attempted fix made no difference;
- recovery and durable correction were different;
- state outside the visible configuration mattered;
- the same mistake could affect another service;
- rollback required knowledge not encoded in the change itself.

Routine changes do not need an incident note. I create one when the investigation
found something which is not obvious from the final configuration.

Once the fix is validated, I write the short note and add its one-line summary
to the index. That is normally enough for the next investigation to start from
the useful check instead of repeating the complete incident.
