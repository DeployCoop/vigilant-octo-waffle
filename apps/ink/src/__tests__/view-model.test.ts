/**
 * WS7 — pure view-model logic tests (Q7: parsing/dispatch + pure
 * logic; no render tests).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sparklineString } from '../components/Sparkline.js';
import { formatElapsed, progressBarFill } from '../components/ProgressBar.js';
import { MENU_ITEMS } from '../components/App.js';

describe('sparklineString', () => {
  it('empty data renders empty', () => {
    assert.equal(sparklineString([]), '');
  });

  it('flat data renders mid-level blocks (range collapses to 1)', () => {
    const out = sparklineString([5, 5, 5]);
    assert.equal(out.length, 3);
    assert.equal(out, '   ');
  });

  it('a ramp spans from low to high blocks', () => {
    const out = sparklineString([0, 5, 10]);
    assert.equal([...out].length, 3);
    assert.equal(out[0], ' ');
    assert.equal(out[2], '█');
  });

  it('clamps outliers into the char range', () => {
    const out = sparklineString([0, 100]);
    assert.equal(out.length, 2);
    assert.equal(out[1], '█');
  });
});

describe('progressBarFill', () => {
  it('0% is all empty; 100% is all filled', () => {
    const zero = progressBarFill(0, 10);
    assert.equal(zero.filledBar, '');
    assert.equal(zero.emptyBar, '░'.repeat(10));
    const full = progressBarFill(100, 10);
    assert.equal(full.filledBar, '█'.repeat(10));
    assert.equal(full.emptyBar, '');
  });

  it('clamps out-of-range percents', () => {
    assert.equal(progressBarFill(150, 4).clamped, 100);
    assert.equal(progressBarFill(-20, 4).clamped, 0);
  });

  it('50% of width 10 fills exactly 5 with no sub-block', () => {
    const half = progressBarFill(50, 10);
    assert.equal(half.filledBar, '█'.repeat(5));
    assert.equal(half.emptyBar, '░'.repeat(5));
  });

  it('fractional progress uses a sub-block char', () => {
    // 55% of 10 = 5.5 -> 5 full + remainder 0.5 -> subIndex 4 -> '▌'
    const out = progressBarFill(55, 10);
    assert.equal(out.filledBar, '█'.repeat(5) + '▌');
    assert.equal(out.emptyBar, '░'.repeat(4));
  });
});

describe('formatElapsed', () => {
  it('formats MM:SS with zero padding', () => {
    assert.equal(formatElapsed(0), '00:00');
    assert.equal(formatElapsed(9), '00:09');
    assert.equal(formatElapsed(65), '01:05');
    assert.equal(formatElapsed(600), '10:00');
  });

  it('minutes keep counting past 59 (no hour rollover)', () => {
    assert.equal(formatElapsed(3600), '60:00');
  });
});

describe('MENU_ITEMS (TUI view model)', () => {
  it('ids are unique and exit comes last', () => {
    const ids = MENU_ITEMS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.at(-1), 'exit');
  });

  it('every item has a label, icon, and description', () => {
    for (const item of MENU_ITEMS) {
      assert.ok(item.label.length > 0, item.id);
      assert.ok(item.icon.length > 0, item.id);
      assert.ok(item.description.length > 0, item.id);
    }
  });

  it('covers exactly the known screens', () => {
    const ids = MENU_ITEMS.map((m) => m.id).sort();
    assert.deepEqual(ids, [
      'apps',
      'doctor',
      'exit',
      'gitops',
      'ingress',
      'k3s',
      'namespaces',
      'secrets',
      'storage',
      'up',
      'waffle',
    ]);
  });
});
