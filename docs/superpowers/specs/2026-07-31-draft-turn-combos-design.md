# Turno do draft e sugestão de duplas

- **Data:** 2026-07-31
- **Branch:** `feat/composition-analysis` (incremento 2)
- **Status:** design aprovado, implementação pendente
- **Base:** estende o card de [2026-07-30](./2026-07-30-composition-analysis-design.md). Aquela spec continua válida; esta só acrescenta.

---

## 1. Contexto (por quê)

O card de análise hoje trata todo momento do draft igual: monta a lista de
counter-picks a partir dos inimigos já revelados e pronto. Mas draft ranqueado
não é simétrico — a ordem é **1-2-2-1**: o 1º time pega 1, o 2º pega 2, o 1º
pega 2, o 2º fecha.

Disso saem duas situações estrategicamente opostas que o card não distingue:

- **Abertura** (1º pick do 1º time): é o pick mais exposto do draft. O inimigo
  ainda tem o último pick e pode counterar de graça. Pede escolha **segura**.
- **Fechamento** (último pick): informação completa, nada pode responder depois.
  Pede **agressão máxima**.

E quando faltam 2 slots, sugerir os melhores picks **individuais** é a resposta
errada: os dois melhores individuais frequentemente respondem aos mesmos
inimigos e ocupam o mesmo papel. A pergunta certa é qual **dupla** cobre mais.

**O que já existe** (nada disso precisa ser construído):

| Capacidade | Onde | Estado |
|---|---|---|
| `state.firstPick` + serialização no hash | `draftBoard.ts:30,146,918` | pronto, porém dormente (§2.1) |
| Motor puro com entrada explícita | `analyzeDraft` em `composition.ts` | pronto, extensível |
| Papéis por classe (`ROLE_BY_CLASS`) | `composition.ts` | pronto |
| Ranking individual + fallback por mapa | `rankPicks` (`rank.ts:42-80`) | pronto |
| Insights com `code` estável + `nameOf` | `composition.ts` | pronto |
| Card de 3 seções | `DraftBoard.astro` | pronto |

---

## 2. Decisões de produto (aprovadas)

1. **Reativar `SHOW_FIRST_PICK_TOGGLE`** (`DraftBoard.astro:45`).
2. **Turno é sinal derivado best-effort, só sobre picks** (bans fora da conta).
   Casa com a sequência → faixa no topo do card. Não casa → faixa omitida.
3. **Sugestão dimensionada pela vez** (§5).
4. **Fallback sem turno derivável:** ≥2 slots aliados livres → duplas; 1 → individual.
5. **Sem poda de pares** — o custo é irrelevante (§6.3).

### 2.1 Pré-requisito: `firstPick` está dormente

Hoje `state.firstPick` **não influencia nada computacional**. Seus únicos
consumidores são `applyFirstPick()` (`draftBoard.ts:514-518`, que só escreve
`aria-pressed` em dois botões), a escrita no hash (`:918`) e a leitura no
restore. Não entra em `rankPicks`, `analyzeDraft`, ordem de slots ou
`findNextEmptySlot`.

Pior: a UI está **desligada** (`SHOW_FIRST_PICK_TOGGLE = false`), então o valor
só muda por URL editada à mão. O comentário em `DraftBoard.astro:42-44` diz que
o estado segue funcionando, "it just always reads as 'ally' while this is off".

Reativar o toggle é portanto pré-requisito, e é reversão de uma decisão de
produto anterior — registrada aqui para não parecer descuido.

### 2.2 Preenchimento livre continua intocado

O README promete: *"qualquer slot, de qualquer time, pode ser preenchido a
qualquer momento"*. Esta feature **não** restringe isso. O turno é leitura, não
regra: `assignSlot`, `findNextEmptySlot` e a inserção pelos painéis seguem
aceitando qualquer slot em qualquer ordem. Quando o estado não casa com a
sequência, a faixa some — nunca um bloqueio, nunca um aviso de erro.

---

## 3. Derivação do turno

Sequência canônica de **picks** (bans não entram), a partir de `firstPick`:

| Bloco | `firstPick = 'ally'` | `firstPick = 'enemy'` |
|---|---|---|
| 1 | ally × 1 | enemy × 1 |
| 2 | enemy × 2 | ally × 2 |
| 3 | ally × 2 | enemy × 2 |
| 4 | enemy × 1 | ally × 1 |

