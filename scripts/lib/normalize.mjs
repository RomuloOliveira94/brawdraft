import { MANUAL_ALIASES, DROP_TOKENS } from './aliases.mjs';

export const stripAccents = (s) => s.normalize('NFD').replace(/\p{Mn}/gu, '');

export const slugify = (name) =>
  stripAccents(name).toLowerCase().replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const normKey = (s) => stripAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Sentinel returned by the resolver for tokens that are known junk / non-brawler
 * classes rather than unresolved errors. Never treat this as a slug. */
export const DROP = Symbol('drop');

/**
 * Builds a name -> slug resolver from the fetched brawler roster.
 *
 * `resolve(rawToken, context)` returns an array of results, each either a
 * brawler slug (string) or the `DROP` sentinel. It is an array because the
 * whitespace-split fallback (step 5) can rescue a single raw token that
 * actually glues two brawler names together (missing comma) into two slugs.
 *
 * `context` is only used to build a helpful error message and should
 * describe where the token came from, e.g. `{ source: 'meta.txt', key: 'Damian' }`.
 */
export function makeResolver(brawlers) {
  const BY_NORM = new Map();
  for (const b of brawlers) {
    BY_NORM.set(normKey(b.name), b.id);
  }

  // Tracks which MANUAL_ALIASES keys actually fired during parsing, so
  // build-data.mjs can flag any that went unused in _report.json.
  const usedAliasKeys = new Set();

  // Steps 2-4 only: resolve a single already-cleaned token to one atom.
  // Returns a slug string, DROP, or undefined (unresolved).
  function resolveAtom(cleaned) {
    const key = normKey(cleaned);
    if (DROP_TOKENS.has(key)) return DROP;
    if (BY_NORM.has(key)) return BY_NORM.get(key);
    if (Object.prototype.hasOwnProperty.call(MANUAL_ALIASES, key)) {
      usedAliasKeys.add(key);
      return MANUAL_ALIASES[key];
    }
    return undefined;
  }

  function resolve(rawToken, context = {}) {
    const cleaned = String(rawToken).trim().replace(/^[.,\s]+|[.,\s]+$/g, '');

    const single = resolveAtom(cleaned);
    if (single !== undefined) return [single];

    // Fallback: whitespace-split rescue (e.g. "Damian lou" missing a comma).
    const pieces = cleaned.split(/\s+/).filter(Boolean);
    if (pieces.length > 1) {
      const resolved = pieces.map(resolveAtom);
      if (resolved.every((r) => r !== undefined)) return resolved;
    }

    const { source = '<unknown>', key = '<unknown>' } = context;
    throw new Error(
      `Unresolved brawler token "${rawToken}" (source: ${source}, key: ${key})`,
    );
  }

  resolve.usedAliasKeys = usedAliasKeys;
  return resolve;
}
