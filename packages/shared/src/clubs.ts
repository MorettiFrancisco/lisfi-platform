import { z } from 'zod';

export const clubInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    shortName: z.string().trim().max(40).nullable().optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
export const clubUpdateSchema = clubInputSchema
  .partial()
  .extend({
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => Object.keys(value).length > 1);
export const clubsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    q: z.string().trim().max(100).default(''),
    status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE'),
    sort: z.enum(['name_asc', 'name_desc', 'newest']).default('name_asc'),
  })
  .strict();
export const clubSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().nullable(),
  slug: z.string(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().positive(),
});
export const clubsResponseSchema = z.object({
  items: z.array(clubSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type Club = z.infer<typeof clubSchema>;

export const clubPersonSchema = z.object({ id: z.string(), name: z.string() });
export const clubStructureSchema = z.object({
  president: clubPersonSchema.nullable(),
  representatives: z.array(
    clubPersonSchema.extend({ membershipId: z.string().optional() }),
  ),
  technicalDirectors: z.array(clubPersonSchema),
  players: z.array(clubPersonSchema),
});
export const clubDetailSchema = clubSchema.extend(clubStructureSchema.shape);
export type ClubStructure = z.infer<typeof clubStructureSchema>;
export type ClubDetail = z.infer<typeof clubDetailSchema>;