Um estado é o par `(a, b)` = quantidade de picks preenchidos de cada time
(`state.ally`/`state.enemy` sem os nulls). É **derivável** se for alcançável
percorrendo a sequência em ordem — inclusive no meio de um bloco.

**Estados alcançáveis (7 de 16 em ambos os casos, validado por enumeração):**

| `firstPick = 'ally'` | vez | faltam no bloco | `firstPick = 'enemy'` | vez | faltam |
|---|---|---|---|---|---|
| (0,0) | ally | 1 | (0,0) | enemy | 1 |
| (1,0) | enemy | 2 | (0,1) | ally | 2 |
| (1,1) | enemy | 1 | (1,1) | ally | 1 |
| (1,2) | ally | 2 | (2,1) | enemy | 2 |
| (2,2) | ally | 1 | (2,2) | enemy | 1 |
| (3,2) | enemy | 1 | (2,3) | ally | 1 |
| (3,3) | — completo | 0 | (3,3) | — completo | 0 |

Não alcançáveis com `ally` primeiro: `(0,1) (0,2) (0,3) (1,3) (2,0) (2,1) (2,3) (3,0) (3,1)`.
Com `enemy` primeiro: `(0,2) (0,3) (1,0) (1,2) (1,3) (2,0) (3,0) (3,1) (3,2)`.

### 3.1 Fases do lado aliado

| Fase | Quando | Sugestão |
|---|---|---|
| `opening` | vez ally, bloco 1 (só existe com `firstPick='ally'`, estado (0,0)) | lista de abertura + vulnerabilidade (§5.3) |
| `double` | vez ally, faltam 2 no bloco — (1,2) ally-first, (0,1) enemy-first | **duplas** |
| `single` | vez ally, falta 1, e **não** é o último pick do draft — (2,2) ally-first, (1,1) enemy-first | individual |
| `closing` | vez ally, falta 1, e **é** o último pick do draft — (2,3) enemy-first | individual + rótulo de agressão |
| `waiting` | vez do inimigo | "aguardando", seções 1-2 seguem ativas |
| `complete` | (3,3) | sem sugestão |
| `unknown` | estado não alcançável | fallback da decisão 4 de §2 |

> **Assimetria registrada:** com `firstPick='ally'` o time aliado **nunca fecha
> o draft** — o inimigo tem o bloco 4. Logo `closing` só existe para o aliado
> quando o inimigo abre. Simetricamente, `opening` só existe quando o aliado
> abre. As duas fases são mutuamente exclusivas na mesma partida.

---

## 4. Interfaces

Extensão de `src/lib/composition.ts` — mesmas restrições de sempre (erasable
syntax only; o módulo é importado direto por `verify-data.mjs` sob
type-stripping).

