import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ModelClient, ModelError } from '../src/client.js';
import type { Message } from '../src/messages.js';
import { runAgent, type AgentEvent } from '../src/runner.js';
import { ToolError } from '../src/errors.js';
import { defineTool } from '../src/tools.js';

/** Records every request so the test can assert the exact wire body. */
function fakeFetch(responder: (body: unknown) => unknown | { status: number; body: string }) {
  const calls: { url: string; body: unknown }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ url: String(url), body });
    const outcome = responder(body);
    if (outcome && typeof outcome === 'object' && 'status' in outcome) {
      return new Response(outcome.body, { status: outcome.status });
    }
    return new Response(JSON.stringify(outcome), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls, fetch: impl };
}

const completion = (message: unknown, finish = 'stop') => ({
  choices: [{ finish_reason: finish, message }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

describe('ModelClient.chat', () => {
  it('parses stringified tool arguments unchanged', async () => {
    const fake = fakeFetch(() =>
      completion(
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_a', function: { name: 'create_note', arguments: '{"title":"Ship it"}' } },
          ],
        },
        'tool_calls',
      ),
    );
    const client = new ModelClient({ fetch: fake.fetch });

    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.message.toolCalls).toEqual([
      { id: 'call_a', name: 'create_note', arguments: '{"title":"Ship it"}' },
    ]);
    expect(result.finishReason).toBe('tool_calls');
  });

  it('normalises object-shaped arguments into JSON text', async () => {
    const fake = fakeFetch(() =>
      completion({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_b', function: { name: 'x', arguments: { a: 1 } } }],
      }),
    );
    const client = new ModelClient({ fetch: fake.fetch });

    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.message.toolCalls[0]?.arguments).toBe('{"a":1}');
  });

  it('treats missing arguments as an empty object', async () => {
    const fake = fakeFetch(() =>
      completion({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c', function: { name: 'x' } }],
      }),
    );
    const client = new ModelClient({ fetch: fake.fetch });

    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.message.toolCalls[0]?.arguments).toBe('{}');
  });

  it('omits tools from the body when none are given', async () => {
    const fake = fakeFetch(() => completion({ role: 'assistant', content: 'ok' }));
    const client = new ModelClient({ fetch: fake.fetch });

    await client.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(fake.calls[0]?.body).not.toHaveProperty('tools');
  });

  it('reports an unreachable server as ModelError(unreachable)', async () => {
    const client = new ModelClient({
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });

    await expect(
      client.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({
      name: 'ModelError',
      kind: 'unreachable',
    });
  });

  it('carries the status and body of an HTTP failure', async () => {
    const client = new ModelClient({
      fetch: (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch,
    });

    const error = await client
      .chat({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ModelError);
    expect(error).toMatchObject({ kind: 'http', status: 503, body: 'boom' });
  });
});

describe('runAgent', () => {
  const echo = defineTool({
    name: 'echo',
    description: 'Echo back.',
    schema: z.object({ text: z.string() }),
  });

  function scripted(turns: unknown[][]) {
    let turn = 0;
    return fakeFetch(() => {
      const message = turns[turn] ?? [{ role: 'assistant', content: 'done' }];
      turn += 1;
      return completion(message[0], turn < turns.length ? 'tool_calls' : 'stop');
    });
  }

  it('executes a tool, feeds the result back and returns the final text', async () => {
    const fake = scripted([
      [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', function: { name: 'echo', arguments: '{"text":"hi"}' } }],
        },
      ],
      [{ role: 'assistant', content: 'all done' }],
    ]);
    const events: AgentEvent[] = [];

    const result = await runAgent(
      {
        client: new ModelClient({ fetch: fake.fetch }),
        tools: [
          {
            definition: echo,
            execute: (args: { text: string }) => ({ echoed: args.text }),
          },
        ],
        system: 'be brief',
        onEvent: (event) => events.push(event),
      },
      'say hi',
    );

    expect(result.text).toBe('all done');
    expect(result.stopReason).toBe('final');
    expect(result.toolCalls).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      'turn-start',
      'tool-call',
      'tool-result',
      'turn-start',
      'assistant-text',
      'final',
    ]);

    const secondRequest = fake.calls[1]?.body as { messages: Message[] };
    const toolMessage = secondRequest.messages.find((message) => message.role === 'tool');
    // This is the wire shape: internal camelCase is translated by toWireMessages.
    expect(toolMessage).toMatchObject({
      role: 'tool',
      tool_call_id: 'c1',
      content: '{"echoed":"hi"}',
    });
  });

  it('rejects invalid arguments without executing the tool', async () => {
    const fake = scripted([
      [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', function: { name: 'echo', arguments: '{"text":42}' } }],
        },
      ],
      [{ role: 'assistant', content: 'fixed' }],
    ]);
    let executions = 0;

    await runAgent(
      {
        client: new ModelClient({ fetch: fake.fetch }),
        tools: [
          {
            definition: echo,
            execute: () => {
              executions += 1;
              return {};
            },
          },
        ],
        system: '',
      },
      'go',
    );

    expect(executions).toBe(0);
    const secondRequest = fake.calls[1]?.body as { messages: Message[] };
    const toolMessage = secondRequest.messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('invalid_arguments');
  });

  it('reports an unknown tool with the available names', async () => {
    const fake = scripted([
      [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', function: { name: 'nope', arguments: '{}' } }],
        },
      ],
      [{ role: 'assistant', content: 'ok' }],
    ]);

    await runAgent({ client: new ModelClient({ fetch: fake.fetch }), tools: [], system: '' }, 'go');

    const secondRequest = fake.calls[1]?.body as { messages: Message[] };
    const toolMessage = secondRequest.messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('unknown_tool');
  });

  it('turns a thrown ToolError into a recoverable tool_failed result', async () => {
    const fake = scripted([
      [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', function: { name: 'echo', arguments: '{"text":"hi"}' } }],
        },
      ],
      [{ role: 'assistant', content: 'recovered' }],
    ]);

    const result = await runAgent(
      {
        client: new ModelClient({ fetch: fake.fetch }),
        tools: [
          {
            definition: echo,
            execute: () => {
              throw new ToolError('disk on fire');
            },
          },
        ],
        system: '',
      },
      'go',
    );

    const toolMessage = result.messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('disk on fire');
    expect(toolMessage).toMatchObject({ role: 'tool', isError: true });
  });

  it('stops at maxSteps instead of looping forever', async () => {
    const fake = fakeFetch(() =>
      completion(
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', function: { name: 'echo', arguments: '{"text":"hi"}' } }],
        },
        'tool_calls',
      ),
    );
    const events: AgentEvent[] = [];

    const result = await runAgent(
      {
        client: new ModelClient({ fetch: fake.fetch }),
        tools: [{ definition: echo, execute: () => ({}) }],
        system: '',
        maxSteps: 3,
        onEvent: (event) => events.push(event),
      },
      'go',
    );

    expect(result.stopReason).toBe('steps');
    expect(result.toolCalls).toBe(3);
    expect(fake.calls).toHaveLength(3);
    expect(events.at(-1)).toEqual({ type: 'limit', reason: 'steps' });
  });

  it('counts multiple tool calls in one assistant turn', async () => {
    const fake = scripted([
      [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'c1', function: { name: 'echo', arguments: '{"text":"a"}' } },
            { id: 'c2', function: { name: 'echo', arguments: '{"text":"b"}' } },
          ],
        },
      ],
      [{ role: 'assistant', content: 'two' }],
    ]);

    const result = await runAgent(
      {
        client: new ModelClient({ fetch: fake.fetch }),
        tools: [{ definition: echo, execute: (args: { text: string }) => args.text }],
        system: '',
      },
      'go',
    );

    expect(result.toolCalls).toBe(2);
    const secondRequest = fake.calls[1]?.body as { messages: Message[] };
    expect(secondRequest.messages.filter((message) => message.role === 'tool')).toHaveLength(2);
  });
});

