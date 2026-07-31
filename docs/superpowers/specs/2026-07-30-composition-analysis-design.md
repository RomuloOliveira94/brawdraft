# Card "Análise de Composição" no Draft Board

- **Data:** 2026-07-30
- **Branch:** `feat/composition-analysis`
- **Status:** design aprovado, implementação pendente
- **Abordagem:** A — runtime puro, zero mudança no pipeline de dados

---

## 1. Contexto (por quê)

Hoje o draft board responde bem a uma pergunta só: _"quem countera o time inimigo?"_.
O painel `Melhores Counter-Picks` agrega counters e ordena por cobertura
(`src/lib/rank.ts:42-80`), mas trata os aliados apenas como **blocklist** —
em `src/scripts/draftBoard.ts:590-597`, `rankPicks` recebe `enemies` como sinal e
`exclude = getAllTaken()` (os 12 slots dos dois times) apenas para não sugerir
quem já está no board. Nada do que o **seu** time já escolheu influencia a
sugestão.

O outro painel, `O que falta no seu time`, olha só para os aliados e só para
classe: `analyzeComposition()` (`src/lib/composition.ts:21-49`) recebe um
`BrawlerClassName[]` e devolve 4 regras fixas de lacuna.

Resultado: dois painéis parciais, nenhum enxergando o draft inteiro. A feature
une os dois numa análise única de **composição completa** (aliados + inimigos +
mapa), que é a leitura que o jogador realmente faz nos segundos do draft.

**O que já existe e será reaproveitado** (nada disso precisa ser construído):

| Capacidade | Onde | Estado |
|---|---|---|
| Estado separado por time | `draftBoard.ts:22-29`, init `:123-130` | pronto |
| Re-render em tempo real | `assignSlot()` `:248-252` → `recompute()` `:588-611` | pronto |
| Agregação de counters ("X countera 2 dos 3") | `rank.ts:54-69` → `Pick.coverage` / `Pick.against` | pronto |
| Counters sensíveis ao mapa + fallback global | `rank.ts:58`, `map-counters.json` | pronto |
| Balanço de papéis por classe | `composition.ts:21-49` | parcial (só aliados, 4 regras) |
| Fit do pick com o mapa | `map-index.json` via `mapBonus` (`rank.ts:71-75`) | parcial (bônus +1 opaco) |

---

## 2. Decisões de produto (aprovadas)

1. **Sinergia por heurística** sobre dados existentes (`className` +
   categorias de `map-index.json`). **Sem fonte nova de dados.**
2. O painel **`O que falta no seu time` é absorvido** pelo card novo. Não
   ficam dois painéis dizendo coisas parecidas.
3. O painel **`Melhores Counter-Picks` também é absorvido**, como seção 3 do
   card, **por realocação de markup** — sem reescrita da interação. Detalhe e
   justificativa em §5.
4. **Abordagem A**: tudo em runtime, no cliente. O pipeline
   (`scripts/build-data.mjs` e amigos) não é tocado.

---

## 3. Arquitetura e fluxo

```
state (ally[3], enemy[3], mapId)
   │  assignSlot() → setSlug + recompute() + syncHash()   [draftBoard.ts:248-252]
   ▼
recompute()                                              [draftBoard.ts:588-611]
   │  monta os argumentos e chama:
   ▼
analyzeDraft(input) — função PURA                        [src/lib/composition.ts]
   │  DraftAnalysis { ally[], enemy[], picks[] }
   ▼
renderAnalysis(analysis) → card                          [draftBoard.ts]
```

**Tempo real:** não exige mudança nenhuma. `recompute()` já roda síncrono a
cada mutação de slot e os painéis já se reconstroem inteiros via
`replaceChildren()`. A feature só acrescenta uma chamada e uma função de render
dentro do fluxo existente.

**Pureza:** `analyzeDraft` não lê DOM, não lê `import` de dados e não tem
estado. Recebe tudo por parâmetro — mesma disciplina de `rankPicks`, e o que
torna possível testá-la em `scripts/verify-data.mjs` sem browser.

---

## 4. Motor: `analyzeDraft()`

