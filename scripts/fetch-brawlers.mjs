// Fetches the brawler roster + brawler images from the BrawlAPI, and the map
// metadata + map/game-mode images needed for the 26 maps covered by
// data/raw/maps.txt. Writes:
//   - src/data/brawlers.json         (base roster; build-data.mjs enriches it later)
//   - src/data/_map-metadata.json    (internal: resolved API metadata for the 26 maps,
//                                     keyed by normKey(name) — consumed by build-data.mjs)
//   - public/brawlers/<slug>.png     (107)
//   - public/maps/<slug>.png         (26)
//   - public/game-modes/<slug>.png   (6)
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { slugify, normKey } from './lib/normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const UA = 'brawdraft-build/1.0';
const BRAWLERS_API = 'https://api.brawlapi.com/v1/brawlers';
const MAPS_API = 'https://api.brawlapi.com/v1/maps';
const MAPS_RAW_FILE = path.join(ROOT, 'data/raw/maps.txt');

const BRAWLERS_JSON = path.join(ROOT, 'src/data/brawlers.json');
const MAP_METADATA_JSON = path.join(ROOT, 'src/data/_map-metadata.json');

const BRAWLERS_DIR = path.join(ROOT, 'public/brawlers');

const MIN_IMAGE_BYTES = 1024;
const RETRY_DELAYS_MS = [500, 1500, 4000];
const CONCURRENCY = 6;

// Same shape as parse-maps.mjs's TITLE detection: "Name (namePt)". Only the 26
// map-title lines in maps.txt contain parentheses, so this alone is enough to
// list the maps we need to fetch metadata/images for.
const TITLE_RE = /^(.*?)\s*\((.*)\)\s*$/;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  return res.json();
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * BrawlAPI has a known data bug: every "Legendary" rarity entry reports
 * color "#fff11ev" (a stray trailing "v" on an otherwise-valid hex color).
 * Truncate to the valid 6-hex-digit prefix rather than shipping malformed
 * color data into src/data/brawlers.json (content.config.ts's zod schema
 * requires a strict 6-hex-digit color and will fail the build otherwise).
 */
function sanitizeHexColor(raw, context) {
  if (HEX_COLOR_RE.test(raw)) return raw;
  const truncated = raw.match(/^#[0-9a-fA-F]{6}/)?.[0];
  if (!truncated) {
    throw new Error(`unrecoverable rarity color "${raw}" for ${context}`);
  }
  return truncated;
}

function extractMapTitles(rawText) {
  const titles = [];
  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = TITLE_RE.exec(trimmed);
    if (m) titles.push({ name: m[1].trim(), namePt: m[2].trim() });
  }
  return titles;
}

/**
 * Prefer disabled === false, then the lowest id (the original/primary entry).
 *
 * Deviation from a naive "highest id wins" tie-break: 25 of the 26 target maps
 * have exactly one non-disabled candidate, so the tie-break never fires for
 * them either way. "Flaring Phoenix" is the sole exception — BrawlAPI carries
 * TWO non-disabled entries for it (id 15000440 / Knockout and id 15000459 /
 * Duels), because the Duels mode reuses existing map layouts under new ids.
 * Picking the highest id would tag it "Duels", which contradicts (a) this
 * project's own verified fact that only 6 game modes appear across the 26
 * maps (Bounty, Brawl Ball, Gem Grab, Heist, Hot Zone, Knockout — no Duels),
 * and (b) the raw data itself, where Flaring Phoenix shares an identical
 * category set with three confirmed Knockout maps (Belles Rock, New
 * Horizons, Out in the open). The lowest-id (first-introduced) entry is the
 * map's primary/original mode assignment.
 */
function pickBestMapEntry(entries) {
  const nonDisabled = entries.filter((e) => e.disabled === false);
  const pool = nonDisabled.length ? nonDisabled : entries;
  return pool.reduce((best, cur) => (cur.id < best.id ? cur : best));
}

async function runWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

async function fileIsGoodEnough(dest) {
  try {
    const s = await stat(dest);
    return s.isFile() && s.size > MIN_IMAGE_BYTES;
  } catch {
    return false;
  }
}

/**
 * Downloads a single image with retries + atomic write.
 * Returns { status: 'skipped' | 'downloaded' | 'failed', dest, url, error? }.
 */
