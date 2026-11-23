import { createServer } from 'node:http';

/**
 * Minimal stand-in for llama-server, for the browser e2e suite.
 *
 * The real model is not part of a reproducible test: it is a multi-gigabyte
 * download behind a GPU. This stub answers the same OpenAI-shaped requests the
 * API sends, so the suite exercises the whole chat path — transport limit,
 * validation, agent loop, tool trace, speech bytes — without a model.
 */
const port = Number(process.env.STUB_MODEL_PORT ?? '8080');
let chatCalls = 0;

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/** A 44-byte silent mono WAV, so a browser can actually decode the reply. */
function silentWav() {
  const samples = 1600;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(32_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);

  if (url.pathname === '/health') {
    json(response, 200, { status: 'ok' });
    return;
  }

  if (url.pathname === '/v1/audio/speech') {
    await readBody(request);
    response.writeHead(200, { 'content-type': 'audio/wav' });
    response.end(silentWav());
    return;
  }

  if (url.pathname === '/v1/chat/completions') {
    const raw = await readBody(request);
    chatCalls += 1;

    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      json(response, 400, { error: { message: 'request was not JSON' } });
      return;
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    const content = typeof lastUser?.content === 'string' ? lastUser.content : '';
    const hasAudio = Array.isArray(lastUser?.content)
      ? lastUser.content.some((part) => part?.type === 'input_audio')
      : false;

    // One tool round trip, then a final answer: the shape the real model
    // produces, so the UI's tool trace is exercised rather than assumed.
    const sawToolResult = messages.some((message) => message.role === 'tool');
    if (content.includes('note') && !sawToolResult) {
      json(response, 200, {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_stub_1',
                  type: 'function',
                  function: { name: 'list_notes', arguments: '{}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
        timings: { predicted_per_second: 100, prompt_per_second: 1000 },
      });
      return;
    }

    json(response, 200, {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: hasAudio ? 'I heard the recording.' : `Stub reply to ${chatCalls} call(s).`,
          },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
      timings: { predicted_per_second: 100, prompt_per_second: 1000 },
    });
    return;
  }

  json(response, 404, { error: { message: `no route for ${url.pathname}` } });
});

server.listen(port, '127.0.0.1', () => {
  // Playwright captures stdout; this line proves which server answered.
  console.log(`stub model server on http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
