export const MANUAL_ALIASES = {
  // counters.txt (5)
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

export const DROP_TOKENS = new Set([
  'lancadores', // counters.txt Shelly: "Nita, Meg ou Lançadores" — a CLASS (throwers), not a brawler
  'lol',        // maps.txt L68 — junk token
  'watts',      // not in the 107-brawler roster — see A.3
]);

// Stripped literally from counters.txt before parsing. Exactly 4, no separators —
// each is glued directly to the next brawler key (Damian, Jacky, Najia, Sam).
export const SECTION_HEADERS = [
  '🅱️ Letras D, E, F, G e H',
  '🅲 Letras J, K, L e M',
  '🅳 Letras N, O, P e R',
  '🅴 Letras S, T, W, Z e novos adicionados',
];

export const ORPHAN_CATEGORY_FIXES = { 'undermine': 'Carregadores das gemas' };

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
