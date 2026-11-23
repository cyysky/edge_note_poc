# Stack

Every version below is pinned exactly (no `^` or `~`) and was checked against
the npm registry with `pnpm view <pkg> version` on 2026-11-23. `pnpm peers check`
reports no issues.

## Runtime

| Component | Version | Notes                      |
| --------- | ------- | -------------------------- |
| Node.js   | 26.10.0 | `engines.node: ">=26.0.0"` |
| pnpm      | 12.6.0  | `packageManager` field     |

## Applications

| Package                                                    | Version |
| ---------------------------------------------------------- | ------- |
| `next`                                                     | 16.4.6  |
| `react` / `react-dom`                                      | 19.3.1  |
| `@nestjs/common` / `core` / `platform-express` / `testing` | 12.6.0  |
| `@nestjs/cli`                                              | 12.0.15 |
| `better-sqlite3`                                           | 13.2.0  |
| `reflect-metadata`                                         | 0.2.2   |
| `rxjs`                                                     | 7.8.2   |

## Types

| Package                             | Version |
| ----------------------------------- | ------- |
| `@types/node`                       | 26.6.6  |
| `@types/react` / `@types/react-dom` | 19.3.0  |
| `@types/express`                    | 5.0.6   |
| `@types/better-sqlite3`             | 9.6.0   |
| `@types/supertest`                  | 7.2.1   |

## Tooling

| Package                       | Version |
| ----------------------------- | ------- |
| `typescript`                  | 6.0.3   |
| `prettier`                    | 3.10.1  |
| `eslint`                      | 10.15.0 |
| `eslint-config-next`          | 16.4.6  |
| `typescript-eslint`           | 8.73.0  |
| `@eslint/js`                  | 10.0.1  |
| `globals`                     | 17.14.0 |
| `vitest`                      | 5.1.1   |
| `@vitejs/plugin-react`        | 6.3.0   |
| `jsdom`                       | 31.0.1  |
| `@playwright/test`            | 1.65.1  |
| `@testing-library/react`      | 16.3.3  |
| `@testing-library/dom`        | 10.4.2  |
| `@testing-library/jest-dom`   | 8.0.0   |
| `@testing-library/user-event` | 14.6.13 |
| `supertest`                   | 7.3.2   |

## Deliberate deviations from `latest`

Only two packages are not on the registry's `latest` tag. Both are recorded here
because `AGENTS.md` requires it.

| Package                     | Pinned  | Latest  | Reason                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript`                | 6.0.3   | 7.0.2   | `typescript-eslint@8.73.0` (and its canary) requires `typescript >=4.8.4 <6.1.0`, and TS 7 removed `moduleResolution: "node10"`. TS 7 cannot be used until the lint toolchain supports it.                                                                                                                                  |
| `eslint` (transitive peers) | 10.15.0 | 10.15.0 | `eslint` itself is latest, but `eslint-plugin-import`, `eslint-plugin-jsx-a11y` and `eslint-plugin-react` still declare an `^9` peer cap. They lint cleanly on 10.x, so the cap is declared in `pnpm-workspace.yaml` under `peerDependencyRules.allowedVersions`. Remove those entries when the plugins widen their ranges. |

`typescript@6` warns when `moduleResolution` is `node10`. All packages therefore
use `module: "node16"` + `moduleResolution: "node16"` (apps and shared) or
`moduleResolution: "bundler"` (web, Next-managed).

`better-sqlite3` is chosen over Node's built-in `node:sqlite` on purpose:
`node:sqlite` is still release-candidate quality, renamed `DatabaseSync` to
`Database` in Node 26.11, and changed `undefined`-to-`NULL` binding in 26.10.