Arquivo: `src/lib/composition.ts` (mesmo módulo, que passa a exportar a função
nova além de `analyzeComposition`).

> **Restrição de sintaxe:** `src/lib/*.ts` é importado direto por
> `scripts/verify-data.mjs` (`:9-10`) sob type-stripping nativo do Node. Vale a
> mesma regra já documentada em `rank.ts:1-4` — **erasable syntax only**: nada
> de `enum`, `namespace` ou parameter properties. Usar `type` unions.

### 4.1 Papéis

```ts
export type Role = 'frontline' | 'damage' | 'support';

/** Tank/Assassin seguram a frente; Marksman/Artillery/Damage Dealer fazem dano;
 *  Support/Controller sustentam. 'Unknown' mapeia para null e nunca preenche
 *  papel — mesma honestidade de composition.ts:35-43. */
const ROLE_BY_CLASS: Record<BrawlerClassName, Role | null>;
```

Distribuição real do roster (106 brawlers): frontline 35 (Tank 16 + Assassin 19),
damage 40 (Damage Dealer 21 + Marksman 11 + Artillery 8), support 31
(Controller 18 + Support 13). Nenhum brawler carrega `className: 'Unknown'`
hoje — o mapeamento para `null` é defensivo.

### 4.2 Entrada

```ts
export interface DraftInput {
  /** Slugs aliados já escolhidos, sem nulls. 0..3. */
  ally: string[];
  /** Slugs inimigos já escolhidos, sem nulls. 0..3. */
  enemy: string[];
  /** Mapa selecionado, ou null. Usado como flag e para o texto dos insights. */
  mapId: string | null;
  /** slug -> className. Construído uma vez no init a partir do DOM — ver
   *  "Origem do classOf" abaixo. */
  classOf: ReadonlyMap<string, BrawlerClassName>;
  /** Counters globais: counters-index.json. */
  countersIndex: CountersIndex;
  /** Counters do mapa selecionado: map-counters.json[mapId], ou null. */
  mapCounters: CountersIndex | null;
  /** Categorias do mapa por slug: map-index.json[mapId], ou null. */
  mapCategories: Record<string, string[]> | null;
  /** Slugs a nunca sugerir (picks + bans dos dois times). */
  exclude: string[];
  /** Resolve um slug para o nome de exibição. Opcional — ver abaixo. */
  nameOf?: (slug: string) => string;
}
```

**`nameOf` é opcional de propósito.** Os textos ilustrados em §4.4
(`"Colette responde a 2 dos 3 inimigos: Bull e Frank"`) citam nomes, mas o
resto do `DraftInput` só carrega slugs e classes — não há fonte de nomes.
`nameOf` fecha essa lacuna sem quebrar a pureza: quando é fornecido, os
insights que ganham com identificação (`ally.role.redundant.*`,
`ally.map.fit`, `enemy.counterable`) usam nomes; quando é omitido, cada um
cai numa formulação equivalente sem nomes.

Isso mantém `scripts/verify-data.mjs` livre de fixture de nomes — os casos de
§7 assertam `code`, não copy — e permite ao call site passar o `nameOf()` que
`draftBoard.ts` já tem (resolve pelo `tileIndex`). Insights sobre **ausência**
(`ally.role.missing.*`, `enemy.role.missing.*`) não citam nomes em nenhum dos
dois modos: o conteúdo deles é quem **não** está no time.

**Decisão — passar fatias já escopadas por mapa, não os JSONs inteiros.**
`mapCounters` e `mapCategories` chegam já resolvidos para o `mapId`, exatamente
como `rankPicks` recebe hoje (`draftBoard.ts:595-597`). `mapId` continua na
entrada apenas como flag ("tem mapa selecionado?") e para compor texto. Isso
mantém a função pura sem carregar os 168 KB de `map-counters.json` para dentro
dela e preserva a simetria com `rank.ts`.

**Nota de tipo:** `map-index.json[mapId]` é hoje consumido como
`MapBonus = Record<string, unknown>` (`rank.ts:10`, qualquer valor truthy vale
+1). A forma real é `Record<string, string[]>` — os rótulos de categoria.
`analyzeDraft` tipa o valor real porque precisa **ler os rótulos** para gerar o
motivo textual, não só testar truthiness.

