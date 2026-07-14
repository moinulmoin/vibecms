/**
 * Deterministic line-level diff over two arbitrary strings.
 *
 * Splits each input into an array of lines (empty string -> no lines),
 * builds a classic LCS length table, then backtracks to emit a DiffLine[]
 * in source order. No external dependencies; output is fully determined by
 * the two inputs.
 *
 * Line emission order during backtracking favors consuming `after`, so in the
 * final (reversed) output a replaced line renders as `del` (old text) then
 * `add` (new text).
 */

export type DiffLine = { type: 'add' | 'del' | 'same'; text: string };

/** Split a string into its lines; an empty string yields no lines. */
const lines = (s: string): string[] => (s === '' ? [] : s.split(/\r?\n/));

export function diffLines(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  const n = a.length;
  const m = b.length;

  // LCS length table: dp[i][j] = LCS length of a[0..i) and b[0..j).
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack from (n, m) to (0, 0), emitting lines in reverse source order.
  const result: DiffLine[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: 'same', text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // Favor consuming `after` on ties so the final output places `del`
      // before `add` for a replaced line.
      result.push({ type: 'add', text: b[j - 1] });
      j--;
    } else {
      result.push({ type: 'del', text: a[i - 1] });
      i--;
    }
  }

  result.reverse();
  return result;
}
