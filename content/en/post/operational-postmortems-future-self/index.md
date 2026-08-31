---
date: "2026-08-29T00:00:00+05:30"
description: The lightweight incident-note habit that preserved exact fixes from my homelab without turning every outage into a formal report
featured_image: ""
tags:
- guide
- documentation
- postmortem
- ops
- workflow
title: Write the Incident Note Before the Relief Wears Off
draft: true
---

The network was back. I could close the terminals, leave the diagrams for later,
and trust that the final command was still in my shell history.

That is the exact moment an incident becomes expensive for the second time.

Relief erases sequence. By the next morning I remember the broad cause and the
successful outcome, but not the observation that ruled out the firewall, the
command that exposed the wrong route, or the failed fix that looked almost
identical to the real one.

My solution is not a formal postmortem process. It is a short operational note,
written before closing the incident.

## The note begins with one sentence

I force the incident into a problem-to-outcome sentence:

> Off-subnet Traefik ingress timed out because its multi-homed container replied
> through the Internet bridge; a lower-metric default route through the ingress
> VLAN restored symmetric routing.

That sentence does three jobs. It gives the symptom, names the cause, and records
the winning change. Months later, it is enough to decide whether the full note
is relevant.

A weak summary sounds like this:

> Fixed Traefik networking.

It is short but cannot route a future investigation. It does not distinguish
DNS failure, backend reachability, stale ARP, firewall policy, or asymmetric
routing.

If I cannot write the stronger sentence, I probably have not finished the
investigation. I may have restored service without understanding why.

## Write for the next failure, not the incident review

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

The sequence is useful even when the note is only 40 lines. Length is not the
measure. Retrieval value is.

## A real example: the repair that did not repair

Radarr could not replace a movie after Copyparty renamed its directory. The
directory was owned by Copyparty's UID and the shared media group, but group
write was missing.

The first diagnosis was correct: fix the directory from `2755` to `2775`. The
first repair was incomplete: I changed only the `btank` backing path. Radarr
still failed.

That apparent contradiction was the part worth preserving. The visible path was
a mergerfs union. A duplicate directory under the `btwo` branch still had mode
`2755`, and mergerfs surfaced that stale metadata. Repairing only the branch
containing the media file did not guarantee the merged view would expose the
new permissions.

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

The second version prevents the exact recurrence. It records both the one-time
filesystem repair and the configuration that stops new bad entries.

## Preserve false leads only when they are reusable

An incident can contain dozens of checks. Most do not deserve permanent space.
I keep a failed attempt when it explains a recurring trap:

- root privileges did not bypass Netdata's systemd device cgroup;
- a stopped Podman container remained associated with its network;
- a healthy container did not prove off-subnet return routing;
- setting a flow to disabled did not stop its persisted realtime subscription;
- a synthetic shell respected the umask while the real s6-supervised process
  reset it.

I omit terminal wandering, typos, and checks that added no information. The goal
is not to prove how hard I worked. It is to save the next person from spending
time on the same attractive mistake.

## Capture two timelines

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
are more valuable than the wall-clock minute at which each curl ran.

## Write it before cleanup destroys evidence

I start the note after service is stable but before deleting scratch files,
closing logs, or relying on memory. The fastest workflow is:

1. Write the one-line outcome.
2. Paste only the decisive errors and commands.
3. Explain the mechanism in plain language.
4. Separate temporary recovery from the durable fix.
5. Add verification and rollback.
6. Remove secrets and irrelevant identifiers.
7. Link the note from a small topic index.

The note can be refined later. The evidence is harder to reconstruct later.

## Recovery is not the same as correction

Several incidents taught me to record two fixes explicitly.

| Recovery action | Durable correction |
|---|---|
| Clear a stale neighbor entry | Pin the macvlan MAC across recreations |
| Repair existing directories | Change creation policy and inherited ACLs |
| Restart Netdata | Configure collector autodetection retry |
| Delete a stuck KV key | Replace TTL presence with timestamp comparison |
| Manually restart a container | Correct its systemd dependency or health contract |

Without this split, the emergency command becomes folklore and eventually an
unexplained cron job.

## Make the note easy to encounter

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

Full-text search remains useful for exact error messages. The index answers a
different question: "Have we already learned something about this class of
failure?"

## Let old notes be wrong visibly

Operational knowledge changes. A note may describe a temporary architecture, a
version-specific bug, or a test later disproved in production.

I do not silently rewrite the old conclusion. I mark it superseded and link it
to the replacement; the replacement links back. That preserves why the earlier
decision was reasonable while making the current instruction obvious.

Periodically, I scan for stale statuses, contradictory guidance, duplicated
incidents, broken links, and notes that should be promoted into stable service
documentation. A tiny coverage script checks that every dated note appears in
the index. Humans still decide whether the summaries are true.

## The threshold is simple

I write an operational note when at least one of these is true:

- the symptom had more than one plausible cause;
- the winning check was non-obvious;
- a reasonable attempted fix made no difference;
- recovery and durable correction were different;
- state outside the visible configuration mattered;
- the same mistake could affect another service;
- rollback required knowledge not encoded in the change itself.

That threshold keeps the practice lightweight. Routine changes do not need
ceremony. Expensive understanding does need somewhere to live.

The best time to write the note is the quiet minute after validation, while the
relief is real and the evidence is still open. Future me does not need a
perfect report. He needs the one observation I am about to forget.
