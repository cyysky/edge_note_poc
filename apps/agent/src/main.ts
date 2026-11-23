import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseArgs } from 'node:util';

import {
  NOTES_SYSTEM_PROMPT,
  ModelClient,
  ModelError,
  createNotesBackend,
  createNotesTools,
  runAgent,
  type AgentEvent,
  type AudioPart,
  type ImagePart,
  type UserContentPart,
} from '@displayer/agent';

const USAGE = `displayer-agent — local LFM3-Omni notes agent

Usage:
  displayer-agent "<prompt>" [--image file.png]... [--audio file.wav] [--tts-out out.wav]

Options:
  --image <path>      Attach an image (repeatable).
  --audio <path>      Attach an audio clip (repeatable).
  --tts-out <path>    Synthesise the final answer to a WAV file.
  --voice <name>      TTS voice: female (default) or male.
  --json              Print newline-delimited JSON events instead of prose.
  --max-steps <n>     Model calls before the loop gives up (default 8).
  --model-url <url>   llama-server base URL (default http://127.0.0.1:8080).
  --api-url <url>     Nest API base URL (default http://127.0.0.1:3001).
  -h, --help          Show this message.
`;

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

function mimeFor(path: string): string {
  const mime = MIME_TYPES[extname(path).toLowerCase()];
  if (!mime) throw new Error(`Unsupported media type: ${path}`);
  return mime;
}

async function readMedia(path: string): Promise<{ mimeType: string; data: string }> {
  const bytes = await readFile(path);
  return { mimeType: mimeFor(path), data: bytes.toString('base64') };
}

function printEvent(event: AgentEvent, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(event));
    return;
  }
  switch (event.type) {
    case 'turn-start':
      if (event.turn > 1) console.error(`\n[turn ${event.turn}]`);
      break;
    case 'tool-call':
      console.error(`→ ${event.call.name}(${event.call.arguments})`);
      break;
    case 'tool-result':
      console.error(`  ${event.ok ? '✓' : '✗'} ${event.preview.replace(/\s+/g, ' ')}`);
      break;
    case 'assistant-text':
      console.log(event.text);
      break;
    case 'final':
      break;
    case 'limit':
      console.error('\n[stopped: step limit reached]');
      break;
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      image: { type: 'string', multiple: true, default: [] },
      audio: { type: 'string', multiple: true, default: [] },
      'tts-out': { type: 'string' },
      voice: { type: 'string', default: 'female' },
      json: { type: 'boolean', default: false },
      'max-steps': { type: 'string', default: '8' },
      'model-url': { type: 'string', default: 'http://127.0.0.1:8080' },
      'api-url': { type: 'string', default: 'http://127.0.0.1:3001' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const client = new ModelClient({ baseUrl: values['model-url'] });
  if (!(await client.health())) {
    console.error(
      `llama-server is not answering at ${values['model-url']}.\nStart it with: start_lfm3.bat (in LFM3_OMNI_ROOT, default D:\\workspace\\20261123_lfm3_omni)`,
    );
    return 1;
  }

  const parts: UserContentPart[] = [{ type: 'text', text: positionals.join(' ') }];
  for (const path of values.image) {
    parts.push({ type: 'image', ...(await readMedia(path)) } satisfies ImagePart);
  }
  for (const path of values.audio) {
    parts.push({ type: 'audio', ...(await readMedia(path)) } satisfies AudioPart);
  }

  try {
    const result = await runAgent(
      {
        client,
        tools: createNotesTools(createNotesBackend({ baseUrl: values['api-url'] })),
        system: NOTES_SYSTEM_PROMPT,
        maxSteps: Number(values['max-steps']),
        onEvent: (event) => printEvent(event, values.json),
      },
      parts.length === 1 ? positionals.join(' ') : { role: 'user', content: parts },
    );

    if (!values.json && result.stopReason === 'steps') {
      console.error('The agent did not converge within the step budget.');
    }

    const ttsOut = values['tts-out'];
    if (ttsOut && result.text.trim().length > 0) {
      const audio = await client.speak(result.text, { voice: values.voice });
      await writeFile(ttsOut, audio);
      console.error(`[spoke ${audio.byteLength} bytes to ${ttsOut}]`);
    }

    return result.stopReason === 'final' ? 0 : 1;
  } catch (error) {
    if (error instanceof ModelError) {
      console.error(`${error.kind}: ${error.message}${error.body ? `\n${error.body}` : ''}`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main();
