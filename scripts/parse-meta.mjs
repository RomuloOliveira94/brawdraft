import { DROP } from './lib/normalize.mjs';

const SOURCE = 'meta.txt';
const MAPS_PER_BLOCK = 25;

// Header line: "<Name> ➔ Counterad[oa] por: A, B ou C." — always the arrow,
// never ":" (verified across all 93 blocks).
const HEADER_RE = /^(.*?)\s*➔\s*Counterad\w+\s+por\s*:\s*(.*)$/;
const MARKER_RE = /Melhores Counter por mapa/;

// Per-map line: "<Map Name><sep> A, B, C" where <sep> is "➔" (8-Bit only) or
// ":" (every other block) — accept both structurally so the malformed 8-Bit
// block parses without hand-editing the source. The lazy `.*?` finds
// whichever separator appears first; map names never contain either
// character.
const MAP_LINE_RE = /^(.*?)\s*(?:➔|:)\s*(.*)$/;

const TRAILING_PERIOD_RE = /\.\s*$/;
const VALUE_SPLIT_RE = /,\s*|\s+ou\s+/;
const PARENTHETICAL_RE = /^(.*?)\s*\(([^)]*)\)\s*$/;

// One corrupted line in the whole file (Squeak/Out in the Open):
// "Nani, Piper, Angelo [, 2]" — strip the bracketed junk before splitting.
const BRACKET_JUNK_RE = /\s*\[[^\]]*\]/g;

/**
 * Parses the per-brawler-per-map export into two pieces:
 *  - `headerCounters`: the 93 "Counterado por: A, B ou C" lines (same shape
 *    as parse-counters.mjs's output) — these replace the global counters.
 *  - `mapCounters`: 93 × 25 per-map ranked-counter lines, keyed by the raw
 *    map name text as it appears in the source (build-data.mjs resolves
 *    those names to canonical map ids, same way it already joins parsed map
 *    names against BrawlAPI metadata).
 *
 * @param {string} rawText
 * @param {(token: string, context?: {source: string, key: string}) => (string | typeof DROP)[]} resolve
 */
export function parseMeta(rawText, resolve) {
  const lines = rawText.split(/\r\n|\r|\n/);
  const aliasHits = [];
  const dropped = { keys: [], values: [] };
  const headerCounters = []; // { slug, counters: [{slug, rank}] }
  const mapCounters = {}; // rawMapName -> { enemySlug: [{slug, note?}] }

  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++;
      continue;
    }

    const headerMatch = HEADER_RE.exec(lines[i].trim());
    if (!headerMatch) {
      throw new Error(`${SOURCE}:${i + 1}: expected a header line ("<Name> ➔ Counterad... por: ..."), got "${lines[i]}"`);
    }
    const [, rawName, rawValue] = headerMatch;
    i++;

    if (!MARKER_RE.test(lines[i] ?? '')) {
      throw new Error(`${SOURCE}:${i + 1}: expected the "Melhores Counter por mapa" marker after header "${rawName}"`);
    }
    i++;

    // --- Header key ---
    const keyResolved = resolve(rawName.trim(), { source: SOURCE, key: rawName });
    if (keyResolved.length !== 1 || keyResolved[0] === DROP) {
      throw new Error(`${SOURCE}: header key "${rawName}" must resolve to exactly one known brawler`);
    }
    const [enemySlug] = keyResolved;
    aliasHits.push({ slug: enemySlug, raw: rawName.trim() });

    // --- Header counters (replace the global counters index) ---
    const bodyText = rawValue.trim().replace(TRAILING_PERIOD_RE, '');
    const headerParts = bodyText.split(VALUE_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
    const headerSlugs = [];
    const headerSeen = new Set();
    for (const part of headerParts) {
      const resolved = resolve(part, { source: SOURCE, key: rawName });
      for (const atom of resolved) {
        if (atom === DROP) {
          dropped.values.push({ raw: part, from: `header:${rawName}`, reason: 'dropped' });
          continue;
        }
        // A handful of source lines repeat the same brawler within one list
        // (e.g. header "Max ➔ ... Crow, Spike ou Crow.") — a genuine data
        // error, not a token to reject outright. Keep the first occurrence
        // and log the repeat instead of throwing (mirrors how DROP tokens
        // are logged, not silently swallowed).
        if (headerSeen.has(atom)) {
          dropped.values.push({ raw: part, from: `header:${rawName}`, reason: 'duplicate-in-source' });
          continue;
        }
        headerSeen.add(atom);
        aliasHits.push({ slug: atom, raw: part });
        headerSlugs.push(atom);
      }
    }
    headerCounters.push({
      slug: enemySlug,
      counters: headerSlugs.map((slug, idx) => ({ slug, rank: idx + 1 })),
    });

    // --- 25 per-map lines ---
    let mapLinesRead = 0;
    while (mapLinesRead < MAPS_PER_BLOCK) {
      if (i >= lines.length) {
        throw new Error(
          `${SOURCE}: unexpected end of file inside "${rawName}"'s block (only ${mapLinesRead}/${MAPS_PER_BLOCK} map lines read)`,
        );
      }
      const mapLineRaw = lines[i];
      i++;
      if (mapLineRaw.trim() === '') continue;

      const mapMatch = MAP_LINE_RE.exec(mapLineRaw.trim());
      if (!mapMatch) {
        throw new Error(`${SOURCE}: could not parse per-map line "${mapLineRaw}" in "${rawName}"'s block`);
      }
      const rawMapName = mapMatch[1].trim();
      const cleanedValue = mapMatch[2].replace(BRACKET_JUNK_RE, '');
      const valueParts = cleanedValue.split(',').map((p) => p.trim()).filter(Boolean);

      const counters = [];
      const mapLineSeen = new Set();
      for (const part of valueParts) {
        const parenMatch = PARENTHETICAL_RE.exec(part);
        const token = parenMatch ? parenMatch[1].trim() : part;
        const note = parenMatch ? parenMatch[2].trim() : undefined;

        const resolved = resolve(token, { source: SOURCE, key: `${rawName} / ${rawMapName}` });
        for (const atom of resolved) {
          if (atom === DROP) {
            dropped.values.push({ raw: token, from: `${rawName} / ${rawMapName}`, reason: 'dropped' });
            continue;
          }
          // Same source-data repeat issue as the header lists above (e.g.
          // "Deathcap Trap: Rico, Spike, Spike" for a few brawlers) — keep
          // the first occurrence, log the repeat.
          if (mapLineSeen.has(atom)) {
            dropped.values.push({ raw: token, from: `${rawName} / ${rawMapName}`, reason: 'duplicate-in-source' });
            continue;
          }
          mapLineSeen.add(atom);
          aliasHits.push({ slug: atom, raw: token });
          counters.push(note ? { slug: atom, note } : { slug: atom });
        }
      }

      (mapCounters[rawMapName] ??= {})[enemySlug] = counters;
      mapLinesRead++;
    }
  }

  return { headerCounters, mapCounters, aliasHits, dropped };
}
