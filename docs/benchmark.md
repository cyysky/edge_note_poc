# Benchmark

Measured on the machine that runs the model, not a synthetic rate. Reproduce with:

```powershell
start_lfm3.bat         # LFM3-Omni on 8080 (in LFM3_OMNI_ROOT)
start_embed.bat        # EmbeddingGemma on 8091, for retrieval
pnpm bench --repeats 3 --md docs/benchmark.md
```

The notes tools are backed by an in-memory stub, so no database has to be running and no notes are left behind.

Local model `http://127.0.0.1:8080`, 3 run(s) per case. Latency is wall-clock around the whole agent loop; decode rate comes from llama-server's own timings.

| Case                     | Capability | Pass | Median latency | Decode tok/s | Prefill tok/s | Tool calls |
| ------------------------ | ---------- | ---- | -------------- | ------------ | ------------- | ---------- |
| `text-exact`             | text       | 100% | 153 ms         | 22.6         | 70.9          | 0          |
| `text-reason`            | text       | 0%   | 70 ms          | 38.2         | 115.5         | 0          |
| `text-instruction`       | text       | 100% | 336 ms         | 118.4        | 527.9         | 3          |
| `image-describe`         | image      | 100% | 387 ms         | 125.1        | 240.0         | 0          |
| `image-no-hallucination` | image      | 100% | 45 ms          | 96.8         | 243.2         | 0          |
| `audio-transcribe`       | audio      | 100% | 555 ms         | 121.7        | 1633.5        | 6          |
| `mixed-describe`         | mixed      | 100% | 366 ms         | 123.9        | 242.4         | 0          |
| `tools-create`           | tools      | 100% | 500 ms         | 120.0        | 1238.2        | 3          |
| `tools-list-then-answer` | tools      | 100% | 272 ms         | 117.1        | 1818.6        | 3          |
| `tools-search`           | tools      | 100% | 384 ms         | 120.1        | 540.8         | 3          |

## Failing attempts

- `text-reason`: missing "8"
  - answered: 4
- `text-reason`: missing "8"
  - answered: 4
- `text-reason`: missing "8"
  - answered: 4

## Embedding retrieval

Recall@1 100%, recall@3 100%, MRR 1.000 over 8 paraphrased queries.

## Speech output

Synthesised 6.24 s of audio in 885 ms (real-time factor 7.05×, 47 kB/s).
