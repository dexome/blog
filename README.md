# The Dexome blog

Personal blog at [blog.dexome.com](https://blog.dexome.com) — notes from my experiments.

Built with [Hugo](https://gohugo.io) and the [Congo](https://github.com/jpanther/congo)
theme, deployed to **Azure Static Web Apps** via GitHub Actions. Comments are powered by
[Giscus](https://giscus.app) and GitHub Discussions.

## Prerequisites

- [Hugo (extended)](https://gohugo.io/installation/) `>= 0.165.0` (CI uses `0.165.0`)
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
hugo server --renderToMemory -D
```

The site is served at http://localhost:1313.
Local servers are non-indexable and do not load comments or send analytics.
For the explicit port-1314 preview, see [preview instructions](preview/README.md).

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
| `content/en/post/` | Existing English posts and their page resources |
| `preview/congo/` | Shared Congo pages, reading paths, templates, CSS, and JavaScript used in production and preview |
| `layouts/` | Legacy Stack overrides (not mounted) and the shared Mermaid shortcode |
| `static/` | Static assets served as-is (css, js, images, verification files) |
| `assets/` | Legacy Stack assets (not mounted by the Congo configuration) |
| `api/` | Azure Functions (.NET 8 isolated) deployed alongside the site |
| `infra/` | Bicep IaC for the Azure resources (Static Web App + analytics) |
| `themes/congo/` | Active theme (git submodule) |
| `.github/workflows/` | Azure Static Web Apps CI/CD |

## Deployment

Every push to `main` triggers the
[Azure Static Web Apps workflow](.github/workflows/azure-static-web-apps-agreeable-pond-03fe8ab00.yml),
which builds the Hugo site (output in `public/`) and the `api/` Functions, then deploys them.
Hugo extended is installed and run directly on the GitHub Ubuntu runner.
The deployment action uploads the prebuilt `public/` directory with
`skip_app_build: true`, avoiding the older C libraries in Oryx's app-build
container. Oryx still builds the Functions API from `api/`.
The workflow also applies the existing Bicep infrastructure on pushes to `main`.
Pull requests get an automatic preview environment that is cleaned up on close;
those builds use Hugo's `preview` environment and disable indexing, comments,
and analytics.

Check the production build locally before pushing:

```bash
hugo --gc --minify --environment production --panicOnWarning
```

The production configuration uses `https://blog.dexome.com/`, permits indexing,
loads Giscus on articles, and sends page-visit beacons to the existing `/api/track`
endpoint. It does not require the preview configuration file.

### Comments

Giscus uses the `Announcements` discussion category in `dexome/blog`. The public
repository/category IDs are configured in `config.yml`; no token or secret is
embedded in the site. Its app must remain installed for this repository.

Comment matching uses an explicit article-title term, without Congo's
browser-title suffix or ambiguous HTML metadata. Light/dark comments follow
the site's appearance switcher.
Missing or placeholder Giscus IDs fail the production build instead of silently
disabling comments.

Existing Utterances issues are not automatically migrated. The AirVPN thread
[#5](https://github.com/dexome/blog/issues/5) remains unchanged. At switchover,
an administrator can convert it to an `Announcements` discussion; verify that
Giscus finds it on the AirVPN article before considering the migration complete.
Do not delete the original conversation or post a replacement thread.

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
