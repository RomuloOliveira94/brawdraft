export const MANUAL_ALIASES = {
  // formerly counters.txt (5) — that source is retired (see meta.txt below),
  // kept here since maps.txt/meta.txt could plausibly hit the same typos;
  // _report.json's unusedManualAliases flags them if they never fire again.
  'miple':    'meeple',      // typo; appears as a key AND as a value (Meg, 8-Bit)
  'gail':     'gale',        // key "Gail (Gale)"; value in 22 entries
  'odie':     'ollie',       // key "Odie (Ollie)"
  'perola':   'pearl',       // PT-BR parenthetical in "Pearl (Pérola)"
  'mo':       'moe',         // parenthetical in "Moe (Mo)"

  // maps.txt (15)
  'corvo':    'crow',        'corv':     'crow',
  'colete':   'colette',     'starnova': 'starr-nova',
  'peny':     'penny',       'byro':     'byron',
  'maise':    'maisie',      'chunk':    'trunk',
  'pearce':   'pierce',      'ali':      'alli',
  'jaeyoung': 'jae-yong',    'melody':   'melodie',
  'daryl':    'darryl',      'ruff':     'ruffs',
  'zyggy':    'ziggy',
};

// 'watts' and 'lancadores' (counters.txt's Damian/Shelly class-not-brawler
// drops) were retired along with counters.txt/parse-counters.mjs — meta.txt
// fixed both entries upstream (Damian: gale/surge/clancy; Shelly:
// piper/spike/gale) and never emits either token.
export const DROP_TOKENS = new Set([
  'lol', // maps.txt L68 — junk token
]);

export const ORPHAN_CATEGORY_FIXES = { 'undermine': 'Carregadores das gemas' };

// meta.txt (5) — typo fixes scoped to that single source file, kept out of
// MANUAL_ALIASES on purpose: 'pipe' in particular is a common English word
// (truncated from "Piper" only in meta.txt's 8-Bit/Out in the Open line) and
// must never leak into parse-counters.mjs/parse-maps.mjs token resolution.
export const META_TYPO_FIXES = {
  'jessi':  'jessie',   // meta.txt: every Open Business line (50 hits)
  'jackie': 'jacky',    // meta.txt: every Sneaky Fields line (8 hits)
  'otiz':   'otis',     // meta.txt: Damian/Deathcap Trap line (1 hit)
  'sprou':  'sprout',   // meta.txt: 8-Bit/Belles Rock line, truncated name (1 hit)
  'pipe':   'piper',    // meta.txt: 8-Bit/Out in the Open line, truncated name (1 hit)
};

// meta.txt's 25 per-map line labels are map names, except "Hot Zone" — that's
// the *game mode* name, not a map. The other three Hot-Zone-mode maps
// (Parallel Plays, Ring of Fire, Open Business) already appear under their
// real names; Dueling Beetles is the only Hot-Zone-mode map with no line of
// its own, so "Hot Zone" is inferred to mean Dueling Beetles here.
export const META_MAP_OVERRIDES = {
  'hotzone': 'Dueling Beetles',
};

// normKey(raw heading) -> display label. Derived from data/raw/maps.txt; any
// heading whose normKey is missing here must throw in parseMaps rather than
// silently falling back, so this table stays authoritative and complete.
export const CATEGORY_LABELS = {
  '1escolha': '1ª Escolha',
  '6escolha': '6ª Escolha',
  'antitank': 'Anti-tank',
  'zonetime': 'Zone Time',
  'pressao': 'Pressão',
  'bralwersdepressao': 'Pressão', // typo "Bralwers" in source
  'atiradores': 'Atiradores',
  'agressivos': 'Agressivos',
  'flex': 'Flex',
  'flexatiradores': 'Flex — Atiradores',
  'flexcontrole': 'Flex — Controle',
  'suportedano': 'Suporte / Dano',
  'longoalcancesuporte': 'Longo Alcance / Suporte',
  'carregadoresdasgemas': 'Carregadores de Gemas',
  'defensor': 'Defensor',
  'safedano': 'Safe Dano',
  'mid': 'Mid',
  'finaldojogo': 'Final do Jogo',
  'defensivozone': 'Zone Defensivo',
  'offensivozone': 'Zone Ofensivo',
  'ambasaszonas': 'Ambas as Zonas',
  'outros': 'Outros Picks',
  'outrospicks': 'Outros Picks',
};

export const CATEGORY_ORDER = [
  '1escolha', '6escolha',
  'antitank', 'zonetime', 'pressao', 'bralwersdepressao',
  'atiradores', 'agressivos',
  'flex', 'flexatiradores', 'flexcontrole',
  'suportedano', 'longoalcancesuporte', 'carregadoresdasgemas',
  'mid', 'defensor', 'safedano',
  'defensivozone', 'offensivozone', 'ambasaszonas',
  'finaldojogo',
  'outros', 'outrospicks',
];
