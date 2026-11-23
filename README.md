# Displayer

A small, complete reference app: **Next.js 16** App Router on the front,
**NestJS 12** behind it, **SQLite** on disk, with **LFM3-Omni-2B** running
locally for text, image, audio and video.

Three things live here:

1. The **notes app** (web + api + shared packages) - the running application.
2. The **agent** (`packages/agent`, `apps/agent`, `apps/bench`) - LFM3-Omni
   calling notes tools on its own, plus a benchmark of what it can actually do.
3. The **local model runtime** (`models/`, `runtime/`, `scripts/`) - LFM3-Omni on
   8080 and EmbeddingGemma 2 on 8091.

## Quick start

```powershell
pnpm install
pnpm dev
```

- Web: <http://localhost:3000>
- API: <http://127.0.0.1:3001/api/health>

`pnpm dev` runs both apps. The first build also generates `next-env.d.ts`.

## Prerequisites

- Node.js 26+ and pnpm 12 (`corepack enable`).
- Windows, macOS or Linux. The LFM scripts are PowerShell.
- Native build tools for `better-sqlite3` on install (MSVC on Windows).

## Layout

| Path                  | Contents                                                   |
| --------------------- | ---------------------------------------------------------- |
| `apps/web`            | Next.js client: notes list, dialog editor, `/chat` page    |
| `apps/api`            | NestJS API: health, notes CRUD, chat and speech            |
| `apps/agent`          | CLI for the notes agent                                    |
| `apps/bench`          | Capability + latency benchmark for LFM3-Omni               |
| `packages/shared`     | Wire contracts and validation used by both apps            |
| `packages/agent`      | Model client, tool loop, notes tools, embeddings client    |
| `docs/`               | Current-state docs: stack, architecture, agent, benchmarks |
| `.agents/skills/`     | Installed Modern Web Guidance skill and guides             |
| `scripts/`            | PowerShell tooling for the local LFM3-Omni runtime         |
| `models/`, `runtime/` | Local model weights and binaries (gitignored)              |

## Commands

```powershell
pnpm dev            # api + web
pnpm build          # shared, then api and web
pnpm test           # unit and e2e suites
pnpm test:unit      # unit only
pnpm test:e2e       # Playwright (web) and supertest (api)
pnpm agent          # notes agent CLI (needs the model + API running)
pnpm bench          # benchmark LFM3-Omni on this machine
pnpm embed:serve    # EmbeddingGemma 2 on 8091
pnpm typecheck      # tsc --noEmit everywhere
pnpm lint           # eslint everywhere
pnpm format         # prettier --write
pnpm format:check   # prettier --check
```

`pnpm test:e2e` starts both apps on private ports and a **stub** model server on
8181, so the browser suite needs no GPU, no model weights and no running
`llama-server`. Model quality is measured separately with `pnpm bench`.

## Configuration

Defaults work with no configuration. To override, copy `.env.example` to
`.env.local` in `apps/web` and/or set the API environment variables.

| Variable         | Default                 | Used by                                 |
| ---------------- | ----------------------- | --------------------------------------- |
| `API_BASE_URL`   | `http://127.0.0.1:3001` | web (build-time; also server rendering) |
| `PORT`           | `3001`                  | api                                     |
| `DATABASE_PATH`  | `data/displayer.db`     | api                                     |
| `MODEL_BASE_URL` | `http://127.0.0.1:8080` | api (chat + speech)                     |
| `NOTES_API_URL`  | `http://127.0.0.1:3001` | agent tools inside the api              |

The browser reaches the API through a Next rewrite at `/api/*`, so no CORS
handling is needed for normal use.

## The notes app

