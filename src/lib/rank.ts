// Pure, dependency-free ranking logic. Kept erasable-syntax-only (no enum,
// namespace, or parameter properties) so scripts/build-data.mjs and friends
// can `await import('./src/lib/rank.ts')` directly under Node's native
// TypeScript type-stripping, with no build step involved.

/** slug -> ordered list of counter slugs (strongest counter first). */
export type CountersIndex = Record<string, string[]>;

/** slug -> bonus flag/weight for a specific map (any truthy value counts). */
export type MapBonus = Record<string, unknown>;

export interface Pick {
  slug: string;
  coverage: number;
  score: number;
  against: string[];
}

export interface RankPicksOptions {
  /** Slugs to never suggest (e.g. brawlers already picked by either team). */
  exclude?: string[];
  /** slug -> truthy value grants +1 score for that pick on the current map. */
  mapBonus?: MapBonus | null;
}

/**
 * Ranks candidate picks against a list of enemy brawlers.
 *
 * Sort rationale: coverage first (answering all enemies beats hard-countering
 * just one), positional score second (source lists are ordered
 * strongest-first), slug last for determinism.
 */
export function rankPicks(
  enemies: string[],
  counters: CountersIndex,
  opts: RankPicksOptions = {},
): Pick[] {
  const { exclude = [], mapBonus = null } = opts;
  const acc = new Map<string, Pick>();

  for (const enemy of enemies) {
    const list = counters[enemy] ?? []; // [] for the 14 brawlers with no counter data
    for (let i = 0; i < list.length; i++) {
      const slug = list[i];
      if (enemies.includes(slug) || exclude.includes(slug)) continue;
      const weight = 3 - i; // rank 1 -> 3, rank 2 -> 2, rank 3 -> 1
      const p = acc.get(slug) ?? { slug, coverage: 0, score: 0, against: [] };
      p.coverage++;
      p.score += weight;
      p.against.push(enemy);
      acc.set(slug, p);
    }
  }

  if (mapBonus) {
    for (const p of acc.values()) {
      if (mapBonus[p.slug]) p.score += 1;
    }
  }

  return [...acc.values()].sort(
    (a, b) => b.coverage - a.coverage || b.score - a.score || a.slug.localeCompare(b.slug),
  );
}
