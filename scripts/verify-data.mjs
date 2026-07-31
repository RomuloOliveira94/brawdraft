// Standalone post-build assertions (independent of build-data.mjs's own
// integrity gate) covering: image presence/validity, slug resolution across
// every generated index, map API metadata completeness, exact drop/gap
// lists, and the golden ranking cases. Exits non-zero on first failure.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rankPicks } from '../src/lib/rank.ts';
import { analyzeComposition, analyzeDraft } from '../src/lib/composition.ts';
import { makeResolver } from './lib/normalize.mjs';
import { parseMetaExtra } from './parse-meta-extra.mjs';

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
  // 105, not 102: a 2026-07-27 supplement appended Sirius, Glowy, and Gigi
  // (3 more derived-by-frequency blocks) to data/raw/meta-extra.txt, on top
  // of the earlier 9 (1 explicit header + 8 derived — see [5b] below).
  check('105 counters | 26 mapas | 133 categorias', countersEntryCount === 105 && maps.length === 26 && categoryCount === 133);

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
  // shade/doug/lola/gene (covered by data/raw/meta-extra.txt's first 9
  // blocks), then a 4-slug list (alli/gigi/glowy/sirius) until the
  // 2026-07-27 supplement appended Sirius, Glowy, and Gigi (see the
  // metaExtra assertions below). Only 1 genuinely uncovered brawler remains.
  const expectedNoCounters = ['alli'].sort();
  const actualNoCounters = brawlers.filter((b) => !b.hasCounters).map((b) => b.id).sort();
  check(
    "brawlers with hasCounters === false sorted === ['alli']",
    deepEqualArrays(actualNoCounters, expectedNoCounters),
    JSON.stringify(actualNoCounters),
  );

  // meta-extra.txt: 12 blocks, provenance must stay visible in
  // _report.json rather than looking indistinguishable from meta.txt's 93
  // curated header lines. Mina came with her own header; the other 11
  // (the original 8, plus a 2026-07-27 supplement's Sirius/Glowy/Gigi) are
  // derived by per-map counter frequency (top 3, ties broken by ascending
  // slug localeCompare — see scripts/lib/deriveCounters.mjs).
  console.log('\n[5b] meta-extra.txt provenance and gaps');
  const metaExtra = report.metaExtra ?? {};
  check('metaExtra.blocks === 12', metaExtra.blocks === 12, JSON.stringify(metaExtra.blocks));
  check(
    "metaExtra.explicit === ['mina']",
    deepEqualArrays(metaExtra.explicit ?? [], ['mina']),
    JSON.stringify(metaExtra.explicit),
  );
  const derivedSlugsSorted = Object.keys(metaExtra.derived ?? {}).sort();
  const expectedDerivedSlugs = [
    'doug', 'finx', 'gene', 'gigi', 'glowy', 'jae-yong', 'kaze', 'lola', 'shade', 'sirius', 'trunk',
  ].sort();
  check(
    'metaExtra.derived keys sorted === the 11 headerless-block slugs',
    deepEqualArrays(derivedSlugsSorted, expectedDerivedSlugs),
    JSON.stringify(derivedSlugsSorted),
  );
  // Frequency-derived top-3, pinned so a future re-derivation (or a
  // regression in the tie-break rule) surfaces here. "gale" beats "spike"/
  // "shelly" for trunk's 3rd slot despite an equal count (4) purely on
  // ascending slug localeCompare — the concrete case the tie-break rule
  // exists for. "gigi" is the 2026-07-27 supplement's own tie-break case:
  // cordelius/gale/nani are tied at 6 occurrences each, and ascending slug
  // localeCompare ('cordelius' < 'gale' < 'nani') picks cordelius and gale
  // for the 2nd/3rd slots, dropping nani despite the equal count.
  const expectedDerivedTop3 = {
    trunk: ['colette', 'piper', 'gale'],
    kaze: ['piper', 'kenji', 'nani'],
    'jae-yong': ['piper', 'nani', 'gale'],
    finx: ['mortis', 'piper', 'nani'],
    shade: ['piper', 'nani', 'jacky'],
    doug: ['colette', 'piper', 'clancy'],
    lola: ['piper', 'nani', 'spike'],
    gene: ['piper', 'nani', 'spike'],
    sirius: ['piper', 'nani', 'spike'],
    glowy: ['piper', 'crow', 'mortis'],
    gigi: ['piper', 'cordelius', 'gale'],
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

  // --- 5c. parse-meta-extra.mjs glued-name guard regression ---
  // The 2026-07-27 supplement's source paste glued each next block's bare
  // name onto the previous block's last map line (e.g. "Out in the Open:
  // Nani, Piper, Angelo  Glowy" — "Glowy" is really its own delimiter line,
  // not a 4th counter). detectGluedTrailingName() in parse-meta-extra.mjs
  // guards against this; these cases pin its exact boundary directly
  // against the parser (independent of data/raw/meta-extra.txt's current
  // content, so a regression here fails even if no future paste ever
  // repeats the exact same corruption).
  console.log('\n[5c] Glued-name guard regression (parse-meta-extra.mjs)');
  const guardResolve = makeResolver(brawlers);
  // 24 filler map lines (all 25 canonical labels minus "Out in the Open",
  // which is appended separately below to carry the glued/edge-case value)
  // plus a trailing 22-line block so both halves satisfy
  // EXPECTED_MAP_LINE_COUNTS ({22, 25}) and only the guard's own behavior
  // is under test, not an unrelated line-count failure.
  const guardFillerMaps = [
    'Bridge Too Far', 'Hot Potato', 'Safe Zone', 'Hot Zone', 'Parallel Plays',
    'Ring of Fire', 'Crystal Arcade', 'Double Swoosh', 'Hard Rock Mine',
    'Deathcap Trap', 'Gem Fort', 'Undermine', 'Center Stage', 'Pinball Dreams',
    'Sneaky Fields', 'Triple Dribble', 'Open Business', 'Dry Season',
    'Hideout', 'Layer Cake', 'Shooting Star', 'Belles Rock',
    'Flaring Phoenix', 'New Horizons',
  ];
  const guardFiller = guardFillerMaps.map((n) => `${n}: Piper, Nani, Mandy`).join('\n');
  const guardTrailer = guardFillerMaps.slice(1, 22).map((n) => `${n}: Colt, Bull, Rico`).join('\n');

  const guardTrailerBlock = `Bridge Too Far: Belle, Piper, Mandy\n${guardTrailer}\n`;

  // For the glued-name cases: no bare-name line between Sirius's last map
  // line and the trailing block — the whole point is that it's missing
  // (glued onto the previous line instead), and the guard must synthesize
  // the boundary itself.
  function parseGluedFixture(lastLineValue) {
    return parseMetaExtra(
      `Sirius\n\n${guardFiller}\nOut in the Open: ${lastLineValue}\n\n${guardTrailerBlock}`,
      guardResolve,
    );
  }

  // For the non-glued (precision-boundary) cases: a real, literal bare-name
  // line delimits the trailing block, exactly like well-formed source data.
  // This isolates what's under test — does Sirius's own block stay a clean
  // 25 lines? — from the unrelated "not enough map lines" failure a missing
  // delimiter would otherwise cause.
  function parsePlainFixture(lastLineValue) {
    return parseMetaExtra(
      `Sirius\n\n${guardFiller}\nOut in the Open: ${lastLineValue}\nGlowy\n\n${guardTrailerBlock}`,
      guardResolve,
    );
  }

  // Case A: the exact glued-name shape from the source paste. Must yield 2
  // blocks (not 1 giant/miscounted block), Sirius's line must keep exactly
  // 3 counters (not 4 — "Glowy" must not be absorbed as a counter), and the
  // 2nd block's name must be the glued fragment.
  const glued = parseGluedFixture('Nani, Piper, Angelo  Glowy');
  check('glued-name: splits into 2 blocks, not 1', glued.blocks.length === 2, `got ${glued.blocks.length}`);
  const gluedLastLine = (glued.blocks[0]?.mapCounters['Out in the Open'] ?? []).map((c) => c.slug);
  check(
    'glued-name: sirius\'s "Out in the Open" keeps exactly 3 counters (not 4)',
    deepEqualArrays(gluedLastLine, ['nani', 'piper', 'angelo']),
    JSON.stringify(gluedLastLine),
  );
  check(
    'glued-name: 2nd block is named from the glued fragment, not merged as a counter',
    glued.blocks[1]?.rawName === 'Glowy',
    JSON.stringify(glued.blocks[1]?.rawName),
  );

  // Case B: uppercase glued name (the real "GIGI" case) resolves via
  // normKey the same way.
  const gluedUpper = parseGluedFixture('Nani, Piper, Angelo GIGI');
  check(
    'glued-name: uppercase "GIGI" resolves to slug "gigi"',
    gluedUpper.blocks[1]?.slug === 'gigi',
    JSON.stringify(gluedUpper.blocks[1]?.slug),
  );

  // Case C/D: precision boundary — genuine multi-word brawler names as the
  // LAST token must never be mistaken for a glued name, because they
  // resolve as a single atom directly and never reach resolve()'s
  // whitespace-split fallback that this guard keys off of.
  const larry = parsePlainFixture('Nani, Piper, Larry & Lawrie');
  check(
    '"Larry & Lawrie" as the last token is not treated as a block delimiter',
    larry.blocks.length === 2 && larry.blocks[0]?.rawName === 'Sirius' && deepEqualArrays(
      (larry.blocks[0]?.mapCounters['Out in the Open'] ?? []).map((c) => c.slug),
      ['nani', 'piper', 'larry-lawrie'],
    ),
    JSON.stringify(larry.blocks.map((b) => b.rawName)),
  );
  const mrP = parsePlainFixture('Nani, Piper, Mr. P');
  check(
    '"Mr. P" as the last token is not treated as a block delimiter',
    mrP.blocks.length === 2 && mrP.blocks[0]?.rawName === 'Sirius' && deepEqualArrays(
      (mrP.blocks[0]?.mapCounters['Out in the Open'] ?? []).map((c) => c.slug),
      ['nani', 'piper', 'mr-p'],
    ),
    JSON.stringify(mrP.blocks.map((b) => b.rawName)),
  );

  // Case E: the "Damian lou" missing-comma case (the reason resolve()'s
  // whitespace-split fallback exists at all — see lib/normalize.mjs) must
  // keep rescuing both atoms when it is NOT the last token of a map line,
  // proving the guard is scoped to the last-token position only and never
  // touches this fallback's normal job.
  const damianLouAtoms = guardResolve('Damian lou', { source: 'test', key: 'test' });
  check(
    'resolve("Damian lou") whitespace-fallback still yields [damian, lou]',
    deepEqualArrays(damianLouAtoms, ['damian', 'lou']),
    JSON.stringify(damianLouAtoms),
  );
  const damianLouMidList = parsePlainFixture('Damian lou, Piper, Angelo');
  check(
    '"Damian lou" mid-list (not the last token) still resolves both atoms as counters, unaffected by the guard',
    damianLouMidList.blocks.length === 2 && damianLouMidList.blocks[0]?.rawName === 'Sirius' && deepEqualArrays(
      (damianLouMidList.blocks[0]?.mapCounters['Out in the Open'] ?? []).map((c) => c.slug),
      ['damian', 'lou', 'piper', 'angelo'],
    ),
    JSON.stringify(damianLouMidList.blocks[0]?.mapCounters['Out in the Open']),
  );

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
  // kaze, jae-yong, finx, shade, doug, lola, gene, sirius, glowy, gigi
  // aren't among them), so those 3 strings are unchanged by this update.
  //
  // The `kaze` empty-ranking case was replaced with `sirius` when kaze
  // gained derived counters; the 2026-07-27 supplement covers sirius too,
  // so this case is replaced again with `alli` — now the only brawler still
  // genuinely uncovered (see [5] above) — to keep exercising the "no
  // counter data -> empty ranking" behavior. `trunk` (added the same way,
  // to prove a newly-covered brawler produces real suggestions) is joined
  // by `gigi`, one of this update's 3 newly-covered brawlers.
  const goldenRanking = [
    { enemies: ['bull', 'frank', 'rosa'], expected: 'colette:3/9 gale:2/3 cordelius:1/2 shelly:1/2 chester:1/1' },
    { enemies: ['edgar', 'mortis', 'buzz'], expected: 'gale:3/8 surge:2/3 bull:2/2 otis:1/3' },
    { enemies: ['piper', 'brock', 'nani'], expected: 'leon:2/2 edgar:1/3 cordelius:1/2' },
    { enemies: ['alli'], expected: '' },
    { enemies: ['trunk'], expected: 'colette:1/3 piper:1/2 gale:1/1' },
    { enemies: ['gigi'], expected: 'piper:1/3 cordelius:1/2 gale:1/1' },
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

  // --- 8. Composition analysis (analyzeDraft) ---
  //
  // The fixed cases from the design spec
  // (docs/superpowers/specs/2026-07-30-composition-analysis-design.md §7).
  //
  // These assert insight CODES, never UI copy — the code is the stable
  // contract, so rewording a pt-BR string can't break the gate.
  //
  // IMPORTANT: the expected rankings below include the map bonus, because
  // analyzeDraft calls rankPicks with `mapBonus` (spec §4.4). The golden
  // cases in [7] above exercise rankPicks directly, WITHOUT `mapBonus`, and
  // are deliberately left untouched — the two differ on purpose. Do not
  // "fix" one against the other.
  console.log('\n[8] Composition analysis');

  const classOfRoster = new Map(brawlers.map((b) => [b.id, b.className]));

  /**
   * Builds a DraftInput, scoping the per-map slices exactly the way
   * draftBoard.ts's recompute() does (spec §4.2: analyzeDraft receives
   * already-scoped slices, not the whole JSONs).
   */
  function draftInput({ ally = [], enemy = [], mapId = null, exclude = [], classOf = classOfRoster } = {}) {
    return {
      ally,
      enemy,
      mapId,
      classOf,
      countersIndex,
      mapCounters: mapId ? (mapCounters[mapId] ?? null) : null,
      mapCategories: mapId ? (mapIndex[mapId] ?? null) : null,
      exclude,
    };
  }

  /**
   * Class-driven ally case: synthetic slugs let a class combination be
   * expressed directly, and keep 'Unknown' testable now that no real brawler
   * carries it — same reasoning as the analyzeComposition case in [2] above.
   */
  function allyClasses(classNames) {
    const slugs = classNames.map((_, i) => `test-ally-${i}`);
    return draftInput({ ally: slugs, classOf: new Map(slugs.map((s, i) => [s, classNames[i]])) });
  }

  const codesOf = (insights) => insights.map((i) => i.code);
  const sameSet = (actual, expected) =>
    deepEqualArrays([...actual].sort(), [...expected].sort());

  // Case 1 — empty draft.
  const emptyDraft = analyzeDraft(draftInput());
  check(
    'analyzeDraft({}) ally codes === ["ally.empty"]',
    sameSet(codesOf(emptyDraft.ally), ['ally.empty']),
    JSON.stringify(codesOf(emptyDraft.ally)),
  );
  check(
    'analyzeDraft({}) enemy codes === ["enemy.empty"]',
    sameSet(codesOf(emptyDraft.enemy), ['enemy.empty']),
    JSON.stringify(codesOf(emptyDraft.enemy)),
  );
  check('analyzeDraft({}) picks === []', emptyDraft.picks.length === 0, `got ${emptyDraft.picks.length}`);

  // Case 2 — one role each, nothing missing, nothing redundant.
  const balanced = codesOf(analyzeDraft(allyClasses(['Tank', 'Support', 'Marksman'])).ally);
  check(
    'analyzeDraft([Tank, Support, Marksman]) ally codes === ["ally.balanced"]',
    sameSet(balanced, ['ally.balanced']),
    JSON.stringify(balanced),
  );

  // Case 3 — three frontlines: redundant, and BOTH other roles missing.
  const allFrontline = codesOf(analyzeDraft(allyClasses(['Assassin', 'Assassin', 'Tank'])).ally);
  check(
    'analyzeDraft([Assassin, Assassin, Tank]) ally codes === redundant.frontline + missing.damage + missing.support',
    sameSet(allFrontline, [
      'ally.role.redundant.frontline',
      'ally.role.missing.damage',
      'ally.role.missing.support',
    ]),
    JSON.stringify(allFrontline),
  );

  // Case 4 — an 'Unknown' pick never fills a role and never earns "balanced"
  // (same honesty guarantee asserted for analyzeComposition in [2] above).
  const withUnknown = codesOf(analyzeDraft(allyClasses(['Tank', 'Support', 'Unknown'])).ally);
  check(
    'analyzeDraft([Tank, Support, Unknown]) ally codes === ["ally.role.missing.damage"] (never "ally.balanced")',
    sameSet(withUnknown, ['ally.role.missing.damage']),
    JSON.stringify(withUnknown),
  );

  // Cases 5-7 — picks, with the map bonus applied (see the note above).
  const analysisEnemies = ['bull', 'frank', 'rosa'];
  const picksFor = (mapId, n) =>
    formatTop(analyzeDraft(draftInput({ enemy: analysisEnemies, mapId })).picks, n);

  const noMapPicks = picksFor(null, 6);
  const noMapExpected = 'colette:3/9 gale:2/3 cordelius:1/2 shelly:1/2 chester:1/1 lou:1/1';
  check(
    `analyzeDraft(["bull","frank","rosa"], no map) top 6 === "${noMapExpected}"`,
    noMapPicks === noMapExpected,
    `got "${noMapPicks}"`,
  );

  const bridgePicks = picksFor('bridge-too-far', 4);
  const bridgeExpected = 'clancy:3/8 colette:3/7 piper:2/3 spike:1/1';
  check(
    `analyzeDraft(..., "bridge-too-far") top 4 === "${bridgeExpected}" (piper 2/3, not the bonus-free 2/2 of [7])`,
    bridgePicks === bridgeExpected,
    `got "${bridgePicks}"`,
  );

  // kaboom-canyon is absent from map-counters.json (counters fall back to the
  // global list) but PRESENT in map-index.json, so the bonus still applies —
  // the ranking is NOT the global one, and lou (1/1 -> 1/2) overtakes shelly
  // on the slug tie-break.
  const kaboomAnalysisPicks = picksFor('kaboom-canyon', 6);
  const kaboomExpected = 'colette:3/10 gale:2/4 cordelius:1/3 lou:1/2 shelly:1/2 chester:1/1';
  check(
    `analyzeDraft(..., "kaboom-canyon") top 6 === "${kaboomExpected}" (bonus survives the counters fallback)`,
    kaboomAnalysisPicks === kaboomExpected,
    `got "${kaboomAnalysisPicks}"`,
  );
  check(
    'analyzeDraft(..., "kaboom-canyon") differs from its own no-map ranking',
    kaboomAnalysisPicks !== noMapPicks,
  );

  // Case 8 — the one brawler with no counter data must not throw.
  const alliAnalysis = analyzeDraft(draftInput({ enemy: ['alli'] }));
  check('analyzeDraft({enemy: ["alli"]}) picks === []', alliAnalysis.picks.length === 0, `got ${alliAnalysis.picks.length}`);

  // Case 9 — structural invariants across a spread of inputs.
  let insightShapeOk = true;
  let insightCodesUniqueOk = true;
  const analysisSamples = [
    draftInput(),
    draftInput({ ally: ['piper', 'bull'], enemy: ['mortis'], mapId: 'shooting-star' }),
    draftInput({ ally: ['piper', 'bull', 'poco'], enemy: ['bull', 'frank', 'rosa'], mapId: 'bridge-too-far' }),
    draftInput({ enemy: ['alli'], mapId: 'kaboom-canyon' }),
    allyClasses(['Assassin', 'Assassin', 'Tank']),
    // Same draft with a name source, so the named wording is exercised too.
    { ...draftInput({ ally: ['bull', 'poco', 'piper'], enemy: ['bull', 'frank', 'rosa'], mapId: 'bridge-too-far' }), nameOf: (slug) => bySlug[slug]?.name ?? slug },
  ];
  for (const input of analysisSamples) {
    const result = analyzeDraft(input);
    for (const section of [result.ally, result.enemy]) {
      for (const insight of section) {
        if (!insight.code || !insight.text) insightShapeOk = false;
        if (!['good', 'warn', 'info'].includes(insight.tone)) insightShapeOk = false;
      }
      const codes = codesOf(section);
      if (new Set(codes).size !== codes.length) insightCodesUniqueOk = false;
    }
  }
  check('every insight has a non-empty code, non-empty text, and a valid tone', insightShapeOk);
  check('insight codes are unique within their section', insightCodesUniqueOk);

  // `nameOf` is optional: supplying it must put real display names in the
  // text, and omitting it must still produce a complete, name-free sentence.
  const counterableText = (input) =>
    analyzeDraft(input).enemy.find((i) => i.code === 'enemy.counterable')?.text ?? '';
  const namedInput = {
    ...draftInput({ enemy: analysisEnemies }),
    nameOf: (slug) => bySlug[slug]?.name ?? slug,
  };
  const namedText = counterableText(namedInput);
  const anonymousText = counterableText(draftInput({ enemy: analysisEnemies }));
  check(
    'enemy.counterable names the counter and its targets when nameOf is supplied',
    namedText.includes('Colette') && namedText.includes('Bull') && namedText.includes('Frank'),
    `got "${namedText}"`,
  );
  check(
    'enemy.counterable falls back to a name-free sentence without nameOf',
    anonymousText.length > 0 && !anonymousText.includes('Colette'),
    `got "${anonymousText}"`,
  );

  // --- Summary ---
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
