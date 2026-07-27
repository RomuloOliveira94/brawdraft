/**
 * Derives "global" counters for a brawler whose raw source only gives
 * per-map counter data, no explicit header list (data/raw/meta-extra.txt's
 * 8 headerless blocks — see scripts/parse-meta-extra.mjs and this project's
 * build-data.mjs integration).
 *
 * Rule (a project decision, not something scraped from the source): count
 * each candidate slug's occurrences across every one of the brawler's
 * per-map counter lines, then take the top N by occurrence count. Ties are
 * broken deterministically so the result never depends on object key
 * iteration order: higher occurrence count first, then ascending slug
 * `localeCompare` for candidates tied on count.
 *
 * @param {string[][]} mapLineSlugLists one array of counter slugs per per-map line
 * @param {number} [topN]
 * @returns {{
 *   counters: { slug: string, rank: number }[],
 *   frequencies: Record<string, number>,
 * }}
 */
export function deriveTopCounters(mapLineSlugLists, topN = 3) {
  const frequencies = {};
  for (const list of mapLineSlugLists) {
    for (const slug of list) {
      frequencies[slug] = (frequencies[slug] ?? 0) + 1;
    }
  }

  const ranked = Object.entries(frequencies).sort(([slugA, countA], [slugB, countB]) => {
    if (countB !== countA) return countB - countA; // higher occurrence count first
    return slugA.localeCompare(slugB); // deterministic tie-break
  });

  const counters = ranked.slice(0, topN).map(([slug], idx) => ({ slug, rank: idx + 1 }));
  return { counters, frequencies };
}
