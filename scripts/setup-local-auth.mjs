import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { log } from 'node:console';
import { URL } from 'node:url';

// Exclusive creation: never overwrite or print an existing secret.
writeFileSync(
  new URL('../apps/api/.dev.vars', import.meta.url),
  `AUTH_BASE_URL=http://127.0.0.1:5173\nAUTH_SECRET=${randomBytes(48).toString('hex')}\n`,
  { flag: 'wx', mode: 0o600 },
);
log('Created apps/api/.dev.vars. Restart the local API to load it.');
