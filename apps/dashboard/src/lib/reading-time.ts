/**
 * Estimate reading time from raw Markdown source.
 *
 * 225 words per minute, rounded up, with a 1-minute floor.
 * Computed purely at render time from content_markdown — no DB column,
 * no migration. Word counting mirrors the renderer's own heuristic
 * (split on whitespace, drop empties) so the two stay consistent.
 *
 * Examples:
 *   ""            -> 1   (floor)
 *   "one two"     -> 1
 *   225 words     -> 1   (ceil(225/225) = 1)
 *   226 words     -> 2
 *   450 words     -> 2
 */
export function readingTimeMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 225));
}
