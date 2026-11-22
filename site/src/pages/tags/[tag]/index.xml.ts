import type { APIContext } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { createFeed } from "@/utils/createFeed";
import { getUniqueTags } from "@/utils/getUniqueTags";
import { slugifyAll } from "@/utils/slugify";
import config from "@/config";

type Props = { tagName: string; posts: CollectionEntry<"posts">[] };

// Keeps the per-tag feeds that the Hugo site published and advertised.
export async function getStaticPaths() {
  const posts = await getCollection("posts");
  return getUniqueTags(posts).map(({ tag, tagName }) => ({
    params: { tag },
    props: {
      tagName,
      posts: posts.filter(({ data }) => slugifyAll(data.tags).includes(tag)),
    },
  }));
}

export function GET({ site, props }: APIContext<Props>) {
  return createFeed(
    site,
    props.posts,
    `${props.tagName} on ${config.site.title}`
  );
}
