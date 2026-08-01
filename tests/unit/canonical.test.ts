import { describe, expect, it } from 'vitest';
import {
  CanonicalValueError,
  canonicalStringify,
} from '../../src/core/canonical.js';

describe('canonicalStringify', () => {
  it('sorts object keys recursively and emits exactly one trailing LF', () => {
    const result = canonicalStringify({ z: 1, a: { d: 2, c: 3 } });

    expect(result).toBe(
      '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "z": 1\n}\n',
    );
    expect(result.endsWith('\n\n')).toBe(false);
  });

  it('preserves array order while sorting objects within arrays', () => {
    expect(canonicalStringify([{ z: 1, a: 2 }, 'second', null])).toBe(
      '[\n  {\n    "a": 2,\n    "z": 1\n  },\n  "second",\n  null\n]\n',
    );
  });

  it.each([
    ['nested undefined in an object', { outer: { unsafe: undefined } }],
    ['nested undefined in an array', { outer: [1, undefined] }],
    ['nested NaN', { outer: { unsafe: Number.NaN } }],
    ['nested positive infinity', { outer: [Number.POSITIVE_INFINITY] }],
    ['nested negative infinity', { outer: Number.NEGATIVE_INFINITY }],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalStringify(value)).toThrow(CanonicalValueError);
  });

  it('rejects unsupported values instead of silently losing them', () => {
    expect(() => canonicalStringify({ unsafe: () => undefined })).toThrow(
      CanonicalValueError,
    );
    expect(() => canonicalStringify({ unsafe: Symbol('value') })).toThrow(
      CanonicalValueError,
    );
    expect(() => canonicalStringify({ unsafe: 1n })).toThrow(
      CanonicalValueError,
    );
  });

  it('rejects negative zero so callers must normalize rounded geometry', () => {
    expect(() => canonicalStringify({ x: -0 })).toThrow(CanonicalValueError);
  });
});
