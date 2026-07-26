// Client-side draft board logic. Vanilla TS, no framework.
//
// The 107 brawler tiles living inside <BrawlerPicker> are server-rendered
// once by Astro; this module indexes them into Map<slug, HTMLElement> and
// reuses that markup everywhere a portrait needs to appear (draft slots,
// counter-pick rows) by cloning nodes — no name or image is re-typed here.
import { rankPicks, type CountersIndex, type MapBonus, type Pick } from '@/lib/rank';
import { analyzeComposition, type BrawlerClassName } from '@/lib/composition';
import { stripAccents } from '@/lib/text';
import { withBase } from '@/lib/basePath';
import countersJson from '@/data/counters-index.json';
import mapIndexJson from '@/data/map-index.json';

const COUNTERS = countersJson as CountersIndex;
const MAP_INDEX = mapIndexJson as unknown as Record<string, MapBonus>;

type Team = 'ally' | 'enemy';
type Kind = 'ban' | 'pick';

interface DraftState {
  ally: (string | null)[];
  enemy: (string | null)[];
  bansAlly: (string | null)[];
  bansEnemy: (string | null)[];
  mapId: string | null;
  firstPick: Team;
}

interface MapCategoryData {
  key: string;
  label: string;
  brawlers: string[];
}

interface MapClientData {
  id: string;
  name: string;
  namePt: string;
  image: string;
  environment: string;
  gameMode: { name: string; color: string; bgColor: string; image: string };
  tips: string[];
  categories: MapCategoryData[];
}

/**
 * Fetches a required DraftBoard element, throwing loudly if the markup and
 * this script have drifted apart — same fail-fast philosophy as
 * `lookup()` in src/lib/brawlers.ts. Also sidesteps a real TypeScript
 * limitation: control-flow narrowing from an `instanceof` guard in the
 * outer function body does not survive into the nested function
 * declarations below (renderSlot, openPicker, etc.), since those are
 * hoisted and TS can't prove they run after the guard. Giving each element
 * a non-nullable static type here avoids that entirely.
 */
function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`draftBoard: expected #${id} to exist`);
  return el as T;
}

