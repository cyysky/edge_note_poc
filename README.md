# LFM3-Omni-2B (GGUF) local setup

Local, offline runner for [LiquidAI/LFM3-Omni-2B-GGUF](https://huggingface.co/LiquidAI/LFM3-Omni-2B-GGUF)
on Windows + NVIDIA. Text, image, audio and video go in; text and speech come out.

## What is installed

| Path | Contents |
| --- | --- |
| `models/LFM3-Omni-2B-Q8_0.gguf` | 1.7 B param backbone, Q8_0 (1.72 GB) |
| `models/mmproj-LFM3-Omni-2B-Q8_0.gguf` | vision + audio projector (0.47 GB) |
| `models/README.md`, `models/LICENSE` | upstream model card and LFM 1.0 license |
| `runtime/` | llama.cpp `b12645` Windows CUDA 13.5 x64 build |
| `scripts/` | `serve.ps1`, `stop.ps1`, `ask.ps1`, `verify.ps1`, `_env.ps1` |
| `samples/` | test fixtures used to validate every modality |
| `out/` | scratch output (gitignored) |

Both GGUF files were SHA-256 verified against the Hugging Face LFS metadata:

```
59118f661eaacb93d204723d76355b53347f0940b508c11412f6290fd49158d4  LFM3-Omni-2B-Q8_0.gguf
8a25f9d1931244429de404fccacfb7fb933970a36aa5688d2f5069f29c6b27b1  mmproj-LFM3-Omni-2B-Q8_0.gguf
```

## Prerequisites

- NVIDIA driver plus a CUDA 13.x runtime. The build links `cudart64_13.dll`,
  `cublas64_13.dll` and `cublasLt64_13.dll`; here they live in
  `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.0\bin\x64`.
- `ffmpeg` **and** `ffprobe` for video input.
- PowerShell 5.1 or 7+.

`scripts/_env.ps1` prepends `runtime/`, the CUDA bin directory and a directory
containing a matched `ffmpeg`/`ffprobe` pair to `PATH`. It is worth knowing why:

- Without the CUDA DLLs on `PATH`, llama.cpp silently runs **CPU-only**
  (`--list-devices` prints `(none)` and generation drops to ~15 t/s).
- This machine has an ancient 2013 `ffprobe` in `Python313\Scripts` that wins
  PATH order over the modern WinGet pair, which makes every video prompt fail
  with `Failed to load image or audio file`.

Override the auto-discovery with `$env:LFM3_FFMPEG_DIR` if ffmpeg lives elsewhere.

## Start and stop

```powershell
.\scripts\serve.ps1        # web UI + OpenAI-compatible API on port 8080
.\scripts\stop.ps1         # stop it
```

Then open <http://localhost:8080>.

The server is **not** a background service. It runs only while `serve.ps1` (or
`llama-server`) is alive, so "server unavailable" simply means nothing is
listening. The two realistic causes:

- **Nothing is running.** The script defaults to port 8080 and llama.cpp itself
  defaults to 9931; a tab reopened after the process exited refuses the
  connection. Check with `Get-Process llama-server`.
- **IPv6 vs IPv4.** `localhost` resolves to `::1` first on Windows. `serve.ps1`
  binds both `127.0.0.1` and `::1`, so `http://localhost`, `http://127.0.0.1`
  and `http://[::1]` all work. If you bind `-HostName 127.0.0.1` manually and the
  page still fails, try `http://127.0.0.1:8080`.

Health check without a browser:

```powershell
Invoke-RestMethod http://localhost:8080/health    # {"status":"ok"}
```

Start detached so closing the terminal does not kill it:

```powershell
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','.\scripts\serve.ps1'
```

## Quick start

```powershell
# web chat UI + OpenAI-compatible API on http://localhost:8080
.\scripts\serve.ps1
```

One-shot prompts:

```powershell
# text
.\scripts\ask.ps1 -Prompt "Explain GGUF quantization in two sentences."

# image understanding
.\scripts\ask.ps1 -Image .\samples\test_shapes.png -Prompt "Describe this image."

# speech recognition
.\scripts\ask.ps1 -Audio .\samples\test_speech.wav -System "Perform ASR in English."

# text to speech
.\scripts\ask.ps1 -Prompt "Hello from Liquid AI." -Tts -TtsOut .\out\hello.wav -TtsVoice female -TtsLang en

# video understanding
.\scripts\ask.ps1 -Video .\samples\reading.mp4 `
    -System "Answer questions about the video using what you see and hear." `
    -Prompt "What happens here, and what can you hear?"

# integrity + GPU + generation check
.\scripts\verify.ps1
```

`ask.ps1 -Interactive` opens the streaming REPL, where `/image`, `/audio` and
`/video` add media mid-conversation. Extra llama.cpp flags can be passed with
`-ExtraMedia @('--image','a.png')`.

## Server usage

`serve.ps1` accepts `-Port`, `-HostName`, `-Ctx`, `-Parallel`, `-Reasoning`,
`-Temp`, and forwards anything else to `llama-server`.

Once running:

- Web UI: <http://localhost:8080>
- OpenAI-compatible base URL: `http://localhost:8080/v1` (any model name, e.g. `local`)
- `GET /v1/models` reports `input_modalities: text, image, audio, video` and
  `output_modalities: text, audio`

Image input is a normal `image_url` content part (data URLs work):

```powershell
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\samples\test_shapes.png"))
$body = @{
  model = 'local'; temperature = 0; max_tokens = 64
  messages = @(@{ role = 'user'; content = @(
    @{ type = 'text'; text = 'What colors are in this image?' }
    @{ type = 'image_url'; image_url = @{ url = "data:image/png;base64,$b64" } }
  )})
} | ConvertTo-Json -Depth 8
Invoke-RestMethod http://localhost:8080/v1/chat/completions -Method Post -Body $body -ContentType 'application/json'
```

Audio input uses an `input_audio` part carrying base64 `data` and
`format = 'wav'`, with a system message such as `Perform ASR in English.`

The server also exposes llama.cpp's `/v1/realtime` WebSocket API for real-time
voice conversations with tool calls.

## Measured performance

RTX 3080, Q8_0, `-ngl 99`, build `b12645`:

| Workload | Result |
| --- | --- |
| Prompt eval | ~9,500 t/s at 512 tokens |
| Text generation | ~130-163 t/s |
| Image understanding | ~950 t/s prompt, ~148 t/s generation |
| Speech recognition | ~275 t/s prompt, ~150 t/s generation |
| Video understanding | ~3,000 t/s prompt, ~143 t/s generation |
| Speech synthesis | ~4.9x faster than real time |

CPU-only fallback for comparison: ~72 t/s prompt, ~15 t/s generation.

Memory: roughly 2.9 GB RSS with the projector loaded, so it coexists easily with
other work on the 10 GB card. Both the 3080 and the 3060 are visible to
llama.cpp if you want to split layers with `--device` / `-ts`.

## Model notes

- Non-reasoning model; scripts and server run with reasoning off and
  `temperature 0`, as the card recommends for text.
- For speech output the card recommends audio temperature 0.4 and audio
  repetition penalty 1.2. `llama-tts` applies the sampling values stored in the
  GGUF, so `ask.ps1 -Tts` needs no tuning.
- `--tts-voice` is `female` (default) or `male`; `--tts-lang` is an ISO 639-1
  code (default `en`). The model covers 22 languages.
- Audio input is marked experimental by llama.cpp and may underperform the
  reference implementation.
- License is **LFM Open License v1.0** (`models/LICENSE`) — not Apache/MIT.
  Review it before commercial use.

## Changing the quant

Q8_0 is a good default here: near-lossless and comfortably in VRAM. Alternatives,
pairing the backbone and projector at the same prefix:

| Files | Size | Notes |
| --- | --- | --- |
| `LFM3-Omni-2B-Q4_K_M.gguf` + `mmproj-...-Q4_K_M.gguf` | 1.05 / 0.28 GB | fastest, slight quality loss |
| `LFM3-Omni-2B-Q8_0.gguf` + `mmproj-...-Q8_0.gguf` | 1.72 / 0.47 GB | current setup |
| `LFM3-Omni-2B-BF16.gguf` + `mmproj-...-BF16.gguf` | 3.31 / 0.91 GB | full precision |

```powershell
hf download LiquidAI/LFM3-Omni-2B-GGUF LFM3-Omni-2B-Q4_K_M.gguf mmproj-LFM3-Omni-2B-Q4_K_M.gguf --local-dir models
```

Then update `LFM3_MODEL` / `LFM3_MMPROJ` in `scripts/_env.ps1`.

## Troubleshooting

- **~15 t/s and `--list-devices` shows `(none)`** — CUDA DLLs are not on `PATH`;
  check the CUDA directory in `_env.ps1`, then run `.\scripts\verify.ps1`.
- **Video prompts fail** — `ffmpeg`/`ffprobe` mismatch; set `LFM3_FFMPEG_DIR` to
  a directory holding both from the same release.
- **Out of VRAM** — lower `-ngl` (e.g. 24) or switch to Q4_K_M.
- **Browser says server unavailable on :8080** — nothing is listening. Start it
  with `.\scripts\serve.ps1`; confirm with `Get-Process llama-server` and
  `Invoke-RestMethod http://localhost:8080/health`. If a process is running but
  the page still fails, use `http://127.0.0.1:8080` (IPv6/IPv4 mismatch).
- **Port already in use** — `.\scripts\stop.ps1`, then start again.