```ts
export type DraftPhase =
  | 'opening' | 'double' | 'single' | 'closing'
  | 'waiting' | 'complete' | 'unknown';

export interface TurnState {
  phase: DraftPhase;
  /** De quem é a vez. null quando completo ou não derivável. */
  turn: 'ally' | 'enemy' | null;
  /** Picks restantes no bloco atual (1 ou 2). 0 quando completo/desconhecido. */
  remaining: number;
  /** Texto pt-BR da faixa, ou null quando ela não deve aparecer. */
  text: string | null;
}

/** Contadores de counters do candidato ainda disponíveis ao inimigo. */
export interface Vulnerability {
  /** Counters ainda livres (não escolhidos nem banidos por ninguém). */
  free: string[];
  /** Total de counters conhecidos do candidato (0..3). */
  total: number;
  /** 'map' quando veio de mapCounters, 'global' quando caiu no fallback. */
  source: 'map' | 'global';
}

/**
 * Candidato de abertura: um recomendado do mapa, medido pela exposição.
 * `SuggestedPick` NÃO ganha campo de vulnerabilidade — a abertura tem pool,
 * ordenação e significado próprios (não é counter de ninguém), então tem tipo
 * e canal próprios, e `picks` segue exatamente o contrato do v1.
 */
export interface SuggestedOpening {
  slug: string;
  /** Counters ainda livres para o inimigo. Chave primária de ordenação (asc). */
  free: string[];
  /** Total de counters conhecidos (sempre > 0 — ver o guard em §5.3). */
  total: number;
  /** 'map' quando veio de mapCounters, 'global' quando caiu no fallback. */
  source: 'map' | 'global';
  /** `[slug]` — para retrato, mesmo nome/uso de refs no resto do módulo. */
  refs: [string];
}

export interface SuggestedCombo {
  /** Os dois slugs, em ordem alfabética (determinismo) — também os retratos. */
  refs: [string, string];
  /** Inimigos distintos que a dupla responde (união). */
  coverage: number;
  /** Papéis faltantes DISTINTOS que a dupla cobre (0..2). */
  roleFill: number;
  /** Quantos dos dois estão nas categorias do mapa (0..2). */
  mapFit: number;
  /** Soma dos scores do rankPicks — desempate, ver §5.2. */
  score: number;
  /** Motivo textual pronto para render. */
  reason: string;
}

export interface DraftInput {
  // ... campos do v1 ...
  /** Quem escolhe primeiro. Ausente => turno indeterminado, ver abaixo. */
  firstPick?: 'ally' | 'enemy';
}

export interface DraftAnalysis {
  ally: Insight[];
  enemy: Insight[];
  /** Contrato do v1, inalterado. */
  picks: SuggestedPick[];
  /** Lista COMPLETA de duplas. Corte de exibição é do renderer. */
  combos: SuggestedCombo[];
  /**
   * Lista COMPLETA de aberturas. Vazia fora da fase `opening` E vazia na fase
   * `opening` sem mapa selecionado (§5.3). Corte de exibição é do renderer.
   */
  opening: SuggestedOpening[];
  turn: TurnState;
}

/**
 * Counters de `slug` ainda disponíveis ao inimigo. Exportada à parte para ser
 * testável direto (casos 12-15), sem precisar montar um draft em fase
 * `opening` só para alcançá-la. `analyzeDraft` a usa internamente.
 */
export function vulnerabilityOf(
  slug: string,
  ctx: { countersIndex: CountersIndex; mapCounters: CountersIndex | null; taken: string[] },
): Vulnerability;
```

**`refs` é a única lista de slugs da dupla.** A versão anterior desta spec tinha
`slugs` e `refs` com o mesmo conteúdo — duas fontes da mesma verdade, que
divergem no primeiro refactor. Ficou só `refs`, o nome que o `Insight` do v1 já
usa para "slugs que este item cita".

**`firstPick` é opcional.** Sem ele não há sequência a percorrer: o motor
devolve `turn.phase = 'unknown'`, `turn: null`, `text: null` — sem exceção, sem
faixa — e o dimensionamento cai na regra de fallback (decisão 4 de §2). Isso
mantém `analyzeDraft` chamável exatamente como a seção `[8]` do v1 já a chama,
o que é o que torna literal o critério "`[1]`-`[8]` intocados" em §12. O call
site real sempre passa o valor, já que `state.firstPick` existe com default
`'ally'`.

---

## 5. Regras

### 5.1 Códigos de insight novos

| `code` | Condição | Tom |
|---|---|---|
| `ally.opening.risk` | fase `opening` | `warn` |
| `ally.closing.freeroll` | fase `closing` | `good` |
| `enemy.turn.waiting` | fase `waiting` | `info` |

Textos citam nomes via `nameOf` quando disponível, com fallback name-free —
mesmo contrato de `nameOf` já implementado em `src/lib/composition.ts` (nasceu
na implementação do v1, commit `3efa936`, depois daquela spec).

### 5.2 Ranking de duplas

**Pool = a saída do `rankPicks`**, não o roster nem a união com os recomendados
do mapa. Ou seja, só entram na dupla brawlers que respondem a **algum** inimigo.

> **Decisão registrada (medida, não intuída).** Testei a alternativa
> "counters ∪ recomendados do mapa" e ela degenera: em `bridge-too-far` com
> inimigos `bull/frank/rosa`, como `clancy` sozinho já cobre os 3, o topo vira
> `clancy + qualquer não-damage do mapa` empatado em `3/2/1`, resolvido por
> ordem alfabética — o primeiro colocado era `alli+clancy`, e `alli` não tem
> counter nenhum. Uma "dupla de counter" cujo segundo membro não countera
> ninguém não é uma dupla; é uma recomendação de mapa, e o painel de mapa já
> cobre isso.

**Chaves de ordenação**, em ordem:

