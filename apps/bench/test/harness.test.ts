import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ModelClient } from '@displayer/agent';

import { runCase } from '../src/harness.js';

/**
 * A fake client that answers with a scripted reply and records what it was sent.
 *
 * The harness is measured with real timing only against the live server; these
 * tests pin the parts that must not depend on a model: prompt assembly, tool
 * accounting, timing capture and pass/fail aggregation.
 */
function fakeClient(replies: readonly string[]) {
  const sent: unknown[] = [];
  let index = 0;
  const client = {
    async chat(request: unknown) {
      sent.push(request);
      const reply = replies[Math.min(index, replies.length - 1)] ?? '';
      index += 1;
      return {
        message: { role: 'assistant', content: reply, toolCalls: [] },
        finishReason: 'stop',
        usage: { promptTokens: 11, completionTokens: 5 },
        timings: { predicted_per_second: 42.5, prompt_per_second: 120 },
      };
    },
  } as unknown as ModelClient;
  return { client, sent };
}

describe('runCase', () => {
  it('scores a passing answer and records llama-server timings', async () => {
    const { client } = fakeClient(['A red circle and a navy rectangle.']);
    const report = await runCase(
      {
        id: 'image-describe',
        capability: 'image',
        prompt: 'Describe the image.',
        expectAnswer: { allOf: ['circle', 'rectangle'] },
      },
      {
        client,
        tools: [],
        system: 'system',
        repoRoot: process.cwd(),
        repeats: 2,
        maxSteps: 2,
      },
    );

    expect(report.passRate).toBe(1);
    expect(report.decodeTokensPerSecond).toBe(42.5);
    expect(report.prefillTokensPerSecond).toBe(120);
    expect(report.attempts).toHaveLength(2);
    expect(report.attempts[0]?.promptTokens).toBe(11);
  });

  it('reports a failing answer instead of silently scoring it as a pass', async () => {
    const { client } = fakeClient(['I cannot tell.']);
    const report = await runCase(
      {
        id: 'image-describe',
        capability: 'image',
        prompt: 'Describe the image.',
        expectAnswer: { allOf: ['circle'] },
      },
      { client, tools: [], system: 'system', repoRoot: process.cwd(), repeats: 1, maxSteps: 2 },
    );

    expect(report.passRate).toBe(0);
    expect(report.attempts[0]?.outcome.failures.join(' ')).toContain('circle');
  });

  it('inlines an attachment as base64 so the model actually receives it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bench-'));
    const imagePath = join(directory, 'dot.png');
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const { client, sent } = fakeClient(['a circle']);
    await runCase(
      {
        id: 'image-describe',
        capability: 'image',
        prompt: 'Describe the image.',
        images: [imagePath],
        expectAnswer: { allOf: ['circle'] },
      },
      { client, tools: [], system: 'system', repoRoot: process.cwd(), repeats: 1, maxSteps: 1 },
    );

    const request = sent[0] as {
      messages: readonly { role: string; content: unknown }[];
    };
    const user = request.messages.find((message) => message.role === 'user');
    expect(Array.isArray(user?.content)).toBe(true);
    const parts = user?.content as { type: string; mimeType?: string; data?: string }[];
    const image = parts.find((part) => part.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    expect(image?.data).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'));
  });

  it('counts a tool call as successful only when it ran', async () => {
    const notes: string[] = [];
    const { client } = fakeClient(['created']);
    const report = await runCase(
      {
        id: 'tools-create',
        capability: 'tools',
        prompt: 'Make a note.',
        expectTools: [{ name: 'create_note' }],
      },
      {
        client,
        tools: [
          {
            definition: {
              name: 'create_note',
              description: 'create',
              schema: {
                safeParse: () => ({ success: true, data: { title: 't' } }),
              } as never,
            },
            execute: () => {
              notes.push('t');
              return { ok: true };
            },
          },
        ],
        system: 'system',
        repoRoot: process.cwd(),
        repeats: 1,
        maxSteps: 2,
      },
    );

    // The fake client never requests a tool, so the case must fail: this pins the
    // expectation that a passing tool case requires an actual call.
    expect(report.passRate).toBe(0);
    expect(notes).toHaveLength(0);
  });
});
