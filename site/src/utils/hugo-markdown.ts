import type { Root } from "mdast";
import { basename } from "node:path";
import { visit } from "unist-util-visit";

export function hugoMarkdown() {
  return (tree: Root, file: { path?: string }) => {
    if (!file.path)
      throw new Error("Hugo Markdown adaptation requires a source path.");
    const slug = basename(file.path).replace(/\.(md|mdx)$/, "");
    const resourceUrl = (url: string) => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return url;
      const resolved = new URL(url, `https://preview.invalid/post/${slug}/`);
      return resolved.pathname + resolved.search + resolved.hash;
    };
    visit(tree, "heading", heading => {
      const last = heading.children.at(-1);
      if (last?.type !== "text") return;
      const match = last.value.match(/\s+\{#([^}]+)\}\s*$/);
      if (!match) return;
      last.value = last.value.slice(0, match.index);
      heading.data = { ...heading.data, hProperties: { id: match[1] } };
    });
    visit(tree, "image", image => {
      image.url = resourceUrl(image.url);
    });
    visit(tree, "html", html => {
      html.value = html.value.replace(
        /(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi,
        (_, start: string, url: string, end: string) =>
          start + resourceUrl(url) + end
      );
    });
  };
}
