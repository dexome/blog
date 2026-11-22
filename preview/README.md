# Blog theme comparisons

AstroPaper in `site/` is the production application. The Congo configuration
remains available as an independent comparison and rollback option.
Shared author pages, reading paths, and diagram rendering remain under
`preview/congo/`; the original post Markdown is unchanged.

The isolated comparisons use the same original posts, About page, featured
articles, and topic reading paths. Nothing in this folder changes the deployment
workflow or selects a different production theme.

| Preview | Address | Runtime |
|---------|---------|---------|
| Congo comparison | http://localhost:1314/ | Hugo extended 0.165.0 |
| AstroPaper v7.2.0 | http://localhost:4321/ | Linux Node.js 24 recommended |

The Congo design includes a curated homepage,
topic reading paths, About page, full-text search, visible RSS links, and a
wider article layout. Original post Markdown and page resources are unchanged.
Comments and analytics are disabled in this preview, and pages are marked
`noindex, nofollow`.

## Requirements

- **Congo:** Hugo extended 0.165.0 for the retained comparison.
- **AstroPaper:** a Linux Node.js runtime satisfying `>=22.23.4`; Node.js 24
  was used for this comparison. When working in WSL, do not use Windows npm to
  install the Linux project's dependencies.

Use official [Hugo releases](https://github.com/gohugoio/hugo/releases) and
[Node.js downloads](https://nodejs.org/en/download), and verify downloaded
archives against their published checksums.

## 1. Restore the theme submodules

```bash
git submodule update --init --recursive
```

## 2. Preview each theme

Congo:

```bash
hugo server --config config.yml,preview/congo.yml --renderToMemory -D --port 1314
```

The Congo preview reads the original `content/en/post/` files. It overlays
the retained Hugo `config.yml` with local URLs and disables comments and analytics,
even when built with the production environment.
Rendering the server in memory keeps local URLs out of `public/` and prevents
separate builds or theme servers from overwriting the running preview.

AstroPaper:

```bash
cd site
npm ci
npm test
SITE_URL=http://localhost:4321/ npm run build:preview
ASTRO_OUTDIR=dist-preview npm run preview -- --host 127.0.0.1 --port 4321
```

This serves the isolated `site/dist-preview/` build, including the search index,
with indexing, Giscus, and analytics disabled. `npm run build` creates the
production `site/dist/` output with production URLs and integrations enabled;
do not serve or deploy that output when you intend a comparison-only preview.
For development, run `npm run dev -- --host 127.0.0.1 --port 4321` instead.
Build at least once before testing search in development mode.

Useful pages to compare at each address:

- `/`: introduction, starting articles, topics, and recent writing
- `/topics/`: ordered reading paths
- `/post/shared-file-permissions-across-containers/`: article with code, tables,
  diagram captions, and accessible diagram zoom controls
- `/about/`: the notebook's purpose and subscription links
- `/post/airvpn-pfsense/`: screenshots and explicit heading anchors

Search is available in the header or with `/`. The existing `/page/search/`
route also opens a search landing page; `/page/archives/` redirects to `/post/`.
The feed and search index include articles only, not utility pages or tags.
Congo's appearance toggle is in the footer; AstroPaper's is in the header.
AstroPaper search is at `/search/`, while Congo also offers a header search
dialog. Both serve the RSS feed at `/index.xml`; AstroPaper also serves `/rss.xml`.

### Editing the shared Congo presentation

- `congo/content/`: homepage copy, section introduction, and utility pages
- `congo/data/notebook.yml`: featured articles and ordered topic reading paths
- `congo/layouts/`: homepage, article-list, and topics templates
- `congo/assets/`: styling, diagrams, and production-only comments/analytics scripts

These files are shared with production; use the local preview to review edits.
The existing post Markdown, images, slugs, and heading anchors are retained.
Congo reuses the production Mermaid shortcode markup, with its own bundled
renderer and zoom dialog; it does not load the Stack templates or external
Mermaid CDN script.

### AstroPaper

`../site/` was scaffolded from the MIT-licensed AstroPaper v7.2.0 release.
It retains the theme's typography, components, dark mode, image zoom, and search.
Google Sans Code is bundled locally through Fontsource; no Google font request
is needed to build or view the preview. Its font license is copied into the
preview output.

`npm run sync:content` creates ignored working copies under
`site/src/content/dexome/` and copies image resources into the application's
`public/` directory. It runs automatically before development and builds.
Original Markdown is never rewritten.

The adapter converts Mermaid and `ref` shortcodes, preserves explicit heading
IDs and image paths, and retains `/post/<slug>/` URLs. Unknown shortcodes fail
explicitly. AstroPaper's template demo posts were removed; only Dexome content is built.

Run `npm run sync:content` after changing original posts or shared pages while
the dev server is running. Rebuild to refresh the search index. Do not edit the
generated copies.

The production lock uses compatible targeted patches for the upstream
typography selector parser and Satori's `fflate` dependency. The dependency audit
is clean; no forced theme downgrades were applied.

Diagram labels use native SVG text to avoid Mermaid's HTML-label clipping at
non-default browser zoom levels. When changing diagram rendering, check the HA
topology at 100%, 125%, and 150% zoom, including the expanded view.

To check a static build without overwriting production output:

```bash
hugo --config config.yml,preview/congo.yml --destination /tmp/dexome-congo-preview --panicOnWarning
```

## 3. Notes

- Production is built with Node.js from `site/`, not with Hugo. CI uploads
  `site/dist/` on `main` pushes and `site/dist-preview/` for pull requests.
- To remove a theme you tried:

  ```bash
  git submodule deinit -f themes/congo && git rm -f themes/congo
  ```
