import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function relationExists(client, name) {
  const res = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [name]);
  return res.rows[0]?.exists === true;
}

async function tableExists(client, tableName) {
  return relationExists(client, `public.${tableName}`);
}

async function indexExists(client, indexName) {
  return relationExists(client, `public.${indexName}`);
}

async function columnExists(client, tableName, columnName) {
  const res = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [tableName, columnName]
  );
  return res.rowCount > 0;
}

async function enumValueExists(client, typeName, value) {
  const res = await client.query(
    `SELECT 1
     FROM pg_type t
     JOIN pg_enum e ON t.oid = e.enumtypid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
       AND t.typname = $1
       AND e.enumlabel = $2
     LIMIT 1`,
    [typeName, value]
  );
  return res.rowCount > 0;
}

async function isLegacyApplied(client, migrationName) {
  // Only needed when upgrading an existing DB that predates schema_migrations.
  // Keep this minimal: focus on migrations that would error if re-run.
  switch (migrationName) {
    case '001_init.sql':
      return tableExists(client, 'hosts');
    case '002_events_indexes.sql':
      return indexExists(client, 'sessions_host_status_idx');
    case '004_session_groups.sql':
      return tableExists(client, 'session_groups');
    case '005_session_forking.sql':
      return columnExists(client, 'sessions', 'forked_from');
    case '006_search.sql':
      return columnExists(client, 'sessions', 'search_vector');
    case '007_multi_provider.sql':
      return enumValueExists(client, 'session_provider', 'gemini_cli');
    default:
      return false;
  }
}

function formatPgError(err) {
  if (!err || typeof err !== 'object') return String(err);
  const e = err;
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : String(e);
  return code ? `${message} (pg ${code})` : message;
}

async function main() {
  const databaseUrl = requireEnv('DATABASE_URL');

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(scriptDir, '..', '..', '..', 'migrations');

  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const migrations = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();

  if (migrations.length === 0) {
    throw new Error(`No migrations found in ${migrationsDir}`);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );

    const appliedRes = await client.query('SELECT name FROM schema_migrations ORDER BY name');
    const applied = new Set(appliedRes.rows.map((r) => r.name).filter((n) => typeof n === 'string'));

    const legacyMode = applied.size === 0;

    for (const name of migrations) {
      if (applied.has(name)) continue;

      if (legacyMode && (await isLegacyApplied(client, name))) {
        // Record without executing to avoid duplicate-object failures.
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [name]
        );
        applied.add(name);
        // eslint-disable-next-line no-console
        console.log(`[db:migrate] baseline ${name}`);
        continue;
      }

      const filePath = path.join(migrationsDir, name);
      const sql = await fs.readFile(filePath, 'utf8');

      // eslint-disable-next-line no-console
      console.log(`[db:migrate] apply ${name}`);

      // Wrap each migration in a transaction so we either apply it fully or not at all.
      // (Postgres 15+ supports our enum migrations inside a transaction.)
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        applied.add(name);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed: ${name}: ${formatPgError(err)}`);
      }
    }

    // eslint-disable-next-line no-console
    console.log('[db:migrate] done');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

