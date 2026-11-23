# Displayer

A small, complete reference app: **Next.js 16** App Router on the front,
**NestJS 12** behind it, **SQLite** on disk, with **LFM3-Omni-2B** running
locally for text, image, audio and video.

Two independent things live here:

1. The **notes app** (web + api + shared packages) - the running application.
2. The **local LFM3-Omni runtime** (`models/`, `runtime/`, `scripts/`) - an
   offline multimodal model that serves a web UI on port 8080.

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
| `apps/web`            | Next.js client: server-rendered list, client dialog editor |
| `apps/api`            | NestJS API: `/api/health`, `/api/notes` CRUD               |
| `packages/shared`     | Wire contracts and validation used by both apps            |
| `docs/`               | `stack.md`, `architecture.md`, `web-guidance.md`           |
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
pnpm typecheck      # tsc --noEmit everywhere
pnpm lint           # eslint everywhere
pnpm format         # prettier --write
pnpm format:check   # prettier --check
```

## Configuration

Defaults work with no configuration. To override, copy `.env.example` to
`.env.local` in `apps/web` and/or set the API environment variables.

| Variable        | Default                 | Used by                                 |
| --------------- | ----------------------- | --------------------------------------- |
| `API_BASE_URL`  | `http://127.0.0.1:3001` | web (build-time; also server rendering) |
| `PORT`          | `3001`                  | api                                     |
| `DATABASE_PATH` | `data/displayer.db`     | api                                     |

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

## LFM3-Omni-2B local runtime

Local, offline runner for
[LiquidAI/LFM3-Omni-2B-GGUF](https://huggingface.co/LiquidAI/LFM3-Omni-2B-GGUF)
on Windows + NVIDIA. Text, image, audio and video go in; text and speech come
out.

| Path                                   | Contents                                                     |
| -------------------------------------- | ------------------------------------------------------------ |
| `models/LFM3-Omni-2B-Q8_0.gguf`        | 1.7 B param backbone, Q8_0 (1.72 GB)                         |
| `models/mmproj-LFM3-Omni-2B-Q8_0.gguf` | vision + audio projector (0.47 GB)                           |
| `runtime/`                             | llama.cpp `b12645` Windows CUDA 13.5 x64 build               |
| `scripts/`                             | `serve.ps1`, `stop.ps1`, `ask.ps1`, `verify.ps1`, `_env.ps1` |
| `samples/`                             | fixtures used to validate every modality                     |

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

## Documentation

- `AGENTS.md` - instructions for coding agents (versions, tests, docs, guidance).
- `docs/stack.md` - pinned versions and every deviation from latest.
- `docs/architecture.md` - process topology, data model, error contract.
- `docs/web-guidance.md` - the Modern Web Guidance rules this UI follows.
