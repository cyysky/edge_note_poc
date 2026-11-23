import { rankBySimilarity, type EmbeddingClient } from '@displayer/agent';

/**
 * Retrieval quality for the notes search path.
 *
 * Measures recall@k and MRR over a fixed corpus with paraphrased queries, so a
 * change to prompts, chunking or the embedding model shows up as a number rather
 * than as "search feels worse". The paraphrase is the point: an exact-word query
 * would pass even with a bag-of-words index and would prove nothing.
 */
export interface RetrievalDocument {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

export interface RetrievalQuery {
  readonly query: string;
  /** The document a person would expect first. */
  readonly expectedId: string;
}

export const RETRIEVAL_CORPUS: readonly RetrievalDocument[] = [
  {
    id: 'fox',
    title: 'Fox sighting',
    text: 'A red fox jumped over a lazy dog in the garden this morning.',
  },
  {
    id: 'groceries',
    title: 'Groceries',
    text: 'Buy oat milk, eggs, rice, and two kilograms of oranges.',
  },
  {
    id: 'standup',
    title: 'Team standup',
    text: 'Sync meeting moved to Tuesday 10am; bring the migration plan.',
  },
  {
    id: 'invoice',
    title: 'Invoice 2041',
    text: 'The client has not paid invoice 2041 yet; send a reminder on Friday.',
  },
  {
    id: 'flight',
    title: 'Flight booking',
    text: 'Book a window seat to Kuala Lumpur, departing early next month.',
  },
  {
    id: 'bug',
    title: 'Login bug',
    text: 'Users cannot sign in after the password reset; session cookie is dropped.',
  },
  {
    id: 'recipe',
    title: 'Dinner idea',
    text: 'Thirty-minute lentil curry with coconut milk and spinach.',
  },
  {
    id: 'trip',
    title: 'Hiking plan',
    text: 'Weekend hike up the hill, meet at the trailhead at seven sharp.',
  },
];

export const RETRIEVAL_QUERIES: readonly RetrievalQuery[] = [
  { query: 'animal jumping over a dog', expectedId: 'fox' },
  { query: 'what do I need to pick up from the shop', expectedId: 'groceries' },
  { query: 'when is the team meeting', expectedId: 'standup' },
  { query: 'unpaid customer bill', expectedId: 'invoice' },
  { query: 'travel plans', expectedId: 'flight' },
  { query: 'people cannot log in', expectedId: 'bug' },
  { query: 'easy dinner recipe', expectedId: 'recipe' },
  { query: 'walk outdoors on the weekend', expectedId: 'trip' },
];

export interface RetrievalReport {
  readonly queries: number;
  readonly recallAt1: number;
  readonly recallAt3: number;
  readonly mrr: number;
  readonly misses: readonly {
    readonly query: string;
    readonly expectedId: string;
    readonly got: string;
  }[];
}

export async function runRetrieval(
  embedder: EmbeddingClient,
  corpus: readonly RetrievalDocument[] = RETRIEVAL_CORPUS,
  queries: readonly RetrievalQuery[] = RETRIEVAL_QUERIES,
): Promise<RetrievalReport> {
  const vectors = await embedder.embedDocuments(
    corpus.map((document) => ({ title: document.title, text: document.text })),
  );

  let hits1 = 0;
  let hits3 = 0;
  let reciprocalRankSum = 0;
  const misses: { query: string; expectedId: string; got: string }[] = [];

  // `embedQuery` is the only path that applies the retrieval prefix. Batching
  // through `embedTexts` would drop it and silently measure the wrong thing.
  const prompted = await Promise.all(queries.map((entry) => embedder.embedQuery(entry.query)));

  queries.forEach((entry, index) => {
    const ranked = rankBySimilarity(prompted[index] ?? [], corpus, vectors, corpus.length);
    const position = ranked.findIndex((scored) => scored.item.id === entry.expectedId);
    if (position === 0) hits1 += 1;
    if (position >= 0 && position < 3) {
      hits3 += 1;
      reciprocalRankSum += 1 / (position + 1);
    } else {
      // Ranking is over the whole corpus, so a document that is present but
      // below k is still a retrieval miss for the search path that keeps k hits.
      misses.push({
        query: entry.query,
        expectedId: entry.expectedId,
        got: ranked[0]?.item.id ?? 'none',
      });
    }
  });

  return {
    queries: queries.length,
    recallAt1: queries.length === 0 ? 0 : hits1 / queries.length,
    recallAt3: queries.length === 0 ? 0 : hits3 / queries.length,
    mrr: queries.length === 0 ? 0 : reciprocalRankSum / queries.length,
    misses,
  };
}
