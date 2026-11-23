import type { CaseExpectation } from './scoring.js';

/**
 * What each case measures.
 *
 * `capability` is the axis the report groups on, so a regression is attributable
 * to text, vision, audio or tools rather than to "the model got worse".
 */
export type Capability = 'text' | 'image' | 'audio' | 'mixed' | 'tools';

export interface BenchCase {
  readonly id: string;
  readonly capability: Capability;
  readonly prompt: string;
  /** Paths relative to the repository root. */
  readonly images?: readonly string[];
  readonly audio?: readonly string[];
  readonly expectAnswer?: CaseExpectation;
  /** Tool names the model must call, with a minimum count. */
  readonly expectTools?: readonly { readonly name: string; readonly atLeast?: number }[];
}

/**
 * Ground truth for the bundled samples.
 *
 * `samples/test_shapes.png` is a red circle and a navy rectangle labelled
 * "LIQUIDOMNI TEST"; `samples/test_speech.wav` is a voice saying the quick brown
 * fox line. These assertions are only meaningful for those exact files, which is
 * why the paths are pinned here rather than passed in.
 */
export const CASES: readonly BenchCase[] = [
  {
    id: 'text-exact',
    capability: 'text',
    prompt: 'Reply with exactly this one word and nothing else: pong',
    expectAnswer: { allOf: ['pong'], noneOf: ['pongpong'] },
  },
  {
    id: 'text-reason',
    capability: 'text',
    prompt:
      'A shop sells notebooks for 3 ringgit each. I buy 4 notebooks and pay with 20 ringgit. How much change do I get? Answer with the number only.',
    expectAnswer: { allOf: ['8'] },
  },
  {
    id: 'text-instruction',
    capability: 'text',
    prompt: 'Name the capital of Japan in one short sentence.',
    expectAnswer: { allOf: ['tokyo'] },
  },
  {
    id: 'image-describe',
    capability: 'image',
    prompt: 'Describe the shapes and colours in this image. Mention the text if you can read it.',
    images: ['samples/test_shapes.png'],
    expectAnswer: { allOf: ['circle', 'rectangle'], anyOf: ['red', 'navy', 'blue'], minHits: 1 },
  },
  {
    id: 'image-no-hallucination',
    capability: 'image',
    prompt: 'What animal is in this image? If there is no animal, say "no animal".',
    images: ['samples/test_shapes.png'],
    expectAnswer: { anyOf: ['no animal', 'none'], minHits: 1 },
  },
  {
    id: 'audio-transcribe',
    capability: 'audio',
    prompt: 'Transcribe the speech in this audio clip.',
    audio: ['samples/test_speech.wav'],
    expectAnswer: { anyOf: ['quick brown fox', 'lazy dog'], minHits: 1 },
  },
  {
    id: 'mixed-describe',
    capability: 'mixed',
    prompt: 'Describe the picture and what is said in the audio.',
    images: ['samples/test_shapes.png'],
    audio: ['samples/test_speech.wav'],
    expectAnswer: { allOf: ['circle'], anyOf: ['fox', 'lazy dog'], minHits: 1 },
  },
  {
    id: 'tools-create',
    capability: 'tools',
    prompt:
      'Create a note titled "Benchmark note" with the body "created by the benchmark harness".',
    expectTools: [{ name: 'create_note' }],
  },
  {
    id: 'tools-list-then-answer',
    capability: 'tools',
    prompt: 'How many notes do I have? Use your tools.',
    expectTools: [{ name: 'list_notes' }],
  },
  {
    id: 'tools-search',
    capability: 'tools',
    prompt: 'Search my notes for anything about animals jumping over dogs.',
    expectTools: [{ name: 'search_notes' }],
  },
] as const;
