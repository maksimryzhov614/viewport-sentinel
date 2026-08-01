export class CanonicalValueError extends Error {
    name = 'CanonicalValueError';
}
function canonicalize(value, ancestors) {
    if (value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || Object.is(value, -0)) {
            throw new CanonicalValueError('Canonical numbers must be finite and not negative zero');
        }
        return value;
    }
    if (typeof value !== 'object') {
        throw new CanonicalValueError(`Unsupported canonical value: ${typeof value}`);
    }
    if (ancestors.has(value)) {
        throw new CanonicalValueError('Circular values are not canonical');
    }
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            if (Object.keys(value).length !== value.length) {
                throw new CanonicalValueError('Sparse or extended arrays are not canonical');
            }
            return value.map((item) => canonicalize(item, ancestors));
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new CanonicalValueError('Only plain objects are canonical');
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
            throw new CanonicalValueError('Symbol object keys are not canonical');
        }
        const result = {};
        for (const key of Object.keys(value).sort()) {
            result[key] = canonicalize(value[key], ancestors);
        }
        return result;
    }
    finally {
        ancestors.delete(value);
    }
}
export function canonicalStringify(value) {
    return `${JSON.stringify(canonicalize(value, new WeakSet()), null, 2)}\n`;
}
//# sourceMappingURL=canonical.js.map