export function initDraftBoard(): void {
  const pickerGrid = byId<HTMLElement>('picker-grid');
  const pickerDialog = byId<HTMLDialogElement>('brawler-picker');
  const pickerSearch = byId<HTMLInputElement>('picker-search');
  const pickerEmpty = document.getElementById('picker-empty');
  const pickerClose = document.getElementById('picker-close');

  const mapPickerOpen = document.getElementById('map-picker-open');
  const mapPickerClearBtn = document.getElementById('map-picker-clear');
  const mapPickerLabel = document.getElementById('map-picker-label');
  const mapPickerDialog = document.getElementById('map-picker');
  const mapPickerSearch = document.getElementById('map-picker-search');
  const mapPickerEmpty = document.getElementById('map-picker-empty');
  const mapPickerClose = document.getElementById('map-picker-close');
  const mapPickerGrid = document.getElementById('map-picker-grid');

  const mapBadge = document.getElementById('map-mode-badge');
  const mapIcon = document.getElementById('map-mode-icon');
  const mapNameEl = document.getElementById('map-mode-name');
  const mapPicksPanel = document.getElementById('map-picks-panel');
  const mapPicksHeader = document.getElementById('map-picks-header');
  const mapPicksImage = document.getElementById('map-picks-image');
  const mapPicksEnvironment = document.getElementById('map-picks-environment');
  const mapPicksModeIcon = document.getElementById('map-picks-mode-icon');
  const mapPicksModeName = document.getElementById('map-picks-mode-name');
  const mapPicksTips = document.getElementById('map-picks-tips');
  const mapPicksCategories = document.getElementById('map-picks-categories');
  const mapCategoryTemplate = document.getElementById('map-category-template');
  const mapPortraitTemplate = document.getElementById('map-portrait-template');

  const firstAllyBtn = document.getElementById('first-pick-ally');
  const firstEnemyBtn = document.getElementById('first-pick-enemy');
  const clearBtn = document.getElementById('clear-draft-floating');
  const compositionList = byId<HTMLElement>('composition-list');
  const compositionTemplate = byId<HTMLTemplateElement>('composition-row-template');
  const counterList = byId<HTMLElement>('counter-picks-list');
  const counterTemplate = byId<HTMLTemplateElement>('counter-row-template');
  const mapsDataEl = document.getElementById('maps-data');

  const mapsData: MapClientData[] = mapsDataEl ? (JSON.parse(mapsDataEl.textContent ?? '[]') as MapClientData[]) : [];
  const mapsById = new Map(mapsData.map((m) => [m.id, m]));

  const cards = Array.from(pickerGrid.querySelectorAll<HTMLButtonElement>('button[data-slug]'));
  const tileIndex = new Map<string, HTMLButtonElement>(cards.map((card) => [card.dataset.slug ?? '', card]));

  const mapCards = mapPickerGrid
    ? Array.from(mapPickerGrid.querySelectorAll<HTMLButtonElement>('button[data-map-id]'))
    : [];

  // Slots are now a non-interactive `.draft-slot` wrapper (carries the
  // team/kind/index dataset) around two sibling buttons — `.draft-slot__open`
  // to launch the picker and `.draft-slot__clear` to instantly clear it.
  const slotEls = Array.from(document.querySelectorAll<HTMLElement>('.draft-slot'));
  const slotIndex = new Map<string, HTMLElement>();
  for (const el of slotEls) {
    const { team, kind, index } = el.dataset;
    if (team && kind && index !== undefined) slotIndex.set(`${team}-${kind}-${index}`, el);
  }

  const state: DraftState = {
    ally: [null, null, null],
    enemy: [null, null, null],
    bansAlly: [null, null, null],
    bansEnemy: [null, null, null],
    mapId: null,
    firstPick: 'ally',
  };

  let activeSlot: { team: Team; kind: Kind; index: number; opener: HTMLElement } | null = null;

  function tileImg(card: HTMLElement): HTMLImageElement | null {
    return card.querySelector<HTMLImageElement>('img.brawler-tile');
  }

  function getArray(team: Team, kind: Kind): (string | null)[] {
    if (kind === 'ban') return team === 'ally' ? state.bansAlly : state.bansEnemy;
    return team === 'ally' ? state.ally : state.enemy;
  }

  function getSlotEl(team: Team, kind: Kind, index: number): HTMLElement | undefined {
    return slotIndex.get(`${team}-${kind}-${index}`);
  }

  function getAllTaken(): string[] {
    return [...state.ally, ...state.enemy, ...state.bansAlly, ...state.bansEnemy].filter(
      (s): s is string => s !== null,
    );
  }

  /** Whether a brawler is currently banned by either team. */
  function isBanned(slug: string): boolean {
    return state.bansAlly.includes(slug) || state.bansEnemy.includes(slug);
  }

  // --- Slot rendering -------------------------------------------------

  function renderSlot(el: HTMLElement, team: Team, kind: Kind, index: number, slug: string | null): void {
    const openBtn = el.querySelector<HTMLElement>('.draft-slot__open');
    const clearBtnEl = el.querySelector<HTMLElement>('.draft-slot__clear');
    const frame = el.querySelector<HTMLElement>('.draft-slot__frame');
    const label = el.querySelector<HTMLElement>('.draft-slot__label');
    const nameEl = el.querySelector<HTMLElement>('.draft-slot__name');
    const noteEl = el.querySelector<HTMLElement>('.draft-slot__note');
    if (!openBtn || !clearBtnEl || !frame || !label || !nameEl || !noteEl) return;

    frame.replaceChildren();
    frame.removeAttribute('style');
    noteEl.hidden = true;
    noteEl.textContent = '';

    const kindLabel = kind === 'ban' ? 'Banir' : 'Escolher';
    const teamLabel = team === 'ally' ? 'time aliado' : 'time inimigo';

    if (!slug) {
      frame.className = 'draft-slot__frame frame-empty';
      label.hidden = false;
      nameEl.textContent = '';
      nameEl.classList.remove('draft-slot__name--filled');
      clearBtnEl.hidden = true;
      openBtn.setAttribute('aria-label', `${kindLabel}, ${teamLabel}, posição ${index + 1}`);
      return;
    }

    const card = tileIndex.get(slug);
    const img = card ? tileImg(card) : null;
    if (!img) return;

    const clone = img.cloneNode(true) as HTMLImageElement;
    const name = img.dataset.name ?? slug;
    const hasNoData = img.dataset.nodata !== undefined;

    frame.appendChild(clone);
    frame.className =
      kind === 'ban' ? 'draft-slot__frame frame-filled frame-banned' : 'draft-slot__frame frame-filled';
    if (kind === 'pick') frame.style.backgroundColor = img.dataset.rarityColor ?? '';

    label.hidden = true;
    nameEl.textContent = name;
    nameEl.classList.add('draft-slot__name--filled');
    clearBtnEl.hidden = false;
    clearBtnEl.setAttribute('aria-label', `Remover ${name}, ${teamLabel}, posição ${index + 1}`);
    openBtn.setAttribute(
      'aria-label',
      `${kind === 'ban' ? 'Banido' : 'Escolhido'}: ${name}, ${teamLabel}, posição ${index + 1}`,
    );

    if (kind === 'pick' && hasNoData) {
      noteEl.hidden = false;
      noteEl.textContent = `Sem dados de counter para ${name} — não influencia as sugestões.`;
    }
  }

  function setSlug(team: Team, kind: Kind, index: number, slug: string | null): void {
    getArray(team, kind)[index] = slug;
    const el = getSlotEl(team, kind, index);
    if (el) renderSlot(el, team, kind, index, slug);
  }

  // --- Brawler picker -----------------------------------------------------

  function updatePickerState(currentValue: string | null): void {
    const taken = new Set(getAllTaken());
    for (const card of cards) {
      const slug = card.dataset.slug ?? '';
      const isCurrent = slug === currentValue;
      card.disabled = taken.has(slug) && !isCurrent;
      card.setAttribute('aria-pressed', String(isCurrent));
      card.classList.toggle('banned-portrait', isBanned(slug) && !isCurrent);
    }
  }

  function filterCards(query: string): void {
    // `data-search` (BrawlerTile.astro) is already accent-stripped, so the
    // query needs the same normalization for e.g. "perola" to match "Pérola".
    const q = stripAccents(query.trim()).toLowerCase();
    let anyVisible = false;
    for (const card of cards) {
      const img = tileImg(card);
      const haystack = img?.dataset.search ?? '';
      const visible = q === '' || haystack.includes(q);
      const li = card.closest('li');
      if (li) li.hidden = !visible;
      if (visible) anyVisible = true;
    }
    if (pickerEmpty instanceof HTMLElement) pickerEmpty.hidden = anyVisible;
  }

  function openPicker(team: Team, kind: Kind, index: number, opener: HTMLElement): void {
    activeSlot = { team, kind, index, opener };
    updatePickerState(getArray(team, kind)[index]);
    pickerSearch.value = '';
    filterCards('');
    pickerDialog.showModal();
    pickerSearch.focus();
  }

  for (const el of slotEls) {
    const { team, kind, index } = el.dataset;
    if (team !== 'ally' && team !== 'enemy') continue;
    if (kind !== 'ban' && kind !== 'pick') continue;
    if (index === undefined) continue;
    const openBtn = el.querySelector<HTMLElement>('.draft-slot__open');
    const clearBtnEl = el.querySelector<HTMLElement>('.draft-slot__clear');
    openBtn?.addEventListener('click', () => {
      if (openBtn) openPicker(team, kind, Number(index), openBtn);
    });
    clearBtnEl?.addEventListener('click', () => {
      setSlug(team, kind, Number(index), null);
      recompute();
      syncHash();
    });
  }

  pickerGrid.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !activeSlot) return;
    const card = target.closest<HTMLButtonElement>('button[data-slug]');
    if (!card || card.disabled) return;
    const slug = card.dataset.slug ?? '';
    const { team, kind, index } = activeSlot;
    const current = getArray(team, kind)[index];
    setSlug(team, kind, index, current === slug ? null : slug);
    pickerDialog.close();
    recompute();
    syncHash();
  });

  pickerSearch.addEventListener('input', () => filterCards(pickerSearch.value));
  pickerClose?.addEventListener('click', () => pickerDialog.close());
  pickerDialog.addEventListener('click', (event) => {
    if (event.target === pickerDialog) pickerDialog.close();
  });
  pickerDialog.addEventListener('close', () => {
    activeSlot?.opener.focus();
    activeSlot = null;
  });

  // --- Map picker (same shape as the brawler picker above) -----------------

  function updateMapPickerState(): void {
    for (const card of mapCards) {
      const isCurrent = card.dataset.mapId === state.mapId;
      card.setAttribute('aria-pressed', String(isCurrent));
    }
  }

  function filterMapCards(query: string): void {
    const q = stripAccents(query.trim()).toLowerCase();
    let anyVisible = false;
    for (const card of mapCards) {
      const haystack = stripAccents(card.dataset.search ?? '');
      const visible = q === '' || haystack.includes(q);
      const li = card.closest('li');
      if (li) li.hidden = !visible;
      if (visible) anyVisible = true;
    }
    if (mapPickerEmpty instanceof HTMLElement) mapPickerEmpty.hidden = anyVisible;
  }

  mapPickerOpen?.addEventListener('click', () => {
    if (!(mapPickerDialog instanceof HTMLDialogElement) || !(mapPickerSearch instanceof HTMLInputElement)) return;
    updateMapPickerState();
    mapPickerSearch.value = '';
    filterMapCards('');
    mapPickerDialog.showModal();
    mapPickerSearch.focus();
  });

  mapPickerGrid?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const card = target.closest<HTMLButtonElement>('button[data-map-id]');
    if (!card) return;
    const mapId = card.dataset.mapId ?? '';
    const map = state.mapId === mapId ? null : (mapsById.get(mapId) ?? null);
    setMap(map);
    if (mapPickerDialog instanceof HTMLDialogElement) mapPickerDialog.close();
    recompute();
    syncHash();
  });

  mapPickerSearch?.addEventListener('input', () => {
    if (mapPickerSearch instanceof HTMLInputElement) filterMapCards(mapPickerSearch.value);
  });
  mapPickerClose?.addEventListener('click', () => {
    if (mapPickerDialog instanceof HTMLDialogElement) mapPickerDialog.close();
  });
  mapPickerDialog?.addEventListener('click', (event) => {
    if (event.target === mapPickerDialog && mapPickerDialog instanceof HTMLDialogElement) mapPickerDialog.close();
  });
  mapPickerDialog?.addEventListener('close', () => {
    mapPickerOpen?.focus();
  });
  mapPickerClearBtn?.addEventListener('click', () => {
    setMap(null);
    recompute();
    syncHash();
  });

  // --- Map selection ------------------------------------------------------

  function setMap(map: MapClientData | null): void {
    state.mapId = map?.id ?? null;

    if (mapPickerLabel instanceof HTMLElement) {
      mapPickerLabel.textContent = map ? map.namePt : 'Selecionar mapa...';
      mapPickerLabel.classList.toggle('text-brawl-navy-deep/50', !map);
      mapPickerLabel.classList.toggle('font-semibold', Boolean(map));
      mapPickerLabel.classList.toggle('text-brawl-navy-deep', Boolean(map));
    }
    if (mapPickerClearBtn instanceof HTMLElement) mapPickerClearBtn.hidden = !map;

    if (map && mapBadge instanceof HTMLElement && mapIcon instanceof HTMLImageElement && mapNameEl instanceof HTMLElement) {
      mapBadge.hidden = false;
      mapIcon.src = map.gameMode.image;
      mapIcon.alt = map.gameMode.name;
      mapNameEl.textContent = map.gameMode.name;
      mapNameEl.style.color = map.gameMode.color;
    } else if (mapBadge instanceof HTMLElement) {
      mapBadge.hidden = true;
    }
    renderMapPicks(map);
  }

  /** Fills (or hides) the "best picks for this map" panel. */
  function renderMapPicks(map: MapClientData | null): void {
    if (!(mapPicksPanel instanceof HTMLElement)) return;

    if (!map) {
      mapPicksPanel.hidden = true;
      return;
    }
    mapPicksPanel.hidden = false;

    if (mapPicksHeader) mapPicksHeader.textContent = `Melhores Picks — ${map.namePt}`;
    if (mapPicksImage instanceof HTMLImageElement) {
      mapPicksImage.src = map.image;
      mapPicksImage.alt = map.namePt;
    }
    if (mapPicksEnvironment) mapPicksEnvironment.textContent = `${map.name} · ${map.environment}`;
    if (mapPicksModeIcon instanceof HTMLImageElement) {
      mapPicksModeIcon.src = map.gameMode.image;
      mapPicksModeIcon.alt = map.gameMode.name;
    }
    if (mapPicksModeName instanceof HTMLElement) {
      mapPicksModeName.textContent = map.gameMode.name;
      mapPicksModeName.style.color = map.gameMode.color;
    }
    // Note: the badge keeps its fixed bg-brawl-navy-deep background (same
    // treatment as #map-mode-badge above) — gameMode.color and
    // gameMode.bgColor are near-identical hues for every mode in the data,
    // so tinting the badge background with bgColor would wash out text
    // colored with `color` (unreadable, same bug the contrast fix addressed
    // elsewhere).

    if (mapPicksTips instanceof HTMLElement) {
      mapPicksTips.replaceChildren();
      mapPicksTips.hidden = map.tips.length === 0;
      for (const tip of map.tips) {
        const node = compositionTemplate.content.firstElementChild?.cloneNode(true);
        if (!(node instanceof HTMLElement)) continue;
        const textEl = node.querySelector('.composition-row__text');
        if (textEl) textEl.textContent = tip;
        mapPicksTips.appendChild(node);
      }
    }

    if (
      mapPicksCategories instanceof HTMLElement &&
      mapCategoryTemplate instanceof HTMLTemplateElement &&
      mapPortraitTemplate instanceof HTMLTemplateElement
    ) {
      mapPicksCategories.replaceChildren();
      for (const category of map.categories) {
        const catNode = mapCategoryTemplate.content.firstElementChild?.cloneNode(true);
        if (!(catNode instanceof HTMLElement)) continue;
        const labelEl = catNode.querySelector('.map-category__label');
        const listEl = catNode.querySelector('ul');
        if (labelEl) labelEl.textContent = category.label;
        for (const slug of category.brawlers) {
          const card = tileIndex.get(slug);
          const img = card ? tileImg(card) : null;
          if (!img || !listEl) continue;
          const portraitNode = mapPortraitTemplate.content.firstElementChild?.cloneNode(true);
          if (!(portraitNode instanceof HTMLElement)) continue;
          const link = portraitNode.querySelector<HTMLAnchorElement>('.map-portrait__link');
          const frame = portraitNode.querySelector('.map-portrait__frame');
          const nameEl = portraitNode.querySelector('.map-portrait__name');
          const name = img.dataset.name ?? slug;
          if (link) link.href = withBase(`/brawlers/${slug}/`);
          portraitNode.classList.toggle('banned-portrait', isBanned(slug));
          frame?.appendChild(img.cloneNode(true));
          if (nameEl) nameEl.textContent = name;
          listEl.appendChild(portraitNode);
        }
        mapPicksCategories.appendChild(catNode);
      }
    }
  }

  // --- First pick -----------------------------------------------------------

  function applyFirstPick(team: Team): void {
    state.firstPick = team;
    firstAllyBtn?.setAttribute('aria-pressed', String(team === 'ally'));
    firstEnemyBtn?.setAttribute('aria-pressed', String(team === 'enemy'));
  }

  firstAllyBtn?.addEventListener('click', () => {
    applyFirstPick('ally');
    syncHash();
  });
  firstEnemyBtn?.addEventListener('click', () => {
    applyFirstPick('enemy');
    syncHash();
  });

  // --- Results --------------------------------------------------------------

  function renderComposition(tips: string[]): void {
    compositionList.replaceChildren();
    if (tips.length === 0) {
      const li = document.createElement('li');
      li.className = 'text-sm text-white/50';
      li.textContent = 'Escolha brawlers para o seu time para ver a análise.';
      compositionList.appendChild(li);
      return;
    }
    for (const tip of tips) {
      const node = compositionTemplate.content.firstElementChild?.cloneNode(true);
      if (!(node instanceof HTMLElement)) continue;
      const textEl = node.querySelector('.composition-row__text');
      if (textEl) textEl.textContent = tip;
      compositionList.appendChild(node);
    }
  }

  function verbFor(coverage: number): string {
    if (coverage >= 3) return 'é ótimo contra';
    if (coverage === 2) return 'é forte contra';
    return 'é bom contra';
  }

  function joinPtBr(items: string[]): string {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
  }

  function nameOf(slug: string): string {
    const card = tileIndex.get(slug);
    const img = card ? tileImg(card) : null;
    return img?.dataset.name ?? slug;
  }

  function renderSuggestions(picks: Pick[]): void {
    counterList.replaceChildren();
    if (picks.length === 0) {
      const li = document.createElement('li');
      li.className = 'text-sm text-white/50';
      li.textContent = 'Escolha brawlers do time inimigo para ver sugestões.';
      counterList.appendChild(li);
      return;
    }
    for (const pick of picks) {
      const card = tileIndex.get(pick.slug);
      const img = card ? tileImg(card) : null;
      if (!img) continue;

      const node = counterTemplate.content.firstElementChild?.cloneNode(true);
      if (!(node instanceof HTMLElement)) continue;
      const portrait = node.querySelector('.counter-row__portrait');
      const textEl = node.querySelector('.counter-row__text');
      if (portrait) portrait.appendChild(img.cloneNode(true));
      if (textEl) {
        textEl.replaceChildren();
        const strong = document.createElement('strong');
        strong.className = 'text-brawl-yellow';
        strong.textContent = img.dataset.name ?? pick.slug;
        const targets = joinPtBr(pick.against.map(nameOf));
        textEl.append(strong, ` ${verbFor(pick.coverage)} ${targets}`);
      }
      counterList.appendChild(node);
    }
  }

  function recompute(): void {
    const exclude = getAllTaken();
    const mapBonus: MapBonus | null = state.mapId ? (MAP_INDEX[state.mapId] ?? null) : null;
    const enemies = state.enemy.filter((s): s is string => s !== null);
    const suggestions = rankPicks(enemies, COUNTERS, { exclude, mapBonus }).slice(0, 6);
    renderSuggestions(suggestions);

    const allyClassNames = state.ally
      .filter((s): s is string => s !== null)
      .map((slug) => tileIndex.get(slug)?.dataset.className)
      .filter((c): c is BrawlerClassName => c !== undefined);
    renderComposition(analyzeComposition(allyClassNames));

    // The floating "Limpar" button only makes sense once there's something
    // to clear — a selected map or at least one pick/ban.
    if (clearBtn instanceof HTMLElement) clearBtn.hidden = state.mapId === null && exclude.length === 0;

    // Refresh the map-picks panel's banned-portrait dimming — a ban can
    // happen after a map is already selected, so this can't only run from
    // setMap().
    if (state.mapId) renderMapPicks(mapsById.get(state.mapId) ?? null);
  }

  // --- Clear ------------------------------------------------------------

  clearBtn?.addEventListener('click', () => {
    for (const team of ['ally', 'enemy'] as const) {
      for (const kind of ['ban', 'pick'] as const) {
        for (let i = 0; i < 3; i++) setSlug(team, kind, i, null);
      }
    }
    setMap(null);
    applyFirstPick('ally');
    recompute();
    syncHash();
  });

  // --- Hash persistence -------------------------------------------------

  function serialize(): string {
    const params = new URLSearchParams();
    if (state.mapId) params.set('map', state.mapId);
    if (state.firstPick !== 'ally') params.set('first', state.firstPick);
    state.ally.forEach((s, i) => s && params.set(`a${i}`, s));
    state.enemy.forEach((s, i) => s && params.set(`e${i}`, s));
    state.bansAlly.forEach((s, i) => s && params.set(`ba${i}`, s));
    state.bansEnemy.forEach((s, i) => s && params.set(`be${i}`, s));
    return params.toString();
  }

  function syncHash(): void {
    const serialized = serialize();
    const url = serialized ? `#${serialized}` : `${location.pathname}${location.search}`;
    history.replaceState(null, '', url);
  }

  function restoreFromHash(): void {
    const params = new URLSearchParams(location.hash.slice(1));

    const mapId = params.get('map');
    if (mapId && mapsById.has(mapId)) {
      setMap(mapsById.get(mapId) ?? null);
    }

    applyFirstPick(params.get('first') === 'enemy' ? 'enemy' : 'ally');

    // A shareable URL can be hand-edited (or just stale), so — unlike the
    // picker, which disables already-taken tiles — this path needs its own
    // duplicate guard: track every slug already placed and skip repeats.
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      restoreSlug('ally', 'pick', i, params.get(`a${i}`), seen);
      restoreSlug('enemy', 'pick', i, params.get(`e${i}`), seen);
      restoreSlug('ally', 'ban', i, params.get(`ba${i}`), seen);
      restoreSlug('enemy', 'ban', i, params.get(`be${i}`), seen);
    }
  }

  function restoreSlug(team: Team, kind: Kind, index: number, slug: string | null, seen: Set<string>): void {
    if (!slug || !tileIndex.has(slug) || seen.has(slug)) return; // discard invalid/unknown/duplicate slugs silently
    seen.add(slug);
    setSlug(team, kind, index, slug);
  }

  restoreFromHash();
  recompute();
}