1. `coverage` desc — inimigos distintos respondidos pela união
2. `roleFill` desc — papéis faltantes **distintos** cobertos pela dupla (0..2)
3. `mapFit` desc — quantos dos dois estão nas categorias do mapa
4. `score` desc — soma dos scores do `rankPicks`
5. `refs` asc (1º slug, depois o 2º) — determinismo

> **Chave 4 é acréscimo meu à cadeia aprovada** (que ia de `mapFit` direto para
> slug). Motivo: sem ela sobram empates resolvidos por ordem alfabética, o que
> é arbitrário e visível para o usuário. Medi sobre 295 drafts sintéticos: com
> `score` no meio, **0%** dos casos terminam em desempate alfabético; sem ela,
> empates alfabéticos são comuns (ver §6.2). `score` já codifica força do
> counter e bônus de mapa, então é o desempate mais informativo disponível sem
> dado novo. **Fácil de remover** se o PO preferir a cadeia original.

`reason` é sempre textual e cita a evidência: cobertura conjunta, e papel
quando `roleFill > 0`. Nunca um número solto.

### 5.3 Abertura: lista própria + vulnerabilidade

**Problema que isto resolve:** na abertura o time inimigo está vazio, e
`rankPicks([])` devolve `[]` — não há contra quem counterar. A lista individual
padrão seria **sempre vazia** na única fase em que o card mais precisa opinar.

Sai por **`analysis.opening`** (`SuggestedOpening[]`), canal próprio — não
misturado em `picks`, que segue sendo só o contrato do v1.

**Fonte de candidatos da abertura = os recomendados do mapa**
(`mapCategories`), menos os já escolhidos/banidos por qualquer time. Ordenação:

1. `free` asc — **menos counters ainda livres para o inimigo** (mais seguro primeiro)
2. `categories` desc — em quantas categorias do mapa o brawler aparece
3. `slug` asc — determinismo

**Sem mapa selecionado → `opening: []`**, sobrando só o aviso
`ally.opening.risk`. Sem mapa não há pool de candidatos nem noção de
recomendado; inventar um ranking aqui seria opinião sem lastro (mesmo princípio
de §6 do v1). **Fora da fase `opening`, `opening: []`** também.

#### Vulnerabilidade

```
lista  = mapCounters[X] ?? countersIndex[X] ?? []     // mesmo fallback do rank.ts:58
livres = lista menos (picks + bans de ambos os times)
```

Exposta como `Vulnerability` e renderizada em texto rotulado, nunca como score.
`source` registra se veio do mapa ou do fallback global.

> **Guard obrigatório: quem não tem dado de counter fica FORA da lista.**
> `alli` (o único brawler sem counters) **está** nas categorias de
> `bridge-too-far`. Sem guard, `total === 0` o colocaria em **1º lugar** como
> "mais seguro do mapa" — validei que isso acontece. Mas `0/0` é ausência de
> **dado**, não ausência de counters, e uma lista de segurança não pode
> ranquear quem ela não consegue avaliar. Brawlers com `total === 0` são
> excluídos da lista de abertura (o pool de `bridge-too-far` cai de 28 para
> 27). Mesma regra que faz `'Unknown'` nunca preencher papel no v1.

---

## 6. Validações executadas

Todos os números abaixo foram derivados **executando** `src/lib/rank.ts` contra
os JSONs commitados em 2026-07-31, não estimados.

### 6.1 Tamanho real do pool

Sobre os 295 drafts sintéticos descritos em §6.2 (tríades determinísticas, cada
uma contra **um** mapa em rodízio — não é o produto cartesiano): pool de
**3 a 8 candidatos**, média **5,0** → **3 a 28 pares**. A estimativa inicial de
"~100 candidatos → ~5k pares" não se sustenta: `rankPicks` só acumula quem
aparece em alguma lista de counters (≤3 por inimigo), então o teto estrutural é
9 candidatos.

### 6.2 Poder de discriminação das chaves

Amostra: 300 tríades de inimigos geradas deterministicamente (índices
`i*7`, `i*13+5`, `i*29+11` sobre o roster), cada uma contra um dos 25 mapas em
rodízio; descartadas as que repetiam slug ou produziam pool < 2 candidatos,
sobraram **295**. As três primeiras linhas particionam essas 295 (79+110+106).

| Métrica | Resultado |
|---|---|
| Pools com 1 papel só | 79/295 (27%) |
| Pools com 2 papéis | 110/295 (37%) |
| Pools com 3 papéis | 106/295 (36%) |
| `roleFill` discrimina entre os de maior cobertura | 184/295 (**62%**) |
| Empates irresolvidos após `mapFit` + `score` | 0/295 (**0%**) |

