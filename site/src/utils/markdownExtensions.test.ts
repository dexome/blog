import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import { markdownExtensions } from "./markdownExtensions.ts";

const render = async (markdown: string) => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [markdownExtensions],
  });
  return processor.render(markdown, {
    fileURL: pathToFileURL("/posts/example/index.md"),
  });
};

test("Mermaid fences become captioned figures with the source intact", async () => {
  const { code } = await render(
    [
      '```mermaid caption="A & B\'s route"',
      "flowchart LR",
      "",
      '  A["<b>x</b>"] --> B',
      "```",
    ].join("\n")
  );
  assert.match(
    code,
    /<figure class="article-diagram">\s*<pre class="mermaid">/
  );
  assert.ok(!code.includes("astro-code"), "diagram must not be highlighted");
  const source = code.match(/<pre class="mermaid">([\s\S]*?)<\/pre>/)?.[1];
  const decoded = source
    ?.replaceAll("&#x22;", '"')
    .replaceAll("&#x3C;", "<")
    .replaceAll("&#x26;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  assert.equal(decoded, 'flowchart LR\n\n  A["<b>x</b>"] --> B');
  assert.match(code, /<figcaption>A (&#x26;|&amp;) B['’]s route<\/figcaption>/);
});

test("Explicit heading anchors set the id and are removed from the text", async () => {
  const { code } = await render("## Install WireGuard {#installwireguard}");
  assert.match(code, /<h2 id="installwireguard">Install WireGuard<\/h2>/);
});

test("Standalone local HTML images are optimized and keep their width", async () => {
  const { code, metadata } = await render(
    'Before\n\n<img src="login-page.png" width="400">\n\nAfter'
  );
  assert.deepEqual(metadata.localImagePaths, ["login-page.png"]);
  const image = JSON.parse(
    code.match(/__ASTRO_IMAGE_="([^"]+)"/)?.[1].replaceAll("&#x22;", '"') ??
      "{}"
  );
  assert.equal(image.src, "login-page.png");
  assert.equal(image.width, 400);
});

test("Local images mixed into other HTML fail instead of breaking silently", async () => {
  await assert.rejects(
    render('<p>See <img src="diagram.png"> here</p>'),
    /standalone <img> tag/
  );
});
