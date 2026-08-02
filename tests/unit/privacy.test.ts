import { describe, expect, it } from 'vitest';
import { CanonicalValueError } from '../../src/core/canonical.js';
import {
  normalizeMessage,
  roundCss,
  roundRect,
  sanitizeUrl,
} from '../../src/core/privacy.js';

describe('sanitizeUrl', () => {
  it('removes credentials, query parameters, and fragments', () => {
    expect(sanitizeUrl('https://user:pass@example.test:443/a?q=secret#x')).toBe(
      'https://example.test/a',
    );
  });

  it('preserves the URL parser root slash', () => {
    expect(sanitizeUrl('https://example.test/?q=secret#x')).toBe(
      'https://example.test/',
    );
  });

  it('replaces invalid URLs with the inline marker', () => {
    expect(sanitizeUrl('not a URL')).toBe('<inline>');
  });

  it.each([
    'data:image/png;base64,SYNTHETIC_DATA_TOKEN',
    'javascript:SYNTHETIC_JAVASCRIPT_TOKEN',
    'blob:https://example.test/SYNTHETIC_BLOB_TOKEN',
    'ftp://user:pass@example.test/private?token=SYNTHETIC_FTP_TOKEN#secret',
  ])('replaces the non-HTTP(S) URL %s with the inline marker', (url) => {
    expect(sanitizeUrl(url)).toBe('<inline>');
  });
});

describe('normalizeMessage', () => {
  it('normalizes whitespace and sanitizes a URL token', () => {
    expect(normalizeMessage('  Boom\r\n at https://x.test/a?token=1#z  ')).toBe(
      'Boom at https://x.test/a',
    );
  });

  it('sanitizes every URL token while preserving trailing punctuation', () => {
    expect(
      normalizeMessage(
        'See https://user:pass@a.test/one?q=secret#x), then http://b.test/two?token=hidden!.',
      ),
    ).toBe('See https://a.test/one), then http://b.test/two!.');
  });

  it('normalizes text to NFC before collapsing whitespace', () => {
    expect(normalizeMessage('  Cafe\u0301\tready  ')).toBe('Café ready');
  });

  it('caps messages at 2,000 Unicode code points without splitting a surrogate pair', () => {
    const result = normalizeMessage(`${'😀'.repeat(1_999)}a😀`);

    expect(Array.from(result)).toHaveLength(2_000);
    expect(result).toBe(`${'😀'.repeat(1_999)}a`);
  });
});

describe('geometry rounding', () => {
  it('rounds CSS values to two decimals and removes negative zero', () => {
    expect(roundCss(-0.004)).toBe(0);
    expect(Object.is(roundCss(-0.004), -0)).toBe(false);
    expect(roundCss(1.235)).toBe(1.24);
  });

  it.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s CSS values', (_label, value) => {
    expect(() => roundCss(value)).toThrow(CanonicalValueError);
  });

  it('returns a newly rounded rectangle', () => {
    const rect = {
      x: -0.004,
      y: 1.235,
      width: 10.004,
      height: 20.005,
      top: 1.235,
      right: 10.004,
      bottom: 21.235,
      left: -0.004,
    };

    expect(roundRect(rect)).toEqual({
      x: 0,
      y: 1.24,
      width: 10,
      height: 20.01,
      top: 1.24,
      right: 10,
      bottom: 21.24,
      left: 0,
    });
    expect(roundRect(rect)).not.toBe(rect);
  });

  it('rejects a rectangle containing non-finite geometry', () => {
    expect(() =>
      roundRect({
        x: 0,
        y: 0,
        width: Number.POSITIVE_INFINITY,
        height: 20,
        top: 0,
        right: 20,
        bottom: 20,
        left: 0,
      }),
    ).toThrow(CanonicalValueError);
  });
});
