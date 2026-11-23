// Homepage copy, featured articles, and topic reading paths.
// Posts are referenced by their folder name under src/content/posts/.

export const home = {
  headline: "Practical notes from building and breaking a homelab.",
  body: "NixOS, containers, networking, and local AI. Real failures, working fixes, and the reasoning behind them.",
};

export const featured = [
  "docker-to-podman-migration-gotchas",
  "ha-firewall-carp-state-sync",
  "self-hosting-llms-consumer-gpus",
];

export const topicsPage = {
  title: "Explore the notebook",
  description:
    "Reading paths through networking, containers, local AI, and engineering practices.",
  body: "Follow a topic rather than a timeline. Each path brings related experiments together in a suggested reading order.",
};

export const topics = [
  {
    id: "networking",
    title: "Networking",
    description:
      "From a declarative network to firewall migrations and failover.",
    posts: [
      "scripted-to-systemd-networkd",
      "migrate-live-isp-wan-without-lockout",
      "firewall-as-code",
      "ha-firewall-carp-state-sync",
      "airvpn-pfsense",
    ],
  },
  {
    id: "containers",
    title: "NixOS & containers",
    description:
      "Migrate the runtime, wire up services, and keep storage usable.",
    posts: [
      "docker-to-podman-migration-gotchas",
      "containerize-reverse-proxy-gotchas",
      "shared-file-permissions-across-containers",
      "hardening-monitoring-agent-nixos",
      "nextcloud-photosync",
    ],
  },
  {
    id: "local-ai",
    title: "Local AI",
    description:
      "Small GPUs, useful models, and durable context for coding agents.",
    posts: [
      "self-hosting-llms-consumer-gpus",
      "durable-memory-for-ai-coding-agent",
    ],
  },
  {
    id: "engineering",
    title: "Engineering practices",
    description:
      "Automation, software development, and lessons that survive the incident.",
    posts: [
      "operational-postmortems-future-self",
      "running-workflow-orchestration-production",
      "nestjs-authz-authn",
      "cognito-auto-admin",
      "this-blog",
    ],
  },
];
