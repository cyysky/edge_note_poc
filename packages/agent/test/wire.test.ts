import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { toWireMessages } from '../src/client.js';
import {
  cosineSimilarity,
  documentPrompt,
  queryPrompt,
  rankBySimilarity,
} from '../src/embeddings.js';
import { toJsonSchema, toWireTools } from '../src/tools.js';

describe('toWireMessages', () => {
  it('sends user text as a bare string', () => {
    const wire = toWireMessages([{ role: 'user', content: 'hello' }]);
    expect(wire).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('encodes base64 media as data URLs inside content parts', () => {
    const wire = toWireMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', mimeType: 'image/png', data: 'AAAA' },
          { type: 'audio', mimeType: 'audio/wav', data: 'BBBB' },
        ],
      },
    ]);

    expect(wire).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          { type: 'input_audio', input_audio: { data: 'BBBB', format: 'wav' } },
        ],
      },
    ]);
  });

  it('keeps tool arguments as raw JSON text', () => {
    const wire = toWireMessages([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'create_note', arguments: '{"title":"a"}' }],
      },
      { role: 'tool', toolCallId: 'call_1', name: 'create_note', content: '{}' },
    ]);

    expect(wire).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'create_note', arguments: '{"title":"a"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{}' },
    ]);
  });
});

describe('tool schemas', () => {
  it('strips $schema and marks optional fields as not required', () => {
    const schema = toJsonSchema(z.object({ title: z.string(), body: z.string().optional() }));

    expect(schema).toEqual({
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
      required: ['title'],
      additionalProperties: false,
    });
  });

  it('wraps definitions in the OpenAI function envelope', () => {
    const wire = toWireTools([{ name: 'ping', description: 'Ping.', schema: z.object({}) }]);

    expect(wire[0]?.type).toBe('function');
    expect(wire[0]?.function.name).toBe('ping');
  });
});

describe('embedding prompts', () => {
  it('applies the documented query prefix', () => {
    expect(queryPrompt('  blue shapes ')).toBe('task: search result | query: blue shapes');
  });

  it('applies the documented document prefix with a title', () => {
    expect(documentPrompt({ title: ' Shapes ', text: ' a red circle ' })).toBe(
      'title: Shapes | text: a red circle',
    );
  });

  it('substitutes "none" when a document has no title', () => {
    expect(documentPrompt({ text: 'a red circle' })).toBe('title: none | text: a red circle');
  });
});

describe('cosineSimilarity', () => {
  it('scores identical vectors as 1 and orthogonal vectors as 0', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for a zero vector instead of NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('rejects vectors of different dimension', () => {
    expect(() => cosineSimilarity([1, 0], [1])).toThrow(/dimension/);
  });
});

describe('rankBySimilarity', () => {
  it('orders by descending score and honours the limit', () => {
    const ranked = rankBySimilarity(
      [1, 0],
      ['far', 'exact', 'near'],
      [
        [0, 1],
        [1, 0],
        [0.8, 0.2],
      ],
      2,
    );

    expect(ranked.map((entry) => entry.item)).toEqual(['exact', 'near']);
  });

  it('breaks ties by input order so results are deterministic', () => {
    const ranked = rankBySimilarity(
      [1, 0],
      ['first', 'second'],
      [
        [1, 0],
        [1, 0],
      ],
    );
    expect(ranked.map((entry) => entry.item)).toEqual(['first', 'second']);
  });
});
