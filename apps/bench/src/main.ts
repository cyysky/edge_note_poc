import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  NOTES_SYSTEM_PROMPT,
  ModelClient,
  createEmbeddingClient,
  createNotesTools,
  type AgentTool,
} from '@displayer/agent';
import type { Note } from '@displayer/shared';

import { CASES } from './cases.js';
import { runCase, summariseByCapability, type CaseReport } from './harness.js';
import { renderMarkdown, type BenchReport } from './report.js';
import { runRetrieval } from './retrieval.js';
import { runSpeech } from './speech.js';

const USAGE = `displayer-bench — measure LFM3-Omni capabilities on this machine

Usage:
  displayer-bench [--repeats 3] [--cases tools-create,image-describe] [--md out.md]

Options:
  --repeats <n>      Runs per case (default 3). The median is reported.
  --cases <ids>      Comma-separated subset; omit for every case.
  --no-retrieval     Skip the EmbeddingGemma retrieval benchmark.
  --no-speech        Skip the speech output benchmark.
  --md <path>        Write the Markdown report to a file as well as stdout.
  --model-url <url>  llama-server base URL (default http://127.0.0.1:8080).
  --embed-url <url>  EmbeddingGemma base URL (default http://127.0.0.1:8091).
  -h, --help         Show this message.
`;

/**
 * A stub notes backend keeps the benchmark hermetic.
 *
 * Tool-using cases then measure the model's ability to choose and shape a call,
 * not whether a database happened to be running, and they cannot leave notes
 * behind on the user's machine.
 */
function stubTools(): AgentTool[] {
  const notes: Note[] = [
    {
      id: 'seed-fox',
      title: 'Fox sighting',
      body: 'A red fox jumped over a lazy dog in the garden.',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  let counter = 0;

  return createNotesTools({
    async list(limit) {
      return limit ? notes.slice(0, limit) : [...notes];
    },
    async get(id) {
      const found = notes.find((note) => note.id === id);
      if (!found) throw new Error(`No note ${id}`);
      return found;
    },
    async create(input) {
      counter += 1;
      const now = new Date().toISOString();
      const note: Note = {
        id: `bench-${counter}`,
        title: input.title,
        body: input.body,
        createdAt: now,
        updatedAt: now,
      };
      notes.push(note);
      return note;
    },
    async update(id, input) {
      const existing = notes.find((note) => note.id === id);
      if (!existing) throw new Error(`No note ${id}`);
      const updated: Note = { ...existing, ...input, updatedAt: new Date().toISOString() };
      notes.splice(notes.indexOf(existing), 1, updated);
      return updated;
    },
    async remove(id) {
      const index = notes.findIndex((note) => note.id === id);
      if (index >= 0) notes.splice(index, 1);
    },
    async search(query, limit) {
      const needle = query.toLowerCase();
      return notes
        .filter((note) => `${note.title} ${note.body}`.toLowerCase().includes(needle))
        .slice(0, limit)
        .map((note) => ({ note, score: 1 }));
    },
  });
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      repeats: { type: 'string', default: '3' },
      cases: { type: 'string' },
      'no-retrieval': { type: 'boolean', default: false },
      'no-speech': { type: 'boolean', default: false },
      md: { type: 'string' },
      'model-url': { type: 'string', default: 'http://127.0.0.1:8080' },
      'embed-url': { type: 'string', default: 'http://127.0.0.1:8091' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const repeats = Math.max(1, Number(values.repeats) || 3);
  const client = new ModelClient({ baseUrl: values['model-url'] });
  if (!(await client.health())) {
    console.error(`llama-server is not answering at ${values['model-url']}.`);
    console.error('Start it with: .\\scripts\\serve.ps1');
    return 1;
  }

  const selected = values.cases
    ? new Set(
        values.cases
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      )
    : undefined;
  const cases = CASES.filter((entry) => !selected || selected.has(entry.id));
  if (cases.length === 0) {
    console.error('No cases matched --cases.');
    return 2;
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const tools = stubTools();
  const reports: CaseReport[] = [];

  for (const testCase of cases) {
    const report = await runCase(testCase, {
      client,
      tools,
      system: NOTES_SYSTEM_PROMPT,
      repoRoot,
      repeats,
      maxSteps: 4,
      onProgress: (line) => console.error(`[bench] ${line}`),
    });
    reports.push(report);
  }

  let retrieval: BenchReport['retrieval'];
  if (!values['no-retrieval']) {
    const embedder = createEmbeddingClient({ baseUrl: values['embed-url'] });
    if (await embedder.health()) {
      console.error('[bench] retrieval');
      retrieval = await runRetrieval(embedder);
    } else {
      console.error(`[bench] embedding server not answering at ${values['embed-url']}; skipping`);
    }
  }

  let speech: BenchReport['speech'];
  if (!values['no-speech']) {
    console.error('[bench] speech output');
    speech = await runSpeech(
      client,
      'The quick brown fox jumps over the lazy dog while the benchmark measures speech.',
      repeats,
    );
  }

  const report: BenchReport = {
    generatedAt: new Date().toISOString(),
    model: values['model-url'],
    repeats,
    cases: reports,
    retrieval,
    speech,
  };
  const markdown = renderMarkdown(report);
  console.log(markdown);

  const summary = summariseByCapability(reports);
  console.error(
    `[bench] capability pass rates: ${summary
      .map((entry) => `${entry.capability} ${(entry.passRate * 100).toFixed(0)}%`)
      .join(', ')}`,
  );

  if (values.md) {
    const target = join(repoRoot, values.md);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${markdown}\n`, 'utf8');
    console.error(`[bench] wrote ${target}`);
  }

  return 0;
}

process.exitCode = await main();
