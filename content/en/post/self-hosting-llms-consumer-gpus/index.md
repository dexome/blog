---
date: "2026-08-29T00:00:00+05:30"
description: What an Intel Arc A310 could really do with Ollama, LibreChat, and Netdata MCP after context, KV cache, and model capability collided
featured_image: ""
tags:
- guide
- ai
- llm
- ollama
- intel-arc
- self-hosting
title: What a 4 GB Intel Arc Can and Cannot Do for Local LLMs
draft: true
---

My Intel Arc A310 has 4 GB of VRAM. It is also not an inference appliance: the
same GPU serves Frigate, Immich, Plex, and Jellyfin.

I still wanted a private assistant in LibreChat, with Ollama handling local
models and Netdata exposed as an MCP server. General chat worked. Tool calling
did not.

At first this looked like a weak-model problem. Then it looked like an Ollama
configuration problem. After several controlled tests, the honest answer was
both: context truncation hid the tools, and once the tools became visible, the
models that fit could not use them reliably.

## The working stack

Ollama 0.12.11 and later include an experimental Vulkan backend that can use
Intel Arc. I passed only `/dev/dri/renderD128`, joined the render and video
groups, and kept the API on private Podman networks. LibreChat reached Ollama by
container DNS; Ollama used a separate egress bridge to pull models.

{{< mermaid caption="The model API stays private while one render node is shared with the host's media and vision workloads." >}}
flowchart TB
	USER[Browser] --> CHAT[LibreChat]
	CHAT -->|private bridge| O[Ollama and Vulkan]
	CHAT -->|13 tool schemas| MCP[Netdata MCP]
	O --> ARC[Intel Arc A310, 4 GB]
	VIDEO[Frigate, Immich, Plex, Jellyfin] --> ARC
	O -->|model pulls only| NET[Internet bridge]
{{< /mermaid >}}

For small models, the Vulkan backend was enough to make local chat useful. The
surprising bottleneck was the prompt before generation even began.

## The model never saw the tools

LibreChat sent the system message, Netdata instructions, 13 MCP tool schemas,
and the user turn. The resulting first prompt was about 11,511 tokens. Ollama's
default context was 4,096.

The log made the failure explicit:

```text
truncating input prompt limit=4096 prompt=11511 keep=4 new=4095
```

The tool definitions were near the discarded end. A model that never receives
the schemas cannot issue a tool call, regardless of its instruction following.
It answered in prose because prose was the only action left.

{{< mermaid caption="At the default 4k context, truncation removed the MCP schemas before the model evaluated the request." >}}
flowchart TB
	P[11.5k-token prompt] --> CUT{4,096-token context}
	CUT --> KEEP[Small retained slice]
	CUT -. discarded .-> TOOLS[Netdata instructions and 13 tool schemas]
	KEEP --> MODEL[Model sees no callable tools]
	MODEL --> TEXT[Plain-text answer]
{{< /mermaid >}}

Raising `OLLAMA_CONTEXT_LENGTH` made structured tool attempts appear. That
proved truncation was causal. It did not yet produce a usable system.

## Context consumes memory before the answer exists

At 16,384 tokens, the KV cache occupied about 1.8 GB. Only 18 of 29 model layers
fit on the GPU; the other 11 spilled to CPU. Processing the first 11.5k-token
prompt took 131 seconds, during which nothing streamed. LibreChat aborted before
the first token.

Turning off the 6 KB server-instructions block helped less than expected. The
prompt still measured 10,189 tokens because the 13 tool schemas themselves were
the dominant cost, and LibreChat could not expose only a subset of MCP tools.
An 8,192-token context still truncated them.

The practical setting was 12,288: enough for the tool prompt plus answer
headroom, with fewer layers displaced than at 16k. The first turn remained slow,
roughly 80 to 100 seconds for a 3B model. Follow-up turns were fast because
Ollama cached the prompt prefix; one 67-token follow-up returned in 0.8 seconds.

