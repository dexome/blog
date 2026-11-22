// Cross-platform stand-in for the previous `cp -r dist/pagefind public/`
// build step: cmd.exe, the shell npm runs scripts with on Windows,
// has no `cp`, so the full build used to fail there. Keeping the index in
// public/ lets `astro dev` and subsequent builds serve it.
import { cpSync } from "node:fs";

const output = process.argv[2] ?? "dist";
cpSync(`${output}/pagefind`, "public/pagefind", { recursive: true, force: true });
// Keep the sitemap URL previously submitted for the Hugo site.
cpSync(`${output}/sitemap-index.xml`, `${output}/sitemap.xml`);
