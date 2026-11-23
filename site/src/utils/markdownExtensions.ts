import type { Html, Image, Root } from "mdast";
import { visit } from "unist-util-visit";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const attribute = (tag: string, name: string) =>
  tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];

const isLocal = (url: string) => !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url);

/**
 * Article Markdown extensions:
 * - `## Heading {#anchor}` sets an explicit heading id.
 * - ```` ```mermaid caption="..." ```` renders a captioned diagram figure.
 * - A standalone `<img src="local.png" width="400">` is optimized like a
 *   Markdown image while keeping its width.
 */
export function markdownExtensions() {
  return (tree: Root) => {
    visit(tree, "heading", heading => {
      const last = heading.children.at(-1);
      if (last?.type !== "text") return;
      const match = last.value.match(/\s+\{#([^}]+)\}\s*$/);
      if (!match) return;
      last.value = last.value.slice(0, match.index);
      heading.data = { ...heading.data, hProperties: { id: match[1] } };
    });

    visit(tree, "code", (code, index, parent) => {
      if (code.lang !== "mermaid" || !parent || index === undefined) return;
      const caption = code.meta?.match(/caption="([^"]*)"/)?.[1];
      // Encoded newlines keep the diagram source inside a single raw HTML block.
      const figure: Html = {
        type: "html",
        value:
          `<figure class="article-diagram">\n<pre class="mermaid">${escapeHtml(code.value.trim()).replace(/\r?\n/g, "&#10;")}</pre>` +
          `${caption ? `\n<figcaption>${escapeHtml(caption)}</figcaption>` : ""}\n</figure>`,
      };
      parent.children[index] = figure;
    });

    visit(tree, "html", (html, index, parent) => {
      const tags = html.value.match(/<img\b[^>]*>/gi) ?? [];
      const local = tags.filter(tag => isLocal(attribute(tag, "src") ?? ""));
      if (!local.length) return;
      const tag = html.value.trim();
      if (
        local.length > 1 ||
        tag !== local[0] ||
        !parent ||
        index === undefined
      ) {
        throw new Error(
          `Local images in HTML must be a standalone <img> tag: ${html.value}`
        );
      }
      const width = attribute(tag, "width");
      const image: Image = {
        type: "image",
        url: attribute(tag, "src") ?? "",
        alt: attribute(tag, "alt") ?? "",
        title: attribute(tag, "title") ?? null,
        data: width ? { hProperties: { width: Number(width) } } : undefined,
      };
      parent.children[index] = image;
    });
  };
}
