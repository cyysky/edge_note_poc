# Agent

`packages/agent` is the model layer shared by the API, the CLI and the
benchmark. `apps/agent` is the command-line front end that gives the notes agent
a chat interface.

The model plans its own tool calls. No framework prompt, no planner and no
hand-written state machine decides what to call; the loop asks the model and
executes what it asks for.

## Run it

The model and the API must already be running:

```powershell
.\scripts\serve.ps1        # LFM3-Omni on 8080
pnpm dev                    # API on 3001, web on 3000
pnpm agent "what notes mention foxes?"
```

```
Usage: displayer-agent "<prompt>" [--image file.png]... [--audio file.wav] [--tts-out out.wav]

  --image <path>      Attach an image (repeatable)
  --audio <path>      Attach an audio clip (repeatable)
  --tts-out <path>    Synthesise the final answer to a WAV file
  --voice <name>      TTS voice: female (default) or male
  --json              Print newline-delimited JSON events instead of prose
  --max-steps <n>     Model calls before the loop gives up (default 8)
  --model-url <url>   llama-server base URL (default http://127.0.0.1:8080)
  --api-url <url>     Nest API base URL (default http://127.0.0.1:3001)
```

```powershell
pnpm agent "Add a note titled 'Fox sighting' saying a red fox crossed the garden."
pnpm agent "What is in this picture?" --image .\samples\test_shapes.png
pnpm agent "Transcribe the recording and save it as a note." --audio .\samples\test_speech.wav
pnpm agent "Summarise my notes" --tts-out .\out\summary.wav
```

Prose events go to stdout, progress goes to stderr, so `--json` or a redirected
stdout stays parseable.

## Tools

| Tool           | Arguments              | Purpose                                          |
| -------------- | ---------------------- | ------------------------------------------------ |
| `list_notes`   | `limit?`               | Newest-first list with ids, for "what do I have" |
| `search_notes` | `query`, `limit?`      | Semantic search over note bodies                 |
| `get_note`     | `id`                   | Full body of one note                            |
| `create_note`  | `title`, `body?`       | Create; validation mirrors the UI                |
| `update_note`  | `id`, `title`, `body?` | Replace title and body                           |
| `delete_note`  | `id`                   | Permanent delete                                 |

Every tool is one complete operation. LFM3 emits one call per turn in practice,
so nothing depends on state a sibling call would have set.

Arguments are validated with Zod **before** execution. A bad call is returned to
the model as structured JSON (`invalid_arguments`, the issues, and a hint),
not thrown as a crash, so the model can retry with corrected arguments.

Tool results are truncated at 8,000 characters before they enter the transcript.
One large result cannot blow the context window.

## Loop

`runAgent` (`packages/agent/src/runner.ts`) is deliberately small:

1. Send the system prompt, replayed history and the new user turn.
2. If the model answers with no tool call, that is the final answer.
3. Otherwise execute every requested call, append each result, go to 1.
4. Stop after `maxSteps` model calls and return the last text with
   `stopReason: 'steps'`.

Each tool call costs one model call, so the budget is a round-trip count, not a
token count. `ChatService` uses 8; the CLI defaults to 8.

Tools receive a context (`signal`, `log`) rather than the loop, so a tool cannot
re-enter the model. Anything the agent should do next belongs in a tool.

## Backends

The tools talk to a `NotesBackend` interface with two implementations:

- **Real** (`createNotesBackend`): HTTP calls to the Nest API. The API owns
  validation, ids and timestamps, so an agent-created note is indistinguishable
  from one made in the UI. It is also the only writer.
- **Stub** (`apps/bench`): an in-memory list seeded with one note. The benchmark
  then measures the model's ability to choose and shape a call, not whether a
  database happened to be running, and cannot leave notes behind.

`search_notes` re-embeds the corpus on every call instead of using a vector
index. Notes are few and small, one batched request covers them, and a stored
index would need invalidation on every write. `docs/embeddings.md` records the
measurement that justified this.

## System prompt

`NOTES_SYSTEM_PROMPT` in `packages/agent/src/prompts.ts` is the policy the API
and CLI share: read before writing, confirm before deleting, prefer semantic
search for topic questions, answer in the user's language, retry a failed call
with fixed arguments, one tool call per turn.
