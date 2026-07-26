// Tiny client-safe text-normalization helper. Mirrors the `stripAccents`
// in scripts/lib/normalize.mjs, but kept as its own copy here since that
// file lives in the build-time data pipeline and must never be imported
// from client-shipped code (src/scripts/*).

/** Strips diacritics (é -> e, ã -> a, ...) via Unicode NFD decomposition. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '');
}