`/api/notes` supports `GET`, `POST`, `PUT /:id` and `DELETE /:id`. Validation
lives in `packages/shared` and runs identically on both sides. Errors always come
back as:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "...",
    "details": [{ "path": "title", "message": "..." }]
  }
}
```

The UI uses a native `<dialog>` for editing and a container-query table that
becomes a stacked card list on narrow widths. See `docs/web-guidance.md` for the
specific guidance rules this commits to.

## Chat and the agent

`/chat` is a conversation with LFM3-Omni. It accepts text, images and audio in
one turn, answers in text, and can speak the answer. The model chooses tool calls
itself: there is no hard-coded flow, only a tool schema and a small loop.

Every attached picture is **captioned** and every recording is **transcribed to
English text** the moment it is attached, before anything is sent. The caption or
transcript appears on the attachment card, the send button waits for it, and that
English text is what joins the conversation: it travels with the turn and it is
replayed in later turns, when the bytes are no longer resent. Attaching a file
while the model server is down shows the failure on the card instead of silently
sending an attachment the model never described.

Pictures and clips can come from the device as well as from disk. **Take photo**
shows a live webcam preview and captures one still; **Record audio** records the
microphone for up to two minutes. Capture happens in a native dialog, the preview
never leaves the machine, and bytes only travel when the turn is sent. A
recording is written as 16 kHz mono WAV because the model server cannot read the
WebM/Opus that MediaRecorder would produce.

```powershell
.\scripts\serve.ps1     # LFM3-Omni on 8080
pnpm dev                # API on 3001, web on 3000
```

Open <http://localhost:3000/chat>. Or drive the same agent from the terminal:

```powershell
pnpm agent "what notes mention foxes?"
pnpm agent "Describe and save this." --image .\samples\test_shapes.png
```

The six notes tools (`list`, `search`, `get`, `create`, `update`, `delete`) call
the REST API, so the API stays the only writer. `search_notes` uses
EmbeddingGemma 2 on 8091; start it with `pnpm embed:serve`. See
`docs/agent.md` and `docs/embeddings.md`.

`POST /api/chat` takes the whole transcript and returns the reply plus a tool
trace. `POST /api/chat/describe` turns one attachment into English text and is
what the browser calls at attach time. `POST /api/chat/speech` returns WAV
bytes. The transcript lives in the browser, so the API holds no per-user
conversation state.

### Use the camera or microphone from a phone

A phone reaches the app by its LAN address, and that address is not a secure
context, so Chrome hides `navigator.mediaDevices`: the chat page says so and
"Take photo" / "Record audio" cannot open a device. Clicking through a
certificate warning does not help - the origin has to be HTTPS.

A public CA cannot issue a certificate for a private address, so the repo makes
its own root CA and serves TLS in front of the same build:

```powershell
.\scripts\https-cert.ps1          # creates certs/rootCA.crt (once per machine)
.\scripts\https-serve.ps1         # https://<lan-ip>:3443 -> next on 3100
```

Then, on the phone:

1. Copy `certs/rootCA.crt` to the device.
2. **Settings -> Security -> Encryption & credentials -> Install a certificate ->
   CA certificate**, and pick the file. Android warns that a third-party may
   monitor traffic; that warning is expected for a CA you created.
3. Open `https://<lan-ip>:3443/chat` and allow the camera/microphone when asked.

The CA is `O=Displayer Local, CN=Displayer Local CA`, SHA-256 fingerprint
`61:A4:32:AE:D7:14:62:DE:87:D7:0F:C6:90:96:FC:67:AC:9B:44:76:2B:A5:2D:E9:BE:A3:C1:16:CD:01:76:6D`
over RSA-3072. Install only that file, and only on devices you control.

The leaf covers `127.0.0.1`, `localhost` and every LAN address detected at mint
time, and it is backdated one hour so a phone clock running slightly behind this
machine still validates it. Re-running the script is a no-op unless an address
changed or the leaf is within a week of expiry; `-Force` reissues unconditionally.
After a DHCP change, re-run with `-Force` and reinstall `rootCA.crt` only if the
authority was recreated too.

Chrome on Android trusts user-installed CAs, so this is enough for the browser.
The proxy sets `x-forwarded-proto: https`, so server code sees the real scheme.

HSTS is deliberately absent: the spec forbids caching it for an IP literal, and
the connection is only as private as the LAN.

### What it is actually good at

`pnpm bench` measures text, image, audio, mixed-media and tool use, plus
retrieval and speech speed. `docs/benchmark.md` is the current run. The honest
summary:

- Fast and reliable at describing images, transcribing audio, and calling tools.
- **Weak at arithmetic**: "20 - 4 × 3" answers "4" every time. Do not route sums
  through this model.
- Speech synthesis runs about 7× faster than real time on an RTX 3080.

## LFM3-Omni-2B local runtime