**Origem do `classOf` — do DOM, não de `brawlers.json`.** O mapa é montado uma
vez no init a partir do `tileIndex`, lendo o `data-class-name` que os tiles
server-renderizados já carregam (`BrawlerGrid.astro:28`). É exatamente o padrão
que `recompute()` já usa hoje para alimentar `analyzeComposition`
(`draftBoard.ts:600-603`, via `tileIndex.get(slug)?.dataset.className`).

Motivo: `brawlers.json` tem 150 KB e **não entra em bundle de cliente hoje** —
é consumido só em build time pelas Content Collections. Importá-lo no
`draftBoard.ts` para obter uma única string por brawler abriria esse precedente
por nada, já que o dado está no DOM. O contrato
`ReadonlyMap<string, BrawlerClassName>` do `DraftInput` fica **intacto**: a
origem é detalhe do call site, e `analyzeDraft` segue pura e testável passando
um `Map` literal.

### 4.3 Saída

```ts
export type InsightTone = 'good' | 'warn' | 'info';

export interface Insight {
  /** Chave estável (ex.: 'ally.role.missing.frontline'). Para asserção em
   *  teste e para i18n futura — o teste nunca compara string de UI. */
  code: string;
  /** Texto pt-BR pronto para render. */
  text: string;
  tone: InsightTone;
  /** Slugs citados, para render futuro de retratos. Opcional. */
  refs?: string[];
}

/** Pick do rankPicks + o motivo textual do bônus de papel, quando houve. */
export interface SuggestedPick extends Pick {
  roleReason?: string;
}

export interface DraftAnalysis {
  ally: Insight[];
  enemy: Insight[];
  /** Lista COMPLETA, na ordem do rankPicks. O corte de exibição é do renderer. */
  picks: SuggestedPick[];
}

export function analyzeDraft(input: DraftInput): DraftAnalysis;
```

O campo `code` é o contrato de teste. Copy de UI pode mudar sem quebrar
`verify-data.mjs`.

**`picks` não é truncada.** `analyzeDraft` devolve a lista inteira que o
`rankPicks` produziu; quem fatia para 6 é o renderer, preservando o
comportamento atual do call site (`draftBoard.ts:597`, `.slice(0, 6)`). Manter
o corte na borda de apresentação deixa o motor livre de uma constante de UI e
permite que os testes assertem prefixo sem depender do limite exibido.

### 4.4 Regras

**Sinergia aliada (`analysis.ally`)**

| `code` | Condição | Tom |
|---|---|---|
| `ally.empty` | 0 picks aliados | `info` |
| `ally.role.missing.<role>` | papel sem nenhum aliado | `warn` |
| `ally.role.redundant.<role>` | 3 picks concentrados num papel só | `warn` |
| `ally.map.fit` | aliado listado numa categoria do mapa | `good` |
| `ally.balanced` | 3 picks, um papel cada, nenhum `warn` disparou | `good` |

O motivo sempre cita a evidência: `"Bibi e Edgar ocupam a frente — falta dano
de longo alcance"`, `"Piper é Atiradores em Shooting Star"`.

**Só insight `warn` bloqueia `ally.balanced`.** A condição é "3 picks **e**
nenhum `ally.role.missing.*` **e** nenhum `ally.role.redundant.*`" — insights
`good` como `ally.map.fit` coexistem livremente com `ally.balanced`. Um time
equilibrado que ainda por cima encaixa no mapa deve mostrar as duas coisas;
tratar `fit` como bloqueio inverteria o sentido do sinal.

**Fraquezas inimigas (`analysis.enemy`)**

| `code` | Condição | Tom |
|---|---|---|
| `enemy.empty` | 0 picks inimigos | `info` |
| `enemy.role.missing.<role>` | mesmo balanço aplicado ao array inimigo | `good` (é vantagem sua) |
| `enemy.counterable` | existe candidato com `coverage >= 2` | `good` |

`enemy.counterable` é derivado direto do `rankPicks` já existente:
`"Colette countera 2 dos 3: Bull e Frank"` sai de `pick.coverage` e
`pick.against` (`rank.ts:12-17`). **Zero cálculo novo.**

