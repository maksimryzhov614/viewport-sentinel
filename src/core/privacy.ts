import type { Rect } from '../model/types.js';

const TRAILING_URL_PUNCTUATION = /[.,;:!?\])}]+$/u;

export function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '<inline>';
  }
}

export function normalizeMessage(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(/https?:\/\/\S+/gu, (token) => {
      const punctuation = TRAILING_URL_PUNCTUATION.exec(token)?.[0] ?? '';
      const url = token.slice(0, token.length - punctuation.length);
      return `${sanitizeUrl(url)}${punctuation}`;
    })
    .trim();

  return Array.from(normalized).slice(0, 2_000).join('');
}

export function roundCss(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function roundRect(rect: Rect): Rect {
  return {
    x: roundCss(rect.x),
    y: roundCss(rect.y),
    width: roundCss(rect.width),
    height: roundCss(rect.height),
    top: roundCss(rect.top),
    right: roundCss(rect.right),
    bottom: roundCss(rect.bottom),
    left: roundCss(rect.left),
  };
}
