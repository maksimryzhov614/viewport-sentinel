import { CanonicalValueError } from './canonical.js';
const TRAILING_URL_PUNCTUATION = /[.,;:!?\])}]+$/u;
export function sanitizeUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return '<inline>';
        }
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return url.href;
    }
    catch {
        return '<inline>';
    }
}
export function normalizeMessage(value) {
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
export function roundCss(value) {
    if (!Number.isFinite(value)) {
        throw new CanonicalValueError('CSS values must be finite');
    }
    const rounded = Math.round(value * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
}
export function roundRect(rect) {
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
//# sourceMappingURL=privacy.js.map