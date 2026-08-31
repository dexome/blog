---
date: "2026-08-29T00:00:00+05:30"
description: What production taught me about Kestra config, OSS authentication, MQTT triggers, cooldowns, worker rendering, and retiring persistent flows
featured_image: ""
tags:
- guide
- automation
- orchestration
- workflows
- kestra
title: Kestra in Production Is Mostly About State You Cannot See
draft: true
---

The first Kestra flow I deployed was simple on paper: subscribe to a Frigate
MQTT event, ignore zero values, enforce a two-minute cooldown, and send a camera
snapshot through Apprise.

That flow eventually worked. Getting there taught me more about hidden state
than about YAML.

I hit configuration writes inside a non-root container, two independent login
layers, a polling trigger that missed transient messages, missing output fields
that threw instead of becoming null, a TTL that never expired, worker-side key
normalization, and a disabled realtime trigger that survived database cleanup
and JVM restarts.

The common thread was that the visible flow definition was only one part of the
running system.

## Deploy the engine before trusting the flows

My Kestra 1.3.24 container ran as a dedicated host UID instead of the image's
baked `kestra` user. The image entrypoint tried to materialize the
`KESTRA_CONFIGURATION` environment variable at
`/app/confs/application.yml`. That image directory was not writable by the
chosen UID, so the container crash-looped before Micronaut started.

The fix was to render configuration declaratively, mount it read-only, and
point Micronaut directly at it:

```text
host-rendered application.yml -> /app/confs/application.yml:ro
MICRONAUT_CONFIG_FILES=/app/confs/application.yml
KESTRA_CONFIGURATION unset
```

Secret placeholders stayed in the rendered file and resolved from the runtime
environment. The entrypoint's write branch was no longer involved.

{{< mermaid caption="A read-only bind mount bypassed the image entrypoint's assumption that its baked config directory was writable." >}}
flowchart TB
	N[Nix renders non-secret config] --> F[Store file with env placeholders]
	S[SOPS runtime environment] --> M[Micronaut]
	F -->|read-only bind mount| M
	E[Image entrypoint config writer] -. skipped .-> M
{{< /mermaid >}}

This is a general non-root container rule: inspect what the entrypoint writes,
not only which user the application eventually runs as.

## Edge SSO did not replace application authentication

Traefik already protected the Kestra route with Pocket ID forward auth. I
expected that gate to be sufficient. Kestra OSS still presented a "create admin
user" page.

These were independent layers:

- Pocket ID decided who could reach Kestra through Traefik.
- Kestra OSS basic auth decided who could use its UI and API.

I tried `kestra.server.basic-auth.enabled: false`. That property did not exist,
and Kestra ignored the unknown key. Enabling Micronaut security removed the
basic-auth bean but broke an OSS UI endpoint that requires the bean. In this
version, an auth-less OSS UI was not a supported state.

The working design retained basic auth, provisioned the admin from runtime
secrets, and had a Traefik response middleware set the same `BASIC_AUTH` cookie
Kestra's login form would set. The middleware runs after the Pocket ID gate, so
users still encounter one interactive login.

An injected `Authorization` request header did not work because the SPA checked
`document.cookie` before routing. Browser behavior, not just server behavior,
was part of the auth contract.

## Validate the exact version outside production

Flow schemas and plugin properties move. I validate repository flows with the
CLI from the pinned Kestra image before synchronizing them. The image's
`/app/kestra` launcher also had no directly usable shebang, so raw
`podman exec kestra /app/kestra ...` returned an exec-format error. Invoking
`docker-entrypoint.sh flow validate ...` reproduced the image's normal shell
fallback and worked.

Local validation catches unknown task properties and malformed expressions. It
does not prove lifecycle behavior. MQTT made that distinction painfully clear.

## Polling MQTT was the wrong abstraction

The first flow used `io.kestra.plugin.mqtt.Trigger`. Its name looked correct,
but it polls: connect on an interval, collect messages, disconnect. Frigate's
zone events are transient and non-retained, so the flow was usually absent when
the message arrived.

`io.kestra.plugin.mqtt.RealtimeTrigger` holds a subscription and creates one
execution per message. It also exposes the body at `trigger.payload`; the
polling trigger has different outputs.

```yaml
triggers:
  - id: maindoor_person
	type: io.kestra.plugin.mqtt.RealtimeTrigger
	server: "{{ envs.mqtt_broker }}"
	topic: frigate/maindoor/person
	serdeType: STRING
```

I put the zero-value filter in a task-level `If`. In Kestra 1.3.33, placing an
expression condition on the realtime trigger destabilized its subscription and
caused the liveness coordinator to restart it repeatedly.

