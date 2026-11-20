# Theme previews

The Congo notebook design is now the default site configuration. Its shared
presentation remains under `preview/congo/` while this version is evaluated;
Hugo module mounts keep the legacy Stack templates and assets out of both builds.

The Congo design includes a curated homepage,
topic reading paths, About page, full-text search, visible RSS links, and a
wider article layout. Original post Markdown and page resources are unchanged.
Comments and analytics are disabled in this preview, and pages are marked
`noindex, nofollow`.

## Requirements

- **Hugo extended >= 0.165.0** (the version used in CI; both themes use the new
  `_partials`/`_markup` layout lookup from Hugo 0.146+). The Ubuntu/apt Hugo is
  far too old. Install a current build to `~/.local/bin`:

  ```bash
  ver=v0.165.0
  curl -fsSL -o /tmp/hugo.tar.gz \
    "https://github.com/gohugoio/hugo/releases/download/$ver/hugo_extended_${ver#v}_linux-amd64.tar.gz"
  tar -xzf /tmp/hugo.tar.gz -C ~/.local/bin hugo
  hash -r && hugo version
  ```

## 1. Add the theme submodules (run these yourself — the assistant does not run git)

```bash
git submodule add https://github.com/jpanther/congo.git themes/congo
git submodule add https://github.com/nunocoracao/blowfish.git themes/blowfish
git submodule update --init --recursive
```

## 2. Preview each theme

Congo:

```bash
hugo server --config config.yml,preview/congo.yml --renderToMemory -D --port 1314
```

Blowfish:

```bash
hugo server --config preview/blowfish.yml -D
```

Both run against your existing `content/en/` posts. The Congo preview overlays
the production `config.yml` with local URLs and disables comments and analytics,
even when built with the production environment.
Rendering the server in memory keeps local URLs out of `public/` and prevents
separate builds or theme servers from overwriting the running preview.

Open the Congo preview at http://localhost:1314. Useful pages to compare:

- `/`: introduction, starting articles, topics, and recent writing
- `/topics/`: ordered reading paths
- `/post/shared-file-permissions-across-containers/`: article with code, tables,
  diagram captions, and accessible diagram zoom controls
- `/about/`: the notebook's purpose and subscription links

Search is available in the header or with `/`. The existing `/page/search/`
route also opens a search landing page; `/page/archives/` redirects to `/post/`.
The feed and search index include articles only, not utility pages or tags.
The appearance toggle is in the footer.

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

To check a static build without overwriting production output:

```bash
hugo --config config.yml,preview/congo.yml --destination /tmp/dexome-congo-preview --panicOnWarning
```

## 3. Notes

- The Blowfish config remains a standalone, minimal theme comparison; do not
  combine it with the root Congo configuration.
- Production is built from `config.yml` only. Do not include `preview/congo.yml`
  in a deployment build: it intentionally prevents indexing and disables
  comments and analytics.
- To remove a theme you tried:

  ```bash
  git submodule deinit -f themes/congo && git rm -f themes/congo
  ```
