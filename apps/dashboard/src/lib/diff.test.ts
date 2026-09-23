import { describe, it, expect } from 'vitest';
import { collapseUnchanged, diffLines, type DiffLine } from './diff';

// Helper: build the exact DiffLine[] the contract expects.
const same = (text: string): DiffLine => ({ type: 'same', text });
const add = (text: string): DiffLine => ({ type: 'add', text });
const del = (text: string): DiffLine => ({ type: 'del', text });

describe('diffLines', () => {
  it('identical multi-line input -> every line same', () => {
    const text = 'alpha\nbeta\ngamma';
    expect(diffLines(text, text)).toEqual([
      same('alpha'),
      same('beta'),
      same('gamma'),
    ]);
  });

  it('pure addition -> original same, appended lines add', () => {
    const before = 'alpha\nbeta';
    const after = 'alpha\nbeta\ngamma\ndelta';
    expect(diffLines(before, after)).toEqual([
      same('alpha'),
      same('beta'),
      add('gamma'),
      add('delta'),
    ]);
  });

  it('pure deletion -> kept lines same, removed lines del', () => {
    const before = 'alpha\nbeta\ngamma\ndelta';
    const after = 'alpha\nbeta';
    expect(diffLines(before, after)).toEqual([
      same('alpha'),
      same('beta'),
      del('gamma'),
      del('delta'),
    ]);
  });

  it('single changed middle line -> del old then add new, surrounding same', () => {
    const before = 'alpha\nOLD\ngamma';
    const after = 'alpha\nNEW\ngamma';
    expect(diffLines(before, after)).toEqual([
      same('alpha'),
      del('OLD'),
      add('NEW'),
      same('gamma'),
    ]);
  });

  it('empty before + non-empty after -> all add', () => {
    expect(diffLines('', 'one\ntwo')).toEqual([add('one'), add('two')]);
  });

  it('non-empty before + empty after -> all del', () => {
    expect(diffLines('one\ntwo', '')).toEqual([del('one'), del('two')]);
  });

  it('both empty -> []', () => {
    expect(diffLines('', '')).toEqual([]);
  });
});

describe('diffLines at scale', () => {
  it('handles a small edit in a long document without an n·m table', () => {
    const base = Array.from({ length: 20000 }, (_, i) => `line ${i}`)
    const edited = [...base]
    edited[10000] = 'changed'
    edited.splice(15000, 0, 'inserted')
    const result = diffLines(base.join('\n'), edited.join('\n'))
    expect(result.filter((line) => line.type !== 'same')).toEqual([del('line 10000'), add('changed'), add('inserted')])
  })

  it('groups a rewritten block as removals then additions', () => {
    expect(diffLines('a\nb\nc\nd', 'a\nx\ny\nd')).toEqual([same('a'), del('b'), del('c'), add('x'), add('y'), same('d')])
  })
})

describe('collapseUnchanged', () => {
  it('keeps context around changes and folds the rest', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    const after = before.replace('l10', 'L10')
    const hunks = collapseUnchanged(diffLines(before, after), 2)
    expect(hunks.map((hunk) => hunk.type)).toEqual(['skip', 'lines', 'skip'])
    expect(hunks[0]).toMatchObject({ count: 8 })
    const middle = hunks[1]
    expect(middle.type === 'lines' ? middle.lines.map((line) => line.text) : []).toEqual(['l8', 'l9', 'l10', 'L10', 'l11', 'l12'])
  })
})

describe('diffLines property checks', () => {
  function lcsLength(a: string[], b: string[]) {
    const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
    return dp[a.length][b.length]
  }
  let seed = 12345
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const randomDoc = () => Array.from({ length: Math.floor(rand() * 14) }, () => 'abcde'[Math.floor(rand() * 5)])

  it('reconstructs both sides and is minimal (matches a naive LCS) on random inputs', () => {
    for (let run = 0; run < 2000; run++) {
      const a = randomDoc()
      const b = randomDoc()
      const diff = diffLines(a.join('\n'), b.join('\n'))
      expect(diff.filter((line) => line.type !== 'add').map((line) => line.text)).toEqual(a.join('\n') === '' ? [] : a)
      expect(diff.filter((line) => line.type !== 'del').map((line) => line.text)).toEqual(b.join('\n') === '' ? [] : b)
      const lcs = a.join('\n') === '' || b.join('\n') === '' ? 0 : lcsLength(a, b)
      expect(diff.filter((line) => line.type === 'same')).toHaveLength(lcs)
    }
  })
})