Em 27% dos drafts o pool inteiro tem um papel só e `roleFill` não diferencia
nada — comportamento esperado, não bug (§7).

### 6.3 Custo

| Pool | Pares | Tempo |
|---|---|---|
| Real (3-8 candidatos) | 3-28 | ~0 ms |
| Roster inteiro 106 (teto absurdo) | 5.565 | **0,0103 ms** |

Um centésimo de milissegundo no pior caso imaginável, contra `recompute()` que
já reconstrói dois painéis inteiros a cada mudança de slot. **Poda seria
otimização prematura de algo que não custa nada.**

---

## 7. Casos de teste

Nova seção `[9]` em `scripts/verify-data.mjs`. As seções `[1]`-`[8]` e os
goldens de `[7]` ficam **intocados**.

**Turno** — asserta a tabela de §3 inteira, via `analyzeDraft().turn`:

1. Os 7 estados alcançáveis de `firstPick='ally'` produzem a vez e o `remaining` da tabela.
2. Os 7 de `firstPick='enemy'`, idem.
3. Os 9 não alcançáveis de cada caso → `phase: 'unknown'`, `text: null`.
4. `(0,0)` com `firstPick='ally'` → `opening`; com `'enemy'` → `waiting`.
5. `(2,3)` com `firstPick='enemy'` → `closing`; `(2,2)` com `'ally'` → `single` (não `closing`); `(1,1)` com `'enemy'` → `single` (bloco 2 pela metade, não é o último pick).
6. `firstPick` ausente → `phase: 'unknown'`, `turn: null`, `text: null`, sem exceção — a chamada da seção `[8]` do v1 continua válida sem alteração.

**Duplas** — via `analyzeDraft().combos`, valores validados por execução
(formato `refs:coverage/roleFill/mapFit/score`):

7. `bull,frank,rosa` + `bridge-too-far`, ally vazio → 6 duplas, topo
   `clancy+piper:3/1/1/11 colette+piper:3/1/1/10 piper+spike:3/1/1/4`
8. Mesmos inimigos, **sem mapa**, ally vazio → 15 duplas, topo
   `colette+gale:3/2/0/12 colette+cordelius:3/2/0/11 colette+lou:3/2/0/10`
9. Mesmos inimigos + `kaboom-canyon`, ally vazio → 15 duplas, topo
   `colette+gale:3/2/2/14 colette+cordelius:3/2/2/13 colette+lou:3/2/2/12`
   (bônus de mapa sobrevive ao fallback de counters, igual ao v1 §7 caso 7)
10. `ally=['darryl']` (Tank, frontline coberta), sem mapa → topo
    `colette+gale:3/2/0/12 colette+lou:3/2/0/10 gale+shelly:3/2/0/5`
    — prova que o ranking **reage à composição aliada**: `colette+cordelius`
    (cordelius é Assassin/frontline), #2 no caso 8, sai do pódio quando
    `frontline` deixa de faltar. Aliado é `darryl`, não `bull`: `bull` está
    entre os inimigos deste caso e a UI nunca produz o mesmo slug nos dois
    times.
11. `enemy=['alli']` → `combos: []`, sem exceção.

**Vulnerabilidade** — `vulnerabilityOf()` chamada direto (sem montar draft),
valores validados por execução:

12. `piper` + `bridge-too-far`, nada pego → `3/3` livres `[nani, mandy, angelo]`, `source: 'map'`
13. `piper` + `kaboom-canyon` → `3/3` livres `[nani, mr-p, leon]`, `source: 'global'` (fallback)
14. `piper` + `bridge-too-far` com `nani` já pego/banido → `2/3` livres `[mandy, angelo]`
15. `alli` → `0/0`, `free: []`, sem exceção

**Lista de abertura** — via `analyzeDraft().opening`, estado (0,0) com
`firstPick='ally'` (fase `opening`), valores validados por execução:

16. `bridge-too-far`, nada pego → `opening` com **27** entradas (28 recomendados
    menos `alli`, sem dado de counter), topo
    `8-bit:2/2 carl:3/3 edgar:3/3 lily:3/3 mico:3/3`
    (formato `slug:livres/total`; `carl`/`edgar`/`lily`/`mico` empatam em 3/3 e
    são desempatados por nº de categorias e slug)
