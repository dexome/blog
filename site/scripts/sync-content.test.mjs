import test from "node:test";
import assert from "node:assert/strict";
import { convertShortcodes, readFrontmatter } from "./sync-content.mjs";

test("Mermaid captions and explicit label breaks survive conversion", () => {
  const result = convertShortcodes(
    '{{< mermaid caption="A & B" >}}\nflowchart LR\n\nA["Before<br/>cutover"] --> B[Done]\n{{< /mermaid >}}'
  );
  assert.match(result, /<figure class="article-diagram">/);
  assert.match(result, /Before&lt;br\/&gt;cutover/);
  assert.match(result, /--&gt; B\[Done\]/);
  assert.match(result, /flowchart LR&#10;&#10;A\[/);
  assert.match(result, /<figcaption>A &amp; B<\/figcaption>/);
  assert.doesNotMatch(result, /\{\{</);
});

test("Hugo refs retain existing post URLs and explicit heading anchors", () => {
  assert.equal(
    convertShortcodes(
      '[Download]({{<ref "airvpn-pfsense.md#downloadconfig" >}})'
    ),
    "[Download](/post/airvpn-pfsense/#downloadconfig)"
  );
});

test("Unsupported shortcodes and malformed frontmatter fail explicitly", () => {
  assert.throws(
    () => convertShortcodes("{{< unknown >}}"),
    /Unsupported Hugo shortcode/
  );
  assert.throws(
    () => readFrontmatter("No frontmatter", "broken.md"),
    /Missing YAML frontmatter/
  );
});
