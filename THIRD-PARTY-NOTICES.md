# Third-party notices

The rest of this file covers everything this repository redistributes or
depends on.
`LICENSE` at the root is MIT and applies to the repository's own source: the
apps, the packages and the scripts around the local model runtime. Anything
below keeps its own license and terms, and those win for that material.

## Vendored Modern Web Guidance skill

`.agents/skills/modern-web-guidance/` is a verbatim copy of the
`modern-web-guidance` skill from
[GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance),
at commit `64a6d708f5a43f2cd3fde5d4d7db3905ba1bdf65`
(recorded in `skills-lock.json`).

- Copyright Google LLC and the modern-web-guidance authors.
- Licensed under the Apache License, Version 2.0:
  <https://www.apache.org/licenses/LICENSE-2.0>.
- Full license text:
  <https://github.com/GoogleChrome/modern-web-guidance/blob/64a6d708f5a43f2cd3fde5d4d7db3905ba1bdf65/LICENSE>.

The copy is unmodified, so the skill's content and its license text stay in
sync with upstream. `skills-lock.json` pins the commit and a content hash;
refresh with `npx modern-web-guidance@latest install` rather than editing files
by hand.

## Models and weights

No model weights are committed; `models/*.gguf` is gitignored. This repository
downloads them and ships a license copy for the primary model
(`models/LICENSE`, not covered by the root MIT license).

| Model            | Source                                                                                | License                         |
| ---------------- | ------------------------------------------------------------------------------------- | ------------------------------- |
| LFM3-Omni-2B     | [LiquidAI/LFM3-Omni-2B-GGUF](https://huggingface.co/LiquidAI/LFM3-Omni-2B-GGUF)       | LFM Open License v1.0           |
| EmbeddingGemma 2 | [unsloth/embeddinggemma-2-GGUF](https://huggingface.co/unsloth/embeddinggemma-2-GGUF) | Apache-2.0 (per its model card) |

Each model's own license governs its use; this repository neither re-licenses
the weights nor grants rights to them by shipping this notice.

## Sample media

- `samples/reading.mp4` comes from the `raushan-testing-hf/videos-test` dataset
  on Hugging Face (Apache-2.0), pinned to
  commit `4cba700bd771f44d72b549253da025c32e944d42`. It is a short clip of a
  child reading a book, used to exercise the video input.
- `samples/test_shapes.png`, `samples/test_speech.wav` and
  `samples/test_tts.wav` are generated fixtures for image, ASR and speech
  output checks.

## Dependencies

All runtime dependencies are resolved through `pnpm-lock.yaml` and keep their
own licenses; see each package's metadata under `node_modules`. Nothing here
changes their terms.
