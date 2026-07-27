// Orchestrates the data pipeline: reads the fetched roster + raw text files,
// parses meta counters and maps, joins everything together, and writes the
// final committed JSON consumed by src/content.config.ts. Throws (non-zero
// exit) on any integrity violation instead of silently emitting bad data.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeResolver, normKey } from './lib/normalize.mjs';
import { MANUAL_ALIASES, META_TYPO_FIXES, META_MAP_OVERRIDES } from './lib/aliases.mjs';
import { deriveTopCounters } from './lib/deriveCounters.mjs';
import { parseMeta } from './parse-meta.mjs';
import { parseMetaExtra } from './parse-meta-extra.mjs';
import { parseMaps } from './parse-maps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BRAWLERS_JSON = path.join(ROOT, 'src/data/brawlers.json');
const MAP_METADATA_JSON = path.join(ROOT, 'src/data/_map-metadata.json');
const META_RAW = path.join(ROOT, 'data/raw/meta.txt');
const META_EXTRA_RAW = path.join(ROOT, 'data/raw/meta-extra.txt');
const MAPS_RAW = path.join(ROOT, 'data/raw/maps.txt');

const MAPS_JSON = path.join(ROOT, 'src/data/maps.json');
const COUNTERS_INDEX_JSON = path.join(ROOT, 'src/data/counters-index.json');
const MAP_INDEX_JSON = path.join(ROOT, 'src/data/map-index.json');
const MAP_COUNTERS_JSON = path.join(ROOT, 'src/data/map-counters.json');
const REPORT_JSON = path.join(ROOT, 'src/data/_report.json');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function main() {
  const brawlers = await readJson(BRAWLERS_JSON);
  // Floor, not an exact match: BrawlAPI's roster can only grow over time.
  // 106, not 107 — fetch-brawlers.mjs excludes buzz-lightyear (a
  // time-limited collab brawler with no data anywhere in this project) from
  // the roster entirely; see REMOVED_BRAWLERS there.
  if (brawlers.length < 106) {
    throw new Error(`integrity: expected >=106 brawlers in ${BRAWLERS_JSON}, got ${brawlers.length}`);
  }
  const brawlerById = new Map(brawlers.map((b) => [b.id, b]));
  const brawlerSlugSet = new Set(brawlers.map((b) => b.id));

  const resolve = makeResolver(brawlers);

  // meta.txt gets its own typo table (META_TYPO_FIXES), tried before falling
  // back to the shared resolver (roster names + MANUAL_ALIASES +
  // DROP_TOKENS). Kept out of MANUAL_ALIASES so e.g. "pipe" -> "piper" can
  // never leak into parse-maps.mjs's token resolution.
  const usedMetaTypoKeys = new Set();
  function resolveMeta(rawToken, context) {
    const key = normKey(String(rawToken).trim());
    if (Object.prototype.hasOwnProperty.call(META_TYPO_FIXES, key)) {
      usedMetaTypoKeys.add(key);
      return [META_TYPO_FIXES[key]];
    }
    return resolve(rawToken, context);
  }

  // --- Parse meta (header counters + per-map counters) ---
  const metaRaw = await readFile(META_RAW, 'utf8');
  const { headerCounters, mapCounters: rawMapCounters, aliasHits: metaAliasHits, dropped: metaDropped } =
    parseMeta(metaRaw, resolveMeta);
  const metaHeaderEntries = headerCounters.length; // meta.txt's own count, before meta-extra.txt merges in below

  // --- Parse meta-extra (9 later-supplied blocks; see parse-meta-extra.mjs) ---
  const metaExtraRaw = await readFile(META_EXTRA_RAW, 'utf8');
  const { blocks: metaExtraBlocks, aliasHits: metaExtraAliasHits, dropped: metaExtraDropped } =
    parseMetaExtra(metaExtraRaw, resolveMeta);

  // meta-extra.txt's 25 canonical map-line labels, in source order, taken
  // from the one block (Mina) that has all 25 — used below to name exactly
  // which maps a truncated block (Doug, Gene) is missing.
  const metaExtraFullMapOrder = Object.keys(
    metaExtraBlocks.find((b) => b.mapLineCount === 25)?.mapCounters ?? {},
  );

  // Only Mina came with an explicit global-counter header; the other 8
  // blocks are headerless in the source, so their "global" counters are
  // DERIVED here from their own per-map counter frequency (project
  // decision, not scraped data) — top 3 by occurrence count, ties broken by
  // ascending slug `localeCompare` (see deriveTopCounters). Recorded in
  // _report.json as derived, not curated, so provenance stays visible.
  const metaExtraReport = { explicit: [], derived: {}, gaps: {} };
  for (const block of metaExtraBlocks) {
    // Merge this block's per-map counters into the same rawMapCounters
    // structure meta.txt's 93 blocks populate, keyed by the same raw map
    // name strings, so the existing map-id resolution loop below (and
    // META_MAP_OVERRIDES's "Hot Zone" -> Dueling Beetles rule) applies
    // uniformly to both sources without knowing they're different files.
    for (const [rawMapName, counters] of Object.entries(block.mapCounters)) {
      (rawMapCounters[rawMapName] ??= {})[block.slug] = counters;
    }

    if (block.explicitCounters) {
      headerCounters.push({ slug: block.slug, counters: block.explicitCounters });
      metaExtraReport.explicit.push(block.slug);
    } else {
      const { counters, frequencies } = deriveTopCounters(
        Object.values(block.mapCounters).map((list) => list.map((c) => c.slug)),
      );
      headerCounters.push({ slug: block.slug, counters });
      metaExtraReport.derived[block.slug] = {
        top3: counters.map((c) => c.slug),
        frequencies,
        mapLineCount: block.mapLineCount,
      };
    }

    if (block.mapLineCount < 25) {
      const missingMaps = metaExtraFullMapOrder.filter((name) => !(name in block.mapCounters));
      metaExtraReport.gaps[block.slug] = { mapLineCount: block.mapLineCount, missingMaps };
    }
  }

  // --- Parse maps ---
  const mapsRaw = await readFile(MAPS_RAW, 'utf8');
  const { maps: parsedMaps, aliasHits: mapAliasHits, dropped: mapDropped } =
    parseMaps(mapsRaw, resolve);

  const mapMetadata = await readJson(MAP_METADATA_JSON);

  // --- Join parsed maps to their BrawlAPI metadata ---
  const enrichedMaps = parsedMaps.map((m) => {
    const meta = mapMetadata[normKey(m.name)];
    if (!meta || !meta.image) {
      throw new Error(`integrity: map "${m.name}" is missing BrawlAPI metadata or a local image`);
    }
    return {
      id: m.id,
      name: m.name,
      namePt: m.namePt,
      mapApiId: meta.mapApiId,
      image: meta.image,
      environment: meta.environment,
      link: meta.link,
      gameMode: meta.gameMode,
      tips: m.tips,
      categories: m.categories,
    };
  });
  if (enrichedMaps.length !== 26) {
    throw new Error(`integrity: expected 26 maps, parsed ${enrichedMaps.length}`);
  }

  // --- Join meta.txt's raw per-map names to canonical map ids ---
  // meta.txt's 25 map-line labels are the same 26 canonical maps minus
  // Kaboom Canyon (absent from the source, accepted as a gap — see
  // META_MAP_OVERRIDES) minus "Hot Zone", which is a *game-mode* name, not a
  // map; META_MAP_OVERRIDES maps it to Dueling Beetles (see aliases.mjs).
  function resolveMapId(rawMapName) {
    const overridden = META_MAP_OVERRIDES[normKey(rawMapName)];
    const lookupKey = normKey(overridden ?? rawMapName);
    const map = enrichedMaps.find((m) => normKey(m.name) === lookupKey);
    if (!map) {
      throw new Error(`meta.txt: map name "${rawMapName}" does not match any known map`);
    }
    return map.id;
  }

  const mapCounters = {}; // { mapId: { enemySlug: [counterSlug, ...] } }
  let mapCountersEntryCount = 0;
  for (const [rawMapName, perEnemy] of Object.entries(rawMapCounters)) {
    const mapId = resolveMapId(rawMapName);
    const bucket = (mapCounters[mapId] ??= {});
    for (const [enemySlug, counters] of Object.entries(perEnemy)) {
      bucket[enemySlug] = counters.map((c) => c.slug);
      mapCountersEntryCount++;
    }
  }

  const counterEntries = headerCounters; // { slug, counters: [{slug, rank}] }[]

  // --- INTEGRITY GATE: counters ---
  for (const entry of counterEntries) {
    if (!brawlerSlugSet.has(entry.slug)) {
      throw new Error(`integrity: counters key "${entry.slug}" is not a known brawler slug`);
    }
    if (entry.counters.length === 0 || entry.counters.length > 3) {
      throw new Error(
        `integrity: "${entry.slug}" has ${entry.counters.length} counters (must be 1-3)`,
      );
    }
    const seen = new Set();
    for (const c of entry.counters) {
      if (seen.has(c.slug)) {
        throw new Error(`integrity: duplicate counter slug "${c.slug}" in "${entry.slug}"'s counter list`);
      }
      seen.add(c.slug);
      if (!brawlerSlugSet.has(c.slug)) {
        throw new Error(`integrity: counter slug "${c.slug}" (for "${entry.slug}") is not a known brawler slug`);
      }
    }
  }

  // --- INTEGRITY GATE: maps ---
  for (const map of enrichedMaps) {
    for (const cat of map.categories) {
      for (const slug of cat.brawlers) {
        if (!brawlerSlugSet.has(slug)) {
          throw new Error(`integrity: map "${map.id}" category "${cat.key}" references unknown brawler slug "${slug}"`);
        }
      }
    }
  }

  // --- INTEGRITY GATE: map-counters ---
  const canonicalMapIds = new Set(enrichedMaps.map((m) => m.id));
  for (const [mapId, perEnemy] of Object.entries(mapCounters)) {
    if (!canonicalMapIds.has(mapId)) {
      throw new Error(`integrity: map-counters references unknown map id "${mapId}"`);
    }
    for (const [enemySlug, list] of Object.entries(perEnemy)) {
      if (!brawlerSlugSet.has(enemySlug)) {
        throw new Error(`integrity: map-counters["${mapId}"] key "${enemySlug}" is not a known brawler slug`);
      }
      if (list.length > 3) {
        throw new Error(`integrity: map-counters["${mapId}"]["${enemySlug}"] has ${list.length} counters (must be <= 3)`);
      }
      const seen = new Set();
      for (const slug of list) {
        if (!brawlerSlugSet.has(slug)) {
          throw new Error(`integrity: map-counters["${mapId}"]["${enemySlug}"] references unknown brawler slug "${slug}"`);
        }
        if (seen.has(slug)) {
          throw new Error(`integrity: map-counters["${mapId}"]["${enemySlug}"] has duplicate counter slug "${slug}"`);
        }
        seen.add(slug);
      }
    }
  }

  // --- Build per-brawler aliases (raw spellings, excluding the canonical name itself) ---
  const aliasesBySlug = new Map(brawlers.map((b) => [b.id, new Map()])); // slug -> (normKey -> surface form)
  function recordAlias(slug, raw) {
    if (!brawlerSlugSet.has(slug)) return;
    const canonicalKey = normKey(brawlerById.get(slug).name);
    const rawKey = normKey(raw);
    if (rawKey === canonicalKey) return;
    const map = aliasesBySlug.get(slug);
    if (!map.has(rawKey)) map.set(rawKey, raw);
  }
  for (const { slug, raw } of [...metaAliasHits, ...metaExtraAliasHits, ...mapAliasHits]) recordAlias(slug, raw);

  // --- Build per-brawler counters + counterFor (inverse index) ---
  const countersBySlug = new Map(brawlers.map((b) => [b.id, []]));
  const counterForBySlug = new Map(brawlers.map((b) => [b.id, new Set()]));
  for (const entry of counterEntries) {
    countersBySlug.set(entry.slug, entry.counters);
    for (const c of entry.counters) counterForBySlug.get(c.slug).add(entry.slug);
  }

  // --- Build per-brawler maps (forward index: which map categories a brawler appears in) ---
  const mapsBySlug = new Map(brawlers.map((b) => [b.id, []]));
  for (const map of enrichedMaps) {
    for (const cat of map.categories) {
      for (const slug of cat.brawlers) {
        mapsBySlug.get(slug).push({ mapId: map.id, category: cat.label });
      }
    }
  }

  // --- Final brawler records ---
  const finalBrawlers = brawlers.map((b) => {
    const counters = countersBySlug.get(b.id) ?? [];
    return {
      ...b,
      counters,
      hasCounters: counters.length > 0,
      counterFor: [...counterForBySlug.get(b.id)].sort(),
      maps: mapsBySlug.get(b.id) ?? [],
      aliases: [...aliasesBySlug.get(b.id).values()].sort(),
    };
  });

  // --- counters-index.json: { slug: slug[] } ---
  const countersIndex = Object.fromEntries(
    finalBrawlers.map((b) => [b.id, b.counters.map((c) => c.slug)]),
  );

  // --- map-index.json: { mapId: { slug: categoryLabel[] } } ---
  const mapIndex = {};
  for (const map of enrichedMaps) {
    const perBrawler = {};
    for (const cat of map.categories) {
      for (const slug of cat.brawlers) {
        (perBrawler[slug] ??= []).push(cat.label);
      }
    }
    mapIndex[map.id] = perBrawler;
  }

  // --- _report.json ---
  const usedAliasKeys = resolve.usedAliasKeys;
  const unusedAliases = Object.keys(MANUAL_ALIASES).filter((k) => !usedAliasKeys.has(k));
  const unusedMetaTypoFixes = Object.keys(META_TYPO_FIXES).filter((k) => !usedMetaTypoKeys.has(k));

  const aliasHitCounts = {};
  for (const { raw } of [...metaAliasHits, ...metaExtraAliasHits, ...mapAliasHits]) {
    const k = normKey(raw);
    aliasHitCounts[k] = (aliasHitCounts[k] ?? 0) + 1;
  }

  const mapsCovered = [...canonicalMapIds].filter((id) => mapCounters[id]).sort();
  const mapsNotCovered = [...canonicalMapIds].filter((id) => !mapCounters[id]).sort();

  const report = {
    counts: {
      brawlers: finalBrawlers.length,
      counters: counterEntries.length,
      maps: enrichedMaps.length,
      categories: enrichedMaps.reduce((acc, m) => acc + m.categories.length, 0),
      hasCountersFalse: finalBrawlers.filter((b) => !b.hasCounters).length,
      mapCountersMapsCovered: mapsCovered.length,
      mapCountersPerMapEntries: mapCountersEntryCount,
    },
    dropped: {
      keys: [...metaDropped.keys, ...metaExtraDropped.keys],
      values: [...metaDropped.values, ...metaExtraDropped.values, ...mapDropped.values],
    },
    hasCountersFalseSlugs: finalBrawlers.filter((b) => !b.hasCounters).map((b) => b.id).sort(),
    aliasHitCounts,
    unusedManualAliases: unusedAliases,
    meta: {
      source: 'data/raw/meta.txt',
      headerEntries: metaHeaderEntries,
      mapsCovered,
      mapsNotCovered,
      metaTypoFixesUsed: [...usedMetaTypoKeys].sort(),
      unusedMetaTypoFixes,
    },
    // data/raw/meta-extra.txt: 9 blocks supplied after meta.txt. `explicit`
    // is Mina (came with its own header); `derived` is the other 8, with
    // the exact per-slug frequency counts that produced their top-3 (see
    // scripts/lib/deriveCounters.mjs); `gaps` records the 2 truncated
    // blocks (Doug, Gene — 22/25 map lines) and exactly which 3 canonical
    // maps are missing for each, so the gap stays visible instead of
    // silently looking like full coverage.
    metaExtra: {
      source: 'data/raw/meta-extra.txt',
      blocks: metaExtraBlocks.length,
      ...metaExtraReport,
    },
  };

  await writeFile(BRAWLERS_JSON, JSON.stringify(finalBrawlers, null, 2) + '\n');
  await writeFile(MAPS_JSON, JSON.stringify(enrichedMaps, null, 2) + '\n');
  await writeFile(COUNTERS_INDEX_JSON, JSON.stringify(countersIndex, null, 2) + '\n');
  await writeFile(MAP_INDEX_JSON, JSON.stringify(mapIndex, null, 2) + '\n');
  await writeFile(MAP_COUNTERS_JSON, JSON.stringify(mapCounters, null, 2) + '\n');
  await writeFile(REPORT_JSON, JSON.stringify(report, null, 2) + '\n');

  console.log(`Wrote ${BRAWLERS_JSON} (${finalBrawlers.length} brawlers)`);
  console.log(`Wrote ${MAPS_JSON} (${enrichedMaps.length} maps, ${report.counts.categories} categories)`);
  console.log(`Wrote ${COUNTERS_INDEX_JSON} (${counterEntries.length} entries)`);
  console.log(`Wrote ${MAP_INDEX_JSON}`);
  console.log(`Wrote ${MAP_COUNTERS_JSON} (${mapsCovered.length} maps, ${mapCountersEntryCount} entries)`);
  console.log(`Wrote ${REPORT_JSON}`);
  if (unusedAliases.length) {
    console.log(`Note: unused MANUAL_ALIASES keys: ${unusedAliases.join(', ')}`);
  }
  if (unusedMetaTypoFixes.length) {
    console.log(`Note: unused META_TYPO_FIXES keys: ${unusedMetaTypoFixes.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
