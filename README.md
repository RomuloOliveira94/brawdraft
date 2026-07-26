# BrawDraft

BrawDraft é um assistente de draft para Brawl Stars: seleção de mapa, banimentos, os
dois times, sugestões de counter-pick e análise de composição, tudo em um site
estático simples e rápido.

Este repositório contém, por enquanto, apenas a base do projeto (scaffold). As
funcionalidades de draft (dados dos brawlers, lógica de pick/ban, contadores,
análise de composição) são adicionadas em etapas futuras.

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