17. `alli` **não** aparece em `opening` no caso 16, apesar de estar nas
    categorias do mapa — asserção direta do guard de §5.3.
18. Mesmo mapa e estado, com `nani` e `mandy` banidos → `opening` com 26
    entradas, topo `belle:1/3 lola:1/3 max:1/3 piper:1/3 shade:1/3` — prova que
    a lista **reage aos bans**, que é justamente o valor estratégico da abertura.
19. Estado (0,0) **sem mapa selecionado** → `opening: []`, e o insight
    `ally.opening.risk` ainda presente.
20. Fora da fase `opening` (ex.: (1,2) com `firstPick='ally'`, mapa
    selecionado) → `opening: []`.

---

## 8. Edge cases (estados honestos)

Mesmo princípio do v1: **omitir sinal é aceitável, inventá-lo não.**

| Situação | Comportamento |
|---|---|
| Estado fora da sequência | `phase: 'unknown'`, faixa omitida, fallback da decisão 4 de §2. Nunca bloqueio. |
| Bans preenchidos, picks não | Irrelevante para o turno — bans não entram na contagem. |
| Pool com 1 papel só (27% dos casos) | `roleFill` igual para todas as duplas; ordenação cai para `mapFit`/`score`. `reason` não menciona papel. |
| `roleFill = 0` (time aliado já cobre tudo) | Duplas seguem ranqueadas por cobertura; `reason` fala só de cobertura. |
| Pool < 2 candidatos | `combos: []` — não há dupla a formar. Renderer cai na lista individual. |
| Time aliado cheio | Sem duplas nem picks; seções 1-2 seguem. |
| `kaboom-canyon` | Counters caem no global, bônus de mapa continua ativo — `source: 'global'` registra isso. |
| Fase `waiting` | Sem sugestão de pick, mas as leituras de composição continuam. |
| Fase `opening` **sem mapa** | `opening: []` (não há pool nem noção de recomendado); o aviso `ally.opening.risk` continua, e a seção 3 cai na lista de `picks`. |
| Candidato sem dado de counter na abertura | Excluído de `opening` — `0/0` é falta de dado, não segurança (§5.3). |
| `firstPick` ausente | `phase: 'unknown'`, sem faixa, sem exceção; dimensionamento pelo fallback. |

---

## 9. UI

**Faixa de turno** no topo do `.panel__body` do card, acima do grid de 2
colunas. Um `<p>` com `aria-live="polite"`, `hidden` quando `text === null`.
Não é seção nova — é uma linha de contexto.

**Seção 3 muda de identidade conforme a fase:**

- fase `double` → cabeçalho "Melhores duplas", lista de `combos`
- fase `opening` **com mapa** → cabeçalho "Aberturas seguras", lista de `opening`
- fases `waiting` e `complete` → **placeholder**, sem lista de sugestão
  ("aguardando pick inimigo" / draft completo), conforme §3.1 e §8
- demais fases (incluindo `opening` **sem** mapa, que tem `opening: []`) →
  cabeçalho "Melhores picks", lista de `picks` (comportamento atual)

