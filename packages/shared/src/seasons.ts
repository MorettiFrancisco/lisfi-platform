import { z } from 'zod';
export const seasonInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    year: z.number().int().min(1900).max(2100),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
  })
  .strict()
  .refine((s) => s.startDate <= s.endDate, { message: 'Invalid date range' });
export const seasonStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'CLOSED']);
export const seasonTransitionSchema = z
  .object({
    from: z.enum(['DRAFT', 'ACTIVE']),
    to: z.enum(['ACTIVE', 'CLOSED']),
  })
  .strict()
  .refine(
    (s) =>
      (s.from === 'DRAFT' && s.to === 'ACTIVE') ||
      (s.from === 'ACTIVE' && s.to === 'CLOSED'),
  );
export const seasonQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    status: z.enum(['ALL', 'DRAFT', 'ACTIVE', 'CLOSED']).default('ALL'),
  })
  .strict();
export const seasonSchema = z.object({
  id: z.string(),
  name: z.string(),
  year: z.number().int(),
  startDate: z.string(),
  endDate: z.string(),
  status: seasonStatusSchema,
  createdAt: z.string(),
});
export const seasonsResponseSchema = z.object({
  items: z.array(seasonSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type Season = z.infer<typeof seasonSchema>;
