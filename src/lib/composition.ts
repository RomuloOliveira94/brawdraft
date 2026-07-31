// Draft composition analysis.
//
// `analyzeComposition` is the original ally-only helper (className values in,
// pt-BR bullet strings out). `analyzeDraft` below is the full-draft engine
// behind the "Análise de Composição" card — allies, enemies and map in, a
// structured DraftAnalysis out.
//
// Kept erasable-syntax-only (no enum, namespace, or parameter properties) for
// the same reason as rank.ts: scripts/verify-data.mjs imports this module
// directly under Node's native TypeScript type-stripping, with no build step.

import { rankPicks } from './rank.ts';
import type { CountersIndex, MapBonus, Pick } from './rank.ts';

export type BrawlerClassName =
  | 'Artillery'
  | 'Assassin'
  | 'Controller'
  | 'Damage Dealer'
  | 'Marksman'
  | 'Support'
  | 'Tank'
  | 'Unknown';

const TEAM_SIZE = 3;

/**
 * Analyzes the ally team's picked classes and returns pt-BR composition
 * warnings. When the team is full (3 picks) and nothing else fired, returns
 * a single "balanced" message instead of an empty list.
 */
export function analyzeComposition(classNames: BrawlerClassName[]): string[] {
  if (classNames.length === 0) return [];

  const has = (className: BrawlerClassName) => classNames.includes(className);
  const count = (className: BrawlerClassName) =>
    classNames.filter((c) => c === className).length;

  const tips: string[] = [];

  if (!has('Tank')) tips.push('Falta tanque para frontline');
  if (!has('Support') && !has('Controller')) tips.push('Bom suporte é necessário');
  if (!has('Marksman') && !has('Artillery')) tips.push('Falta alcance longo');
  if (count('Assassin') >= 2) tips.push('Time muito agressivo — considere um pick de controle');

  // Safe even when the team still holds an 'Unknown' pick (e.g. a brawler
  // BrawlAPI hasn't classified yet): 'Unknown' never satisfies any has()/
  // count() check above, so it can never earn credit for a category it
  // isn't actually known to fill. With TEAM_SIZE === 3, reaching this branch
  // (all 4 gap checks passed) requires 3 pairwise-disjoint category slots —
  // Tank, Support|Controller, Marksman|Artillery — to each be positively
  // confirmed, which needs 3 non-Unknown picks. A team with 1+ 'Unknown'
  // therefore always has an unmet category and some tip above always fires
  // first; 'Composição equilibrada' is never claimed over data we don't have.
  if (tips.length === 0 && classNames.length >= TEAM_SIZE) {
    tips.push('Composição equilibrada');
  }

  return tips;
}

// --- Full-draft analysis ----------------------------------------------------

/** The three jobs a team needs covered. */
export type Role = 'frontline' | 'damage' | 'support';

/**
 * Tank/Assassin hold the front, Marksman/Artillery/Damage Dealer deal damage,
 * Support/Controller sustain. 'Unknown' maps to null and can never fill a
 * role — the same honesty rule analyzeComposition follows above: a class we
 * don't know must never earn credit for a job it isn't confirmed to do.
 */
const ROLE_BY_CLASS: Record<BrawlerClassName, Role | null> = {
  Tank: 'frontline',
  Assassin: 'frontline',
  Marksman: 'damage',
  Artillery: 'damage',
  'Damage Dealer': 'damage',
  Support: 'support',
  Controller: 'support',
  Unknown: null,
};

const ROLES: Role[] = ['frontline', 'damage', 'support'];

/** Short pt-BR name for a role, for interpolation into insight text. */
const ROLE_GAP: Record<Role, string> = {
  frontline: 'linha de frente',
  damage: 'dano',
  support: 'suporte',
};

export type InsightTone = 'good' | 'warn' | 'info';

export interface Insight {
  /** Stable key (e.g. 'ally.role.missing.frontline'). The test contract — UI
   *  copy can be reworded without breaking verify-data.mjs. Unique per section. */
  code: string;
  /** Ready-to-render pt-BR text. */
  text: string;
  tone: InsightTone;
  /** Slugs this insight is about, for portrait rendering. */
  refs?: string[];
}

/** A rankPicks result plus the textual reason for its role bonus, when any. */
export interface SuggestedPick extends Pick {
  roleReason?: string;
}

export interface DraftAnalysis {
  ally: Insight[];
  enemy: Insight[];
  /** COMPLETE list, in rankPicks order. Display truncation belongs to the renderer. */
  picks: SuggestedPick[];
}

export interface DraftInput {
  /** Ally slugs already picked, no nulls. 0..3. */
  ally: string[];
  /** Enemy slugs already picked, no nulls. 0..3. */
  enemy: string[];
  /** Selected map, or null. Used as a flag and for insight text. */
  mapId: string | null;
  /** slug -> className. Built once at init from the DOM's data-class-name. */
  classOf: ReadonlyMap<string, BrawlerClassName>;
  /** Global counters: counters-index.json. */
  countersIndex: CountersIndex;
  /** Selected map's counters: map-counters.json[mapId], or null. */
  mapCounters: CountersIndex | null;
  /** Selected map's categories by slug: map-index.json[mapId], or null. */
  mapCategories: Record<string, string[]> | null;
  /** Slugs to never suggest (picks + bans of both teams). */
  exclude: string[];
  /**
   * Resolves a slug to its display name. Optional on purpose: when it's
   * absent every insight falls back to an equivalent name-free wording, so
   * callers that don't have a name source (scripts/verify-data.mjs) stay
   * fixture-free and the function stays pure.
   */
  nameOf?: (slug: string) => string;
}

