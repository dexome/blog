import {
  defineConfig,
  envField,
  fontProviders,
  svgoOptimizer,
} from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { rehypeHeadingIds, unified } from "@astrojs/markdown-remark";
import rehypeCallouts from "rehype-callouts";
import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import { transformerFileName } from "./src/utils/transformers/fileName";
import { rehypeTableWrapper } from "./src/utils/rehypeTableWrapper";
import {
  inlineTocDeprecation,
  rehypeInlineToc,
} from "./src/utils/rehypeInlineToc";
import config from "./astro-paper.config";
import { markdownExtensions } from "./src/utils/markdownExtensions";

export default defineConfig({
  site: process.env.SITE_URL ?? config.site.url,
  outDir: process.env.ASTRO_OUTDIR ?? "./dist",
  trailingSlash: "always",
  redirects: {
    "/page/archives/": "/post/",
    "/page/search/": "/search/",
    "/page/2/": "/post/2/",
    "/post/page/2/": "/post/2/",
    "/tags/guide/page/2/": "/tags/guide/2/",
  },
  integrations: [
    mdx(),
    sitemap({
      filter: page => {
        const path = new URL(page).pathname;
        return (
          !path.includes("/page/") &&
          (config.features?.showArchives !== false ||
            !/\/archives\/?$/.test(path))
        );
      },
    }),
    inlineTocDeprecation(),
  ],
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
    routing: {
      prefixDefaultLocale: false,
    },
  },
  markdown: {
    // Deprecated: the theme no longer uses remark-toc or remark-collapse. They
    // stay in package.json so a customised config importing them still builds,
    // and are removed in v8.
    processor: unified({
      remarkPlugins: [markdownExtensions],
      rehypePlugins: [
        rehypeHeadingIds,
        rehypeInlineToc,
        rehypeCallouts,
        rehypeTableWrapper,
      ],
    }),
    shikiConfig: {
      themes: { light: "min-light", dark: "night-owl" },
      defaultColor: false,
      wrap: false,
      transformers: [
        transformerFileName({ style: "v2", hideDot: false }),
        transformerNotationHighlight(),
        transformerNotationWordHighlight(),
        transformerNotationDiff({ matchAlgorithm: "v3" }),
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  fonts: [
    {
      name: "Google Sans Code",
      cssVariable: "--font-google-sans-code",
      provider: fontProviders.local(),
      fallbacks: ["monospace"],
      options: {
        variants: [
          {
            weight: 300,
            style: "normal",
            src: [
              "./node_modules/@fontsource/google-sans-code/files/google-sans-code-latin-300-normal.woff",
            ],
          },
          {
            weight: 400,
            style: "normal",
            src: [
              "./node_modules/@fontsource/google-sans-code/files/google-sans-code-latin-400-normal.woff",
            ],
          },
          {
            weight: 500,
            style: "normal",
            src: [
              "./node_modules/@fontsource/google-sans-code/files/google-sans-code-latin-500-normal.woff",
            ],
          },
          {
            weight: 600,
            style: "normal",
            src: [
              "./node_modules/@fontsource/google-sans-code/files/google-sans-code-latin-600-normal.woff",
            ],
          },
          {
            weight: 700,
            style: "normal",
            src: [
              "./node_modules/@fontsource/google-sans-code/files/google-sans-code-latin-700-normal.woff",
            ],
          },
        ],
      },
    },
  ],
  env: {
    schema: {
      PUBLIC_GOOGLE_SITE_VERIFICATION: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
    },
  },
  experimental: {
    svgOptimizer: svgoOptimizer(),
  },
});
