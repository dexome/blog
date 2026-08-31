---
date: "2026-06-10T00:00:00+05:30"
description: My results from running Ollama, LibreChat and Netdata MCP on an Intel Arc A310 with 4 GB VRAM
featured_image: ""
tags:
- guide
- ai
- llm
- ollama
- intel-arc
- self-hosting
title: Running Local LLMs on an Intel Arc A310
---

I use an Intel Arc A310 with 4 GB VRAM for Frigate, Immich and media transcoding.
I wanted to use the same GPU for a private LibreChat setup, with Ollama as the
model server and Netdata exposed through MCP.

Small models worked for normal chat. Netdata tool calling did not work reliably.
The first problem was Ollama's default 4096-token context, which removed the MCP
tool definitions from the prompt. After increasing the context, the remaining
problem was the capability of models which could fit on this GPU.

## My setup

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

The Vulkan backend worked for small local models. The first issue appeared before
the model generated any response.

## MCP tools were removed by context truncation

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

## Larger context used more VRAM

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

The model files fitted, but the model, KV cache and the other GPU workloads did
not always fit at the same time.

## Models I tested

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

Increasing the timeout only waited longer for the same result. It did not fix
the invalid tool arguments or make the 7B model fit better.

## Testing the Intel SYCL backend

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

## What works well on the A310

The A310 is useful for private chat, summarization and small experiments. Llama
3.2 3B was the best local default from my tests. It fitted well enough and could
emit a real tool-call structure. Qwen2.5 1.5B was faster but printed the tool call
as text.

It was not reliable for the 13 Netdata MCP tools. Their schemas required a large
context and the models which remained usable on 4 GB VRAM could not consistently
produce valid tool arguments.

The debugging order I use now is:

1. Confirm the accelerator backend actually loaded; do not infer GPU use from
   container access to `/dev/dri`.
2. Read the prompt token count and truncation log.
3. Measure KV cache size and GPU layer placement at the chosen context.
4. Separate prompt-evaluation latency from generation speed.
5. Verify tool execution success in logs, not in UI decoration.
6. Check whether the remaining problem is model capability rather than another
	timeout or context setting.

I kept Ollama with Vulkan as the default because it supports model management and
normal local chat worked. llama.cpp with SYCL is available for comparison, but a
faster backend does not make the small model better at producing schema-valid
tool calls.
