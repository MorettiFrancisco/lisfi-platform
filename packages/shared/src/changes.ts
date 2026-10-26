import { z } from 'zod';
import { clubInputSchema } from './clubs';
const name = z.string().trim().min(1).max(120);
export const changeInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('CLUB'), details: clubInputSchema }).strict(),
  z
    .object({ kind: z.literal('PRESIDENT'), clubId: z.string().min(1), name })
    .strict(),
  z
    .object({
      kind: z.literal('TECHNICAL_DIRECTOR'),
      clubId: z.string().min(1),
      name,
    })
    .strict(),
  z
    .object({
      kind: z.literal('REPRESENTATIVE'),
      clubId: z.string().min(1),
      email: z.string().trim().toLowerCase().email().max(254),
    })
    .strict(),
  z
    .object({
      kind: z.literal('PLAYER'),
      clubId: z.string().min(1),
      firstName: name,
      lastName: name,
    })
    .strict(),
]);
