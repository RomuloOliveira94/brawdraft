import { DROP } from './lib/normalize.mjs';

const SOURCE = 'meta-extra.txt';

// Header line unique to Mina (the only one of the 9 new blocks that carries
// an explicit global-counter list): "MINA > Lumi, Frank ou Charlie" — a
// bare name, ">" separator, plain comma/"ou" value list. No "Counterad...
// por:" phrase and no trailing period, unlike meta.txt's "➔ Counterado
// por:" header (see parse-meta.mjs's HEADER_RE) — a different enough shape
// that reusing that regex would just be a coincidence, not a contract.
const HEADER_RE = /^(.*?)\s*>\s*(.*)$/;

// Per-map line: "<Map Name>: A, B, C" — colon only. meta-extra.txt never
// uses meta.txt's "➔" separator, so no alternation needed here.
const MAP_LINE_RE = /^(.*?)\s*:\s*(.*)$/;

const TRAILING_PERIOD_RE = /\.\s*$/;
const VALUE_SPLIT_RE = /,\s*|\s+ou\s+/;

// The 8 other new blocks have no header at all — just a bare brawler-name
// line, and every map name label is 25/26 (Kaboom Canyon is absent here
// too, same accepted gap as meta.txt). Two blocks (Doug, Gene) are
// truncated source-side at 22 lines; any other count is a parsing bug.
const EXPECTED_MAP_LINE_COUNTS = new Set([22, 25]);

/**
 * Resolves a comma/"ou"-delimited value list (a header's counter list, or a
 * per-map line's counter list) to slugs, logging DROP tokens and
 * duplicate-within-the-same-list repeats exactly like parse-meta.mjs does
 * for meta.txt, instead of silently swallowing or throwing on either.
 */
function resolveValueList(rawValue, splitRe, resolve, context, dropped, aliasHits) {
  const parts = rawValue.trim().replace(TRAILING_PERIOD_RE, '').split(splitRe).map((p) => p.trim()).filter(Boolean);
  const slugs = [];
  const seen = new Set();
  for (const part of parts) {
    const resolved = resolve(part, context);
    for (const atom of resolved) {
      if (atom === DROP) {
        dropped.values.push({ raw: part, from: context.key, reason: 'dropped' });
        continue;
      }
      if (seen.has(atom)) {
        dropped.values.push({ raw: part, from: context.key, reason: 'duplicate-in-source' });
        continue;
      }
      seen.add(atom);
      aliasHits.push({ slug: atom, raw: part });
      slugs.push(atom);
    }
  }
  return slugs;
}

/**
 * Parses data/raw/meta-extra.txt: 9 brawler blocks contributed after
 * meta.txt's original 93, in a structurally different shape that doesn't
 * fit parse-meta.mjs's fixed "header + marker + exactly 25 map lines"
 * grammar:
 *  - Only Mina carries an explicit header (">"-separated, see HEADER_RE).
 *  - The other 8 blocks are headerless: a bare brawler-name line (no ":",
 *    no ">") is immediately followed by that brawler's per-map lines, with
 *    no "Melhores Counter por mapa" marker anywhere. This parser only
 *    extracts their raw per-map counters — it does NOT derive global
 *    counters for them; build-data.mjs does that (see
 *    scripts/lib/deriveCounters.mjs) so the frequency-derivation decision
 *    stays a build-time, reportable step rather than baked into parsing.
 *  - Doug and Gene are truncated source-side at 22 of 25 map lines each;
 *    this parser accepts 22 or 25 and lets build-data.mjs record the gap.
 *
 * A sibling parser (rather than teaching parse-meta.mjs a second grammar)
 * on purpose: meta.txt's parser has zero header/marker variance across its
 * 93 blocks today, and threading "maybe no header, maybe no marker, maybe
 * '>' instead of the phrase-based header" through its control flow would
 * add branching to a file with no test coverage gap to justify it. Both
 * parsers take the same `resolve` callback and return the same
 * `{ ..., aliasHits, dropped }` shape, so build-data.mjs merges their
 * output without either one knowing the other exists.
 *
 * Block boundaries are detected structurally, not by counting to N: a line
 * is a per-map line iff it contains ":", a header line iff it contains ">"
 * (only Mina's), and any other non-blank line is a new block's bare-name
 * delimiter. This holds because meta-extra.txt's 25 canonical map labels
 * never contain ">", and always use ":" before their value list.
 *
 * @param {string} rawText
 * @param {(token: string, context?: {source: string, key: string}) => (string | typeof DROP)[]} resolve
 */
export function parseMetaExtra(rawText, resolve) {
  const lines = rawText.split(/\r\n|\r|\n/);
  const aliasHits = [];
  const dropped = { keys: [], values: [] };
  const blocks = [];

  let current = null; // { rawName, explicitHeaderValue: string | null, mapLines: {rawMapName, rawValue}[] }

  function finalizeCurrentBlock() {
    if (!current) return;
    const { rawName, explicitHeaderValue, mapLines } = current;

    if (!EXPECTED_MAP_LINE_COUNTS.has(mapLines.length)) {
      throw new Error(
        `${SOURCE}: "${rawName}"'s block has ${mapLines.length} map lines (expected 22 or 25)`,
      );
    }

    const keyResolved = resolve(rawName, { source: SOURCE, key: rawName });
    if (keyResolved.length !== 1 || keyResolved[0] === DROP) {
      throw new Error(`${SOURCE}: block name "${rawName}" must resolve to exactly one known brawler`);
    }
    const [enemySlug] = keyResolved;
    aliasHits.push({ slug: enemySlug, raw: rawName });

    let explicitCounters = null;
    if (explicitHeaderValue !== null) {
      const slugs = resolveValueList(
        explicitHeaderValue,
        VALUE_SPLIT_RE,
        resolve,
        { source: SOURCE, key: `header:${rawName}` },
        dropped,
        aliasHits,
      );
      explicitCounters = slugs.map((slug, idx) => ({ slug, rank: idx + 1 }));
    }

    const mapCounters = {};
    for (const { rawMapName, rawValue } of mapLines) {
      mapCounters[rawMapName] = resolveValueList(
        rawValue,
        /,\s*/,
        resolve,
        { source: SOURCE, key: `${rawName} / ${rawMapName}` },
        dropped,
        aliasHits,
      ).map((slug) => ({ slug }));
    }

    blocks.push({ slug: enemySlug, rawName, explicitCounters, mapCounters, mapLineCount: mapLines.length });
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    if (trimmed.includes('>')) {
      finalizeCurrentBlock();
      const m = HEADER_RE.exec(trimmed);
      if (!m) throw new Error(`${SOURCE}: could not parse header line "${trimmed}"`);
      current = { rawName: m[1].trim(), explicitHeaderValue: m[2], mapLines: [] };
      continue;
    }

    if (trimmed.includes(':')) {
      if (!current) {
        throw new Error(`${SOURCE}: per-map line "${trimmed}" appears before any block started`);
      }
      const m = MAP_LINE_RE.exec(trimmed);
      if (!m) throw new Error(`${SOURCE}: could not parse per-map line "${trimmed}"`);
      current.mapLines.push({ rawMapName: m[1].trim(), rawValue: m[2] });
      continue;
    }

    // Bare brawler-name line, no ":" and no ">": starts a new headerless block.
    finalizeCurrentBlock();
    current = { rawName: trimmed, explicitHeaderValue: null, mapLines: [] };
  }
  finalizeCurrentBlock();

  return { blocks, aliasHits, dropped };
}