**Lista de abertura — `#opening-picks-list` + template próprio**, irmã das
outras duas, alternada por `hidden`. Cada linha traz o retrato, o nome e o
texto de vulnerabilidade no formato `livres/total` de §7 (ex.: "2 de 3 counters
ainda livres para o inimigo"), sempre rotulado, nunca um número solto.

Diferente das duplas, esta lista **tem os handlers de inserção**: cada linha
carrega **um** slug, então a interação é contratualmente a mesma da lista de
counter-picks — clique/toque insere no time aliado, botão direito/toque longo
no inimigo, `Enter`/`Shift+Enter` no teclado, com o mesmo feedback
não-bloqueante. É o motivo pelo qual a abertura pode reusar a mecânica que as
duplas não podem: o que impedia as duplas era terem dois slugs por linha, não a
lista ser nova.

> **`#counter-picks-list` e `#counter-row-template` continuam sendo contrato**
> (decisão da spec v1 §5). A lista de duplas usa um `<ul>` e um `<template>`
> **próprios**, irmãos dos atuais, alternando por `hidden`. Não reaproveitar o
> markup de picks para duplas: aquela lista carrega os handlers de inserção
> (clique/toque longo/`Enter`/`Shift+Enter`/recuperação de foco) desenhados
> para **um** slug por linha, e uma linha de dupla tem dois. Misturar os dois
> significados no mesmo template reabriria exatamente o risco que a v1 fechou.

**Foco na troca de fase:** alternar entre as três listas destaca do DOM a linha
que porventura tinha foco — exatamente o cenário para o qual
`restoreFocusIfDetached` (`draftBoard.ts:637-651`) já existe. **Reusar essa
função** em qualquer troca de fase, passando o container que ficou visível, em
vez de escrever um segundo mecanismo de recuperação de foco. Ela já trata o
caso de o browser ter movido o foco para `<body>` e cai no próprio container
quando não há linha para focar.

Inserção de dupla (clicar e preencher 2 slots) é **fora de escopo** neste
incremento — ver §10.

---

## 10. Fora de escopo

- Inserir a dupla inteira com um clique (2 slots de uma vez).
- Modelar bans na sequência de turno.
- Duplas para o time inimigo (previsão do que eles vão pegar).
- Trios / composição completa em uma tacada.
- Qualquer fonte de dado nova; o pipeline segue intocado.

---

## 11. Riscos

1. **`roleFill` é silencioso em 27% dos drafts** (pool de papel único). A seção
   de duplas vai parecer "só cobertura" nesses casos. É honesto, mas pode ler
   como feature quebrada — o `reason` deve deixar claro o que fundamentou a
   escolha, sem prometer papel quando não houve.
2. **Reativar o toggle de `firstPick` muda a UI para todos.** Foi escondido a
   pedido do produto; volta agora por outro pedido do produto. Se houver
   arrependimento, o custo de esconder de novo é uma linha — mas aí o turno
   passa a assumir sempre `ally` primeiro, o que só está correto em metade das
   partidas. **Turno e toggle andam juntos: um sem o outro é pior que nenhum.**
3. **Chave `score`** (§5.2) é acréscimo meu à cadeia aprovada. Removível, mas
   remover devolve os empates alfabéticos.
4. **Três listas alternando em seção 3** (`#counter-picks-list`, duplas e
   `#opening-picks-list`) aumentam a superfície de estado da UI. Mitigação:
   alternância por `hidden` num único ponto do renderer, e a lista de picks
   nunca muda de forma.

---

## 12. Critérios de aceite

- [ ] `analyzeDraft` continua pura e importável por `verify-data.mjs` sob type-stripping.
- [ ] Os 20 casos de §7 passam, na nova seção `[9]`; `[1]`-`[8]` seguem verdes e **sem uma linha editada**.
- [ ] `npm run check` sem erro novo; `npm run build` conclui sem reduzir páginas.
- [ ] `SHOW_FIRST_PICK_TOGGLE = true` e o toggle altera a faixa de turno em tempo real.
- [ ] Preenchimento livre preservado: é possível preencher qualquer slot em qualquer ordem, e um estado fora da sequência só faz a faixa sumir — sem bloqueio, sem erro.
- [ ] A faixa some (`hidden`) quando `text === null`; nunca exibe string vazia.
- [ ] Seção 3 alterna entre `#counter-picks-list`, a lista de duplas e `#opening-picks-list` conforme a fase; toda troca reusa `restoreFocusIfDetached` e não deixa o foco no `<body>`.
- [ ] `#counter-picks-list` e `#counter-row-template` inalterados; handlers de inserção intactos.
- [ ] Toda dupla exibida tem `reason` textual e toda abertura exibe `livres/total` rotulado; nenhum número aparece sem explicação.
- [ ] Linhas de `#opening-picks-list` inserem com a mesma interação da lista de counter-picks (clique, botão direito/toque longo, `Enter`/`Shift+Enter`).
- [ ] `opening` é preenchida **só** na fase `opening` com mapa, nunca inclui quem tem `total === 0`, e é `[]` em todo o resto; `picks` não ganhou campo de vulnerabilidade e segue o contrato do v1.
- [ ] `vulnerabilityOf` é exportada e chamável isolada (é o que os casos 12-15 exercitam).
- [ ] `analyzeDraft` sem `firstPick` devolve `phase: 'unknown'` sem lançar — é o que mantém a seção `[8]` literalmente intocada.
- [ ] Nada sob `scripts/` (exceto `verify-data.mjs`), `data/raw/` ou `src/data/` é modificado.
