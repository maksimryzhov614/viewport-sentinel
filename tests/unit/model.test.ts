import { describe, expect, it } from 'vitest';
import { CONTENT_RULE_ORDER, isRuleId } from '../../src/model/types.js';

describe('rule identifiers', () => {
  it('keeps the public content-rule order stable', () => {
    expect(CONTENT_RULE_ORDER).toEqual(['VS001', 'VS002', 'VS003', 'VS004']);
  });

  it.each(['VS001', 'VS002', 'VS003', 'VS004', 'VSRUN001'])(
    'accepts %s',
    (value) => {
      expect(isRuleId(value)).toBe(true);
    },
  );

  it('rejects unknown identifiers', () => {
    expect(isRuleId('VS999')).toBe(false);
  });
});
