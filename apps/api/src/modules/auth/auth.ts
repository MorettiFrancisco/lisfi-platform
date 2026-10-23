import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import { authOptions } from './options';
import type { Bindings } from '../../env';
import { createDb } from '../../db';
import * as authSchema from '../../db/auth-schema';

export function createAuth(env: Bindings) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || !env.AUTH_BASE_URL) {
    throw new Error('Authentication is not configured');
  }
  const url = new URL(env.AUTH_BASE_URL);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('Authentication requires HTTPS outside loopback');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('AUTH_BASE_URL must be an origin');
  }
  return betterAuth({
    ...authOptions,
    database: drizzleAdapter(createDb(env.DB), {
      provider: 'sqlite',
      schema: authSchema,
      transaction: false,
    }),
    secret: env.AUTH_SECRET,
    baseURL: url.origin,
    trustedOrigins: [url.origin],
    advanced: {
      useSecureCookies: url.protocol === 'https:',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    logger: { disabled: true },
    databaseHooks: {
      user: {
        update: {
          // Do not retain pre-MFA sessions when a user enrolls or changes security settings.
          after: async (updated) => {
            await createDb(env.DB)
              .delete(authSchema.session)
              .where(eq(authSchema.session.userId, updated.id));
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const current = await createDb(env.DB)
              .select({ status: authSchema.user.status })
              .from(authSchema.user)
              .where(eq(authSchema.user.id, session.userId))
              .get();
            if (current?.status !== 'ACTIVE') return false;
          },
        },
      },
    },
  });
}
