// Joins an app-root absolute path with Astro's configured `base`, so every
// hardcoded absolute reference (portraits, favicons, internal <a href>s)
// still resolves once the site is served under a sub-path — e.g. this
// project's GitHub Pages deploy at /brawdraft/. Astro's `base` config only
// rewrites URLs it generates itself (its own asset pipeline, route
// emission); it does not touch absolute paths written directly in markup
// or client-side scripts, so every such reference must be routed through
// this helper instead.
//
// `import.meta.env.BASE_URL` is a Vite-inlined compile-time constant, so
// it's safe to import this from both server-rendered .astro files and
// client-shipped code under src/scripts/.

/**
 * Prefixes `path` (e.g. "/brawlers/mr-p.png" or "/") with the site's base
 * path. Normalizes slashes so the join never produces "//", regardless of
 * whether `BASE_URL` itself carries a trailing slash.
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${suffix}`;
}
