import {
  cp,
  glob,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";

const project = fileURLToPath(new URL("../", import.meta.url));
const repository = fileURLToPath(new URL("../../", import.meta.url));
const generated = join(project, "src/content/dexome");

export function readFrontmatter(source, filename) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${filename}`);
  const data = parse(match[1]);
  if (!data || typeof data !== "object" || typeof data.title !== "string") {
    throw new Error(`Missing article title: ${filename}`);
  }
  return { data, body: match[2] };
}

const escapeHtml = value =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function convertShortcodes(body) {
  const converted = body
    .replace(
      /\{\{<\s*mermaid(?:\s+caption="([^"]*)")?\s*>\}\}([\s\S]*?)\{\{<\s*\/mermaid\s*>\}\}/g,
      (_, caption, diagram) =>
        `\n<figure class="article-diagram">\n<pre class="mermaid">${escapeHtml(diagram.trim()).replace(/\r?\n/g, "&#10;")}</pre>` +
        `${caption ? `\n<figcaption>${escapeHtml(caption)}</figcaption>` : ""}\n</figure>\n`
    )
    .replace(/\{\{<\s*ref\s+"([^"]+)"\s*>\}\}/g, (_, reference) => {
      const [path, fragment] = reference.split("#");
      const slug = basename(path, ".md");
      return `/post/${slug}/${fragment ? `#${fragment}` : ""}`;
    });
  if (/\{\{[<%]/.test(converted)) {
    throw new Error("Unsupported Hugo shortcode in Astro preview content.");
  }
  return converted;
}

async function copyImages(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyImages(from, to);
    else if (/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(extname(entry.name)))
      await cp(from, to);
  }
}

async function syncContent() {
  const source = join(repository, "content/en/post");
  const notebook = parse(
    await readFile(join(repository, "preview/congo/data/notebook.yml"), "utf8")
  );
  const home = readFrontmatter(
    await readFile(join(repository, "preview/congo/content/_index.md"), "utf8"),
    "homepage"
  );
  const topics = readFrontmatter(
    await readFile(
      join(repository, "preview/congo/content/topics/index.md"),
      "utf8"
    ),
    "topics"
  );
  const featured = new Set(
    notebook.featured.map(entry => entry.path.split("/").at(-1))
  );
  await rm(generated, { recursive: true, force: true });
  await rm(join(project, "public/post"), { recursive: true, force: true });
  await mkdir(join(generated, "posts"), { recursive: true });
  await mkdir(join(generated, "pages"), { recursive: true });
  let count = 0;
  for await (const file of glob("*/index.md", { cwd: source })) {
    const slug = basename(dirname(file));
    const { data, body } = readFrontmatter(
      await readFile(join(source, file), "utf8"),
      slug
    );
    const date = new Date(data.date);
    if (
      !Number.isFinite(date.getTime()) ||
      typeof data.description !== "string"
    ) {
      throw new Error(`Invalid publication date or description: ${slug}`);
    }
    if (
      data.tags !== undefined &&
      (!Array.isArray(data.tags) ||
        data.tags.some(tag => typeof tag !== "string"))
    ) {
      throw new Error(`Invalid tags: ${slug}`);
    }
    if (data.draft !== undefined && typeof data.draft !== "boolean") {
      throw new Error(`Invalid draft flag: ${slug}`);
    }
    const metadata = {
      title: data.title,
      description: data.description,
      pubDatetime: date.toISOString(),
      ...(data.lastmod
        ? { modDatetime: new Date(data.lastmod).toISOString() }
        : {}),
      tags: data.tags ?? [],
      draft: data.draft ?? false,
      featured: featured.has(slug),
    };
    await writeFile(
      join(generated, "posts", `${slug}.md`),
      `---\n${stringify(metadata)}---\n${convertShortcodes(body)}`
    );
    await copyImages(join(source, slug), join(project, "public/post", slug));
    count++;
  }
  const about = readFrontmatter(
    await readFile(
      join(repository, "preview/congo/content/about/index.md"),
      "utf8"
    ),
    "about"
  );
  await writeFile(
    join(generated, "pages/about.md"),
    `---\n${stringify({ title: about.data.title, description: about.data.description })}---\n${about.body}`
  );
  await writeFile(
    join(generated, "notebook.json"),
    JSON.stringify(
      {
        ...notebook,
        home: { ...home.data, body: home.body.trim() },
        topicsPage: { ...topics.data, body: topics.body.trim() },
      },
      null,
      2
    )
  );
  await copyImages(
    join(repository, "static/images"),
    join(project, "public/images")
  );
  await cp(
    join(repository, "static/images/dexome.png"),
    join(project, "public/dexome.png")
  );
  await cp(
    join(project, "node_modules/@fontsource/google-sans-code/LICENSE"),
    join(project, "public/google-sans-code-license.txt")
  );
  for (const name of [
    "BingSiteAuth.xml",
    "c20cf60d78fe468db0a5059fe0273e1e.txt",
  ]) {
    await cp(join(repository, "static", name), join(project, "public", name));
  }
  process.stdout.write(
    `Synced ${count} original posts and shared pages; source files were not modified.\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await syncContent();
}