Não há `enemy.role.redundant.*` na v1. É **escolha deliberada de escopo**:
redundância no time inimigo é informação de menor valor acionável no momento do
draft (o jogador não muda o pick deles), e o sinal já aparece indiretamente via
`enemy.role.missing.*`. Fica em aberto para uma v2 se o uso pedir.

**Picks sugeridos (`analysis.picks`)**

`rankPicks(enemy, countersIndex, { exclude, mapBonus, mapCounters })` — a
chamada de hoje, intacta. Sobre o resultado, `analyzeDraft` anexa
`roleReason` quando o candidato preenche um papel que falta ao time aliado:
`"também cobre a frontline que falta"`.

**O bônus é rotulado, nunca um número opaco.** Se não há motivo em texto,
não há bônus. A ordenação do `rankPicks` (cobertura → score → slug) permanece a
autoridade; `roleReason` é anotação explicativa, não re-ranking. Isso mantém a
sugestão auditável pelo usuário e o golden test de ranking existente
(`verify-data.mjs:448-484`) válido sem alteração.

---

## 5. UI

Arquivos: `src/components/DraftBoard.astro` + `src/scripts/draftBoard.ts`.

**Card único** `Análise de Composição`, no lugar do painel
`O que falta no seu time` (`DraftBoard.astro:130-135`), com 3 seções:

1. **Seu time** — insights de `analysis.ally`
2. **Time inimigo** — insights de `analysis.enemy`
3. **Melhores picks** — `analysis.picks`

Padrões a respeitar (todos já no arquivo):

- Estrutura `.panel` / `.panel__header` / `.panel__body`, como os demais painéis.
- `aria-live="polite"` mantido na(s) lista(s), como em `:132` e `:142`.
- Linhas via `<template>` clonado, no padrão de `#composition-row-template`
  (`:190-195`) e `#counter-row-template` (`:197-208`). Tom do insight vira
  classe de cor no marcador; sem markup novo inventado.
- Render por `replaceChildren()` a cada `recompute()`, como
  `renderComposition()` (`:515-531`) e `renderSuggestions()` (`:551-586`).

### Decisão: seção 3 é realocação de markup, não reimplementação

O painel `Melhores Counter-Picks` (`DraftBoard.astro:136-145`) é **absorvido**
pelo card como seção 3. A lista **move** para dentro do card preservando
`#counter-picks-list`, seu `#counter-row-template` (`:197-208`) e todos os
handlers de interação **intactos, sem reescrita**.

Justificativa: essa lista carrega a interação mais intrincada do módulo —
clique/toque insere no time aliado, botão direito/toque longo insere no
inimigo, `Enter`/`Shift+Enter` no teclado, feedback não-bloqueante
(`flashFeedback`) e recuperação de foco após o re-render
(`restoreFocusIfDetached`, `draftBoard.ts:637-651`, que existe justamente
porque `replaceChildren()` destaca a linha focada a cada recompute).
Reimplementá-la para caber num card novo trocaria uma mudança de layout por uma
reescrita de comportamento — o maior risco de regressão de toda a feature, sem
ganho nenhum. Tratar a seção 3 como movimentação de markup mantém o risco
confinado ao CSS/estrutura e deixa a lógica de insert fora do diff.

Consequência para a implementação: os IDs e o template acima são **contrato**.
Renomeá-los obriga a mexer nos handlers e sai do escopo desta decisão.

O grid de resultados (`DraftBoard.astro:129-146`) passa de 2 colunas para o
card único. Se o card ficar alto demais no mobile, a alternativa é promovê-lo a
full-width entre `:126` e `:128` — decisão de layout a validar visualmente, não
bloqueante para o design.

---

## 6. Edge cases (estados honestos)

O princípio herdado de `composition.ts:35-43`: **nunca afirmar sobre dado que
não temos.** Omitir um sinal é aceitável; inventá-lo não.

