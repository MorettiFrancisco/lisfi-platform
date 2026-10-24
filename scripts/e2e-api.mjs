import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const requireApi = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
const wrangler = join(
  dirname(requireApi.resolve('wrangler/package.json')),
  'bin',
  'wrangler.js',
);
const directory = mkdtempSync(join(tmpdir(), 'lisfi-e2e-'));
const config = join(directory, 'wrangler.json');
const persistence = join(directory, 'state');
if (!process.env.LISFI_E2E_BOOTSTRAP_TOKEN)
  throw new Error('Missing E2E bootstrap token');
writeFileSync(
  config,
  JSON.stringify({
    name: 'lisfi-api-e2e',
    main: fileURLToPath(new URL('../apps/api/src/index.ts', import.meta.url)),
    compatibility_date: '2026-10-22',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: false,
    d1_databases: [
      {
        binding: 'DB',
        database_name: 'lisfi-e2e',
        database_id: '00000000-0000-0000-0000-000000000001',
        migrations_dir: fileURLToPath(
          new URL('../apps/api/migrations', import.meta.url),
        ),
      },
    ],
  }),
);
writeFileSync(
  join(directory, '.dev.vars'),
  [
    'AUTH_BASE_URL=http://127.0.0.1:5174',
    `AUTH_SECRET=${randomBytes(48).toString('hex')}`,
    `BOOTSTRAP_TOKEN=${process.env.LISFI_E2E_BOOTSTRAP_TOKEN}`,
    `BOOTSTRAP_EXPIRES_AT=${new Date(Date.now() + 3600000).toISOString()}`,
  ].join('\n'),
  { mode: 0o600 },
);

async function run(args) {
  const child = spawn(
    process.execPath,
    [wrangler, ...args, '--config', config, '--persist-to', persistence],
    { cwd: directory, stdio: 'inherit' },
  );
  const stop = () => child.kill();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`E2E Worker exited with ${code}`)),
      );
    });
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}
// A new temporary database for every suite; never use the developer's .dev.vars or D1.
await run(['d1', 'migrations', 'apply', 'DB', '--local']);
await run([
  'dev',
  '--local',
  '--ip',
  '127.0.0.1',
  '--port',
  '8788',
  '--inspector-port',
  '0',
]);
