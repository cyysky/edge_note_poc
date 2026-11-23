import { describe, expect, it } from 'vitest';

import { describe as describeValues, median, scoreCase, scoreToolCall } from '../src/scoring.js';

describe('scoreCase', () => {
  it('passes when every required word is present', () => {
    const outcome = scoreCase('A red circle and a navy rectangle.', {
      allOf: ['circle', 'rectangle'],
      anyOf: ['red', 'navy'],
    });
    expect(outcome.passed).toBe(true);
    expect(outcome.failures).toEqual([]);
  });

  it('fails when a required word is missing', () => {
    const outcome = scoreCase('A red circle.', { allOf: ['circle', 'rectangle'] });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]).toContain('rectangle');
  });

  it('enforces minHits instead of stopping at the first match', () => {
    const outcome = scoreCase('The circle is red.', {
      anyOf: ['red', 'navy', 'blue'],
      minHits: 2,
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]).toContain('matched 1/2');
  });

  it('fails on a forbidden phrase, catching a hallucinated attachment', () => {
    const outcome = scoreCase('There is a cat in the image.', { noneOf: ['cat'] });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]).toContain('cat');
  });

  it('normalises curly quotes and hyphen variants', () => {
    const outcome = scoreCase('It says \u201cquick brown fox\u201d and a navy\u2010blue box.', {
      allOf: ['quick brown fox', 'navy-blue'],
    });
    expect(outcome.passed).toBe(true);
  });
});

describe('scoreToolCall', () => {
  it('passes when the required tool was called', () => {
    expect(scoreToolCall([{ name: 'create_note' }], [{ name: 'create_note' }]).passed).toBe(true);
  });

  it('fails when the model answered without calling the tool', () => {
    const outcome = scoreToolCall([], [{ name: 'create_note' }]);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]).toContain('create_note');
  });

  it('honours a minimum count', () => {
    const outcome = scoreToolCall(
      [{ name: 'search_notes' }],
      [{ name: 'search_notes', atLeast: 2 }],
    );
    expect(outcome.passed).toBe(false);
  });
});

describe('median', () => {
  it('returns the middle value of an odd sample', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the two middle values of an even sample', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('ignores a single outlier rather than averaging it in', () => {
    // This is why the report quotes the median: one contended run must not move it.
    expect(median([100, 100, 100, 100, 10_000])).toBe(100);
  });
});

describe('describe', () => {
  it('reports spread so a noisy case is visible', () => {
    const stats = describeValues([10, 10, 10]);
    expect(stats.stdDev).toBe(0);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(10);
  });
});
