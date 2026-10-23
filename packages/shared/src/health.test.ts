import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './index';

describe('health contract', () => {
  it('rejects an unavailable or unrelated service', () => {
    expect(
      healthResponseSchema.safeParse({ status: 'error', service: 'lisfi-api' })
        .success,
    ).toBe(false);
    expect(
      healthResponseSchema.safeParse({ status: 'ok', service: 'other' })
        .success,
    ).toBe(false);
  });
});
