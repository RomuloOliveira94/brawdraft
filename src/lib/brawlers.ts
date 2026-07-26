import { getCollection, type CollectionEntry } from 'astro:content';

export type Brawler = CollectionEntry<'brawlers'>;

/** Builds a slug -> Brawler lookup map from the brawlers collection. */
export async function brawlerIndex(): Promise<Map<string, Brawler>> {
  const entries = await getCollection('brawlers');
  return new Map(entries.map((entry) => [entry.id, entry]));
}

/**
 * Looks up a brawler by slug, throwing if it doesn't exist. This turns a bad
 * data reference (typo'd slug, stale counter, etc.) into a build failure
 * instead of a silently broken page.
 */
export function lookup(index: Map<string, Brawler>, slug: string): Brawler {
  const brawler = index.get(slug);
  if (!brawler) {
    throw new Error(`lookup: unknown brawler slug "${slug}"`);
  }
  return brawler;
}

/** All released brawlers (106), sorted by name. */
export async function releasedBrawlers(): Promise<Brawler[]> {
  const entries = await getCollection('brawlers');
  return entries
    .filter((entry) => entry.data.released)
    .sort((a, b) => a.data.name.localeCompare(b.data.name));
}

/** Every brawler in the roster (107), including unreleased ones. */
export async function allBrawlers(): Promise<Brawler[]> {
  return getCollection('brawlers');
}
