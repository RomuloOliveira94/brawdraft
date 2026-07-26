# BrawDraft

BrawDraft é um assistente de draft para Brawl Stars: seleção de mapa, banimentos, os
dois times, sugestões de counter-pick e análise de composição, tudo em um site
estático simples e rápido.

🔗 **Site publicado:** https://romulooliveira94.github.io/brawdraft/

## Deploy

O site é publicado no GitHub Pages a partir do branch `main` via GitHub
Actions (`.github/workflows/deploy.yml`): todo push em `main` roda
`npm ci && npm run build` e publica o conteúdo de `dist/`. O workflow também
pode ser disparado manualmente (`workflow_dispatch`) na aba Actions do
repositório.

O deploy **não** roda `npm run data:all` — esse passo busca dados na API
pública do Brawlify (`api.brawlapi.com`) e tornaria o build do CI
não-determinístico (dependente de rede/uptime de terceiros). Por isso todo o
JSON gerado em `src/data/` e as ~139 imagens em `public/` são versionados no
repositório: o build de produção roda inteiramente offline a partir deles.

Para atualizar os dados localmente (novos brawlers/mapas, mudanças na API):

```sh
npm run data:all   # busca, parseia e valida os dados — NÃO roda em CI
```

Revise e commite as mudanças em `src/data/*.json` e `public/` normalmente; o
próximo deploy em `main` já sai com os dados atualizados.

## Stack

- [Astro](https://astro.build) — site estático
- [Tailwind CSS](https://tailwindcss.com) v4 (via `@tailwindcss/vite`)
- TypeScript em modo `strict`
- JavaScript puro (sem framework de UI como React/Vue)

## Como rodar

```sh
npm install
npm run dev       # servidor de desenvolvimento
npm run build     # build de produção em ./dist/
npm run preview   # pré-visualiza o build de produção
npm run check     # verificação de tipos (astro check)
```

## Estrutura de pastas

```text
/
├── public/                 # arquivos estáticos servidos como estão (favicons, etc.)
│   └── brawlers/           # imagens/ícones dos brawlers (gerados pelo pipeline de dados)
├── scripts/                # scripts do pipeline de dados (fetch/parse/verify)
├── data/
│   └── raw/                # dados brutos baixados, antes do parse
├── src/
│   ├── assets/             # imagens e outros assets processados pelo Astro
│   ├── components/         # componentes Astro/JS reutilizáveis
│   ├── data/                # dados já processados (JSON) consumidos pelo site
│   ├── layouts/            # layouts de página (ex.: BaseLayout.astro)
│   ├── lib/                # utilitários e lógica compartilhada
│   ├── pages/              # rotas do site (cada arquivo = uma página)
│   └── styles/             # CSS global (import do Tailwind)
└── package.json
```

`scripts/`, `data/raw/`, `src/data/*.json` e `public/brawlers/` ainda não existem
neste ponto do projeto — são criados por uma etapa posterior do pipeline de dados.