{{< mermaid caption="A larger context fixed schema visibility but enlarged the KV cache and forced model layers onto the CPU." >}}
flowchart TB
	C4[4k context] -->|small KV cache| FAST[More GPU residency]
	C4 -->|but| TRUNC[Tool schemas truncated]
	TRUNC -. next test .-> C12[12k context]
	C12 -->|schemas fit| VISIBLE[Tools visible]
	C12 -->|larger KV cache| SPLIT[Some layers spill to CPU]
	SPLIT -. next test .-> C16[16k context]
	C16 -->|about 1.8 GB KV| SLOW[18 of 29 layers on GPU, 131s prompt evaluation]
{{< /mermaid >}}

This is the consumer-GPU context trap: a model can fit, and a prompt can fit,
but the model plus KV cache plus other GPU users may not fit together.

## Three models, three different failures

With logs confirming no truncation, I tested the models against simple Netdata
questions.

| Model | GPU placement | First prompt | Result |
|---|---:|---:|---|
| Qwen2.5 1.5B | 29/29 layers | about 55s | Printed a tool call as JSON text; LibreChat could not execute it |
| Llama 3.2 3B | 20-21/29 layers | 105-131s | Emitted a real call with schema-invalid arguments |
| Qwen2.5 7B | 13/29 layers | about 218s | Too slow and returned an unusable result |

The 3B model even failed the no-argument `list_raised_alerts` schema. This was
not limited to one complicated metrics query. It could choose a tool and emit a
tool-call shape, but not produce arguments the MCP client accepted reliably.

LibreChat's "Ran tool" pill was not proof of success. It appeared when dispatch
began; the execution log later showed `Received tool input did not match
expected schema`. Without checking that log, I would have mistaken an attempted
call followed by hallucinated prose for real monitoring data.

At that point, more timeout was not a solution. A timeout can wait for a capable
model. It cannot add model capability or VRAM.

## The Intel acceleration detour

Intel's old IPEX-LLM path looked attractive because it promised optimized SYCL
inference. By the time I evaluated it, the repository was archived, its bundled
Ollama was old, the images used rolling tags, and the project was flagged with
known security issues. I rejected it.

The maintained high-throughput option is upstream llama.cpp's Intel SYCL image.
I staged it beside Ollama rather than replacing the working service. It needed
both `renderD128` and this host's actual card node, `card1`; assuming `card0`
prevented container creation.

llama-server introduced its own constraints:

- the default four parallel slots divided the usable context per request;
- `--parallel 1` was necessary for the large single-user prompt;
- `--jinja` was required for structured tool calls;
- oversized prompts hard-failed unless context shifting was configured;
- one server process loaded one GGUF model, unlike Ollama's model manager;
- the first SYCL request paid a JIT compilation cost.

I kept Ollama plus Vulkan as the default. SYCL can improve throughput, but it
does not make a 3B model format better arguments, nor does it make a 7B model fit
in 4 GB.

## What this GPU is actually good at

The A310 remains useful for private, small-model chat, summarization, rewriting,
and experiments where latency is acceptable. Llama 3.2 3B is the best local
default of the models I tested because it fits well enough and at least emits
real structured call shapes. Qwen2.5 1.5B is faster but less capable.

It is not a reliable local agent for a large MCP surface. The 13 Netdata schemas
force a large context, the large context consumes scarce VRAM, and the models
that remain fast enough cannot satisfy the schemas consistently.

The debugging order I use now is:

1. Confirm the accelerator backend actually loaded; do not infer GPU use from
   container access to `/dev/dri`.
2. Read the prompt token count and truncation log.
3. Measure KV cache size and GPU layer placement at the chosen context.
4. Separate prompt-evaluation latency from generation speed.
5. Verify tool execution success in logs, not in UI decoration.
6. Stop tuning when the evidence points to a model-capability or memory ceiling.

Self-hosting on a consumer GPU worked. The important part was narrowing the
claim: local chat worked well enough; reliable agentic monitoring did not.
