// Standalone post-build assertions (independent of build-data.mjs's own
// integrity gate) covering: image presence/validity, slug resolution across
// every generated index, map API metadata completeness, exact drop/gap
// lists, and the golden ranking cases. Exits non-zero on first failure.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rankPicks } from '../src/lib/rank.ts';
import { analyzeComposition } from '../src/lib/composition.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex');

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function deepEqualArrays(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function pngFiles(dir) {
  return (await readdir(dir)).filter((f) => f.endsWith('.png'));
}

async function isValidPng(file) {
  const s = await stat(file);
  if (!s.isFile() || s.size <= 1024) return false;
  const buf = await readFile(file);
  return buf.subarray(0, 8).equals(PNG_MAGIC);
}

async function main() {
  const brawlers = await readJson(path.join(ROOT, 'src/data/brawlers.json'));
  const maps = await readJson(path.join(ROOT, 'src/data/maps.json'));
  const countersIndex = await readJson(path.join(ROOT, 'src/data/counters-index.json'));
  const mapIndex = await readJson(path.join(ROOT, 'src/data/map-index.json'));
  const mapCounters = await readJson(path.join(ROOT, 'src/data/map-counters.json'));
  const report = await readJson(path.join(ROOT, 'src/data/_report.json'));

  const slugSet = new Set(brawlers.map((b) => b.id));
  const bySlug = Object.fromEntries(brawlers.map((b) => [b.id, b]));

  // --- 1. Images ---
  console.log('\n[1] Images');
  // 106, not 107: fetch-brawlers.mjs's REMOVED_BRAWLERS excludes
  // buzz-lightyear (time-limited collab, no data anywhere in this project)
  // from the roster entirely.
  check('brawlers.json.length === 106', brawlers.length === 106, `got ${brawlers.length}`);

  const brawlerFiles = await pngFiles(path.join(ROOT, 'public/brawlers'));
  let allBrawlerPngsOk = brawlerFiles.length === 106;
  for (const b of brawlers) {
    const file = path.join(ROOT, 'public/brawlers', `${b.id}.png`);
    if (!(await isValidPng(file))) allBrawlerPngsOk = false;
  }
  check('every public/brawlers/<id>.png exists, >1024B, valid PNG magic', allBrawlerPngsOk);

  const mapFiles = await pngFiles(path.join(ROOT, 'public/maps'));
  let allMapPngsOk = mapFiles.length === 26;
  for (const m of maps) {
    const file = path.join(ROOT, 'public/maps', `${m.id}.png`);
    if (!(await isValidPng(file))) allMapPngsOk = false;
  }
  check('every public/maps/<slug>.png (26) exists, >1024B, valid PNG magic', allMapPngsOk);

  const gameModeFiles = await pngFiles(path.join(ROOT, 'public/game-modes'));
  let allModePngsOk = gameModeFiles.length === 6;
  for (const f of gameModeFiles) {
    if (!(await isValidPng(path.join(ROOT, 'public/game-modes', f)))) allModePngsOk = false;
  }
  check('every public/game-modes/<slug>.png (6) exists, >1024B, valid PNG magic', allModePngsOk);

  const hardCases = ['8-bit', 'mr-p', 'r-t', 'larry-lawrie', 'el-primo', 'starr-nova', 'jae-yong'];
  const hardCasesOk = hardCases.every((slug) => brawlerFiles.includes(`${slug}.png`));
  check(`hard-case brawler files exist (${hardCases.join(' ')})`, hardCasesOk);

  // --- 2. Brawler classes ---
  // BrawlAPI reports class.name === "Unknown" for brawlers it hasn't
  // backfilled yet; scripts/fetch-brawlers.mjs's CLASS_OVERRIDES table
  // hand-corrects the ones we could verify against a real source. This
  // pins down exactly which brawlers are still expected to be "Unknown" so
  // a roster change (a new unclassified brawler, or BrawlAPI/an override
  // fixing one) surfaces here instead of silently degrading
  // src/lib/composition.ts's analysis. Was ['buzz-lightyear'] — now empty:
  // he was the only real "Unknown" left (the other 19 are hand-classified
  // via CLASS_OVERRIDES) and REMOVED_BRAWLERS drops him from the roster
  // entirely.
  console.log('\n[2] Brawler classes');
  const expectedUnknown = [];
  const actualUnknown = brawlers.filter((b) => b.className === 'Unknown').map((b) => b.id).sort();
  check(
    `brawlers with className === "Unknown" sorted === ${JSON.stringify(expectedUnknown)}`,
    deepEqualArrays(actualUnknown, expectedUnknown),
    JSON.stringify(actualUnknown),
  );

  // analyzeComposition() must stay honest when a real 'Unknown' brawler is
  // on the team: pairing an Unknown pick with a real Tank and a real
  // Support must surface the genuine remaining gap (no Marksman/Artillery)
  // and must NEVER claim "Composição equilibrada" — that would assert
  // completeness over a slot whose class we don't actually know. Previously
  // exercised via buzz-lightyear (the roster's one real 'Unknown' brawler);
  // now that he's removed from the roster entirely (see [2] above), no
  // brawler slug carries className 'Unknown' any more, so this passes a
  // literal 'Unknown' class value instead of looking one up by slug — the
  // behavior under test is analyzeComposition()'s handling of the class
  // string itself, not any particular brawler.
  const compositionClasses = ['Tank', 'Support', 'Unknown'];
  const compositionTips = analyzeComposition(compositionClasses);
  check(
    'analyzeComposition([Tank, Support, Unknown]) === ["Falta alcance longo"] (never "Composição equilibrada")',
    deepEqualArrays(compositionTips, ['Falta alcance longo']),
    JSON.stringify({ classes: compositionClasses, tips: compositionTips }),
  );

  // --- 3. No unresolved slug anywhere ---
  console.log('\n[3] Slug resolution');
  let countersSlugsOk = true;
  for (const b of brawlers) {
    for (const c of b.counters) if (!slugSet.has(c.slug)) countersSlugsOk = false;
    for (const s of b.counterFor) if (!slugSet.has(s)) countersSlugsOk = false;
  }
  check('every counters/counterFor slug resolves to a real brawler', countersSlugsOk);

  let countersIndexOk = true;
  for (const [key, list] of Object.entries(countersIndex)) {
    if (!slugSet.has(key)) countersIndexOk = false;
    for (const s of list) if (!slugSet.has(s)) countersIndexOk = false;
  }
  check('every counters-index key and value resolves', countersIndexOk);

  let mapCategorySlugsOk = true;
  let emptyCategoryCount = 0;
  let categoryCount = 0;
  for (const m of maps) {
    for (const cat of m.categories) {
      categoryCount++;
      if (cat.brawlers.length === 0) emptyCategoryCount++;
      for (const s of cat.brawlers) if (!slugSet.has(s)) mapCategorySlugsOk = false;
    }
  }
  check('every map category brawler slug resolves', mapCategorySlugsOk);
  check('zero empty categories', emptyCategoryCount === 0, `found ${emptyCategoryCount}`);

  let mapIndexOk = true;
  for (const m of maps) {
    const perBrawler = mapIndex[m.id];
    if (!perBrawler) { mapIndexOk = false; continue; }
    for (const cat of m.categories) {
      for (const slug of cat.brawlers) {
        if (!perBrawler[slug]?.includes(cat.label)) mapIndexOk = false;
      }
    }
  }
  check('map-index.json mirrors every maps.json category exactly', mapIndexOk);

  const countersEntryCount = brawlers.filter((b) => b.hasCounters).length;
  console.log(`  -> ${countersEntryCount} counters | ${maps.length} mapas | ${categoryCount} categorias`);
  // 102, not 93: data/raw/meta-extra.txt added 9 more covered brawlers
  // (1 explicit header + 8 derived-by-frequency — see [5] below).
  check('102 counters | 26 mapas | 133 categorias', countersEntryCount === 102 && maps.length === 26 && categoryCount === 133);

  // --- 4. All 26 maps carry API metadata ---
  console.log('\n[4] Map API metadata');
  let mapMetadataOk = true;
  for (const m of maps) {
    if (!m.mapApiId || !m.gameMode?.name || !m.image) mapMetadataOk = false;
    console.log(`  ${m.name} -> ${m.mapApiId} (${m.gameMode?.name})`);
  }
  check('all 26 maps have mapApiId, gameMode.name, image', mapMetadataOk && maps.length === 26);

  // --- 5. Exact drops and gaps ---
  // meta.txt replaced counters.txt as the source of the global counters
  // (see data/raw/meta.txt / scripts/parse-meta.mjs) — 'Watts' and
  // 'Lançadores' were counters.txt-only drops (Damian/Shelly's old
  // class-not-brawler tokens) and no longer occur anywhere; meta.txt fixed
  // both entries upstream instead. 'LOL' is still dropped from maps.txt,
  // which this change did not touch.
  console.log('\n[5] Exact drops and gaps');
  const droppedKeysSorted = report.dropped.keys.map((d) => d.raw).sort();
  check(
    'dropped keys sorted === []',
    deepEqualArrays(droppedKeysSorted, []),
    JSON.stringify(droppedKeysSorted),
  );

  const droppedValuesSorted = report.dropped.values
    .filter((d) => d.reason !== 'duplicate-in-source')
    .map((d) => d.raw)
    .sort();
  check(
    "dropped values (excluding source-data duplicates) sorted === ['LOL']",
    deepEqualArrays(droppedValuesSorted, ['LOL']),
    JSON.stringify(droppedValuesSorted),
  );

  // meta.txt has 4 duplicate-in-source repeats not present in the old
  // counters.txt data — a genuine data error (e.g. header "Max ➔ ... Crow,
  // Spike ou Crow.") — logged and deduped by parse-meta.mjs rather than
  // thrown, since the token itself resolves fine; it's just repeated.
  const duplicateInSource = report.dropped.values
    .filter((d) => d.reason === 'duplicate-in-source')
    .map((d) => `${d.raw}@${d.from}`)
    .sort();
  check(
    "duplicate-in-source drops sorted === ['Crow@header:Max','Spike@Belle / Deathcap Trap','Spike@Max / Deathcap Trap','Spike@Stu / Deathcap Trap']",
    deepEqualArrays(duplicateInSource, [
      'Crow@header:Max',
      'Spike@Belle / Deathcap Trap',
      'Spike@Max / Deathcap Trap',
      'Spike@Stu / Deathcap Trap',
    ]),
    JSON.stringify(duplicateInSource),
  );

  // Was a 14-slug list including buzz-lightyear (now removed from the
  // roster entirely — [1]/[2] above) plus mina/trunk/kaze/jae-yong/finx/
  // shade/doug/lola/gene (now covered by data/raw/meta-extra.txt, 1
  // explicit header + 8 derived-by-frequency — see the metaExtra assertions
  // below). Only 4 genuinely uncovered brawlers remain.
  const expectedNoCounters = ['alli', 'gigi', 'glowy', 'sirius'].sort();
  const actualNoCounters = brawlers.filter((b) => !b.hasCounters).map((b) => b.id).sort();
  check(
    'brawlers with hasCounters === false sorted === the exact 4-slug list',
    deepEqualArrays(actualNoCounters, expectedNoCounters),
    JSON.stringify(actualNoCounters),
  );

  // meta-extra.txt (2026-07-27 supplement): 9 blocks, provenance must stay
  // visible in _report.json rather than looking indistinguishable from
  // meta.txt's 93 curated header lines. Mina came with her own header;
  // the other 8 are derived by per-map counter frequency (top 3, ties
  // broken by ascending slug localeCompare — see scripts/lib/deriveCounters.mjs).
  console.log('\n[5b] meta-extra.txt provenance and gaps');
  const metaExtra = report.metaExtra ?? {};
  check('metaExtra.blocks === 9', metaExtra.blocks === 9, JSON.stringify(metaExtra.blocks));
  check(
    "metaExtra.explicit === ['mina']",
    deepEqualArrays(metaExtra.explicit ?? [], ['mina']),
    JSON.stringify(metaExtra.explicit),
  );
  const derivedSlugsSorted = Object.keys(metaExtra.derived ?? {}).sort();
  const expectedDerivedSlugs = ['doug', 'finx', 'gene', 'jae-yong', 'kaze', 'lola', 'shade', 'trunk'].sort();
  check(
    'metaExtra.derived keys sorted === the 8 headerless-block slugs',
    deepEqualArrays(derivedSlugsSorted, expectedDerivedSlugs),
    JSON.stringify(derivedSlugsSorted),
  );
  // Frequency-derived top-3, pinned so a future re-derivation (or a
  // regression in the tie-break rule) surfaces here. "gale" beats "spike"/
  // "shelly" for trunk's 3rd slot despite an equal count (4) purely on
  // ascending slug localeCompare — the concrete case the tie-break rule
  // exists for.
  const expectedDerivedTop3 = {
    trunk: ['colette', 'piper', 'gale'],
    kaze: ['piper', 'kenji', 'nani'],
    'jae-yong': ['piper', 'nani', 'gale'],
    finx: ['mortis', 'piper', 'nani'],
    shade: ['piper', 'nani', 'jacky'],
    doug: ['colette', 'piper', 'clancy'],
    lola: ['piper', 'nani', 'spike'],
    gene: ['piper', 'nani', 'spike'],
  };
  for (const [slug, expectedTop3] of Object.entries(expectedDerivedTop3)) {
    const actualTop3 = metaExtra.derived?.[slug]?.top3 ?? [];
    check(`metaExtra.derived["${slug}"].top3 === ${JSON.stringify(expectedTop3)}`, deepEqualArrays(actualTop3, expectedTop3), JSON.stringify(actualTop3));
  }

  // Doug and Gene are truncated source-side at 22/25 map lines; the exact
  // 3 missing canonical maps must be recorded, never silently absorbed.
  const expectedGapMaps = ['Flaring Phoenix', 'New Horizons', 'Out in the Open'];
  for (const slug of ['doug', 'gene']) {
    const gap = metaExtra.gaps?.[slug];
    check(
      `metaExtra.gaps["${slug}"] === {mapLineCount: 22, missingMaps: ${JSON.stringify(expectedGapMaps)}}`,
      gap?.mapLineCount === 22 && deepEqualArrays(gap?.missingMaps ?? [], expectedGapMaps),
      JSON.stringify(gap),
    );
  }

  // Golden counters below reflect meta.txt (2026 update), not the old
  // counters.txt export — see the before/after table in this change's PR
  // description. spike/mortis changed content; shelly/damian went from 2
  // counters (a dropped token each) to 3 (meta.txt fixed both upstream);
  // 8-bit is unchanged.
  const goldenCounters = {
    spike: ['piper', 'brock', 'tick'],
    shelly: ['piper', 'spike', 'gale'],
    damian: ['gale', 'surge', 'clancy'],
    '8-bit': ['pierce', 'meeple', 'piper'],
    mortis: ['gale', 'shelly', 'bull'],
  };
  for (const [slug, expected] of Object.entries(goldenCounters)) {
    const actual = (bySlug[slug]?.counters ?? []).map((c) => c.slug);
    check(`${slug} counters === ${JSON.stringify(expected)}`, deepEqualArrays(actual, expected), JSON.stringify(actual));
  }

  // --- 6. Golden ranking cases ---
  console.log('\n[6] Golden ranking cases');
  const countersIndexForRank = countersIndex;

  function formatTop(picks, n) {
    return picks.slice(0, n).map((p) => `${p.slug}:${p.coverage}/${p.score}`).join(' ');
  }

  // Expected strings below are recomputed against meta.txt's counters (this
  // change's data update) — see the before/after table in the PR
  // description. bull/frank/rosa, edgar/mortis/buzz, and piper/brock/nani
  // are all keyed off enemies meta-extra.txt never touches (mina, trunk,
  // kaze, jae-yong, finx, shade, doug, lola, gene aren't among them), so
  // those 3 strings are unchanged by this update.
  //
  // The `kaze` empty-ranking case was replaced with `sirius`: kaze now HAS
  // derived counters (data/raw/meta-extra.txt — see [5b] above), so
  // rankPicks(['kaze']) is no longer empty; `sirius` is one of the 4
  // brawlers still genuinely uncovered (see [5] above) and exercises the
  // same "no counter data -> empty ranking" behavior kaze used to. A new
  // `trunk` case is added alongside it specifically to prove the opposite:
  // a brawler this change newly covers now produces real suggestions.
  const goldenRanking = [
    { enemies: ['bull', 'frank', 'rosa'], expected: 'colette:3/9 gale:2/3 cordelius:1/2 shelly:1/2 chester:1/1' },
    { enemies: ['edgar', 'mortis', 'buzz'], expected: 'gale:3/8 surge:2/3 bull:2/2 otis:1/3' },
    { enemies: ['piper', 'brock', 'nani'], expected: 'leon:2/2 edgar:1/3 cordelius:1/2' },
    { enemies: ['sirius'], expected: '' },
    { enemies: ['trunk'], expected: 'colette:1/3 piper:1/2 gale:1/1' },
  ];

  for (const { enemies, expected } of goldenRanking) {
    const picks = rankPicks(enemies, countersIndexForRank);
    const n = expected ? expected.split(' ').length : 0;
    const actual = formatTop(picks, n);
    check(`rankPicks(${JSON.stringify(enemies)}) top ${n || 0} === "${expected}"`, actual === expected, `got "${actual}"`);
  }

  // --- 7. Map-specific counters (map-counters.json) ---
  console.log('\n[7] Map-specific counters');
  const mapIdSet = new Set(maps.map((m) => m.id));

  check('map-counters.json covers exactly 25 of the 26 maps', Object.keys(mapCounters).length === 25, `got ${Object.keys(mapCounters).length}`);
  check('map-counters.json has no "kaboom-canyon" entry (absent from meta.txt)', !('kaboom-canyon' in mapCounters));
  check('map-counters.json has a "dueling-beetles" entry (meta.txt\'s "Hot Zone" lines)', 'dueling-beetles' in mapCounters);

  let mapCountersSlugsOk = true;
  for (const [mapId, perEnemy] of Object.entries(mapCounters)) {
    if (!mapIdSet.has(mapId)) mapCountersSlugsOk = false;
    for (const [enemy, list] of Object.entries(perEnemy)) {
      if (!slugSet.has(enemy) || list.length > 3) mapCountersSlugsOk = false;
      for (const s of list) if (!slugSet.has(s)) mapCountersSlugsOk = false;
    }
  }
  check('every map-counters map id, enemy slug, and counter slug resolves; no list > 3', mapCountersSlugsOk);

  // rankPicks({mapCounters}) must differ from the global list for a map the
  // data covers, and fall back to the global list (per enemy) for one it
  // doesn't — never an all-or-nothing switch keyed on the map.
  const enemiesForMapCase = ['bull', 'frank', 'rosa'];
  const globalPicks = formatTop(rankPicks(enemiesForMapCase, countersIndexForRank), 6);
  const bridgeTooFarPicks = formatTop(
    rankPicks(enemiesForMapCase, countersIndexForRank, { mapCounters: mapCounters['bridge-too-far'] }),
    4,
  );
  check(
    'rankPicks(["bull","frank","rosa"], {mapCounters: mapCounters["bridge-too-far"]}) top 4 === "clancy:3/8 colette:3/7 piper:2/2 spike:1/1"',
    bridgeTooFarPicks === 'clancy:3/8 colette:3/7 piper:2/2 spike:1/1',
    `got "${bridgeTooFarPicks}"`,
  );
  check('map-specific ranking differs from the global ranking for a covered map', bridgeTooFarPicks !== globalPicks);

  const kaboomPicks = formatTop(
    rankPicks(enemiesForMapCase, countersIndexForRank, { mapCounters: mapCounters['kaboom-canyon'] ?? null }),
    6,
  );
  check(
    'rankPicks(..., {mapCounters: mapCounters["kaboom-canyon"] ?? null}) falls back to the global ranking',
    kaboomPicks === globalPicks,
    `global "${globalPicks}" vs kaboom-canyon "${kaboomPicks}"`,
  );

  // --- Summary ---
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
