import { z } from 'zod';
export const auditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    resourceType: z
      .enum(['ALL', 'CLUB', 'CHANGE_REQUEST', 'SEASON'])
      .default('ALL'),
    from: z.union([z.iso.date(), z.literal('')]).default(''),
    to: z.union([z.iso.date(), z.literal('')]).default(''),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to);
export const auditEntrySchema = z.object({
  id: z.string(),
  actorName: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  resourceName: z.string().nullable(),
  requestKind: z.string().nullable(),
  createdAt: z.string(),
  changes: z.array(
    z.object({
      field: z.string(),
      before: z.string().nullable(),
      after: z.string().nullable(),
    }),
  ),
});
export const auditResponseSchema = z.object({
  items: z.array(auditEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
