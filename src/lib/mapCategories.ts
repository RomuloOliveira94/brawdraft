// Canonical display order for a map's pick categories ("1ª Escolha", "Anti-tank",
// ...). Mirrors scripts/lib/aliases.mjs's CATEGORY_ORDER, which already sorts
// src/data/maps.json at build time — but that module lives under scripts/
// (a build-time-only tree) and must never be imported from src/, so the
// order is duplicated here for anything under src/ that displays categories.
// Keep the two lists in sync if the source data ever grows new category keys.
export const CATEGORY_ORDER = [
  '1escolha', '6escolha',
  'antitank', 'zonetime', 'pressao', 'bralwersdepressao',
  'atiradores', 'agressivos',
  'flex', 'flexatiradores', 'flexcontrole',
  'suportedano', 'longoalcancesuporte', 'carregadoresdasgemas',
  'mid', 'defensor', 'safedano',
  'defensivozone', 'offensivozone', 'ambasaszonas',
  'finaldojogo',
  'outros', 'outrospicks',
];

export interface MapCategory {
  key: string;
  label: string;
  brawlers: string[];
}

/**
 * Returns a new array of categories sorted per CATEGORY_ORDER. Unknown keys
 * sort last (stable relative to each other), same fallback build-data.mjs
 * uses for its own sort.
 */
export function sortCategories<T extends MapCategory>(categories: T[]): T[] {
  const orderIndex = new Map(CATEGORY_ORDER.map((key, i) => [key, i]));
  return [...categories].sort(
    (a, b) => (orderIndex.get(a.key) ?? 999) - (orderIndex.get(b.key) ?? 999),
  );
}
