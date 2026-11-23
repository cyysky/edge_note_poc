/**
 * Scoring for benchmark cases.
 *
 * Every case declares what a correct answer must contain and what it must not.
 * The checks are deliberately lexical rather than judged by another model: a
 * local 2B model writing its own rubric would make the score unfalsifiable,
 * which is exactly what a benchmark must avoid.
 */

export interface CaseExpectation {
  /** At least `minHits` of these must appear, case-insensitive. */
  readonly anyOf?: readonly string[];
  readonly minHits?: number;
  /** Every one of these must appear. */
  readonly allOf?: readonly string[];
  /** None of these may appear; used to catch a hallucinated attachment. */
  readonly noneOf?: readonly string[];
}

export interface CaseOutcome {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

function normalise(text: string): string {
  // Curly quotes and non-breaking hyphens come back from the model often enough
  // that a strict substring check would fail a correct answer.
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ');
}

export function scoreCase(answer: string, expectation: CaseExpectation): CaseOutcome {
  const text = normalise(answer);
  const failures: string[] = [];

  if (expectation.allOf) {
    for (const needle of expectation.allOf) {
      if (!text.includes(normalise(needle))) failures.push(`missing "${needle}"`);
    }
  }

  if (expectation.anyOf) {
    const hits = expectation.anyOf.filter((needle) => text.includes(normalise(needle)));
    const required = expectation.minHits ?? 1;
    if (hits.length < required) {
      failures.push(
        `matched ${hits.length}/${required} of [${expectation.anyOf.join(', ')}] (got: ${
          hits.join(', ') || 'none'
        })`,
      );
    }
  }

  for (const needle of expectation.noneOf ?? []) {
    if (text.includes(normalise(needle))) failures.push(`unexpected "${needle}"`);
  }

  return { passed: failures.length === 0, failures };
}

export function scoreToolCall(
  calls: readonly { readonly name: string }[],
  expectations: readonly { readonly name: string; readonly atLeast?: number }[],
): CaseOutcome {
  const failures: string[] = [];
  for (const expectation of expectations) {
    const count = calls.filter((call) => call.name === expectation.name).length;
    const required = expectation.atLeast ?? 1;
    if (count < required) {
      failures.push(`expected ${required}× ${expectation.name}, saw ${count}`);
    }
  }
  return { passed: failures.length === 0, failures };
}

/** Median is the headline number: one cold or contended run must not move it. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Mean and population standard deviation, for the latency spread column. */
export function describe(values: readonly number[]): {
  readonly median: number;
  readonly mean: number;
  readonly stdDev: number;
  readonly min: number;
  readonly max: number;
} {
  if (values.length === 0) return { median: 0, mean: 0, stdDev: 0, min: 0, max: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    median: median(values),
    mean,
    stdDev: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
