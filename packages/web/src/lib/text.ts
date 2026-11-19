/** Lowercase without accents, so a search for "maquinas" finds "Máquinas" (UI copy is Spanish). */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Every word of `query` appears in `haystack` (any order, accent-insensitive). An empty query matches. */
export function matchesWords(haystack: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hay = fold(haystack);
  return words.every((w) => hay.includes(w));
}
