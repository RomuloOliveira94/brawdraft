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

/**
 * BrawlAPI reports `class.name === "Unknown"` for a growing subset of the
 * roster (20 of 107 as of 2026-07-27) — these are real, released brawlers;
 * BrawlAPI just hasn't backfilled their class tag. A wrong class here is
 * worse than "Unknown" (it drives confident, wrong draft advice in
 * src/lib/composition.ts), so every entry below was hand-verified against a
 * real fetched source, not recalled from memory, and is applied ONLY when
 * the API itself says "Unknown" (see fetchBrawlerRoster) — if BrawlAPI ever
 * starts reporting a real class for one of these, the API's value wins and
 * this entry simply stops being read.
 *
 * Sources tried, in the order the task recommended:
 *   - brawlify.com (web pages) and api.brawlify.com: Cloudflare 403 from
 *     this build environment for every URL shape tried (/brawlers/detail/X,
 *     /brawlers/<id>). Not usable.
 *   - Brawl Stars Fandom wiki, Liquipedia: also blocked (403, or 402 via the
 *     fetch tool) from this environment. Not usable.
 *   - Landed on two independent, reachable, third-party stat trackers that
 *     each publish a per-brawler class/role field sourced from the game's
 *     own data: metaforge.app (MF) and brawlmetrics.gg (BM). Every entry
 *     below was cross-checked on BOTH sites and they agreed in every case;
 *     both quotes are kept in the comment for auditability. Both fetched
 *     2026-07-27.
 *     MF = https://metaforge.app/brawlstars/brawlers/<slug> — page's
 *          embedded JSON has a literal `class:"<CLASS>"` field.
 *     BM = https://brawlmetrics.gg/brawlers/<slug> — brawler portrait has
 *          `alt="<Name> - <Rarity> <Class> brawler in Brawl Stars"`.
 *   - Cross-checked (not cited as primary) against BrawlAPI's own
 *     description/stats for internal consistency, e.g. Damian/Trunk/Ollie's
 *     unusually high `health` figures line up with a Tank tag; Kaze's "deadly
 *     ninja" flavor text lines up with Assassin. No contradictions found.
 *
 * `buzz-lightyear` is deliberately absent from this table: he's a
 * time-limited Toy Story collab brawler that neither MF nor BM lists at all
 * (checked their full roster listing pages, not just the direct URL), and
 * every wiki-style source above was unreachable. No fetchable source to cite
 * with confidence, so he stays "Unknown" per project policy.
 */
const CLASS_OVERRIDES = {
  wendy: 'Support', // MF class:"SUPPORT"; BM alt="Wendy - Mythic Support brawler in Brawl Stars"
  nori: 'Assassin', // MF class:"ASSASSIN"; BM alt="Nori - Legendary Assassin brawler in Brawl Stars"
  bolt: 'Tank', // MF class:"TANK"; BM alt="Bolt - Epic Tank brawler in Brawl Stars"
  'starr-nova': 'Assassin', // MF class:"ASSASSIN"; BM alt="Starr Nova - Mythic Assassin brawler in Brawl Stars"
  damian: 'Tank', // MF class:"TANK"; BM alt="Damian - Mythic Tank brawler in Brawl Stars"
  najia: 'Damage Dealer', // MF class:"DAMAGE DEALER"; BM alt="Najia - Mythic Damage Dealer brawler in Brawl Stars"
  sirius: 'Controller', // MF class:"CONTROLLER"; BM alt="Sirius - Ultra Legendary Controller brawler in Brawl Stars"
  glowy: 'Support', // MF class:"SUPPORT"; BM alt="Glowy - Mythic Support brawler in Brawl Stars"
  gigi: 'Assassin', // MF class:"ASSASSIN"; BM alt="Gigi - Mythic Assassin brawler in Brawl Stars"
  pierce: 'Marksman', // MF class:"MARKSMAN"; BM alt="Pierce - Legendary Marksman brawler in Brawl Stars"
  ziggy: 'Controller', // MF class:"CONTROLLER"; BM alt="Ziggy - Mythic Controller brawler in Brawl Stars"
  mina: 'Damage Dealer', // MF class:"DAMAGE DEALER"; BM alt="Mina - Mythic Damage Dealer brawler in Brawl Stars"
  trunk: 'Tank', // MF class:"TANK"; BM alt="Trunk - Epic Tank brawler in Brawl Stars"
  alli: 'Assassin', // MF class:"ASSASSIN"; BM alt="Alli - Mythic Assassin brawler in Brawl Stars"
  kaze: 'Assassin', // MF class:"ASSASSIN"; BM alt="Kaze - Ultra Legendary Assassin brawler in Brawl Stars"
  'jae-yong': 'Support', // MF class:"SUPPORT"; BM alt="Jae-Yong - Mythic Support brawler in Brawl Stars"
  finx: 'Controller', // MF class:"CONTROLLER"; BM alt="Finx - Mythic Controller brawler in Brawl Stars"
  ollie: 'Tank', // MF class:"TANK"; BM alt="Ollie - Mythic Tank brawler in Brawl Stars"
  meeple: 'Controller', // MF class:"CONTROLLER"; BM alt="Meeple - Epic Controller brawler in Brawl Stars"
};

