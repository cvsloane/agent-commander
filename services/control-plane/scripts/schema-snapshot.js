/**
 * Generate (or verify) a normalized snapshot of the migrated database schema.
 *
 *   node scripts/schema-snapshot.js           # write migrations/schema.snapshot.txt
 *   node scripts/schema-snapshot.js --check    # exit 1 if the snapshot drifted
 *
 * Reads catalog metadata rather than shelling out to pg_dump, so output does not
 * vary with the client version installed on the runner. The snapshot is the
 * reviewable record of what the migration chain actually produces: a PR that
 * changes the schema must include the regenerated file, which makes accidental
 * drift visible in review instead of at deploy time.
 */
import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = path.resolve(scriptDir, '..', '..', '..', 'migrations', 'schema.snapshot.txt');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function buildSnapshot(client) {
  const lines = [];

  const { rows: columns } = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name
  `);
  lines.push('# columns: table.column type nullable default');
  for (const c of columns) {
    const def = c.column_default === null ? '-' : c.column_default.replace(/\s+/g, ' ');
    lines.push(`${c.table_name}.${c.column_name} ${c.data_type} nullable=${c.is_nullable} default=${def}`);
  }

  const { rows: constraints } = await client.query(`
    SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
           COALESCE(string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position), '-') AS cols
    FROM information_schema.table_constraints tc
    LEFT JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
    GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
    ORDER BY tc.table_name, tc.constraint_name
  `);
  lines.push('', '# constraints: table constraint type (columns)');
  for (const c of constraints) {
    lines.push(`${c.table_name} ${c.constraint_name} ${c.constraint_type} (${c.cols})`);
  }

  const { rows: indexes } = await client.query(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `);
  lines.push('', '# indexes');
  for (const i of indexes) {
    lines.push(`${i.tablename} ${i.indexname} :: ${i.indexdef}`);
  }

  const { rows: enums } = await client.query(`
    SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname
  `);
  lines.push('', '# enums');
  for (const e of enums) {
    lines.push(`${e.typname} = ${e.labels}`);
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const check = process.argv.includes('--check');
  const client = new pg.Client({ connectionString: requireEnv('DATABASE_URL') });
  await client.connect();

  let snapshot;
  try {
    snapshot = await buildSnapshot(client);
  } finally {
    await client.end();
  }

  if (!check) {
    await fs.writeFile(snapshotPath, snapshot, 'utf8');
    console.log(`[schema-snapshot] wrote ${path.relative(process.cwd(), snapshotPath)}`);
    return;
  }

  let committed;
  try {
    committed = await fs.readFile(snapshotPath, 'utf8');
  } catch {
    throw new Error(
      `No committed schema snapshot at ${snapshotPath}. `
        + 'Run `pnpm --filter @agent-command/control-plane db:schema:snapshot` and commit the result.'
    );
  }

  if (committed !== snapshot) {
    const committedLines = committed.split('\n');
    const currentLines = snapshot.split('\n');
    const added = currentLines.filter((l) => l && !committedLines.includes(l));
    const removed = committedLines.filter((l) => l && !currentLines.includes(l));

    console.error('[schema-snapshot] Schema drift detected.');
    for (const line of removed.slice(0, 40)) console.error(`  - ${line}`);
    for (const line of added.slice(0, 40)) console.error(`  + ${line}`);
    if (removed.length + added.length > 80) {
      console.error(`  ... ${removed.length + added.length - 80} more line(s)`);
    }
    console.error(
      '\nIf this change is intended, regenerate and commit the snapshot:\n'
        + '  pnpm --filter @agent-command/control-plane db:schema:snapshot'
    );
    process.exitCode = 1;
    return;
  }

  console.log('[schema-snapshot] schema matches committed snapshot');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
