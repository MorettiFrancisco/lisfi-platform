import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/d1';
import { authOptions } from './src/modules/auth/options';

// Generation only: the official CLI reads adapter metadata, never queries this DB.
// Keep generated column names stable across schema regeneration.
export const auth = betterAuth({
  ...authOptions,
  database: drizzleAdapter(drizzle({} as D1Database), {
    provider: 'sqlite',
    camelCase: true,
  }),
  advanced: { database: { validateSchema: false } },
});
