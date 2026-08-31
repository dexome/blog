---
date: "2026-08-29T00:00:00+05:30"
description: The repository-native memory system I use to stop coding agents from rediscovering operational lessons across sessions
featured_image: ""
tags:
- guide
- ai
- agents
- workflow
- documentation
title: Giving an AI Coding Agent Memory That Survives the Chat
draft: true
---

An AI coding agent can spend an hour proving exactly why a production command
fails, fix it, validate the result, and forget the whole thing when the chat
ends.

The next session begins with the same plausible wrong assumptions.

I saw this repeatedly in my homelab repository. One session established the
safe way to evaluate a large Nix flake without copying 20 GiB of ignored model
artifacts. Another proved the exact SSH and TTY sequence needed for privileged
diagnostics. A third found that disabling a Kestra realtime flow did not stop
its persisted subscription.

Those were not facts I wanted trapped in chat transcripts or editor-local
memory. They were part of the repository's operating model.

So I built a deliberately small memory system out of Markdown.

## The design constraints

The system needed to be:

- **durable:** survive chat sessions, machines, and editor profiles;
- **reviewable:** change through the same review process as code;
- **routable:** let an agent find one relevant note without reading hundreds;
- **historical:** preserve old decisions without presenting them as current;
- **safe:** record where secrets live, never their values;
- **cheap:** make adding a lesson easier than rediscovering it.

That ruled out a single giant notebook. It also ruled out an opaque memory store
whose contents collaborators could not inspect.

## One note per operational topic

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

The body answers operational questions in the order an agent needs them:

1. What was the symptom?
2. What evidence separated it from similar failures?
3. What was the root cause?
4. What exact change fixed it?
5. How was the fix verified?
6. How can it be undone or superseded?

This is memory, not a diary. Failed attempts belong only when they close a
tempting path the next investigator might repeat.

## The index is a router, not a generated table of contents

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

{{< mermaid caption="The routing index keeps startup context small while preserving access to detailed operational evidence." >}}
flowchart TB
	Q[New engineering request] --> I[Read compact routing index]
	I --> S{Select matching summaries}
	S --> N1[Open relevant incident note]
	S --> N2[Open relevant reference note]
	N1 --> W[Work with prior evidence]
	N2 --> W
	ALL[Hundreds of unrelated notes] -. not loaded .-> W
{{< /mermaid >}}

Why curate the summaries by hand? A filename or extracted first heading does not
say what finally won. The sentence is a compression boundary: a human or agent
must understand the lesson well enough to state the symptom and outcome.

The index is intentionally not generated. Automation checks its completeness;
it does not write its judgment.

## Memory has multiple scopes

Not every fact belongs in the dated-note catalog. I separate three classes:

| Memory class | Example | Lifetime |
|---|---|---|
| Incident or migration | Why macvlan replies used the wrong route | Historical, may be superseded |
| Living reference | Port allocation inventory | Updated in place |
| Durable service guidance | Stable operating constraint | Promoted into reference documentation |

A port inventory would become noisy as a sequence of dated files. A completed
incident should not be silently rewritten whenever understanding changes.
Choosing the right shape is part of preserving meaning.

## Supersession keeps history without keeping ambiguity

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

{{< mermaid caption="Supersession preserves the audit trail while making the current instruction unambiguous." >}}
flowchart TB
	OLD[Old note: status superseded] -->|superseded by| NEW[New note: current guidance]
	NEW -->|supersedes| OLD
	INDEX[Routing index] -->|current entry| NEW
	INDEX -. historical entry marked superseded .-> OLD
{{< /mermaid >}}

This mattered when a temporary architecture was later retired, or when a
synthetic test said `umask 0002` worked but the real image's supervisor reset it.
The earlier note was not useless; it proved the lower-level mechanism. The new
note corrected the production conclusion.

## Instructions turn documentation into memory

Notes do not help if the agent does not know when to read them. Repository
instructions establish a retrieval protocol:

1. At the start of a request, read the routing index.
2. Open only relevant notes.
3. Consult living inventories before changing shared resources such as ports.
4. Record a newly proven operational lesson in the repository.
5. Update the index in the same change.

This is the difference between storing information and building memory. Memory
requires a reliable cue, retrieval path, and feedback loop.

{{< mermaid caption="Work produces evidence, evidence becomes a note, and future instructions route the next task back through it." >}}
flowchart TB
	TASK[Task begins] --> ROUTE[Index and instruction routing]
	ROUTE --> PRIOR[Relevant prior knowledge]
	PRIOR --> ACT[Implement and validate]
	ACT --> LESSON{New durable lesson?}
	LESSON -->|yes| NOTE[Write dated note and index summary]
	NOTE --> CHECK[Run coverage and consistency checks]
	CHECK --> TASK
	LESSON -->|no| DONE[Finish]
{{< /mermaid >}}

## A linter checks structure, not truth

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

The result is a useful division of labor: automation proves catalog integrity;
review proves meaning.

## What not to remember

Repository memory must never contain secret values. A note may say that an MQTT
password comes from a named SOPS secret and which service consumes it. It should
not contain the password, a token copied from a log, or an unredacted credential
example.

I also avoid storing transient conversation detail, broad summaries of the
codebase, and facts the code already states clearly. Memory earns its place when
it preserves reasoning, an operational trap, a discriminating check, or a
decision that would otherwise be expensive to reconstruct.

## The system is intentionally boring

There is no vector database, embedding pipeline, or proprietary memory API.
Markdown, links, frontmatter, repository instructions, and a 50-line checker
are enough.

The sophistication is in the protocol:

- capture only proven lessons;
- compress each lesson into a routable sentence;
- load details only when relevant;
- preserve history through supersession;
- keep every memory visible to the people responsible for the system.

An agent still begins each chat without personal recollection. It no longer
begins without institutional memory.
