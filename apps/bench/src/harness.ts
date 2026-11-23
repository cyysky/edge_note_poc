import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';

import {
  type ModelClient,
  runAgent,
  type AgentTool,
  type AudioPart,
  type ImagePart,
  type UserContentPart,
} from '@displayer/agent';

import type { BenchCase } from './cases.js';
import { describe, median, scoreCase, scoreToolCall, type CaseOutcome } from './scoring.js';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

export interface HarnessOptions {
  readonly client: ModelClient;
  readonly tools: readonly AgentTool[];
  readonly system: string;
  readonly repoRoot: string;
  readonly repeats: number;
  readonly maxSteps: number;
  readonly onProgress?: (line: string) => void;
}

export interface Attempt {
  readonly wallMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** llama-server's own measured decode rate; absent if it did not report one. */
  readonly decodeTokensPerSecond: number | undefined;
  readonly prefillTokensPerSecond: number | undefined;
  readonly toolCalls: readonly { readonly name: string; readonly ok: boolean }[];
  readonly answer: string;
  readonly outcome: CaseOutcome;
}

export interface CaseReport {
  readonly id: string;
  readonly capability: BenchCase['capability'];
  readonly attempts: readonly Attempt[];
  readonly passRate: number;
  readonly wallMs: ReturnType<typeof describe>;
  readonly decodeTokensPerSecond: number;
  readonly prefillTokensPerSecond: number;
  readonly toolCalls: number;
}

async function readMediaPart(
  path: string,
  kind: 'image' | 'audio',
  repoRoot: string,
): Promise<ImagePart | AudioPart> {
  const absolute = isAbsolute(path) ? path : join(repoRoot, path);
  const mimeType = MIME_TYPES[extname(absolute).toLowerCase()];
  if (!mimeType) throw new Error(`Unsupported benchmark media type: ${path}`);
  const bytes = await readFile(absolute);
  return kind === 'image'
    ? { type: 'image', mimeType, data: bytes.toString('base64') }
    : { type: 'audio', mimeType, data: bytes.toString('base64') };
}

async function buildPrompt(
  testCase: BenchCase,
  repoRoot: string,
): Promise<string | { readonly role: 'user'; readonly content: readonly UserContentPart[] }> {
  const parts: UserContentPart[] = [{ type: 'text', text: testCase.prompt }];
  for (const path of testCase.images ?? []) {
    parts.push(await readMediaPart(path, 'image', repoRoot));
  }
  for (const path of testCase.audio ?? []) {
    parts.push(await readMediaPart(path, 'audio', repoRoot));
  }
  // `runAgent` takes a string or a full user message; handing it a bare parts
  // array would silently produce a message with no `content` field.
  return parts.length === 1 ? testCase.prompt : { role: 'user', content: parts };
}

/** One timed attempt of one case. */
async function runOnce(testCase: BenchCase, options: HarnessOptions): Promise<Attempt> {
  const prompt = await buildPrompt(testCase, options.repoRoot);
  const toolCalls: { name: string; ok: boolean }[] = [];
  let pendingName: string | undefined;
  let promptTokens = 0;
  let completionTokens = 0;
  const decodeRates: number[] = [];
  const prefillRates: number[] = [];

  // The rate reported by llama-server is per model call, so a tool-using case
  // produces several. Each is collected and the case uses the median.
  const probe = new Proxy(options.client, {
    get(target, property, receiver) {
      if (property !== 'chat') return Reflect.get(target, property, receiver);
      return async (request: Parameters<ModelClient['chat']>[0]) => {
        const result = await target.chat(request);
        promptTokens += result.usage.promptTokens;
        completionTokens += result.usage.completionTokens;
        const timings = result.timings as
          { predicted_per_second?: number; prompt_per_second?: number } | undefined;
        if (typeof timings?.predicted_per_second === 'number') {
          decodeRates.push(timings.predicted_per_second);
        }
        if (typeof timings?.prompt_per_second === 'number') {
          prefillRates.push(timings.prompt_per_second);
        }
        return result;
      };
    },
  });

  const started = performance.now();
  const result = await runAgent(
    {
      client: probe,
      tools: options.tools,
      system: options.system,
      maxSteps: options.maxSteps,
      onEvent: (event) => {
        if (event.type === 'tool-call') pendingName = event.call.name;
        if (event.type === 'tool-result' && pendingName) {
          toolCalls.push({ name: pendingName, ok: event.ok });
          pendingName = undefined;
        }
      },
    },
    prompt,
  );
  const wallMs = performance.now() - started;

  const answerOutcome = testCase.expectAnswer
    ? scoreCase(result.text, testCase.expectAnswer)
    : { passed: true, failures: [] };
  const toolOutcome = testCase.expectTools
    ? scoreToolCall(toolCalls, testCase.expectTools)
    : { passed: true, failures: [] };
  const failures = [...answerOutcome.failures, ...toolOutcome.failures];

  return {
    wallMs,
    promptTokens,
    completionTokens,
    decodeTokensPerSecond: decodeRates.length > 0 ? median(decodeRates) : undefined,
    prefillTokensPerSecond: prefillRates.length > 0 ? median(prefillRates) : undefined,
    toolCalls,
    answer: result.text,
    outcome: { passed: failures.length === 0, failures },
  };
}

export async function runCase(testCase: BenchCase, options: HarnessOptions): Promise<CaseReport> {
  const attempts: Attempt[] = [];
  for (let index = 0; index < options.repeats; index += 1) {
    options.onProgress?.(`${testCase.id} · run ${index + 1}/${options.repeats}`);
    attempts.push(await runOnce(testCase, options));
  }

  const passed = attempts.filter((attempt) => attempt.outcome.passed).length;
  const decodeRates = attempts
    .map((attempt) => attempt.decodeTokensPerSecond)
    .filter((rate): rate is number => rate !== undefined);
  const prefillRates = attempts
    .map((attempt) => attempt.prefillTokensPerSecond)
    .filter((rate): rate is number => rate !== undefined);

  return {
    id: testCase.id,
    capability: testCase.capability,
    attempts,
    passRate: attempts.length === 0 ? 0 : passed / attempts.length,
    wallMs: describe(attempts.map((attempt) => attempt.wallMs)),
    decodeTokensPerSecond: median(decodeRates),
    prefillTokensPerSecond: median(prefillRates),
    toolCalls: attempts.reduce((sum, attempt) => sum + attempt.toolCalls.length, 0),
  };
}

export function summariseByCapability(reports: readonly CaseReport[]): {
  readonly capability: string;
  readonly passRate: number;
  readonly decodeTokensPerSecond: number;
}[] {
  const grouped = new Map<string, CaseReport[]>();
  for (const report of reports) {
    const existing = grouped.get(report.capability) ?? [];
    existing.push(report);
    grouped.set(report.capability, existing);
  }
  return [...grouped.entries()].map(([capability, group]) => ({
    capability,
    passRate: group.reduce((sum, report) => sum + report.passRate, 0) / group.length,
    decodeTokensPerSecond: median(group.map((report) => report.decodeTokensPerSecond)),
  }));
}
