---
pubDatetime: "2026-06-05T00:00:00+05:30"
description: How I keep useful AI coding agent notes as Markdown files in my homelab repository
tags:
- guide
- ai
- agents
- workflow
- documentation
title: Keeping AI Agent Notes in My Homelab Repository
---

I use AI coding agents regularly while working on my homelab repository. The
chat history is useful during a task, but a new session does not automatically
know what was proved in an older one.

This became a problem for operational details. For example, one session found
the safe way to evaluate my Nix flake without copying 20 GiB of ignored model
files. Another found the exact SSH and TTY sequence required for privileged
diagnostics. I did not want to investigate those details again.

I now store these notes as Markdown under `docs/agent-memory/`. They are part of
the repository, so I can review and update them along with the configuration.

## What I wanted from these notes

The system needed to be:

- **durable:** survive chat sessions, machines, and editor profiles;
- **reviewable:** change through the same review process as code;
- **routable:** let an agent find one relevant note without reading hundreds;
- **historical:** preserve old decisions without presenting them as current;
- **safe:** record where secrets live, never their values;
- **cheap:** make adding a lesson easier than rediscovering it.

I did not want one large file which every agent had to read at the start of a
task. I also wanted the notes to remain visible outside one editor or agent.

## One Markdown file for each topic

Every memory is a dated Markdown file under `docs/agent-memory/`:

```text
2026-06-12-traefik-macvlan-asymmetric-return-route.md
2026-07-23-copyparty-rename-strips-group-write-arrs-import-denied.md
2026-08-10-netdata-2.10.3-collector-fixes.md
```

The ISO date gives a useful filesystem order. The descriptive suffix makes the
file discoverable with ordinary text search. One topic per file lets a later
note supersede one conclusion without invalidating an unrelated section of a
large document.

New notes carry queryable frontmatter:

```yaml
---
type: incident
title: Podman network drift recreate needs rm -f
description: Stopped containers remain associated with their networks.
timestamp: 2026-06-12
tags: [podman, networking]
resource: hosts/heavymetal/containers.nix
status: resolved
---
```

I normally write the body in this order:

1. What was the symptom?
2. What evidence separated it from similar failures?
3. What was the root cause?
4. What exact change fixed it?
5. How was the fix verified?
6. How can it be undone or superseded?

I include a failed attempt only when it is likely to be tried again. Normal
terminal exploration and command typos do not need to be stored.

## Using a small index to find the correct note

Opening every note at the start of every request would replace forgetting with
context overload. The repository instead has a hand-curated `index.md`, grouped
by service or topic. Each entry is one complete problem-to-outcome sentence:

```markdown
- [2026-06-12-podman-network-drift-recreate-needs-force.md](...)
  — Recreating a drifted Podman network requires rm -f because stopped
  containers remain associated with it. (_resolved_)
```

The agent's startup rule is simple: read the index, select the few summaries
that match the current task, then open only those notes.

```mermaid caption="The routing index keeps startup context small while preserving access to detailed operational evidence."
flowchart TB
	Q[New engineering request] --> I[Read compact routing index]
	I --> S{Select matching summaries}
	S --> N1[Open relevant incident note]
	S --> N2[Open relevant reference note]
	N1 --> W[Work with prior evidence]
	N2 --> W
	ALL[Hundreds of unrelated notes] -. not loaded .-> W
```

I write these summaries by hand because a filename or heading usually does not
say which fix actually worked. A script checks that every note is included in
the index, but it does not generate the summary.

## Not every note needs a dated file

Not every fact belongs in the dated-note catalog. I separate three classes:

| Memory class | Example | Lifetime |
|---|---|---|
| Incident or migration | Why macvlan replies used the wrong route | Historical, may be superseded |
| Living reference | Port allocation inventory | Updated in place |
| Durable service guidance | Stable operating constraint | Promoted into reference documentation |

A port inventory would become noisy as a sequence of dated files. A completed
incident should not be silently rewritten whenever understanding changes.
For example, I update the port allocation inventory in place. An incident stays
as a dated file because a later note may supersede it without removing the old
evidence.

## Marking an old note as superseded

Deleting an old note destroys the path that explains why a decision existed.
Leaving it unmarked lets an agent follow obsolete instructions. The compromise
is bidirectional supersession.

The old note says:

```markdown
> **Superseded by:** [2026-08-17-new-design.md](...) — reason.
```

The new note says:

```markdown
> **Supersedes:** [2026-06-05-old-design.md](...).
```

Both frontmatter records and index entries carry the same state. The old
evidence remains available, but every retrieval path points toward current
guidance.

```mermaid caption="Supersession preserves the audit trail while making the current instruction unambiguous."
flowchart TB
	OLD[Old note: status superseded] -->|superseded by| NEW[New note: current guidance]
	NEW -->|supersedes| OLD
	INDEX[Routing index] -->|current entry| NEW
	INDEX -. historical entry marked superseded .-> OLD
```

I used this when a temporary design was retired and when a shell test showed
that `umask 0002` worked but the real container supervisor reset it. The old
test was still useful, but the new note needed to be the current instruction.

## Telling the agent when to read the notes

Notes do not help if the agent does not know when to read them. Repository
instructions establish a retrieval protocol:

1. At the start of a request, read the routing index.
2. Open only relevant notes.
3. Consult living inventories before changing shared resources such as ports.
4. Record a newly proven operational lesson in the repository.
5. Update the index in the same change.

Without these repository instructions, the notes would only be documentation
which an agent might or might not find.

```mermaid caption="Work produces evidence, evidence becomes a note, and future instructions route the next task back through it."
flowchart TB
	TASK[Task begins] --> ROUTE[Index and instruction routing]
	ROUTE --> PRIOR[Relevant prior knowledge]
	PRIOR --> ACT[Implement and validate]
	ACT --> LESSON{New durable lesson?}
	LESSON -->|yes| NOTE[Write dated note and index summary]
	NOTE --> CHECK[Run coverage and consistency checks]
	CHECK --> TASK
	LESSON -->|no| DONE[Finish]
```

## Checking the index

The repository includes a small dependency-free checker. It compares dated
files on disk with links in the index and reports:

- notes missing from the index;
- index links whose files no longer exist;
- notes without frontmatter.

It exits nonzero for missing coverage or broken links. It does not generate
summaries, decide which topic heading is best, or resolve contradictory advice.
Those are semantic tasks.

A periodic manual pass checks what code cannot reliably infer:

- stale `pending` or `parked` statuses;
- one-directional supersession links;
- newer notes that contradict older guidance;
- duplicate incidents without a relationship;
- ports or service references that drifted;
- lessons mature enough to move into stable documentation.

The script checks the structure. I still review the summaries and decide whether
one note replaces another.

## Do not store secrets or duplicate the code

Repository memory must never contain secret values. A note may say that an MQTT
password comes from a named SOPS secret and which service consumes it. It should
not contain the password, a token copied from a log, or an unredacted credential
example.

I also avoid storing temporary chat details, large summaries of the repository
and facts already clear from the code. I add a note when it preserves a useful
check, an operational problem or a decision which would take time to reconstruct.

## Current workflow

I do not use a vector database or an embedding pipeline for this. Markdown,
links, frontmatter, repository instructions and a small checker are enough for
my repository.

The workflow is:

- capture only proven lessons;
- compress each lesson into a routable sentence;
- load details only when relevant;
- preserve history through supersession;
- keep every memory visible to the people responsible for the system.

The agent still starts a new chat without the old conversation. It first reads
the index, opens the notes related to the current task and continues with the
checks and fixes already recorded there.
