import { z } from 'zod';
import {
  adminInvitationAcceptSchema,
  adminInvitationRequestSchema,
  auditResponseSchema,
  bootstrapRequestSchema,
  changeInputSchema,
  clubDetailSchema,
  clubUpdateSchema,
  clubsResponseSchema,
  existingRepresentativeInvitationAcceptSchema,
  healthResponseSchema,
  meResponseSchema,
  recoveryAcceptSchema,
  recoveryLinkRequestSchema,
  representativeInvitationRequestSchema,
  seasonInputSchema,
  seasonSchema,
  seasonsResponseSchema,
  seasonTransitionSchema,
} from '@lisfi/shared';

// JSON Schema is generated from the same Zod inputs and outputs used by the API.
// Cross-field refinements and authorization rules are described separately.
const schema = (value: z.ZodType, io: 'input' | 'output' = 'output') =>
  z.toJSONSchema(value, { target: 'openapi-3.0', io, unrepresentable: 'any' });
const body = (value: z.ZodType) => ({
  required: true,
  content: { 'application/json': { schema: schema(value, 'input') } },
});
const response = (description: string, value?: z.ZodType) => ({
  description,
  ...(value
    ? { content: { 'application/json': { schema: schema(value) } } }
    : {}),
});
const pathParam = (name: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
});
const query = (
  name: string,
  description: string,
  type: 'string' | 'integer' = 'string',
) => ({ name, in: 'query', required: false, description, schema: { type } });
const auth = [{ session: [] }];
const errors = {
  '400': response('Solicitud inválida'),
  '401': response('Sesión requerida'),
  '403': response('Acceso u origen no permitido'),
  '404': response('Recurso no disponible'),
  '409': response('Conflicto de estado'),
};
const request = (
  summary: string,
  tag: string,
  options: {
    input?: z.ZodType;
    output?: z.ZodType;
    status?: string;
    parameters?: unknown[];
    secure?: boolean;
    description?: string;
  } = {},
) => ({
  summary,
  tags: [tag],
  ...(options.description ? { description: options.description } : {}),
  ...(options.secure === false ? {} : { security: auth }),
  ...(options.input ? { requestBody: body(options.input) } : {}),
  ...(options.parameters ? { parameters: options.parameters } : {}),
  responses: {
    [options.status ?? '200']: response('Operación exitosa', options.output),
    ...errors,
  },
});
const invitationResponse = z.object({
  token: z.string(),
  expiresAt: z.string(),
});
const ok = z.object({ created: z.boolean() });
const id = [pathParam('id')];
const tokenBody = existingRepresentativeInvitationAcceptSchema;

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'LISFI API',
    version: '1.0.0',
    description:
      'Referencia de la API actual. Las operaciones con sesión usan cookies del mismo origen. Las mutaciones verifican Origin y las funciones administrativas exigen MFA. Las reglas de aprobación y refinamientos adicionales se validan en el servidor. Better Auth expone rutas adicionales no incluidas en esta referencia inicial.',
  },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: {
      session: {
        type: 'apiKey',
        in: 'cookie',
        name: 'better-auth.session_token',
        description:
          'Sesión Better Auth. El navegador gestiona la cookie; en HTTPS puede tener prefijo __Secure-.',
      },
    },
  },
  paths: {
    '/api/health': {
      get: request('Estado del servicio', 'Sistema', {
        secure: false,
        output: healthResponseSchema,
      }),
    },
    '/api/me': {
      get: request('Identidad y clubes disponibles', 'Sesión', {
        output: meResponseSchema,
      }),
    },
    '/api/bootstrap': {
      post: request('Alta inicial del administrador', 'Sesión', {
        secure: false,
        input: bootstrapRequestSchema,
        output: ok,
        status: '201',
        parameters: [
          {
            name: 'x-bootstrap-token',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'Clave temporal de bootstrap.',
          },
        ],
      }),
    },
    '/api/auth/sign-in/email': {
      post: request('Iniciar sesión', 'Sesión', {
        secure: false,
        input: z.object({
          email: z.email(),
          password: z.string(),
          rememberMe: z.boolean().optional(),
        }),
        description: 'Puede requerir completar el desafío MFA.',
      }),
    },
    '/api/auth/sign-out': { post: request('Cerrar sesión', 'Sesión') },
    '/api/auth/two-factor/verify-totp': {
      post: request('Verificar código TOTP', 'Sesión', {
        secure: false,
        input: z.object({ code: z.string() }),
      }),
    },
    '/api/auth/two-factor/verify-backup-code': {
      post: request('Usar código de recuperación MFA', 'Sesión', {
        secure: false,
        input: z.object({ code: z.string() }),
      }),
    },
    '/api/clubs': {
      get: request('Listar clubes visibles', 'Clubes', {
        output: clubsResponseSchema,
        parameters: [
          query('page', 'Página', 'integer'),
          query('pageSize', 'Elementos por página', 'integer'),
          query('q', 'Búsqueda literal'),
          query('status', 'ACTIVE, INACTIVE o ALL'),
          query('sort', 'name_asc, name_desc o newest'),
        ],
        description:
          'La lista y el total están filtrados por membresías para representantes.',
      }),
    },
    '/api/clubs/{id}': {
      get: request('Consultar club', 'Clubes', {
        parameters: id,
        output: clubDetailSchema,
      }),
      patch: request('Editar club', 'Clubes', {
        parameters: id,
        input: clubUpdateSchema,
        output: z.object({ id: z.string() }).passthrough(),
        description:
          'Administrador con MFA; requiere la versión actual del club.',
      }),
    },
    '/api/clubs/{id}/representatives/{membershipId}': {
      delete: request('Revocar membresía', 'Clubes', {
        parameters: [...id, pathParam('membershipId')],
        output: z.object({ revoked: z.boolean() }),
      }),
    },
    '/api/changes': {
      get: request('Listar solicitudes', 'Solicitudes', {
        description:
          'Administradores ven todas; representantes solo las de sus clubes, con datos privados filtrados.',
      }),
      post: request('Solicitar cambio', 'Solicitudes', {
        input: changeInputSchema,
        status: '201',
        output: z.object({ id: z.string(), status: z.string() }),
        description:
          'Los cambios se aplican después de dos aprobaciones administrativas distintas.',
      }),
    },
    '/api/changes/{id}/approve': {
      post: request('Aprobar solicitud', 'Solicitudes', { parameters: id }),
    },
    '/api/changes/{id}/reject': {
      post: request('Rechazar solicitud', 'Solicitudes', { parameters: id }),
    },
    '/api/seasons': {
      get: request('Listar temporadas', 'Temporadas', {
        output: seasonsResponseSchema,
        parameters: [
          query('page', 'Página', 'integer'),
          query('pageSize', 'Elementos por página', 'integer'),
          query('status', 'ALL, DRAFT, ACTIVE o CLOSED'),
        ],
      }),
      post: request('Crear temporada borrador', 'Temporadas', {
        input: seasonInputSchema,
        output: seasonSchema,
        status: '201',
        description: 'La fecha de inicio no puede ser posterior a la de fin.',
      }),
    },
    '/api/seasons/{id}/status': {
      patch: request('Cambiar estado de temporada', 'Temporadas', {
        parameters: id,
        input: seasonTransitionSchema,
        description:
          'Transiciones permitidas: DRAFT a ACTIVE y ACTIVE a CLOSED.',
      }),
    },
    '/api/audit-logs': {
      get: request('Consultar auditoría', 'Auditoría', {
        output: auditResponseSchema,
        parameters: [
          query('page', 'Página', 'integer'),
          query('pageSize', 'Elementos por página', 'integer'),
          query('resourceType', 'Tipo de recurso'),
          query('from', 'Desde YYYY-MM-DD'),
          query('to', 'Hasta YYYY-MM-DD'),
        ],
      }),
    },
    '/api/administrators': {
      get: request('Listar administradores', 'Administración', {
        description: 'Solo administrador inicial con MFA.',
      }),
    },
    '/api/administrators/{id}': {
      delete: request('Revocar administrador', 'Administración', {
        parameters: id,
        description:
          'Solo administrador inicial con MFA; no puede revocarse a sí mismo.',
      }),
    },
    '/api/admin-invitations': {
      post: request('Invitar administrador', 'Invitaciones', {
        input: adminInvitationRequestSchema,
        output: invitationResponse,
        status: '201',
      }),
    },
    '/api/admin-invitations/accept': {
      post: request('Aceptar invitación administrativa', 'Invitaciones', {
        secure: false,
        input: adminInvitationAcceptSchema,
        output: ok,
        status: '201',
      }),
    },
    '/api/representative-invitations': {
      post: request(
        'Generar invitación de presidente o representante',
        'Invitaciones',
        {
          input: representativeInvitationRequestSchema,
          output: invitationResponse,
          status: '201',
          description:
            'El administrador invita al presidente; el presidente invita a representantes de su club.',
        },
      ),
    },
    '/api/representative-invitations/accept': {
      post: request('Aceptar invitación con cuenta nueva', 'Invitaciones', {
        secure: false,
        input: adminInvitationAcceptSchema,
        output: z.object({
          created: z.boolean(),
          kind: z.enum(['PRESIDENT', 'REPRESENTATIVE']),
        }),
        status: '201',
      }),
    },
    '/api/representative-invitations/accept-existing': {
      post: request('Aceptar invitación con cuenta existente', 'Invitaciones', {
        input: tokenBody,
        status: '201',
        output: z.object({
          requested: z.boolean(),
          kind: z.enum(['PRESIDENT', 'REPRESENTATIVE']),
        }),
        description:
          'La sesión debe corresponder al correo invitado. Para representantes genera una solicitud pendiente de dos aprobaciones; un presidente invitado por LISFI queda habilitado al aceptar.',
      }),
    },
    '/api/recovery-links': {
      post: request('Generar enlace de recuperación', 'Recuperación', {
        input: recoveryLinkRequestSchema,
        output: invitationResponse,
        status: '201',
        description:
          'La liga debe verificar manualmente la identidad y el número de WhatsApp.',
      }),
    },
    '/api/recovery-links/accept': {
      post: request('Cambiar contraseña con enlace', 'Recuperación', {
        secure: false,
        input: recoveryAcceptSchema,
        output: z.object({ changed: z.boolean() }),
      }),
    },
  },
} as const;
