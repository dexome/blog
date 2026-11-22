import rss from "@astrojs/rss";
import type { CollectionEntry } from "astro:content";
import { getSortedPosts } from "@/utils/getSortedPosts";
import { getPostUrl } from "@/utils/getPostPaths";
import config from "@/config";

export function createFeed(
  site: URL | undefined,
  posts: CollectionEntry<"posts">[],
  title = config.site.title
) {
  if (!site) throw new Error("RSS requires a configured site URL.");

  return rss({
    title,
    description: config.site.description,
    site,
    items: getSortedPosts(posts).map(({ data, id, filePath }) => ({
      link: getPostUrl(id, filePath, config.site.lang),
      title: data.title,
      description: data.description,
      pubDate: new Date(data.pubDatetime),
    })),
  });
}