async function downloadImage(url, dest) {
  if (await fileIsGoodEnough(dest)) {
    return { status: 'skipped', dest, url };
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length <= MIN_IMAGE_BYTES) {
        throw new Error(`downloaded image too small (${buf.length} bytes)`);
      }
      await writeFile(tmp, buf);
      await rename(tmp, dest);
      return { status: 'downloaded', dest, url };
    } catch (err) {
      if (attempt === RETRY_DELAYS_MS.length) {
        return { status: 'failed', dest, url, error: err.message };
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  // unreachable
  return { status: 'failed', dest, url, error: 'unknown' };
}

async function downloadAll(jobs, label) {
  const results = await runWithConcurrency(jobs, (job) => downloadImage(job.url, job.dest), CONCURRENCY);
  const failed = results.filter((r) => r.status === 'failed');
  const downloaded = results.filter((r) => r.status === 'downloaded').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  console.log(`[${label}] skipped ${skipped} / downloaded ${downloaded} / failed ${failed.length}`);
  if (failed.length) {
    console.error(`[${label}] failed downloads:`);
    for (const f of failed) console.error(`  ${f.url} -> ${f.dest}: ${f.error}`);
  }
  return failed;
}

async function fetchBrawlerRoster() {
  const data = await fetchJson(BRAWLERS_API);
  const list = data.list;
  if (!Array.isArray(list) || list.length < 100) {
    throw new Error(`expected >=100 brawlers, got ${Array.isArray(list) ? list.length : typeof list}`);
  }

  const brawlers = [];
  const seenSlugs = new Map();
  const seenNormKeys = new Map();

  for (const b of list) {
    const slug = slugify(b.name);
    const key = normKey(b.name);

    if (seenSlugs.has(slug)) {
      throw new Error(`duplicate brawler slug "${slug}" for "${b.name}" and "${seenSlugs.get(slug)}"`);
    }
    if (seenNormKeys.has(key)) {
      throw new Error(`duplicate brawler normKey "${key}" for "${b.name}" and "${seenNormKeys.get(key)}"`);
    }
    seenSlugs.set(slug, b.name);
    seenNormKeys.set(key, b.name);

    brawlers.push({
      id: slug,
      brawlerId: b.id,
      name: b.name,
      className: b.class.name,
      rarity: b.rarity.name,
      rarityColor: sanitizeHexColor(b.rarity.color, `brawler "${b.name}" rarity "${b.rarity.name}"`),
      released: b.released,
      image: `/brawlers/${slug}.png`,
    });
  }

  return brawlers;
}

async function fetchMapMetadata() {
  const rawText = await readFile(MAPS_RAW_FILE, 'utf8');
  const titles = extractMapTitles(rawText);

  const data = await fetchJson(MAPS_API);
  const list = data.list;
  if (!Array.isArray(list) || list.length < 100) {
    throw new Error(`expected a large map list from ${MAPS_API}, got ${Array.isArray(list) ? list.length : typeof list}`);
  }

  const byNormName = new Map();
  for (const entry of list) {
    const key = normKey(entry.name);
    if (!byNormName.has(key)) byNormName.set(key, []);
    byNormName.get(key).push(entry);
  }

  const metadata = {};
  const misses = [];
  for (const { name } of titles) {
    const key = normKey(name);
    const candidates = byNormName.get(key);
    if (!candidates || candidates.length === 0) {
      misses.push(name);
      continue;
    }
    const best = pickBestMapEntry(candidates);
    metadata[key] = {
      mapApiId: best.id,
      name: best.name,
      environment: best.environment?.name ?? 'Unknown',
      link: best.link,
      image: `/maps/${slugify(name)}.png`,
      imageUrl: best.imageUrl,
      gameMode: {
        name: best.gameMode.name,
        color: best.gameMode.color,
        bgColor: best.gameMode.bgColor,
        image: `/game-modes/${slugify(best.gameMode.name)}.png`,
        imageUrl: best.gameMode.imageUrl,
      },
    };
  }

  if (misses.length) {
    throw new Error(`no BrawlAPI map metadata match for: ${misses.join(', ')} (expected 26/26 to match)`);
  }

  console.log(`[maps] matched ${titles.length}/${titles.length} map titles to BrawlAPI metadata`);
  return { titles, metadata };
}

async function main() {
  await mkdir(path.dirname(BRAWLERS_JSON), { recursive: true });

  console.log('Fetching brawler roster...');
  const brawlers = await fetchBrawlerRoster();
  console.log(`[brawlers] ${brawlers.length} brawlers fetched`);

  console.log('Fetching map metadata...');
  const { metadata } = await fetchMapMetadata();

  // --- Download brawler images ---
  const brawlerJobs = brawlers.map((b) => ({
    url: `https://cdn.brawlify.com/brawlers/borderless/${b.brawlerId}.png`,
    dest: path.join(BRAWLERS_DIR, `${b.id}.png`),
  }));
  const brawlerFailures = await downloadAll(brawlerJobs, 'brawlers');

  // --- Download map images ---
  const mapJobs = Object.values(metadata).map((m) => ({
    url: m.imageUrl,
    dest: path.join(ROOT, 'public', m.image),
  }));
  const mapFailures = await downloadAll(mapJobs, 'maps');

  // --- Download distinct game-mode images ---
  const modeByFile = new Map();
  for (const m of Object.values(metadata)) {
    const dest = path.join(ROOT, 'public', m.gameMode.image);
    if (!modeByFile.has(dest)) modeByFile.set(dest, m.gameMode.imageUrl);
  }
  const modeJobs = [...modeByFile.entries()].map(([dest, url]) => ({ url, dest }));
  const modeFailures = await downloadAll(modeJobs, 'game-modes');

  const allFailures = [...brawlerFailures, ...mapFailures, ...modeFailures];
  if (allFailures.length) {
    console.error(`\n${allFailures.length} image download(s) failed. Aborting.`);
    process.exit(1);
  }

  // Strip the raw imageUrl fields before writing (internal fetch detail only).
  const cleanMetadata = {};
  for (const [key, m] of Object.entries(metadata)) {
    const { imageUrl, gameMode, ...rest } = m;
    cleanMetadata[key] = {
      ...rest,
      gameMode: { name: gameMode.name, color: gameMode.color, bgColor: gameMode.bgColor, image: gameMode.image },
    };
  }

  await writeFile(BRAWLERS_JSON, JSON.stringify(brawlers, null, 2) + '\n');
  await writeFile(MAP_METADATA_JSON, JSON.stringify(cleanMetadata, null, 2) + '\n');

  console.log(`\nWrote ${BRAWLERS_JSON} (${brawlers.length} brawlers)`);
  console.log(`Wrote ${MAP_METADATA_JSON} (${Object.keys(cleanMetadata).length} maps)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