/**
 * Brawlers intentionally excluded from this app's roster even though
 * BrawlAPI still lists them — the single choke point for "this brawler
 * doesn't exist in BrawDraft" (picker, brawlers list, per-brawler page
 * generation, images, all read from the roster this function returns).
 *
 * `buzz-lightyear`: a time-limited Toy Story collab brawler with zero
 * counter or map data anywhere in this project's sources (data/raw/meta.txt,
 * meta-extra.txt, maps.txt all never mention him — see CLASS_OVERRIDES'
 * comment above for why even his class was never resolvable) and no
 * realistic path to getting any before the collab rotates out. Roster:
 * 107 -> 106.
 */
const REMOVED_BRAWLERS = new Set(['buzz-lightyear']);

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
  let overridesApplied = 0;
  let removedCount = 0;

  for (const b of list) {
    const slug = slugify(b.name);
    const key = normKey(b.name);

    if (REMOVED_BRAWLERS.has(slug)) {
      removedCount++;
      continue;
    }

    if (seenSlugs.has(slug)) {
      throw new Error(`duplicate brawler slug "${slug}" for "${b.name}" and "${seenSlugs.get(slug)}"`);
    }
    if (seenNormKeys.has(key)) {
      throw new Error(`duplicate brawler normKey "${key}" for "${b.name}" and "${seenNormKeys.get(key)}"`);
    }
    seenSlugs.set(slug, b.name);
    seenNormKeys.set(key, b.name);

    // Only ever override an API-reported "Unknown" — a real class from the
    // API always wins, so a future BrawlAPI fix silently retires the entry.
    let className = b.class.name;
    if (className === 'Unknown' && Object.prototype.hasOwnProperty.call(CLASS_OVERRIDES, slug)) {
      className = CLASS_OVERRIDES[slug];
      overridesApplied++;
    }

    brawlers.push({
      id: slug,
      brawlerId: b.id,
      name: b.name,
      className,
      rarity: b.rarity.name,
      rarityColor: sanitizeHexColor(b.rarity.color, `brawler "${b.name}" rarity "${b.rarity.name}"`),
      released: b.released,
      image: `/brawlers/${slug}.png`,
    });
  }

  console.log(`[brawlers] ${overridesApplied} CLASS_OVERRIDES applied`);
  console.log(`[brawlers] ${removedCount} REMOVED_BRAWLERS excluded (${[...REMOVED_BRAWLERS].join(', ')})`);

  const staleOverrideKeys = Object.keys(CLASS_OVERRIDES).filter(
    (slug) => !seenSlugs.has(slug) && !REMOVED_BRAWLERS.has(slug),
  );
  for (const slug of staleOverrideKeys) {
    console.warn(`[brawlers] WARNING: CLASS_OVERRIDES key "${slug}" does not match any current roster brawler (renamed or removed?)`);
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
