import { describe, expect, it } from 'vitest';

import type { EmbeddingClient } from '@displayer/agent';

import { runRetrieval, type RetrievalDocument, type RetrievalQuery } from '../src/retrieval.js';

/**
 * A stand-in embedder that maps text to a hand-written vector.
 *
 * Using fixed vectors rather than the real model makes the ranking asserted
 * exactly; a real run is measured live by the CLI, not by this test.
 */
function fakeEmbedder(
  vectors: Record<string, readonly number[]>,
  byQuery: Record<string, readonly number[]>,
) {
  return {
    async embedDocuments(documents: readonly { title: string; text: string }[]) {
      return documents.map((document) => {
        const vector = vectors[document.title];
        if (!vector) throw new Error(`No vector for ${document.title}`);
        return [...vector];
      });
    },
    async embedQuery(query: string) {
      const vector = byQuery[query];
      if (!vector) throw new Error(`No vector for ${query}`);
      return [...vector];
    },
  } as unknown as EmbeddingClient;
}

const corpus: readonly RetrievalDocument[] = [
  { id: 'a', title: 'Alpha', text: 'alpha text' },
  { id: 'b', title: 'Beta', text: 'beta text' },
  { id: 'c', title: 'Gamma', text: 'gamma text' },
];

describe('runRetrieval', () => {
  it('scores a correct top hit as recall@1', async () => {
    const embedder = fakeEmbedder(
      { Alpha: [1, 0], Beta: [0, 1], Gamma: [0.5, 0.5] },
      { 'find alpha': [1, 0] },
    );
    const queries: RetrievalQuery[] = [{ query: 'find alpha', expectedId: 'a' }];

    const report = await runRetrieval(embedder, corpus, queries);
    expect(report.recallAt1).toBe(1);
    expect(report.mrr).toBe(1);
    expect(report.misses).toEqual([]);
  });

  it('scores a wrong top hit as recall@3 but not recall@1', async () => {
    const embedder = fakeEmbedder(
      { Alpha: [1, 0], Beta: [0, 1], Gamma: [0.5, 0.5] },
      // This query points at Beta, but claims to want Alpha.
      { wantAlpha: [0, 1] },
    );
    const queries: RetrievalQuery[] = [{ query: 'wantAlpha', expectedId: 'a' }];

    const report = await runRetrieval(embedder, corpus, queries);
    expect(report.recallAt1).toBe(0);
    expect(report.recallAt3).toBe(1);
    expect(report.misses).toHaveLength(0);
  });

  it('counts a document ranked second as recall@3 but not recall@1', async () => {
    const embedder = fakeEmbedder(
      { Alpha: [1, 0], Beta: [0.9, 0.1], Gamma: [0, 1] },
      { 'find alpha': [1, 0] },
    );

    const report = await runRetrieval(embedder, corpus, [{ query: 'find alpha', expectedId: 'c' }]);
    expect(report.recallAt1).toBe(0);
    expect(report.recallAt3).toBe(1);
    expect(report.mrr).toBeCloseTo(1 / 3, 5);
  });

  it('reports the top hit for a miss so a regression is diagnosable', async () => {
    // A corpus larger than k is required for a document to fall outside the top
    // 3; with only three documents every expected id is always retrieved.
    const wide: readonly RetrievalDocument[] = [
      ...corpus,
      { id: 'd', title: 'Delta', text: 'delta text' },
      { id: 'e', title: 'Epsilon', text: 'epsilon text' },
    ];
    const embedder = fakeEmbedder(
      { Alpha: [1, 0], Beta: [0, 1], Gamma: [0.5, 0.5], Delta: [0.1, 0.9], Epsilon: [0, 1] },
      { unrelated: [0, 1] },
    );
    const report = await runRetrieval(embedder, wide, [{ query: 'unrelated', expectedId: 'a' }]);
    expect(report.recallAt3).toBe(0);
    // Beta and Epsilon produce identical vectors, so the tie keeps corpus order.
    expect(report.misses).toEqual([{ query: 'unrelated', expectedId: 'a', got: 'b' }]);
  });
});
