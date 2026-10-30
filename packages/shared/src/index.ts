import { z } from 'zod';
export * from './clubs';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('lisfi-api'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const meResponseSchema = z.object({
  user: z.object({ id: z.string(), name: z.string() }),
  roles: z.array(z.literal('LEAGUE_ADMIN')),
  mfaRequired: z.boolean(),
  canManageAdmins: z.boolean().default(false),
  clubs: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const bootstrapRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();

export const adminInvitationRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();

export const adminInvitationAcceptSchema = bootstrapRequestSchema
  .extend({
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const mfaEnrollmentSchema = z.object({
  totpURI: z.url({ protocol: /^otpauth$/, hostname: /^totp$/ }).max(2048),
  backupCodes: z.array(z.string().min(1)).min(1),
});

export * from './changes';

export * from './seasons';

export * from './audit';
