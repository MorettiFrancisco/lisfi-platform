import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@lisfi/shared';
import app from './index';

describe('API', () => {
  it('returns the public liveness contract without exposing configuration', async () => {
    const response = await app.request('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      status: 'ok',
      service: 'lisfi-api',
    });
  });
  it('returns JSON 404 for unknown routes', async () => {
    const response = await app.request('/missing');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });
});
