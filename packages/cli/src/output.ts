// Stable, documented exit codes (see `vibecms --help`).
export const EXIT = {
  OK: 0,
  OTHER: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  CONFLICT: 5,
  RATE_LIMIT: 6,
} as const;

export function exitCodeForStatus(status: number): number {
  if (status === 401 || status === 403) return EXIT.AUTH;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 409) return EXIT.CONFLICT;
  if (status === 429) return EXIT.RATE_LIMIT;
  return EXIT.OTHER;
}

export type OutputFormat = { json?: boolean; ndjson?: boolean };

// All machine output goes to stdout as JSON; no color, no spinners.
export function printData(data: unknown, fmt: OutputFormat): void {
  if (fmt.ndjson && Array.isArray(data)) {
    for (const item of data) process.stdout.write(`${JSON.stringify(item)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(data, null, fmt.json ? 0 : 2)}\n`);
}

// Errors go to stderr; process exits nonzero with a stable code.
export function fail(payload: unknown, code: number): never {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  process.stderr.write(`${text}\n`);
  process.exit(code);
}