/** "A", "A e B", "A, B e C" — pt-BR list joining. */
function joinPtBr(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/** Counts how many of `slugs` fill each role. Unknown/unmapped slugs count for none. */
function countRoles(slugs: string[], classOf: ReadonlyMap<string, BrawlerClassName>): Map<Role, number> {
  const counts = new Map<Role, number>();
  for (const slug of slugs) {
    const className = classOf.get(slug);
    const role = className ? ROLE_BY_CLASS[className] : null;
    if (role) counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return counts;
}

/**
 * Analyzes a whole draft: ally synergy, enemy weaknesses, and ranked picks for
 * the remaining slots.
 *
 * Pure — no DOM, no imports of data, no state. Everything arrives through
 * `input`, which is what lets scripts/verify-data.mjs exercise it directly.
 *
 * Per-map slices (`mapCounters`, `mapCategories`) arrive already scoped to
 * `mapId`, mirroring how rankPicks is called today; `mapId` itself is only a
 * "is a map selected?" flag here.
 */
export function analyzeDraft(input: DraftInput): DraftAnalysis {
  const { ally, enemy, classOf, countersIndex, mapCounters, mapCategories, exclude, nameOf } = input;

  /** Names for a slug list, or '' when no name source was supplied. */
  const names = (slugs: string[]): string => (nameOf ? joinPtBr(slugs.map(nameOf)) : '');

  const ally_: Insight[] = [];
  const enemy_: Insight[] = [];

  // --- Ally synergy ---
  const allyRoles = countRoles(ally, classOf);
  const missingAllyRoles: Role[] = [];

  if (ally.length === 0) {
    ally_.push({
      code: 'ally.empty',
      text: 'Escolha brawlers para o seu time para ver a análise.',
      tone: 'info',
    });
  } else {
    for (const role of ROLES) {
      if ((allyRoles.get(role) ?? 0) === 0) {
        missingAllyRoles.push(role);
        ally_.push({
          code: `ally.role.missing.${role}`,
          text: `Falta ${ROLE_GAP[role]} no seu time.`,
          tone: 'warn',
        });
      }
    }

    // Only at a full team: 3 picks all doing the same job.
    for (const role of ROLES) {
      if (ally.length === TEAM_SIZE && (allyRoles.get(role) ?? 0) === TEAM_SIZE) {
        const who = names(ally);
        ally_.push({
          code: `ally.role.redundant.${role}`,
          text: who
            ? `${who} ocupam a ${ROLE_GAP[role]} — composição concentrada demais.`
            : `Os 3 picks ocupam a ${ROLE_GAP[role]} — composição concentrada demais.`,
          tone: 'warn',
          refs: [...ally],
        });
      }
    }

    // One aggregated insight, not one per brawler — codes are unique per section.
    const fitting = mapCategories ? ally.filter((slug) => mapCategories[slug]) : [];
    if (fitting.length > 0) {
      const who = names(fitting);
      const verb = fitting.length === 1 ? 'está' : 'estão';
      ally_.push({
        code: 'ally.map.fit',
        text: who
          ? `${who} ${verb} entre os recomendados deste mapa.`
          : fitting.length === 1
            ? '1 pick seu está entre os recomendados deste mapa.'
            : `${fitting.length} picks seus estão entre os recomendados deste mapa.`,
        tone: 'good',
        refs: fitting,
      });
    }

    // Only a `warn` blocks "balanced" — a `good` insight like ally.map.fit
    // coexists with it happily.
    const hasWarning = ally_.some((insight) => insight.tone === 'warn');
    if (!hasWarning && ally.length >= TEAM_SIZE) {
      ally_.push({
        code: 'ally.balanced',
        text: 'Composição equilibrada: linha de frente, dano e suporte cobertos.',
        tone: 'good',
      });
    }
  }

  // --- Picks (rankPicks, with the map bonus) ---
  const picks: SuggestedPick[] = rankPicks(enemy, countersIndex, {
    exclude,
    mapBonus: mapCategories as MapBonus | null,
    mapCounters,
  }).map((pick) => {
    const className = classOf.get(pick.slug);
    const role = className ? ROLE_BY_CLASS[className] : null;
    // Labelled bonus only: no reason, no bonus. Never a bare number.
    return role && missingAllyRoles.includes(role)
      ? { ...pick, roleReason: `também cobre a ${ROLE_GAP[role]} que falta ao seu time` }
      : pick;
  });

  // --- Enemy weaknesses ---
  if (enemy.length === 0) {
    enemy_.push({
      code: 'enemy.empty',
      text: 'Escolha brawlers do time inimigo para ver as fraquezas e os counters.',
      tone: 'info',
    });
  } else {
    const enemyRoles = countRoles(enemy, classOf);
    for (const role of ROLES) {
      if ((enemyRoles.get(role) ?? 0) === 0) {
        enemy_.push({
          code: `enemy.role.missing.${role}`,
          // Their gap is your advantage, hence the 'good' tone.
          text: `O time inimigo não tem ${ROLE_GAP[role]}.`,
          tone: 'good',
        });
      }
    }

    const best = picks.find((pick) => pick.coverage >= 2);
    if (best) {
      const bestName = nameOf ? nameOf(best.slug) : '';
      const targets = names(best.against);
      enemy_.push({
        code: 'enemy.counterable',
        text: bestName
          ? `${bestName} responde a ${best.coverage} dos ${enemy.length} inimigos: ${targets}.`
          : `O melhor counter responde a ${best.coverage} dos ${enemy.length} inimigos.`,
        tone: 'good',
        refs: [best.slug],
      });
    }
  }

  return { ally: ally_, enemy: enemy_, picks };
}
