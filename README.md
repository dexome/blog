# The Dexome blog

Personal blog at [blog.dexome.com](https://blog.dexome.com) — notes from my experiments.

Built with [Hugo](https://gohugo.io) and the [hugo-theme-stack](https://github.com/CaiJimmy/hugo-theme-stack)
theme, deployed to **Azure Static Web Apps** via GitHub Actions. Comments are powered by
[Utterances](https://utteranc.es).

## Prerequisites

- [Hugo (extended)](https://gohugo.io/installation/) `>= 0.128.0`
- [.NET SDK 8.0](https://dotnet.microsoft.com/download) — only needed to work on the `api/` Functions
- Git (the theme is a submodule)

## Getting started

```bash
# Clone with the theme submodule
git clone --recurse-submodules https://github.com/dexome/blog.git
cd blog

# If you already cloned without submodules
git submodule update --init --recursive

# Run locally with drafts
hugo server -D
```

The site is served at http://localhost:1313.

## Writing a post

```bash
hugo new post/my-new-post/index.md
```

Edit the generated file, fill in `description`, `tags`, `categories` and (optionally) a
`featured_image`, then set `draft: false` when ready to publish.

## Project layout

| Path | Purpose |
|------|---------|
| `config.yml` | Hugo site configuration |
| `content/en/` | Posts and pages (English) |
| `layouts/` | Custom template overrides and shortcodes |
| `static/` | Static assets served as-is (css, js, images, verification files) |
| `assets/` | Pipeline assets processed by Hugo |
| `api/` | Azure Functions (.NET 8 isolated) deployed alongside the site |
| `infra/` | Bicep IaC for the Azure resources (Static Web App + analytics) |
| `themes/hugo-theme-stack/` | Active theme (git submodule) |
| `.github/workflows/` | Azure Static Web Apps CI/CD |

## Deployment

Every push to `main` triggers the
[Azure Static Web Apps workflow](.github/workflows/azure-static-web-apps-agreeable-pond-03fe8ab00.yml),
which builds the Hugo site (output in `public/`) and the `api/` Functions, then deploys them.
Pull requests get an automatic preview environment that is cleaned up on close.

## Infrastructure (Bicep)

The Azure resources are defined as code in [`infra/`](infra/):

- Static Web App (`blog`, Free, East Asia — the closest SWA-supported region to India)
- Log Analytics workspace + workspace-based Application Insights (South India)
- The `APPLICATIONINSIGHTS_CONNECTION_STRING` app setting wiring the two together

The template is idempotent against the existing resources. Preview and apply with:

```bash
# Preview changes (read-only)
az deployment group what-if -g dexome -f infra/main.bicep -p infra/main.bicepparam

# Apply
az deployment group create -g dexome -f infra/main.bicep -p infra/main.bicepparam
```

> Static Web Apps are only available in Central US, East US 2, West US 2, West Europe,
> and East Asia — not South India — so the site stays in East Asia while analytics runs
> in South India.
