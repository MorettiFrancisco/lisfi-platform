import type { BetterAuthOptions } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';

// Shared by the runtime and official schema generator. No credentials here.
export const authOptions = {
  appName: 'LISFI',
  basePath: '/api/auth',
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
    cookieCache: { enabled: false },
  },
  user: {
    additionalFields: {
      status: {
        type: 'string',
        required: true,
        defaultValue: 'ACTIVE',
        input: false,
      },
    },
  },
  rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
  plugins: [twoFactor({ issuer: 'LISFI' })],
} satisfies BetterAuthOptions;
