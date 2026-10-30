import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { HealthResponse } from '@lisfi/shared';
import type { Bindings } from './env';
import { createAuth } from './modules/auth/auth';
import { protectedRoutes } from './modules/auth/routes';
import { bootstrapRoutes } from './modules/auth/bootstrap';
import { adminInvitationAcceptanceRoutes } from './modules/auth/invitations';
import { representativeInvitationAcceptanceRoutes } from './modules/auth/representative-invitations';
import { recoveryAcceptanceRoutes } from './modules/auth/recovery';
import { openApiDocument } from './openapi';

const app = new Hono<{ Bindings: Bindings }>();
app.use('*', secureHeaders());
app.get('/api/openapi.json', (c) => c.json(openApiDocument));
app.get('/api/health', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({
    status: 'ok',
    service: 'lisfi-api',
  } satisfies HealthResponse);
});
app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
  c.header('Cache-Control', 'no-store');
  let auth: ReturnType<typeof createAuth>;
  try {
    auth = createAuth(c.env);
  } catch {
    return c.json({ error: 'Authentication unavailable' }, 503);
  }
  // Reject cross-origin login too, including requests without an existing cookie.
  if (
    c.req.method === 'POST' &&
    c.req.header('origin') !== new URL(c.env.AUTH_BASE_URL!).origin
  ) {
    return c.json({ error: 'Forbidden origin' }, 403);
  }
  const currentSession = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (
    currentSession &&
    currentSession.user.status !== 'ACTIVE' &&
    c.req.path !== '/api/auth/sign-out'
  ) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return auth.handler(c.req.raw);
});
app.route('/api', bootstrapRoutes);
app.route('/api', adminInvitationAcceptanceRoutes);
app.route('/api', recoveryAcceptanceRoutes);
app.route('/api', representativeInvitationAcceptanceRoutes);
app.route('/api', protectedRoutes);
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((_error, c) => c.json({ error: 'Internal server error' }, 500));

export default app;
