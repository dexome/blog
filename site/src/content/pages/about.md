---
title: About Dexome
description: Jahan Arun J's working notebook on software, homelab experiments, and the reasoning behind the fixes.
---
I'm **Jahan Arun J**. I build software, run a homelab, and write down the
lessons I don't want to learn twice. Dexome is that working notebook.

Most posts begin with something that needs figuring out: a container that
cannot reach its backend, a firewall migration that must keep the WAN
reachable, or a language model that needs to fit on a small GPU.

The interesting part isn't just the configuration that finally works.
It's understanding why the first attempt didn't, which evidence changed
the diagnosis, and how to tell whether the fix actually holds.

## What you'll find here

- **Networking:** declarative configuration, firewall migrations, and
  failover. Start with [testing firewall high availability](/post/ha-firewall-carp-state-sync/).
- **NixOS and containers:** services, runtimes, storage, and the permissions
  between them. Start with [the gotchas in moving from Docker to Podman](/post/docker-to-podman-migration-gotchas/).
- **Local AI:** useful models on modest hardware and practical workflows
  for coding agents. Start with [self-hosting language models on consumer GPUs](/post/self-hosting-llms-consumer-gpus/).
- **Engineering practices:** automation, operational lessons, and notes
  worth returning to. Start with [writing postmortems for your future self](/post/operational-postmortems-future-self/).

## How to read these notes

I aim to preserve enough context to make the reasoning useful: the goal,
the constraints, what failed, what changed, and how I checked the result.
Commands and configuration snippets are part of the explanation, not a
substitute for it.

These are field notes from my environment, not universal recipes.
Hardware, versions, and network layouts matter. Use the investigation to
guide your own checks rather than assuming the same configuration will
behave identically everywhere.

For a guided route through the posts, [choose a topic and reading path](/topics/).
To explore at your own pace, [browse all the writing](/post/).

## Keep in touch

Have a correction, a question, or a different result from trying something
here? Find me on [GitHub](https://github.com/jahanarun) or
[LinkedIn](https://www.linkedin.com/in/jahanarun).

To follow new posts in your feed reader, [subscribe via RSS](/index.xml).
