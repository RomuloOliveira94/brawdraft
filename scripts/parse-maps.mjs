import { DROP, normKey } from './lib/normalize.mjs';
import { CATEGORY_LABELS, ORPHAN_CATEGORY_FIXES, CATEGORY_ORDER } from './lib/aliases.mjs';
import { slugify } from './lib/normalize.mjs';

const SOURCE = 'maps.txt';

const DROP_REASONS = {
  lol: 'junk-token',
};

// Only the 26 map-title lines contain parentheses; every heading and every
// brawler list line in this file is parenthesis-free.
const TITLE_RE = /^(.*?)\s*\((.*)\)\s*$/;

function categoryLabelFor(headingText, lineNo) {
  const key = normKey(headingText);
  const label = CATEGORY_LABELS[key];
  if (!label) {
    throw new Error(
      `${SOURCE}:${lineNo}: heading "${headingText}" (normKey "${key}") has no entry in CATEGORY_LABELS`,
    );
  }
  return { key, label };
}

function dedupePush(arr, slugs) {
  const seen = new Set(arr);
  for (const slug of slugs) {
    if (!seen.has(slug)) {
      seen.add(slug);
      arr.push(slug);
    }
  }
}

/**
 * Parses the 26-map raw export into per-map categories + tips.
 *
 * @param {string} rawText
 * @param {(token: string, context?: {source: string, key: string}) => (string | typeof DROP)[]} resolve
 */
export function parseMaps(rawText, resolve) {
  const lines = rawText.split(/\r?\n/);
  const aliasHits = [];
  const dropped = { values: [] };

  function classify(trimmed, lineNo) {
    const toks = trimmed.split(',').map((t) => t.trim()).filter(Boolean);
    let resolvedCount = 0;
    for (const tok of toks) {
      try {
        resolve(tok, { source: SOURCE, key: `line ${lineNo}` });
        resolvedCount++;
      } catch {
        // not resolvable -> doesn't count toward the ratio
      }
    }
    const ratio = toks.length ? resolvedCount / toks.length : 0;
    if (ratio >= 0.5) return 'LIST';
    if (TITLE_RE.test(trimmed)) return 'TITLE';
    return 'HEADING';
  }

  function resolveListLine(trimmed, lineNo) {
    const toks = trimmed.split(',').map((t) => t.trim()).filter(Boolean);
    const slugs = [];
    for (const tok of toks) {
      const resolved = resolve(tok, { source: SOURCE, key: `line ${lineNo}` });
      for (const atom of resolved) {
        if (atom === DROP) {
          dropped.values.push({ raw: tok, from: `${SOURCE}:${lineNo}`, reason: DROP_REASONS[normKey(tok)] ?? 'dropped' });
          continue;
        }
        aliasHits.push({ slug: atom, raw: tok });
        slugs.push(atom);
      }
    }
    return slugs;
  }

  const maps = [];
  let currentMap = null;
  let pendingHeading = null; // string or null
  let prevLineType = null; // 'TITLE' | 'HEADING' | 'LIST' | null
  let prevCategory = null; // category object the last LIST line appended to

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const trimmed = lines[i].trim();
    if (!trimmed) {
      prevLineType = 'BLANK';
      continue;
    }

    const type = classify(trimmed, lineNo);

    if (type === 'TITLE') {
      if (pendingHeading && currentMap) currentMap.tips.push(pendingHeading);
      pendingHeading = null;

      const m = TITLE_RE.exec(trimmed);
      const name = m[1].trim();
      const namePt = m[2].trim();
      currentMap = { id: slugify(name), name, namePt, tips: [], categories: [] };
      maps.push(currentMap);
      prevCategory = null;
      prevLineType = 'TITLE';
      continue;
    }

    if (type === 'HEADING') {
      if (pendingHeading && currentMap) currentMap.tips.push(pendingHeading);
      pendingHeading = trimmed;
      prevLineType = 'HEADING';
      continue;
    }

    // type === 'LIST'
    if (!currentMap) {
      throw new Error(`${SOURCE}:${lineNo}: brawler list appears before any map title`);
    }
    const slugs = resolveListLine(trimmed, lineNo);

    if (prevLineType === 'LIST' && prevCategory) {
      // Continuation: same category, no heading in between, no blank line.
      dedupePush(prevCategory.brawlers, slugs);
    } else if (pendingHeading) {
      const { key, label } = categoryLabelFor(pendingHeading, lineNo);
      const category = { key, label, brawlers: [] };
      dedupePush(category.brawlers, slugs);
      currentMap.categories.push(category);
      prevCategory = category;
      pendingHeading = null;
    } else {
      // Orphan: a brawler list with no heading directly above it (blank-line
      // separated from whatever came before). Only recoverable via
      // ORPHAN_CATEGORY_FIXES; anything else is a data error.
      const fixHeading = ORPHAN_CATEGORY_FIXES[currentMap.id];
      if (!fixHeading) {
        throw new Error(
          `${SOURCE}:${lineNo}: orphan brawler list in map "${currentMap.name}" with no preceding heading, and no ORPHAN_CATEGORY_FIXES entry for "${currentMap.id}"`,
        );
      }
      const { key, label } = categoryLabelFor(fixHeading, lineNo);
      const category = { key, label, brawlers: [] };
      dedupePush(category.brawlers, slugs);
      currentMap.categories.push(category);
      prevCategory = category;
    }
    prevLineType = 'LIST';
  }

  // A trailing heading at EOF with no list ever following it is also a tip.
  if (pendingHeading && currentMap) currentMap.tips.push(pendingHeading);

  // Stable, human-friendly ordering for display purposes.
  const orderIndex = new Map(CATEGORY_ORDER.map((k, i) => [k, i]));
  for (const map of maps) {
    map.categories.sort((a, b) => (orderIndex.get(a.key) ?? 999) - (orderIndex.get(b.key) ?? 999));
  }

  return { maps, aliasHits, dropped };
}
