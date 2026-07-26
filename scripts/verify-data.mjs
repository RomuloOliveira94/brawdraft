// Standalone post-build assertions (independent of build-data.mjs's own
// integrity gate) covering: image presence/validity, slug resolution across
// every generated index, map API metadata completeness, exact drop/gap
// lists, and the golden ranking cases. Exits non-zero on first failure.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rankPicks } from '../src/lib/rank.ts';

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
  const report = await readJson(path.join(ROOT, 'src/data/_report.json'));

  const slugSet = new Set(brawlers.map((b) => b.id));
  const bySlug = Object.fromEntries(brawlers.map((b) => [b.id, b]));

  // --- 1. Images ---
  console.log('\n[1] Images');
  check('brawlers.json.length === 107', brawlers.length === 107, `got ${brawlers.length}`);

  const brawlerFiles = await pngFiles(path.join(ROOT, 'public/brawlers'));
  let allBrawlerPngsOk = brawlerFiles.length === 107;
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

  // --- 2. No unresolved slug anywhere ---
  console.log('\n[2] Slug resolution');
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
  check('93 counters | 26 mapas | 133 categorias', countersEntryCount === 93 && maps.length === 26 && categoryCount === 133);

  // --- 3. All 26 maps carry API metadata ---
  console.log('\n[3] Map API metadata');
  let mapMetadataOk = true;
  for (const m of maps) {
    if (!m.mapApiId || !m.gameMode?.name || !m.image) mapMetadataOk = false;
    console.log(`  ${m.name} -> ${m.mapApiId} (${m.gameMode?.name})`);
  }
  check('all 26 maps have mapApiId, gameMode.name, image', mapMetadataOk && maps.length === 26);

  // --- 4. Exact drops and gaps ---
  console.log('\n[4] Exact drops and gaps');
  const droppedKeysSorted = report.dropped.keys.map((d) => d.raw).sort();
  check(
    "dropped keys sorted === ['Watts']",
    deepEqualArrays(droppedKeysSorted, ['Watts']),
    JSON.stringify(droppedKeysSorted),
  );

  const droppedValuesSorted = report.dropped.values.map((d) => d.raw).sort();
  check(
    "dropped values sorted === ['LOL','Lançadores','Watts']",
    deepEqualArrays(droppedValuesSorted, ['LOL', 'Lançadores', 'Watts']),
    JSON.stringify(droppedValuesSorted),
  );

  const expectedNoCounters = [
    'alli', 'buzz-lightyear', 'doug', 'finx', 'gene', 'gigi', 'glowy',
    'jae-yong', 'kaze', 'lola', 'mina', 'shade', 'sirius', 'trunk',
  ].sort();
  const actualNoCounters = brawlers.filter((b) => !b.hasCounters).map((b) => b.id).sort();
  check(
    'brawlers with hasCounters === false sorted === the exact 14-slug list',
    deepEqualArrays(actualNoCounters, expectedNoCounters),
    JSON.stringify(actualNoCounters),
  );

  const goldenCounters = {
    spike: ['piper', 'mandy', 'mr-p'],
    shelly: ['nita', 'meg'],
    damian: ['surge', 'edgar'],
    '8-bit': ['pierce', 'meeple', 'piper'],
    mortis: ['gale', 'surge', 'bull'],
  };
  for (const [slug, expected] of Object.entries(goldenCounters)) {
    const actual = (bySlug[slug]?.counters ?? []).map((c) => c.slug);
    check(`${slug} counters === ${JSON.stringify(expected)}`, deepEqualArrays(actual, expected), JSON.stringify(actual));
  }

  // --- 5. Golden ranking cases ---
  console.log('\n[5] Golden ranking cases');
  const countersIndexForRank = countersIndex;

  function formatTop(picks, n) {
    return picks.slice(0, n).map((p) => `${p.slug}:${p.coverage}/${p.score}`).join(' ');
  }

  const goldenRanking = [
    { enemies: ['bull', 'frank', 'rosa'], expected: 'colette:3/9 gale:2/4 clancy:2/2 shelly:1/2 chester:1/1' },
    { enemies: ['edgar', 'mortis', 'buzz'], expected: 'gale:3/8 surge:3/5 bull:2/2 otis:1/3' },
    { enemies: ['piper', 'brock', 'nani'], expected: 'mandy:2/3 leon:2/2 max:1/2' },
    { enemies: ['kaze'], expected: '' },
  ];

  for (const { enemies, expected } of goldenRanking) {
    const picks = rankPicks(enemies, countersIndexForRank);
    const n = expected ? expected.split(' ').length : 0;
    const actual = formatTop(picks, n);
    check(`rankPicks(${JSON.stringify(enemies)}) top ${n || 0} === "${expected}"`, actual === expected, `got "${actual}"`);
  }

  // --- Summary ---
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
