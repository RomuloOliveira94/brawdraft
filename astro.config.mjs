// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages project-page deployment (see .github/workflows/deploy.yml):
  // the site is served at https://romulooliveira94.github.io/brawdraft/, so
  // every route lives under the /brawdraft base path.
  site: 'https://romulooliveira94.github.io',
  base: '/brawdraft',
  // Every route in this project is a directory-style page
  // (/brawlers/<slug>/index.html) and every internal <a href> already
  // written in the codebase ends in a trailing slash to match. Enforcing
  // "always" keeps that convention consistent under both `astro preview`
  // and GitHub Pages (src/lib/basePath.ts still normalizes defensively,
  // since it doesn't assume this setting).
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()]
  }
});