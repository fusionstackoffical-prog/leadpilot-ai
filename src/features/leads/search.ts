/**
 * Make a search term safe to embed in a PostgREST `or=(...ilike...)` filter:
 * drop characters that would change the filter's structure or act as wildcards.
 */
export function sanitizeSearch(input: string) {
  return input
    .replace(/[%_\,()*:."']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}