describe('ModelClient.describe', () => {
  it('asks for a caption with the image part and no tools', async () => {
    const fake = fakeFetch(() => completion({ role: 'assistant', content: 'A red circle.' }));
    const client = new ModelClient({ fetch: fake.fetch });

    const text = await client.describe({ mimeType: 'image/png', data: 'AAAA' }, 'image');

    expect(text).toBe('A red circle.');
    const body = fake.calls[0]?.body as {
      messages: { content: { type: string; text?: string }[] }[];
      tools?: unknown;
    };
    expect(body.tools).toBeUndefined();
    expect(body.messages[0]?.content[0]?.text).toContain('Describe this image');
    expect(body.messages[0]?.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAA' },
    });
  });

  it('asks for an English transcript of an audio clip', async () => {
    const fake = fakeFetch(() => completion({ role: 'assistant', content: 'Hello there.' }));
    const client = new ModelClient({ fetch: fake.fetch });

    const text = await client.describe({ mimeType: 'audio/wav', data: 'BBBB' }, 'audio');

    expect(text).toBe('Hello there.');
    const body = fake.calls[0]?.body as {
      messages: { content: { type: string; text?: string }[] }[];
    };
    expect(body.messages[0]?.content[0]?.text).toContain('Transcribe the speech');
    expect(body.messages[0]?.content[1]).toEqual({
      type: 'input_audio',
      input_audio: { data: 'BBBB', format: 'wav' },
    });
  });

  it('treats an empty answer as a protocol error instead of showing nothing', async () => {
    const fake = fakeFetch(() => completion({ role: 'assistant', content: '   ' }));
    const client = new ModelClient({ fetch: fake.fetch });

    await expect(
      client.describe({ mimeType: 'image/png', data: 'AAAA' }, 'image'),
    ).rejects.toMatchObject({ kind: 'protocol' });
  });
});
