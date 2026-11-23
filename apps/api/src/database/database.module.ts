import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Global, Logger, Module } from '@nestjs/common';
import type BetterSqlite3 from 'better-sqlite3';

import { DATABASE } from './database.tokens.js';
import { runMigrations } from './migrations.js';

/**
 * Resolve the database file location.
 *
 * Defaults to `apps/api/data/displayer.db` so a clone runs without configuration.
 * Tests pass `:memory:` through the same code path.
 */
export function resolveDatabasePath(): string {
  return process.env['DATABASE_PATH'] ?? resolve(process.cwd(), 'data', 'displayer.db');
}

/** Constructor shape of the CommonJS-only `better-sqlite3` package. */
type BetterSqlite3Constructor = new (filename: string) => BetterSqlite3.Database;

export function openDatabase(path: string): BetterSqlite3.Database {
  // `better-sqlite3` is CommonJS and has no ESM entry, so it is loaded through
  // `createRequire` rather than a static `import`.
  const require = createRequire(import.meta.url);
  const BetterSqlite3 = require('better-sqlite3') as BetterSqlite3Constructor;

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new BetterSqlite3(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);

  return db;
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (): BetterSqlite3.Database => {
        const path = resolveDatabasePath();
        Logger.log(`SQLite database at ${path}`, 'DatabaseModule');
        return openDatabase(path);
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
