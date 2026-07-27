// Ally-team composition analysis. Given the className values of the
// brawlers picked so far, returns pt-BR bullet strings flagging gaps.

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
