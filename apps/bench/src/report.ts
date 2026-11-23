import type { CaseReport } from './harness.js';
import type { RetrievalReport } from './retrieval.js';
import type { SpeechReport } from './speech.js';

export interface BenchReport {
  readonly generatedAt: string;
  readonly model: string;
  readonly repeats: number;
  readonly cases: readonly CaseReport[];
  readonly retrieval: RetrievalReport | undefined;
  readonly speech: SpeechReport | undefined;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function milliseconds(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

/** Markdown table; the same text is printed and written to docs/benchmark.md. */
export function renderMarkdown(report: BenchReport): string {
  const lines: string[] = [];
  lines.push('# Benchmark');
  lines.push('');
  lines.push(
    'Measured on the machine that runs the model, not a synthetic rate. ' + 'Reproduce with:',
  );
  lines.push('');
  lines.push('```powershell');
  lines.push('.\\scripts\\serve.ps1    # LFM3-Omni on 8080');
  lines.push('pnpm embed:serve       # EmbeddingGemma on 8091, for retrieval');
  lines.push('pnpm bench --repeats 3 --md docs/benchmark.md');
  lines.push('```');
  lines.push('');
  lines.push(
    'The notes tools are backed by an in-memory stub, so no database has to be ' +
      'running and no notes are left behind.',
  );
  lines.push('');
  lines.push(
    `Local model \`${report.model}\`, ${report.repeats} run(s) per case. ` +
      'Latency is wall-clock around the whole agent loop; decode rate comes from ' +
      "llama-server's own timings.",
  );
  lines.push('');
  lines.push(
    '| Case | Capability | Pass | Median latency | Decode tok/s | Prefill tok/s | Tool calls |',
  );
  lines.push(
    '| ---- | ---------- | ---- | -------------- | ------------ | ------------- | ---------- |',
  );
  for (const entry of report.cases) {
    lines.push(
      `| \`${entry.id}\` | ${entry.capability} | ${percent(entry.passRate)} | ` +
        `${milliseconds(entry.wallMs.median)} | ${entry.decodeTokensPerSecond.toFixed(1)} | ` +
        `${entry.prefillTokensPerSecond.toFixed(1)} | ${entry.toolCalls} |`,
    );
  }
  lines.push('');

  const failures = report.cases.flatMap((entry) =>
    entry.attempts
      .filter((attempt) => !attempt.outcome.passed)
      .map((attempt) => ({
        id: entry.id,
        failures: attempt.outcome.failures,
        answer: attempt.answer,
      })),
  );
  if (failures.length > 0) {
    lines.push('## Failing attempts');
    lines.push('');
    for (const failure of failures) {
      lines.push(`- \`${failure.id}\`: ${failure.failures.join('; ')}`);
      lines.push(`  - answered: ${failure.answer.replace(/\s+/g, ' ').slice(0, 200) || '(empty)'}`);
    }
    lines.push('');
  }

  const retrieval = report.retrieval;
  if (retrieval) {
    lines.push('## Embedding retrieval');
    lines.push('');
    lines.push(
      `Recall@1 ${percent(retrieval.recallAt1)}, recall@3 ${percent(retrieval.recallAt3)}, ` +
        `MRR ${retrieval.mrr.toFixed(3)} over ${retrieval.queries} paraphrased queries.`,
    );
    if (retrieval.misses.length > 0) {
      lines.push('');
      lines.push('Missed (expected document not in the top 3):');
      for (const miss of retrieval.misses) {
        lines.push(`- "${miss.query}" → expected \`${miss.expectedId}\`, top hit \`${miss.got}\``);
      }
    }
    lines.push('');
  }

  const speech = report.speech;
  if (speech) {
    lines.push('## Speech output');
    lines.push('');
    lines.push(
      `Synthesised ${speech.durationSeconds.toFixed(2)} s of audio in ${milliseconds(
        speech.latencyMs,
      )} (real-time factor ${speech.realTimeFactor.toFixed(2)}×, ` +
        `${Math.round(speech.bytesPerSecond / 1024)} kB/s).`,
    );
    lines.push('');
  }
  return lines.join('\n');
}
