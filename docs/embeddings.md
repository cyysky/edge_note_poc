# Embeddings

The notes agent's `search_notes` tool uses
[`unsloth/embeddinggemma-2-GGUF`](https://huggingface.co/unsloth/embeddinggemma-2-GGUF)
served by a second `llama-server` on port **8091**. It produces **768-dimension**
vectors. Text and media use different wire shapes; the model card forbids a task
prefix on media.

## Files and server

| Path                                       | Purpose                        |
| ------------------------------------------ | ------------------------------ |
| `models/embeddinggemma-2-Q8_0.gguf`        | 310 MB text/embedding backbone |
| `models/mmproj-embeddinggemma-2-Q8_0.gguf` | 555 MB multimodal projector    |

The projector is published as `mmproj-Q8_0.gguf`; it is stored under a
model-specific name because several models share that filename shape. Without it,
media embeddings fail even though text embeddings still answer.

```powershell
.\scripts\download-embeddings.ps1   # skips files already present
pnpm embed:serve                      # llama-server --embeddings -c 8192 on 8091
Invoke-RestMethod http://127.0.0.1:8091/health
```

One `llama-server` hosts one model, which is why this is a separate process from
LFM3-Omni on 8080. `scripts/_env.ps1` holds `LFM3_EMBED_MODEL`,
`LFM3_EMBED_MMPROJ` and `LFM3_EMBED_PORT`.

## Wire formats

llama-server requires a `model` name but ignores its value; `embed` is what the
client sends.

Text, one or many, returns one 768-d vector per input in `data[].index` order:

```json
{
  "model": "embed",
  "input": [
    "task: search result | query: what did I write about foxes?",
    "title: Fox sighting | text: A red fox crossed the garden."
  ]
}
```

Media is sent as **content parts**, and carries **no task prefix**:

```json
{
  "model": "embed",
  "input": [
    {
      "content": [{ "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }]
    }
  ]
}
```

Audio uses `{ "type": "input_audio", "input_audio": { "data": "<base64>", "format": "wav" } }`
and video uses `video_url`, matching the chat client's part shapes.

Rejected shapes, confirmed against the running server:

- `input: [{ "prompt": "..." }]` - 400.
- A top-level `content` array instead of `input` - 400.
- Any task prefix on a media part - the model card forbids it.

## Asymmetric prefixes

```
query:    task: search result | query: <user text>
document: title: <title or "none"> | text: <body>
```

The prefix is not decoration. EmbeddingGemma was trained to put a labelled query
and a labelled document in the same region; dropping the labels measurably lowers
retrieval. The client applies the query prefix **only** in `embedQuery` and the
document prefix **only** in `embedDocuments`, so a caller cannot accidentally
prefix both or neither.

## Retrieval

`search_notes` embeds every note title+body and the query, scores with cosine
similarity, and returns the top hits. There is no stored index:

- A note corpus here is small enough that one batched request covers it, and the
  server embeds the whole corpus faster than a round trip per note.
- A stored index needs invalidation on every create, update and delete. A stale
  index is a correctness bug; re-embedding cannot be stale.
- `apps/bench` measures this path directly: `recall@1`, `recall@3` and MRR over
  paraphrased queries. Current numbers are in `docs/benchmark.md`.

If the corpus grows past what one request can carry, the replacement is a stored
vector table plus an invalidation path, not a bigger request.

## Failure modes

- **8091 not answering** - `search_notes` throws a `ToolError` naming
  `pnpm embed:serve`; the model sees a tool failure and can fall back to
  `list_notes`.
- **Projector missing** - text search still works; media embeddings fail. Download
  both files.
- **Dimension mismatch** - comparing vectors of different lengths throws rather
  than scoring silently, so a wrong model cannot quietly degrade ranking.
