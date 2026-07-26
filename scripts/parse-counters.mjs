import { DROP, normKey } from './lib/normalize.mjs';
import { SECTION_HEADERS } from './lib/aliases.mjs';

const SOURCE = 'counters.txt';

// Only used for _report.json annotations — resolution itself is driven by
// DROP_TOKENS in aliases.mjs; this just explains *why* each one is dropped.
const DROP_REASONS = {
  watts: 'not-in-roster',
  lancadores: 'class-not-brawler',
  lol: 'junk-token',
};

const VALUE_PREFIX_RE = /^Counterad\w+\s+por\s*:\s*/;
const PARENTHETICAL_RE = /^(.*?)\s*\(([^)]*)\)\s*$/;
const KEY_PARENTHETICAL_RE = /\s*\(([^)]*)\)/;
const NEXT_KEY_BOUNDARY_RE = /\.(?=\S)/;

function stripSectionHeader(text) {
  for (const header of SECTION_HEADERS) {
    if (text.startsWith(header)) return text.slice(header.length);
  }
  return text;
}

/**
 * Parses the single-line counters.txt export into per-brawler counter lists.
 *
 * @param {string} rawText
 * @param {(token: string, context?: {source: string, key: string}) => (string | typeof DROP)[]} resolve
 */
export function parseCounters(rawText, resolve) {
  const segments = rawText.split('➔');

  // Step 1/2/3: walk the segments, splitting each "value+nextKey" blob at the
  // first period that is NOT followed by whitespace, and stripping a leading
  // section-header banner off the recovered next key.
  const rawEntries = []; // { rawKey, rawValueText }
  let pendingKey = segments[0].trim();
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (i < segments.length - 1) {
      const m = NEXT_KEY_BOUNDARY_RE.exec(seg);
      if (!m) {
        throw new Error(
          `${SOURCE}: could not find key/value boundary after key "${pendingKey}" in segment "${seg}"`,
        );
      }
      const valueText = seg.slice(0, m.index + 1);
      const nextKeyRaw = stripSectionHeader(seg.slice(m.index + 1)).trim();
      rawEntries.push({ rawKey: pendingKey, rawValueText: valueText });
      pendingKey = nextKeyRaw;
    } else {
      rawEntries.push({ rawKey: pendingKey, rawValueText: seg });
    }
  }

  const entries = [];
  const aliasHits = [];
  const dropped = { keys: [], values: [] };

  for (const { rawKey, rawValueText } of rawEntries) {
    // Step 4: key parenthetical -> base name (resolved) + alias text.
    const keyParenMatch = KEY_PARENTHETICAL_RE.exec(rawKey);
    const keyBase = rawKey.replace(KEY_PARENTHETICAL_RE, '').trim();
    const keyParenText = keyParenMatch ? keyParenMatch[1].trim() : null;

    const keyResolved = resolve(keyBase, { source: SOURCE, key: rawKey });
    if (keyResolved.length !== 1) {
      throw new Error(`${SOURCE}: key "${rawKey}" unexpectedly resolved to multiple brawlers`);
    }
    const [keyAtom] = keyResolved;
    if (keyAtom === DROP) {
      dropped.keys.push({ raw: keyBase, reason: DROP_REASONS[normKey(keyBase)] ?? 'dropped' });
      continue;
    }
    const slug = keyAtom;
    if (keyParenText) aliasHits.push({ slug, raw: keyParenText });
    aliasHits.push({ slug, raw: keyBase });

    // Step 5: value text -> prefix/period stripped, then split into raw parts.
    const prefixStripped = rawValueText.trim().replace(VALUE_PREFIX_RE, '');
    const withoutTrailingPeriod = prefixStripped.replace(/\.\s*$/, '');
    const rawParts = withoutTrailingPeriod.split(/,\s*|\s+ou\s+/).filter(Boolean);

    const counters = [];
    for (const part of rawParts) {
      const parenMatch = PARENTHETICAL_RE.exec(part);
      const token = parenMatch ? parenMatch[1].trim() : part.trim();
      const note = parenMatch ? parenMatch[2].trim() : undefined;

      const resolved = resolve(token, { source: SOURCE, key: rawKey });
      for (const atom of resolved) {
        if (atom === DROP) {
          dropped.values.push({
            raw: token,
            from: rawKey,
            reason: DROP_REASONS[normKey(token)] ?? 'dropped',
          });
          continue;
        }
        aliasHits.push({ slug: atom, raw: token });
        counters.push({ slug: atom, note });
      }
    }

    // Re-rank sequentially after any drops (no special-casing short lists).
    const ranked = counters.map((c, i) => ({
      slug: c.slug,
      rank: i + 1,
      ...(c.note ? { note: c.note } : {}),
    }));

    entries.push({ slug, counters: ranked });
  }

  return { entries, aliasHits, dropped };
}
