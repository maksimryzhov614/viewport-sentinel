export class CanonicalValueError extends Error {
  override readonly name = 'CanonicalValueError';
}

type CanonicalValue =
  | null
  | boolean
  | string
  | number
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalize(
  value: unknown,
  ancestors: WeakSet<object>,
): CanonicalValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new CanonicalValueError(
        'Canonical numbers must be finite and not negative zero',
      );
    }
    return value;
  }

  if (typeof value !== 'object') {
    throw new CanonicalValueError(
      `Unsupported canonical value: ${typeof value}`,
    );
  }

  if (ancestors.has(value)) {
    throw new CanonicalValueError('Circular values are not canonical');
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) {
        throw new CanonicalValueError(
          'Sparse or extended arrays are not canonical',
        );
      }
      return value.map((item) => canonicalize(item, ancestors));
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalValueError('Only plain objects are canonical');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new CanonicalValueError('Symbol object keys are not canonical');
    }

    const result: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize(
        (value as Record<string, unknown>)[key],
        ancestors,
      );
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalStringify(value: unknown): string {
  return `${JSON.stringify(canonicalize(value, new WeakSet()), null, 2)}\n`;
}
