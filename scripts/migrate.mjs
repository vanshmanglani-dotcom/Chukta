// Applies every migrations/*.sql file in order. Safe to re-run (statements are idempotent).
// Usage: DATABASE_URL=... npm run db:migrate
import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const dir = 'migrations';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  const text = readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const statements = text.split(';').map((s) => s.trim()).filter(Boolean);
  // Run the whole file atomically so a half-applied migration can't happen.
  await sql.transaction(statements.map((s) => sql.query(s)));
  console.log(`applied ${file} (${statements.length} statements)`);
}
