# Theme previews

Try alternative themes side-by-side without touching the live Stack setup.
Each preview uses Hugo **module mounts** to load only `content/en` and `static`,
while masking the project's Stack-specific `layouts/` with an empty directory —
so the previewed theme renders with its *own* templates.

## Requirements

- **Hugo extended >= 0.158.0** (Congo needs 0.158+, and both themes use the new
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
hugo server --config preview/congo.yml -D
```

Blowfish:

```bash
hugo server --config preview/blowfish.yml -D
```

Both run against your existing `content/en/` posts. Your production build (Stack)
is unaffected — it still uses the root `config.yml`.

## 3. Notes

- These preview configs are intentionally minimal — just enough to render posts.
  Each theme has many more options (menus, homepage layout, appearance) you'd
  flesh out if you decide to switch.
- Switching themes for real means porting the Stack-specific `params` (widgets,
  sidebar, colorScheme) in `config.yml` to the new theme's schema, and updating
  `HUGO_VERSION` in the GitHub Actions workflow to >= 0.158.0.
- To remove a theme you tried:

  ```bash
  git submodule deinit -f themes/congo && git rm -f themes/congo
  ```
