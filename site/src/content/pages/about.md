---
title: About this blog
description: Notes from Jahan Arun J on building software, tinkering with a homelab, and figuring things out.
---
Hey, I'm **Jahan Arun J**. I build software, tinker with a homelab, and keep
notes so I don't have to figure out the same thing twice. That's pretty
much what this blog is.

Most posts start with something that isn't quite working: a container
that can't reach its backend, a firewall migration where I need to keep
the internet up, or a language model that has to fit on a small GPU.

I like figuring out why things broke, not just finding a config that
works. So I write about the failed attempts too, what helped me work out
the problem, and how I checked that the fix actually stuck.

## What I write about

- **Networking:** configuring things, swapping firewalls, and keeping
  connections alive when something goes down. Try [testing firewall high availability](/post/ha-firewall-carp-state-sync/).
- **NixOS and containers:** getting services, runtimes, storage, and
  permissions to play nicely together. Try [the gotchas in moving from Docker to Podman](/post/docker-to-podman-migration-gotchas/).
- **Local AI:** running useful models without huge GPUs, plus working
  with coding agents. Try [self-hosting language models on consumer GPUs](/post/self-hosting-llms-consumer-gpus/).
- **Engineering practices:** automating the boring bits and keeping
  notes for next time. Try [writing postmortems for your future self](/post/operational-postmortems-future-self/).

## A quick heads-up

I try to leave enough context that the notes make sense later: what I
was trying to do, what got in the way, what I changed, and how I tested
it. The commands and configs are there, but so is the thinking behind them.

This is what worked in my setup, not a promise that it'll work in yours.
Hardware, versions, and network layouts can change things. Hopefully the
notes help you figure out what to check, even if your fix looks different.

Not sure where to start? [Pick a topic](/topics/) for a suggested reading
order, or just [browse all the posts](/post/).

## Say hello

Spotted a mistake, have a question, or tried something here and got a
different result? You can find me on [GitHub](https://github.com/jahanarun) or
[LinkedIn](https://www.linkedin.com/in/jahanarun).

If you use a feed reader, [RSS is here](/index.xml).
