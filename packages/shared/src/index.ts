import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('lisfi-api'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const meResponseSchema = z.object({
  user: z.object({ id: z.string(), name: z.string() }),
  roles: z.array(z.literal('LEAGUE_ADMIN')),
  mfaRequired: z.boolean(),
  clubs: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
