// Orchestrates the data pipeline: reads the fetched roster + raw text files,
// parses counters and maps, joins everything together, and writes the final
// committed JSON consumed by src/content.config.ts. Throws (non-zero exit) on
// any integrity violation instead of silently emitting bad data.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeResolver, normKey } from './lib/normalize.mjs';
import { MANUAL_ALIASES } from './lib/aliases.mjs';
import { parseCounters } from './parse-counters.mjs';
import { parseMaps } from './parse-maps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BRAWLERS_JSON = path.join(ROOT, 'src/data/brawlers.json');
const MAP_METADATA_JSON = path.join(ROOT, 'src/data/_map-metadata.json');
const COUNTERS_RAW = path.join(ROOT, 'data/raw/counters.txt');
const MAPS_RAW = path.join(ROOT, 'data/raw/maps.txt');

const MAPS_JSON = path.join(ROOT, 'src/data/maps.json');
const COUNTERS_INDEX_JSON = path.join(ROOT, 'src/data/counters-index.json');
const MAP_INDEX_JSON = path.join(ROOT, 'src/data/map-index.json');
const REPORT_JSON = path.join(ROOT, 'src/data/_report.json');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function main() {
  const brawlers = await readJson(BRAWLERS_JSON);
  if (brawlers.length < 107) {
    throw new Error(`integrity: expected >=107 brawlers in ${BRAWLERS_JSON}, got ${brawlers.length}`);
  }
  const brawlerById = new Map(brawlers.map((b) => [b.id, b]));
  const brawlerSlugSet = new Set(brawlers.map((b) => b.id));

  const resolve = makeResolver(brawlers);

  // --- Parse counters ---
  const countersRaw = await readFile(COUNTERS_RAW, 'utf8');
  const { entries: counterEntries, aliasHits: counterAliasHits, dropped: counterDropped } =
    parseCounters(countersRaw, resolve);

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
  for (const { slug, raw } of [...counterAliasHits, ...mapAliasHits]) recordAlias(slug, raw);

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

  const aliasHitCounts = {};
  for (const { raw } of [...counterAliasHits, ...mapAliasHits]) {
    const k = normKey(raw);
    aliasHitCounts[k] = (aliasHitCounts[k] ?? 0) + 1;
  }

  const report = {
    counts: {
      brawlers: finalBrawlers.length,
      counters: counterEntries.length,
      maps: enrichedMaps.length,
      categories: enrichedMaps.reduce((acc, m) => acc + m.categories.length, 0),
      hasCountersFalse: finalBrawlers.filter((b) => !b.hasCounters).length,
    },
    dropped: {
      keys: counterDropped.keys,
      values: [...counterDropped.values, ...mapDropped.values],
    },
    hasCountersFalseSlugs: finalBrawlers.filter((b) => !b.hasCounters).map((b) => b.id).sort(),
    aliasHitCounts,
    unusedManualAliases: unusedAliases,
  };

  await writeFile(BRAWLERS_JSON, JSON.stringify(finalBrawlers, null, 2) + '\n');
  await writeFile(MAPS_JSON, JSON.stringify(enrichedMaps, null, 2) + '\n');
  await writeFile(COUNTERS_INDEX_JSON, JSON.stringify(countersIndex, null, 2) + '\n');
  await writeFile(MAP_INDEX_JSON, JSON.stringify(mapIndex, null, 2) + '\n');
  await writeFile(REPORT_JSON, JSON.stringify(report, null, 2) + '\n');

  console.log(`Wrote ${BRAWLERS_JSON} (${finalBrawlers.length} brawlers)`);
  console.log(`Wrote ${MAPS_JSON} (${enrichedMaps.length} maps, ${report.counts.categories} categories)`);
  console.log(`Wrote ${COUNTERS_INDEX_JSON} (${counterEntries.length} entries)`);
  console.log(`Wrote ${MAP_INDEX_JSON}`);
  console.log(`Wrote ${REPORT_JSON}`);
  if (unusedAliases.length) {
    console.log(`Note: unused MANUAL_ALIASES keys: ${unusedAliases.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
