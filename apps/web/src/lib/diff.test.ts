import { describe, it, expect } from 'vitest';
import { diffLines, type DiffLine } from './diff';

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
