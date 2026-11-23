# AGENTS.md

Instructions for any coding agent working in this repository.

## Version policy (mandatory)

Every dependency must be on a **latest stable** release.

1. Before adding or bumping a package, check the registry, do not trust memory:
   ```powershell
   pnpm view <pkg> version            # latest stable
   pnpm view <pkg> dist-tags --json   # latest / next / canary
   ```
2. Pin the exact version in `package.json` (no `^`/`~`) and install it, then
   record the value in `docs/stack.md`.
3. If the true latest breaks a peer range, use the newest version that satisfies
   the peer graph and note why in `docs/stack.md`. Do not silently keep a stale
   version.
4. Re-check versions whenever you touch dependencies, at least once per session.
   `pnpm peers check` must be clean.
5. Do not commit unless asked. Never commit `models/`, `runtime/`, `node_modules/`,
   build output, databases, or logs; they are gitignored on purpose.

Current pinned stack lives in `docs/stack.md`. Treat it as the source of truth
for "what version are we on", and update it in the same change that bumps a
dependency.

## Documentation policy

`.md` files describe **only the current state**. There is no changelog, no
"previously we did X", no dated history section. Git is the history; use
`git log`, `git blame`, and `git show` instead of writing it down.

- `README.md` - what the repo is, how to run it, how to test it.
- `docs/stack.md` - pinned versions and the reason for any deviation from latest.
- `docs/architecture.md` - how the pieces fit together.
- `docs/web-guidance.md` - which Modern Web Guidance rules this UI commits to.
- Doc comments in code explain _why_, not _what the diff changed_.

## Modern Web Guidance (mandatory)

Any work on HTML, CSS, layout, animation, client-side JS, forms, dialogs,
tables, accessibility, performance or security must consult the installed
Modern Web Guidance skill first (`.agents/skills/modern-web-guidance/`).

```powershell
npx.cmd -y modern-web-guidance@latest search "<2-5 word capability query>"
npx.cmd -y modern-web-guidance@latest retrieve "<id>[,<id>]"
```

- Search **before** writing UI code, not after.
- One query per single platform capability; no framework or app nouns.
- Apply the guide's modern platform primitive (for example a native `<dialog>`
  instead of a scripted modal) and its documented fallback only when the feature
  is not Baseline.
- End the response with a `### Modern Web Guidance` section listing each applied
  guide id with a short verbatim quote, as the skill requires.
- Refresh the skill with `npx modern-web-guidance@latest install` and commit the
  updated `skills-lock.json`.

## Browser support

Target **Baseline Widely available** and current evergreen browsers. Adopt a
non-Baseline feature only with the fallback the guide prescribes.

## Repository layout

```
apps/web          Next.js 16 App Router client (port 3000)
apps/api          NestJS 12 HTTP API (port 3001, prefix /api)
packages/shared   Wire contracts + validation shared by both apps
scripts/          PowerShell tooling for the local LFM3-Omni runtime
docs/             Current-state documentation
```

Model weights, the llama.cpp build and the `start_*.bat` / `stop_*.bat`
launchers live in `LFM3_OMNI_ROOT` (default `D:\workspace\20261123_lfm3_omni`),
outside this repository, so a clone stays source-only. Both launchers pin
`--device CUDA0`, the RTX 3080.

The browser talks to `/api/*` on the web origin; `next.config.ts` rewrites that
to the API. Server rendering calls the API directly.

## Commands

```powershell
pnpm install                 # workspace install
pnpm dev                     # api + web together
pnpm build                   # shared, then api and web
pnpm test                    # every unit and e2e suite
pnpm typecheck               # tsc --noEmit everywhere
pnpm lint                    # eslint everywhere
pnpm format:check            # prettier check
```

`packages/shared` must be built before the apps can typecheck; the app scripts
build it automatically.

## Testing rules

Tests must be able to fail. A test that cannot go red is not evidence.

- Add a test for every behaviour you change; assert the observable outcome.
- Before trusting a changed test, deliberately break the code it covers and
  confirm the suite fails, then restore.
- Unit tests: Vitest. API uses SWC (`unplugin-swc`) because Nest reads
  `design:paramtypes`, which esbuild does not emit.
- API e2e: supertest against a real `AppModule` with an in-memory database.
- Web e2e: Playwright against real servers on an isolated database per run.
- Do not weaken an assertion to make a suite pass. Fix the code, or fix the
  assertion because the _expectation_ was wrong - and say which.

## Code conventions

- TypeScript strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- ES modules everywhere (`"type": "module"`); imports carry the `.js` extension.
- Prefer platform primitives over libraries. Native `<dialog>`, container
  queries, `:user-invalid`, `color-scheme`, `text-wrap` are already in use.
- Keep functions small and named for intent. Comment the _why_.
- No new dependency without a version check and a reason.
