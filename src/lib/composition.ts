// Draft composition analysis.
//
// `analyzeDraft` is the engine behind the "Análise de Composição" card —
// allies, enemies and map in, a structured DraftAnalysis out.
//
// `analyzeComposition` is the original ally-only helper it superseded
// (className values in, pt-BR bullet strings out). LEGACY / TEST-ONLY: no
// production code path calls it any more; it survives because
// scripts/verify-data.mjs [2] still pins its honesty guarantee. Removing both
// is a follow-up, not part of this feature.
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

/**
 * Definite article matching each label's gender. Without it the templates read
 * "a dano" / "a suporte" — the labels aren't all feminine like "linha de
 * frente" is.
 */
const ROLE_ARTICLE: Record<Role, string> = {
  frontline: 'a',
  damage: 'o',
  support: 'o',
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

export type Team = 'ally' | 'enemy';

/** Where the draft is in the canonical 1-2-2-1 pick order, from the ally side. */
export type DraftPhase =
  | 'opening' | 'double' | 'single' | 'closing'
  | 'waiting' | 'complete' | 'unknown';

export interface TurnState {
  phase: DraftPhase;
  /** Whose turn it is. null when complete or not derivable. */
  turn: Team | null;
  /** Picks left in the current block (1 or 2). 0 when complete/unknown. */
  remaining: number;
  /** pt-BR banner text, or null when the banner must not show. */
  text: string | null;
}

/** Counters of a candidate still available to the enemy. */
export interface Vulnerability {
  /** Counters still free — picked or banned by nobody. */
  free: string[];
  /** Known counters in total (0..3). */
  total: number;
  /** 'map' when it came from mapCounters, 'global' when it fell back. */
  source: 'map' | 'global';
}

/**
 * An opening candidate: a map recommendation, measured by exposure.
 * `SuggestedPick` deliberately gains NO vulnerability field — the opening has
 * its own pool, ordering and meaning (it counters nobody), so it gets its own
 * type and its own channel, and `picks` stays exactly the v1 contract.
 */
export interface SuggestedOpening {
  slug: string;
  /** Counters still free to the enemy. Primary sort key (ascending). */
  free: string[];
  /** Known counters in total (always > 0 — see the guard in analyzeDraft). */
  total: number;
  source: 'map' | 'global';
  /** `[slug]`, for the portrait. */
  refs: [string];
}

export interface SuggestedCombo {
  /** Both slugs, alphabetical (determinism) — and the portraits. */
  refs: [string, string];
  /** Distinct enemies the duo answers (union). */
  coverage: number;
  /** DISTINCT missing roles the duo fills (0..2). */
  roleFill: number;
  /** How many of the two are in the map's categories (0..2). */
  mapFit: number;
  /** Sum of the rankPicks scores — tie-break. */
  score: number;
  /** Ready-to-render reason. */
  reason: string;
}

export interface DraftAnalysis {
  ally: Insight[];
  enemy: Insight[];
  /** COMPLETE list, in rankPicks order. Display truncation belongs to the renderer. */
  picks: SuggestedPick[];
  /** COMPLETE duo list. Empty when fewer than 2 ally slots are open. */
  combos: SuggestedCombo[];
  /** COMPLETE opening list. Empty outside the opening phase or with no map. */
  opening: SuggestedOpening[];
  turn: TurnState;
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
  /**
   * Who picks first. Optional: without it there is no sequence to walk, so the
   * turn comes back as 'unknown' rather than throwing — which is what lets
   * every pre-turn caller keep working untouched.
   */
  firstPick?: Team;
}

/** "A", "A e B", "A, B e C" — pt-BR list joining. */
function joinPtBr(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

// --- Turn derivation -------------------------------------------------------

const UNKNOWN_TURN: TurnState = { phase: 'unknown', turn: null, remaining: 0, text: null };

/** The canonical 1-2-2-1 blocks, from whoever opens. */
function blocksFor(firstPick: Team): { team: Team; n: number }[] {
  const other: Team = firstPick === 'ally' ? 'enemy' : 'ally';
  return [
    { team: firstPick, n: 1 }, { team: other, n: 2 },
    { team: firstPick, n: 2 }, { team: other, n: 1 },
  ];
}

/**
 * Derives whose turn it is from the filled-pick counts, best-effort.
 *
 * Walks the canonical sequence accumulating picks; a state matches if it is
 * reachable — including mid-block. A state the sequence can't produce (the
 * board allows filling any slot in any order, by design) yields 'unknown',
 * never an error and never a constraint.
 */
function deriveTurn(allyCount: number, enemyCount: number, firstPick: Team | undefined): TurnState {
  if (!firstPick) return UNKNOWN_TURN;

  const blocks = blocksFor(firstPick);
  const lastBlock = blocks[blocks.length - 1];
  let a = 0;
  let b = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    for (let k = 0; k < block.n; k++) {
      if (a === allyCount && b === enemyCount) {
        const remaining = block.n - k;
        if (block.team === 'enemy') {
          return {
            phase: 'waiting',
            turn: 'enemy',
            remaining,
            text: `Vez do inimigo — aguardando ${remaining} pick${remaining > 1 ? 's' : ''}.`,
          };
        }
        // The ally's own turn: which of the four ally-side phases is it?
        const isLastPickOfDraft = i === blocks.length - 1 && lastBlock.team === 'ally' && remaining === 1;
        const phase: DraftPhase =
          i === 0 ? 'opening' : remaining === 2 ? 'double' : isLastPickOfDraft ? 'closing' : 'single';
        const text =
          phase === 'opening'
            ? 'Sua vez — abertura. O inimigo ainda fecha o draft.'
            : phase === 'closing'
              ? 'Sua vez — último pick do draft.'
              : `Sua vez — escolha ${remaining}.`;
        return { phase, turn: 'ally', remaining, text };
      }
      if (block.team === 'ally') a++;
      else b++;
    }
  }

  if (a === allyCount && b === enemyCount) {
    return { phase: 'complete', turn: null, remaining: 0, text: 'Draft completo.' };
  }
  return UNKNOWN_TURN;
}

// --- Vulnerability ---------------------------------------------------------

/**
 * Counters of `slug` still available to the enemy.
 *
 * Exported separately so it can be tested directly, without assembling a draft
 * in the opening phase just to reach it. Uses the same per-enemy fallback as
 * rank.ts: the map's counters when the data covers this brawler, else global.
 */
export function vulnerabilityOf(
  slug: string,
  ctx: { countersIndex: CountersIndex; mapCounters: CountersIndex | null; taken: string[] },
): Vulnerability {
  const fromMap = ctx.mapCounters?.[slug];
  const list = fromMap ?? ctx.countersIndex[slug] ?? [];
  return {
    free: list.filter((counter) => !ctx.taken.includes(counter)),
    total: list.length,
    source: fromMap ? 'map' : 'global',
  };
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
  const { ally, enemy, classOf, countersIndex, mapCounters, mapCategories, exclude, nameOf, firstPick } = input;

  /** Names for a slug list, or '' when no name source was supplied. */
  const names = (slugs: string[]): string => (nameOf ? joinPtBr(slugs.map(nameOf)) : '');

  const ally_: Insight[] = [];
  const enemy_: Insight[] = [];

  // --- Ally synergy ---
  const allyRoles = countRoles(ally, classOf);

  // The gaps are a fact about the team, computed unconditionally: an empty
  // team is missing all three roles. Whether we SURFACE them as insights is a
  // separate, UI-level decision (an empty team shows `ally.empty` instead of
  // three redundant "falta X" bullets). Duo ranking reads this list, so it
  // must reflect reality even when no insight is emitted for it.
  const missingAllyRoles: Role[] = ROLES.filter((role) => (allyRoles.get(role) ?? 0) === 0);

  if (ally.length === 0) {
    ally_.push({
      code: 'ally.empty',
      text: 'Escolha brawlers para o seu time para ver a análise.',
      tone: 'info',
    });
  } else {
    for (const role of missingAllyRoles) {
      ally_.push({
        code: `ally.role.missing.${role}`,
        text: `Falta ${ROLE_GAP[role]} no seu time.`,
        tone: 'warn',
      });
    }

    // Only at a full team: 3 picks all doing the same job.
    for (const role of ROLES) {
      if (ally.length === TEAM_SIZE && (allyRoles.get(role) ?? 0) === TEAM_SIZE) {
        const who = names(ally);
        ally_.push({
          code: `ally.role.redundant.${role}`,
          text: who
            ? `${who} ocupam ${ROLE_ARTICLE[role]} ${ROLE_GAP[role]} — composição concentrada demais.`
            : `Os 3 picks ocupam ${ROLE_ARTICLE[role]} ${ROLE_GAP[role]} — composição concentrada demais.`,
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
      ? { ...pick, roleReason: `também cobre ${ROLE_ARTICLE[role]} ${ROLE_GAP[role]} que falta ao seu time` }
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

  // --- Turn -----------------------------------------------------------------
  const turn = deriveTurn(ally.length, enemy.length, firstPick);

  // --- Duos -----------------------------------------------------------------
  //
  // Pool is the rankPicks output, NOT the roster nor the union with the map
  // recommendations: a duo whose second member answers nobody isn't a duo,
  // it's a map recommendation, and the map panel already covers that. (The
  // union was measured and degenerates into "best counter + anyone".)
  const combos: SuggestedCombo[] = [];
  if (TEAM_SIZE - ally.length >= 2) {
    for (let i = 0; i < picks.length; i++) {
      for (let k = i + 1; k < picks.length; k++) {
        const [x, y] = [picks[i], picks[k]];
        const coverage = new Set([...x.against, ...y.against]).size;
        const pairRoles = new Set(
          [x.slug, y.slug]
            .map((slug) => {
              const className = classOf.get(slug);
              return className ? ROLE_BY_CLASS[className] : null;
            })
            .filter((role): role is Role => role !== null),
        );
        const roleFill = [...pairRoles].filter((role) => missingAllyRoles.includes(role)).length;
        const mapFit = (mapCategories?.[x.slug] ? 1 : 0) + (mapCategories?.[y.slug] ? 1 : 0);
        const refs: [string, string] =
          x.slug.localeCompare(y.slug) <= 0 ? [x.slug, y.slug] : [y.slug, x.slug];

        // `who` names both brawlers, so the verbs go plural with it and stay
        // singular under the name-free fallback ("A dupla responde...").
        const who = names(refs);
        const plural = who ? 'm' : '';
        const subject = who || 'A dupla';
        const covers = `${subject} responde${plural} a ${coverage} ${coverage === 1 ? 'inimigo' : 'inimigos'}`;
        // No definite article on "dois papéis": the team may be missing three,
        // and the duo only ever covers two of them.
        const filled = [...pairRoles].filter((role) => missingAllyRoles.includes(role));
        const reason = roleFill > 0
          ? `${covers} e cobre${plural} ${roleFill === 2 ? 'dois papéis que faltam' : `${ROLE_ARTICLE[filled[0]]} ${ROLE_GAP[filled[0]]} que falta`}.`
          : `${covers}.`;

        combos.push({ refs, coverage, roleFill, mapFit, score: x.score + y.score, reason });
      }
    }
    combos.sort(
      (p, q) =>
        q.coverage - p.coverage ||
        q.roleFill - p.roleFill ||
        q.mapFit - p.mapFit ||
        q.score - p.score ||
        p.refs[0].localeCompare(q.refs[0]) ||
        p.refs[1].localeCompare(q.refs[1]),
    );
  }

  // --- Opening --------------------------------------------------------------
  //
  // rankPicks([]) is empty — there's nobody to counter yet — so the opening
  // draws from the map's recommendations instead, ranked by exposure.
  const opening: SuggestedOpening[] = [];
  if (turn.phase === 'opening' && mapCategories) {
    for (const slug of Object.keys(mapCategories)) {
      if (exclude.includes(slug)) continue;
      const v = vulnerabilityOf(slug, { countersIndex, mapCounters, taken: exclude });
      // Guard: 0 counters means missing DATA, not safety. A safety ranking must
      // never put a brawler it cannot assess on top — same rule that stops
      // 'Unknown' from filling a role above.
      if (v.total === 0) continue;
      opening.push({ slug, free: v.free, total: v.total, source: v.source, refs: [slug] });
    }
    opening.sort(
      (p, q) =>
        p.free.length - q.free.length ||
        (mapCategories[q.slug]?.length ?? 0) - (mapCategories[p.slug]?.length ?? 0) ||
        p.slug.localeCompare(q.slug),
    );
  }

  // --- Phase insights (spec §5.1) ------------------------------------------
  //
  // Only ever emitted when a turn was actually derived: without firstPick
  // there is no phase to comment on, so no phase insight exists either.
  if (turn.phase === 'opening') {
    ally_.push({
      code: 'ally.opening.risk',
      text: 'Abertura: o inimigo ainda fecha o draft e pode counterar este pick de graça — prefira algo seguro.',
      tone: 'warn',
    });
  } else if (turn.phase === 'closing') {
    ally_.push({
      code: 'ally.closing.freeroll',
      text: 'Último pick do draft: nada pode responder depois. Pode ir no counter mais agressivo.',
      tone: 'good',
    });
  }

  if (turn.phase === 'waiting') {
    // With a full ally team there is no "until you pick again" — what's left
    // is the end of the draft (reachable at (3,2) when the ally opens).
    const allyDone = ally.length >= TEAM_SIZE;
    enemy_.push({
      code: 'enemy.turn.waiting',
      text: allyDone
        ? `Vez do inimigo — ${turn.remaining > 1 ? 'os últimos picks do draft são deles' : 'o último pick do draft é deles'}.`
        : `Vez do inimigo — ${turn.remaining} pick${turn.remaining > 1 ? 's' : ''} até você escolher de novo.`,
      tone: 'info',
    });
  }

  return { ally: ally_, enemy: enemy_, picks, combos, opening, turn };
}

/** Which of section 3's mutually exclusive lists the renderer must show. */
export type PicksSection = 'picks' | 'combos' | 'opening' | 'placeholder';

/**
 * Decides what section 3 shows, from the analysis alone.
 *
 * Pure and exported so the routing rule is covered by the data gate even
 * though the DOM isn't. Order matters: it is a precedence list, not a set of
 * independent conditions.
 */
export function picksSectionFor(analysis: DraftAnalysis): PicksSection {
  const { phase } = analysis.turn;
  if (phase === 'waiting' || phase === 'complete') return 'placeholder';
  if (phase === 'opening') return analysis.opening.length > 0 ? 'opening' : 'picks';
  // A two-pick block still falls back to individual picks when there aren't
  // two candidates to pair — e.g. every counter of the revealed enemies is
  // already picked or banned.
  if (phase === 'double') return analysis.combos.length > 0 ? 'combos' : 'picks';
  // Fallback of spec §2 decision 4: no derivable turn, but the engine only
  // fills `combos` when 2+ ally slots are open — exactly the condition under
  // which duos are the right answer.
  if (phase === 'unknown' && analysis.combos.length > 0) return 'combos';
  return 'picks';
}
