const INDEXNOW_KEY = /^[A-Za-z0-9-]{8,128}$/;

/**
 * The configured IndexNow key (Worker setting `INDEXNOW_KEY`), or null when it
 * is unset or not a valid key: 8 to 128 characters of a-z, A-Z, 0-9 and "-".
 * Both the public Worker (serving `/<key>.txt`) and the API (submitting) read
 * it through this so neither runs with a key the other would refuse.
 */
export function parseIndexNowKey(raw: string | null | undefined): string | null {
  const key = raw?.trim();
  return key && INDEXNOW_KEY.test(key) ? key : null;
}
