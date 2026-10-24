import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { log } from 'node:console';
import { URL } from 'node:url';

const path = new URL('../apps/api/.dev.vars', import.meta.url);
// Requires auth:setup:local first. Preserve all other settings and never print secrets.
const current = readFileSync(path, 'utf8');
const retained = current
  .split(/\r?\n/)
  .filter((line) => !/^\s*BOOTSTRAP_(TOKEN|EXPIRES_AT)\s*=/.test(line))
  .join('\n')
  .trimEnd();
const expiration = new Date(Date.now() + 60 * 60 * 1000).toISOString();
writeFileSync(
  path,
  `${retained}\nBOOTSTRAP_TOKEN=${randomBytes(32).toString('hex')}\nBOOTSTRAP_EXPIRES_AT=${expiration}\n`,
  { mode: 0o600 },
);
log(
  'Alta inicial habilitada por una hora en .dev.vars. Reiniciá la API y usá BOOTSTRAP_TOKEN en el formulario. No compartas esta clave.',
);
