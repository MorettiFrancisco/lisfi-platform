import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { HealthResponse } from '@lisfi/shared';
import type { Bindings } from './env';

const app = new Hono<{ Bindings: Bindings }>();
app.use('*', secureHeaders());
app.get('/api/health', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({
    status: 'ok',
    service: 'lisfi-api',
  } satisfies HealthResponse);
});
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((_error, c) => c.json({ error: 'Internal server error' }, 500));

export default app;
