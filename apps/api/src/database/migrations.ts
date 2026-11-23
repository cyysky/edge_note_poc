import type BetterSqlite3 from 'better-sqlite3';

interface Migration {
  readonly version: number;
  readonly up: string;
}

/**
 * Ordered, append-only migrations. Never edit a shipped migration; add a new
 * one. Applied under `PRAGMA user_version` so re-running is a no-op.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE notes (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX notes_updated_at_idx ON notes (updated_at DESC);
    `,
  },
];

export function runMigrations(db: BetterSqlite3.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;

    const apply = db.transaction(() => {
      db.exec(migration.up);
      db.pragma(`user_version = ${migration.version}`);
    });

    apply();
  }
}

export function latestMigrationVersion(): number {
  return MIGRATIONS.at(-1)?.version ?? 0;
}