| Situação | Comportamento |
|---|---|
| 0 picks nos dois times | `ally.empty` + `enemy.empty` com dica de uso. Sem picks. |
| Time parcial (1-2 picks) | Analisa o que há. Papéis faltantes são reportados, `ally.balanced` não dispara (exige 3). |
| `kaboom-canyon` selecionado | `mapCounters = null` → fallback para counters globais. **Comportamento já existente** (`rank.ts:55-58`), nada a implementar. **O fallback cobre só os counters:** o mapa está ausente de `map-counters.json` mas **presente** em `map-index.json`, então `mapBonus` continua ativo e o ranking **não** é igual ao global. Ver caso 7 em §7. |
| Nenhum mapa selecionado | `mapCategories = null` → seção de fit do mapa omitida; papéis e counters seguem. |
| Brawler sem categoria no mapa | Omite só o insight de fit dele. 13 brawlers não aparecem em categoria nenhuma. |
| Brawler sem counters (`alli`) | Não gera sugestão, não quebra. 1 brawler tem lista vazia em `counters-index.json`. |
| Inimigo que não countera ninguém | 49 brawlers têm `counterFor` vazio — normal, sem insight. |
| `className: 'Unknown'` | Nunca preenche papel; nunca habilita `ally.balanced`. |

---

## 7. Testes

Gate automatizado: **`scripts/verify-data.mjs`** — único do projeto (não há
test runner no `package.json`). Já importa `analyzeComposition` (`:10`) e
`rankPicks` (`:9`), e já tem seção de composição (`:113-131`) e de golden
ranking (`:448-484`). Os casos de `analyzeDraft` entram no mesmo padrão
`check(descrição, condição, detalhe)`.

Casos fixos mínimos:

1. Draft vazio → `ally = ['ally.empty']`, `enemy = ['enemy.empty']`, `picks = []`.
2. Aliados `[Tank, Support, Marksman]` → nenhum `ally.role.missing.*`, dispara `ally.balanced`.
3. Aliados `[Assassin, Assassin, Tank]` → os 3 são frontline, logo o conjunto
   exato é `ally.role.redundant.frontline` + `ally.role.missing.damage` +
   `ally.role.missing.support`.
4. Aliados `[Tank, Support, Unknown]` → `ally.role.missing.damage`, **nunca** `ally.balanced` (preserva a garantia de `:113-131`).
5. Inimigos `['bull','frank','rosa']` **sem mapa** → prefixo de 6 de `picks` ===
   `colette:3/9, gale:2/3, cordelius:1/2, shelly:1/2, chester:1/1, lou:1/1`
   (a lista completa tem exatamente 6 aqui, então prefixo === total).
6. Mesmos inimigos + `bridge-too-far` → prefixo de 4 ===
   `clancy:3/8, colette:3/7, piper:2/3, spike:1/1` (a lista completa tem 4).
7. Mesmos inimigos + `kaboom-canyon` → prefixo de 6 ===
   `colette:3/10, gale:2/4, cordelius:1/3, lou:1/2, shelly:1/2, chester:1/1`.
8. Inimigo `['alli']` → `picks = []`, sem exceção.
9. Todo `Insight` tem `code` não-vazio, `text` não-vazio e `code` único dentro da sua seção.

> **Atenção — estes valores incluem `mapBonus`, os goldens atuais não.**
> §4.4 manda `analyzeDraft` chamar `rankPicks` com `mapBonus`, enquanto as
> asserções existentes em `verify-data.mjs:509-527` exercitam `rankPicks`
> direto, **sem** `mapBonus`. Daí as duas divergências:
>
> - **Caso 6:** `piper` sai de `2/2` (golden atual) para `2/3` — ganha +1 por
>   estar numa categoria de `map-index.json` em `bridge-too-far`.
> - **Caso 7:** `kaboom-canyon` **não** reproduz o ranking global. O mapa está
>   ausente de `map-counters.json` (fallback de counters) mas **presente** em
>   `map-index.json`, então o bônus continua valendo: quem está nas categorias
>   do mapa sobe +1 (`colette`, `gale`, `cordelius`, `lou` — `shelly` e
>   `chester` não), e `lou` (`1/1` → `1/2`) empata com `shelly` e passa à
>   frente no desempate por slug.
>
> Os goldens de `rankPicks` em `:509-527` **permanecem válidos como estão** —
> testam outra função, com outros argumentos. Não "corrigir" um pelo outro.
> Valores acima conferidos executando `src/lib/rank.ts` contra os JSONs
> commitados em 2026-07-30.

