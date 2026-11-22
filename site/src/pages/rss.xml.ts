import type { APIContext } from "astro";
import { getCollection } from "astro:content";
import { createFeed } from "@/utils/createFeed";

export async function GET({ site }: APIContext) {
  return createFeed(site, await getCollection("posts"));
}