Local, offline runner for
[LiquidAI/LFM3-Omni-2B-GGUF](https://huggingface.co/LiquidAI/LFM3-Omni-2B-GGUF)
on Windows + NVIDIA. Text, image, audio and video go in; text and speech come
out.

| Path                                       | Contents                                                     |
| ------------------------------------------ | ------------------------------------------------------------ |
| `models/LFM3-Omni-2B-Q8_0.gguf`            | 1.7 B param backbone, Q8_0 (1.72 GB)                         |
| `models/mmproj-LFM3-Omni-2B-Q8_0.gguf`     | vision + audio projector (0.47 GB)                           |
| `runtime/`                                 | llama.cpp `b12645` Windows CUDA 13.5 x64 build               |
| `scripts/`                                 | `serve.ps1`, `stop.ps1`, `ask.ps1`, `verify.ps1`, `_env.ps1` |
| `models/embeddinggemma-2-Q8_0.gguf`        | notes search embeddings (310 MB)                             |
| `models/mmproj-embeddinggemma-2-Q8_0.gguf` | its multimodal projector (555 MB)                            |
| `samples/`                                 | fixtures used to validate every modality                     |

Both GGUF files were SHA-256 verified against the Hugging Face LFS metadata:

```
59118f661eaacb93d204723d76355b53347f0940b508c11412f6290fd49158d4  LFM3-Omni-2B-Q8_0.gguf
8a25f9d1931244429de404fccacfb7fb933970a36aa5688d2f5069f29c6b27b1  mmproj-LFM3-Omni-2B-Q8_0.gguf
```

### Requirements

- NVIDIA driver plus a CUDA 13.x runtime (`cudart64_13.dll`, `cublas64_13.dll`,
  `cublasLt64_13.dll`). Here they live in
  `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.0\bin\x64`.
- `ffmpeg` **and** `ffprobe` for video input.
- PowerShell 5.1 or 7+.

`scripts/_env.ps1` prepends `runtime/`, the CUDA bin directory and a directory
holding a matched `ffmpeg`/`ffprobe` pair to `PATH`. Without the CUDA DLLs
llama.cpp silently runs CPU-only (~15 t/s instead of ~150 t/s). Override with
`$env:LFM3_FFMPEG_DIR` if ffmpeg lives elsewhere.

### Start and stop

```powershell
.\scripts\serve.ps1        # web UI + OpenAI-compatible API on port 8080
.\scripts\stop.ps1         # stop it
```

Then open <http://localhost:8080>.

The server is **not** a background service. It runs only while `serve.ps1` (or
`llama-server`) is alive, so "server unavailable" means nothing is listening.
Check with `Get-Process llama-server` and
`Invoke-RestMethod http://localhost:8080/health`. `localhost` resolves to `::1`
first on Windows; `serve.ps1` binds both `127.0.0.1` and `::1`.

Start detached:

```powershell
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','.\scripts\serve.ps1'
```

### One-shot prompts

```powershell
.\scripts\ask.ps1 -Prompt "Explain GGUF quantization in two sentences."
.\scripts\ask.ps1 -Image .\samples\test_shapes.png -Prompt "Describe this image."
.\scripts\ask.ps1 -Audio .\samples\test_speech.wav -System "Perform ASR in English."
.\scripts\ask.ps1 -Prompt "Hello from Liquid AI." -Tts -TtsOut .\out\hello.wav -TtsVoice female -TtsLang en
.\scripts\ask.ps1 -Video .\samples\reading.mp4 -System "Answer questions about the video." -Prompt "What happens here?"
.\scripts\verify.ps1   # integrity + GPU + generation check
```

`ask.ps1 -Interactive` opens a streaming REPL where `/image`, `/audio` and
`/video` add media mid-conversation.

### Server API

`serve.ps1` accepts `-Port`, `-HostName`, `-Ctx`, `-Parallel`, `-Reasoning`,
`-Temp`, and forwards anything else to `llama-server`.

- Web UI: <http://localhost:8080>
- OpenAI-compatible base URL: `http://localhost:8080/v1` (any model name)
- `GET /v1/models` reports `input_modalities: text, image, audio, video` and
  `output_modalities: text, audio`
- `/v1/realtime` exposes llama.cpp's WebSocket API for live voice

Image input is an `image_url` content part (data URLs work). Audio input is an
`input_audio` part with base64 `data` and `format: 'wav'`.

### Measured performance

RTX 3080, Q8_0, `-ngl 99`, build `b12645`:

| Workload            | Result                                 |
| ------------------- | -------------------------------------- |
| Prompt eval         | ~9,500 t/s at 512 tokens               |
| Text generation     | ~130-163 t/s                           |
| Image understanding | ~950 t/s prompt, ~148 t/s generation   |
| Speech recognition  | ~275 t/s prompt, ~150 t/s generation   |
| Video understanding | ~3,000 t/s prompt, ~143 t/s generation |
| Speech synthesis    | ~4.9x faster than real time            |

CPU-only: ~72 t/s prompt, ~15 t/s generation. Memory: ~2.9 GB RSS with the
projector loaded.

### Model notes

- Non-reasoning model; run with reasoning off and `temperature 0` for text.
- Speech output wants audio temperature 0.4 and repetition penalty 1.2; the
  values stored in the GGUF already do this.
- `--tts-voice` is `female` (default) or `male`; 22 languages supported.
- Audio input is marked experimental by llama.cpp.
- License is **LFM Open License v1.0** (`models/LICENSE`) - not Apache/MIT.

### Changing the quant

| Files                          | Size           | Notes                        |
| ------------------------------ | -------------- | ---------------------------- |
| `Q4_K_M` + `mmproj-...-Q4_K_M` | 1.05 / 0.28 GB | fastest, slight quality loss |
| `Q8_0` + `mmproj-...-Q8_0`     | 1.72 / 0.47 GB | current setup                |
| `BF16` + `mmproj-...-BF16`     | 3.31 / 0.91 GB | full precision               |

```powershell
hf download LiquidAI/LFM3-Omni-2B-GGUF LFM3-Omni-2B-Q4_K_M.gguf mmproj-LFM3-Omni-2B-Q4_K_M.gguf --local-dir models
```

Then update `LFM3_MODEL` / `LFM3_MMPROJ` in `scripts/_env.ps1`.

## Troubleshooting

- **Port 8080 says "server unavailable"** - nothing is listening. Run
  `.\scripts\serve.ps1`; verify with `Invoke-RestMethod http://localhost:8080/health`.
- **~15 t/s, `--list-devices` shows `(none)`** - CUDA DLLs are not on `PATH`.
- **Video prompts fail** - mismatched `ffmpeg`/`ffprobe`; set `LFM3_FFMPEG_DIR`.
- **`better-sqlite3` fails to build** - install MSVC Build Tools for the native
  addon, then `pnpm approve-builds`.
- **`/api/*` returns 500 from the web app** - the API is not running on the port
  baked into the Next build. Start the API on 3001, or rebuild with
  `API_BASE_URL` set.
- **Chat says "The assistant could not answer"** - 8080 is not answering. Start it
  with `scripts/serve.ps1`. A failed _speech_ synthesis is not an error; the text
  answer still appears.
- **`search_notes` fails but everything else works** - 8091 is not running. Start
  it with `pnpm embed:serve`; downloads come from
  `scripts/download-embeddings.ps1`.
- **"Take photo" / "Record audio" do nothing on a phone** - the page is on a
  plain-HTTP LAN origin, where `navigator.mediaDevices` is `undefined`. Use the
  HTTPS address from `scripts/https-serve.ps1` with `certs/rootCA.crt` installed,
  as in "Use the camera or microphone from a phone".
- **The phone shows a certificate warning before the page loads** - the leaf is
  not trusted yet, or the LAN address changed after minting. Reinstall
  `certs/rootCA.crt`, and re-run `scripts/https-cert.ps1 -Force` if the address
  changed.
- **`curl.exe` fails on `https://127.0.0.1:3443` with "revocation status unknown"**
  - Windows Schannel wants to reach a CRL for the local CA. `curl --ssl-no-revoke
--cacert certs/rootCA.crt ...` verifies fine; browsers are unaffected.

## Documentation

- `AGENTS.md` - instructions for coding agents (versions, tests, docs, guidance).
- `docs/stack.md` - pinned versions and every deviation from latest.
- `docs/architecture.md` - process topology, data model, chat, error contract.
- `docs/agent.md` - the agent CLI, its tools, and the loop.
- `docs/embeddings.md` - EmbeddingGemma 2 wire formats and retrieval design.
- `docs/benchmark.md` - measured capability and latency, and how to reproduce.
- `docs/web-guidance.md` - the Modern Web Guidance rules this UI follows.