Interação (clique/teclado/foco/mobile) fica para o QA, depois da implementação.

---

## 8. Critérios de aceite

- [ ] `analyzeDraft` é pura: sem DOM, sem import de dados, sem estado. Chamá-la duas vezes com a mesma entrada dá a mesma saída.
- [ ] `src/lib/composition.ts` continua importável por `verify-data.mjs` sob type-stripping (erasable syntax only).
- [ ] Os 9 casos da seção 7 passam em `npm run data:verify`, e a suíte inteira segue verde.
- [ ] `npm run check` (astro check, TS strict) passa sem erro novo.
- [ ] `npm run build` conclui sem erro e sem reduzir o número de páginas geradas.
- [ ] O DOM final tem **um** card de análise; o painel `O que falta no seu time` não existe mais.
- [ ] Todo insight exibido tem motivo textual. Nenhum score numérico sem explicação aparece na UI.
- [ ] Seção 3 preserva: clique insere no aliado, botão direito/toque longo insere no inimigo, `Enter`/`Shift+Enter` funcionam, foco é recuperado após re-render, brawler duplicado dá feedback e não insere.
- [ ] Draft vazio mostra dica de uso nas 3 seções, sem lista vazia silenciosa.
- [ ] Selecionar `kaboom-canyon` não quebra e não mente: sugestões seguem saindo (fallback global).
- [ ] Mudar qualquer slot atualiza o card no mesmo `recompute()`, sem flicker e sem chamada assíncrona.
- [ ] `aria-live` preservado; leitor de tela anuncia a atualização uma vez por mudança.
- [ ] Nenhum arquivo sob `scripts/` (exceto `verify-data.mjs`), `data/raw/` ou `src/data/` é modificado.
- [ ] O comentário defasado de `rank.ts:58` foi corrigido (ver §11).

---

## 9. Fora de escopo

- Matriz de sinergia par-a-par (X+Y funciona junto) — não existe nos dados e
  não será inventada.
- Win rate, pick rate, tier list. O README posiciona o app explicitamente como
  _"não é uma ferramenta de estatísticas nem de meta"_.
- Novas fontes de dados (range, HP, velocidade) e qualquer mudança no pipeline.
- Persistência da análise no hash da URL — a análise é derivada do estado que
  já é serializado; não tem estado próprio.

---

## 10. Riscos

1. **Heurística é opinião, não dado.** Sinergia derivada de `className` vai
   produzir afirmações contestáveis por jogadores experientes ("Tank+Tank é
   ruim" é falso em vários mapas). Mitigação: todo insight cita a evidência que
   o gerou, e o tom é de observação, não de veredito.
2. **Cobertura rala das categorias de mapa.** São 21 rótulos distintos, mas
   vários aparecem em 1 único mapa dos 26 (`Mid`, `Longo Alcance / Suporte`,
   `Zone Ofensivo`). O sinal de fit será silencioso na maior parte dos casos —
   é esperado, não é bug.
3. **Realocação da lista de picks é o maior risco de regressão** do trabalho.
   Recomendado implementar em dois passos: primeiro o card com as seções 1 e 2
   (absorvendo o painel de composição), depois mover a seção 3 — cada passo
   verificável isolado. Ver a decisão em §5: a seção 3 é movimentação de
   markup, com IDs e template tratados como contrato.

---

## 11. Notas de implementação

- **Corrigir o comentário defasado de `rank.ts:58`.** Ele diz
  `// [] for the 14 brawlers with no counter data`, número que ficou para trás:
  desde o suplemento de `meta-extra.txt` (commits `1ea597f`/`bcbf633`) só
  **1** brawler segue sem counters — `alli`, o mesmo que
  `verify-data.mjs` já usa como caso de ranking vazio. A linha é justamente a
  do fallback por inimigo que a feature exercita, então vale corrigir no mesmo
  trabalho em vez de deixar um número errado ao lado da lógica nova. Só o
  comentário muda; o comportamento não.
