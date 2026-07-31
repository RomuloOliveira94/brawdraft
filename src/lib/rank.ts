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
  /**
   * Selected map's counters, keyed by enemy slug — same shape as `counters`
   * but scoped to one map (`map-counters.json[mapId]`). Checked per enemy
   * before falling back to the global `counters` list, so an enemy/map
   * combination the source data doesn't cover (e.g. any enemy on a map
   * absent from map-counters.json) falls back individually rather than
   * disabling map-specific counters for the whole pick list.
   */
  mapCounters?: CountersIndex | null;
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
  const { exclude = [], mapBonus = null, mapCounters = null } = opts;
  const acc = new Map<string, Pick>();

  // Defensive: callers are expected to pass unique enemies (the picker
  // enforces this), but a duplicate must never double-count a counter's
  // coverage/score. Set preserves insertion order, so unique input is
  // unaffected.
  for (const enemy of new Set(enemies)) {
    // Per-enemy fallback: use this map's counters for `enemy` if the source
    // data covers it, else fall back to the global list — never an
    // all-or-nothing switch keyed on whether the map itself has any data.
    const list = mapCounters?.[enemy] ?? counters[enemy] ?? []; // [] for the 1 brawler with no counter data (alli)
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
