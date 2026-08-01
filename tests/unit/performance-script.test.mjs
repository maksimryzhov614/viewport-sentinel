import { describe, expect, it } from 'vitest';
import { ensureWithinThreshold } from '../../scripts/verify-performance.mjs';

describe('performance gate', () => {
  it('accepts the exact threshold and rejects the first millisecond above it', () => {
    expect(ensureWithinThreshold(60_000)).toBeUndefined();
    expect(() => ensureWithinThreshold(60_001)).toThrow(
      'Performance gate exceeded 60000ms',
    );
  });
});