{{< mermaid caption="A polling subscriber samples the topic and misses edges; a realtime subscriber remains connected and filters inside the execution." >}}
sequenceDiagram
	participant F as Frigate
	participant P as Polling trigger
	participant R as RealtimeTrigger
	P->>P: disconnected between polls
	F-->>R: payload 1
	Note over P: Event is missed
	R->>R: create execution
	R->>R: task-level If reads trigger.payload
{{< /mermaid >}}

## Missing output fields are not null

The cooldown began with a KV `Get` configured with `errorOnMissing: false`. I
then checked:

```text
{{ outputs.cooldown_get.value is null }}
```

When the key did not exist, Kestra omitted `value` from the output object. Pebble
did not turn the absent attribute into null; it threw an
`IllegalVariableEvaluationException` while deciding the next task.

Optional outputs need an explicit default:

```text
{{ (outputs.cooldown_get.value ?? null) is null }}
```

That fixed the exception and exposed the more serious cooldown problem.

## A TTL presence check wedged the alert for hours

The flow set a KV key with `ttl: PT2M` and sent another alert only when the key
was absent. After one notification, about 40 later events reached the check and
were suppressed. The key remained readable for hours.

Even reliable expiry would have been awkward in this version: reading an
expired value could delete it and throw `ResourceExpiredException`, which
`errorOnMissing: false` did not handle.

I stopped making correctness depend on deletion. The key now stores the last
alert epoch without a TTL:

```yaml
value: "{{ now() | timestamp }}"
kvType: NUMBER
```

The condition compares values:

```text
{{ (now() | timestamp) - (outputs.cooldown_get.value ?? 0) >= 120 }}
```

I used a new key name because the old key contained an ISO string. The fresh key
self-seeded on the first successful execution and avoided a migration-time type
error.

{{< mermaid caption="Cooldown correctness moved from an unreliable expiration side effect to explicit timestamp arithmetic." >}}
flowchart TB
	EVENT[MQTT event] --> GET[Read last alert epoch]
	GET --> AGE{now minus last is at least 120s?}
	AGE -->|no| SKIP[Finish without notification]
	AGE -->|yes or absent| SEND[Send through Apprise]
	SEND --> SET[Overwrite last alert epoch]
{{< /mermaid >}}

## Configuration rendered on the worker had different keys

I moved the MQTT broker address into `kestra.variables.globals.mqttBroker` and
referenced `{{ globals.mqttBroker }}`. Every realtime trigger began failing
before task execution with empty trigger variables.

Micronaut normalized map keys while reconstructing globals on the worker:
`mqttBroker` became kebab-case. The template requested a key that no longer
existed. Password secrets still worked because Kestra injected them through a
different path, which made the failure look like a broker problem.

The fix was an environment variable:

```text
container: ENV_MQTT_BROKER=<single-sourced broker endpoint>
flow:      {{ envs.mqtt_broker }}
```

The lesson is not that globals are always bad. It is that values rendered by a
worker or trigger must be tested in that execution context. UI previews and
controller-side templates are not equivalent evidence.

## Disabled did not mean stopped

The strangest incident arrived while replacing one realtime flow with another
on Kestra 1.3.33. The old flow was marked `disabled: true`. It continued to
receive MQTT messages and create executions.

Removing its YAML did not help because my namespace update was upsert-only and
did not prune the running flow. Deleting the flow and its `triggers` row still
did not finish the job. After a restart, the JDBC liveness coordinator recreated
the subscription from `worker_job_running`.

The full runtime state spanned four places:

{{< mermaid caption="A realtime flow exists as definition, trigger registration, queued work, and a persisted running-worker record." >}}
flowchart TB
	FLOW[Flow definition] --> TRIG[triggers row]
	TRIG --> RUN[worker_job_running subscription]
	RUN --> MQTT[Live MQTT subscription]
	MQTT --> QUEUE[queues backlog]
	COORD[JDBC liveness coordinator] -->|restarts persisted job| RUN
{{< /mermaid >}}

Retirement required deleting the flow, its trigger registration, matching queue
backlog, and the `worker_job_running` record, then restarting Kestra. Verification
meant checking that the old rows stayed absent while a retained flow on the same
topic still received the next event.

## What production changed

I no longer review a workflow only as a task graph. I review five contracts:

1. **Deployment:** can the image start under its real UID and mounted config?
2. **Schema:** does the exact pinned engine accept the flow?
3. **Rendering:** where is each expression evaluated, and what variables exist there?
4. **State:** what persists in KV, queues, registrations, and worker tables?
5. **Lifecycle:** what does disable, delete, retry, restart, and reconcile actually do?

Workflow engines make the happy path beautifully visible. Production work is
learning where the invisible copies of that path live.
