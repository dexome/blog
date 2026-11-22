import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://blog.dexome.com/",
    title: "Dexome",
    description:
      "Practical notes on NixOS, containers, networking, and local AI. Real failures, working fixes, and the reasoning behind them.",
    author: "Jahan Arun J",
    profile: "https://github.com/jahanarun",
    ogImage: "dexome.png",
    lang: "en",
    timezone: "Asia/Kolkata",
    dir: "ltr",
  },
  posts: {
    perPage: 10,
    perIndex: 6,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: false,
    showArchives: false,
    showBackButton: true,
    editPost: {
      enabled: false,
    },
    search: "pagefind",
    toc: true,
  },
  socials: [
    { name: "github", url: "https://github.com/jahanarun" },
    { name: "linkedin", url: "https://www.linkedin.com/in/jahanarun" },
  ],
  shareLinks: [],
});

export const SITE_FEATURES = {
  analytics: true,
  articleLicense: "Licensed under CC BY-NC-SA 4.0",
  comments: {
    enabled: true,
    repo: "dexome/blog",
    repoId: "R_kgDOGoNOmQ",
    category: "Announcements",
    categoryId: "DIC_kwDOGoNOmc4DLkhR",
    lightTheme: "light",
    darkTheme: "dark_dimmed",
  },
};
