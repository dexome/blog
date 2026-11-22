# The Dexome blog

Personal blog at [blog.dexome.com](https://blog.dexome.com) — notes from my experiments.

Built with [Astro](https://astro.build) and [AstroPaper](https://github.com/satnaing/astro-paper),
deployed to **Azure Static Web Apps** via GitHub Actions. Comments are powered by
[Giscus](https://giscus.app) and GitHub Discussions.

## Prerequisites

- [Node.js](https://nodejs.org) 24 (CI uses Node.js 24)
- [.NET SDK 8.0](https://dotnet.microsoft.com/download) — only needed to work on the `api/` Functions
- Git with submodules (the retained shared Mermaid library comes from the Congo submodule)

## Getting started

```bash
# Clone with the theme submodule
git clone --recurse-submodules https://github.com/dexome/blog.git
cd blog

# If you already cloned without submodules
git submodule update --init --recursive

cd site
npm ci
npm run dev
```

The dev server is served at http://localhost:4321. Development mode is non-indexable
and does not load comments or send analytics.

For a production-faithful local comparison with integrations disabled:

```bash
cd site
SITE_URL=http://localhost:4321/ npm run build:preview
ASTRO_OUTDIR=dist-preview npm run preview -- --host 127.0.0.1 --port 4321
```

The preview output is separate from production `site/dist/`. The content-copy
adapter runs before builds and development; run `npm run sync:content` after
editing original posts while the dev server is running. Rebuild to refresh search.
The retained Hugo comparisons are documented in [preview instructions](preview/README.md).

## Writing a post

Keep authoring in `content/en/post/<slug>/index.md`, with YAML frontmatter containing
`title`, `date`, `description`, `tags`, and an optional `draft` flag.
Store images beside the post. Set `draft: false` when it is ready to publish.

The adapter generates ignored Astro content copies without rewriting originals.
Mermaid shortcodes, existing `ref` links, explicit heading anchors, and image URLs
are preserved; unsupported shortcodes fail explicitly.

## Project layout

| Path | Purpose |
|------|---------|
| `site/` | Production AstroPaper app, package manifest, lockfile, components, and build configuration |
| `site/astro-paper.config.ts` | Site identity, Giscus IDs, analytics toggle, and article licensing |
| `content/en/post/` | Existing English posts and their page resources |
| `preview/congo/content/` | Shared homepage copy, About page, and topic introduction |
| `preview/congo/data/notebook.yml` | Featured articles and ordered reading paths |
| `preview/congo/assets/js/` | Shared, tested Mermaid renderer and first-party analytics beacon |
| `preview/shared/` | Shared diagram styling |
| `config.yml`, `layouts/`, `assets/` | Retained Hugo configuration and templates for comparison/rollback |
| `static/` | Original static images and verification resources |
| `api/` | Azure Functions (.NET 8 isolated) deployed alongside the site |
| `infra/` | Bicep IaC for the Azure resources (Static Web App + analytics) |
| `themes/congo/` | Retained Hugo rollback configuration's theme and the shared Mermaid library |
| `.github/workflows/` | Azure Static Web Apps CI/CD |

## Deployment

Every push to `main` triggers the
[Azure Static Web Apps workflow](.github/workflows/azure-static-web-apps-agreeable-pond-03fe8ab00.yml),
which installs locked dependencies in `site/`, runs the adapter tests, and builds
AstroPaper on the GitHub Ubuntu runner using Node.js 24.
The deployment action uploads the prebuilt `site/dist/` directory with
`skip_app_build: true`, avoiding the older C libraries in Oryx's app-build
container. Oryx still builds the Functions API from `api/`.
The workflow also applies the existing Bicep infrastructure on pushes to `main`.
Pull requests get an automatic preview environment that is cleaned up on close;
those builds use Astro's `preview` mode, write to `site/dist-preview/`, and disable
indexing, comments, and analytics. The API and infrastructure jobs are unchanged.

Check the production build locally before pushing:

```bash
cd site
npm ci
npm audit --audit-level=moderate
npm test
npm run build
```

The production configuration uses `https://blog.dexome.com/`, permits indexing,
loads Giscus on articles, and sends page-visit beacons to the existing `/api/track`
endpoint after full-page loads and Astro client-side navigation (reporting the
previous page as the referrer).
The old Hugo feeds remain available: `/index.xml`, `/post/index.xml`, and each
`/tags/<tag>/index.xml`, alongside `/rss.xml`.
The submitted `/sitemap.xml` URL is retained as an alias of Astro's sitemap index.
Legacy archive/search/pagination redirects and the custom 404 response are
defined in `site/public/staticwebapp.config.json`.

The dependency lock includes targeted compatible security patches for the
upstream typography selector parser and Satori's `fflate` dependency.
No forced theme downgrades are used.

### Comments

Giscus uses the `Announcements` discussion category in `dexome/blog`. The public
repository/category IDs are configured in `site/astro-paper.config.ts`; no token or secret is
embedded in the site. Its app must remain installed for this repository.

Comment matching uses an explicit article-title term, without Congo's
browser-title suffix or ambiguous HTML metadata. Light/dark comments follow
the site's appearance switcher. The official Giscus web component handles iframe
configuration and cleanup when Astro navigates between article pages.
It is mounted after navigation completes so discussion backlinks use the current article URL.
Missing or placeholder Giscus IDs fail the production build instead of silently
disabling comments.

Existing Utterances issues are not automatically migrated. The AirVPN thread
[#5](https://github.com/dexome/blog/issues/5) remains unchanged. At switchover,
an administrator can convert it to an `Announcements` discussion; verify that
Giscus finds it on the AirVPN article before considering the migration complete.
Do not delete the original conversation or post a replacement thread.

For a local Giscus check against real discussions without sending analytics:

```bash
cd site
PUBLIC_DISABLE_ANALYTICS=true npm run build
npm run preview -- --host 127.0.0.1 --port 4322
```

This uses production-mode comments and the production discussion mappings.
Posting locally creates real GitHub comments. Production builds should omit the
local-only `PUBLIC_DISABLE_ANALYTICS` flag.

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
