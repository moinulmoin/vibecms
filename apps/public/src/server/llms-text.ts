/**
 * llms.txt is a line-oriented Markdown manifest — the first file agents fetch
 * to bootstrap trust in a site. Fields writable by any posts:create/update
 * token holder (site name, post titles, excerpts) must stay exactly one line
 * of plain text: flatten control characters and escape the link-text closer
 * so content cannot forge manifest sections or links.
 */
export function sanitizeLlmsField(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/]/g, "\\]").trim();
}
