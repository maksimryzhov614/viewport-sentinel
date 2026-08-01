import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/load-config.js';
import { ConfigInputSchema } from '../../src/config/schema.js';

async function configFile(value: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'viewport-sentinel-config-'));
  const path = join(dir, 'viewport-sentinel.config.json');
  await writeFile(path, JSON.stringify(value));
  return path;
}

const valid = {
  version: 1,
  baseUrl: 'http://127.0.0.1:4173',
  pages: [{ name: 'clean', path: '/clean', consoleIgnore: [] }],
  viewports: [{ name: 'mobile-320', width: 320, height: 844 }],
  timeoutMs: 10_000,
  output: {
    dir: 'artifacts/viewport-sentinel',
    formats: ['json', 'sarif'],
  },
};

interface JsonSchemaNode {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  oneOf?: unknown[];
  allOf?: unknown[];
  uniqueItems?: boolean;
}

describe('loadConfig', () => {
  it('ships an input-oriented JSON Schema for defaults and cross-field rules', async () => {
    const schema = JSON.parse(
      await readFile(
        new URL('../../config.schema.json', import.meta.url),
        'utf8',
      ),
    ) as JsonSchemaNode;
    const page = schema.properties?.pages?.items;
    const viewport = schema.properties?.viewports?.items;
    const output = schema.properties?.output;

    expect(schema.properties?.version?.type).toBe('integer');
    expect(schema.required).toEqual(['version', 'pages', 'viewports']);
    expect(schema.allOf).toHaveLength(1);
    expect(page?.required).toEqual(['name']);
    expect(page?.oneOf).toHaveLength(2);
    expect(viewport?.required).toEqual(['name', 'width', 'height']);
    expect(output?.required).toBeUndefined();
    expect(output?.properties?.formats?.uniqueItems).toBe(true);
  });

  it('resolves page URLs, DPR, config path, and output directory', async () => {
    const path = await configFile(valid);
    const result = await loadConfig(path);

    expect(result).toEqual({
      version: 1,
      configPath: path,
      pages: [
        {
          name: 'clean',
          url: 'http://127.0.0.1:4173/clean',
          consoleIgnore: [],
        },
      ],
      viewports: [
        {
          name: 'mobile-320',
          width: 320,
          height: 844,
          deviceScaleFactor: 1,
        },
      ],
      timeoutMs: 10_000,
      outputDir: join(dirname(path), 'artifacts/viewport-sentinel'),
      formats: ['json', 'sarif'],
    });
  });

  it('accepts and discards non-empty $schema editor metadata', async () => {
    const result = await loadConfig(
      await configFile({ ...valid, $schema: './config.schema.json' }),
    );

    expect(result).not.toHaveProperty('$schema');
  });

  it.each([
    ['root', { ...valid, unknown: true }],
    [
      'page',
      { ...valid, pages: [{ name: 'clean', path: '/clean', unknown: true }] },
    ],
    [
      'viewport',
      {
        ...valid,
        viewports: [
          { name: 'mobile-320', width: 320, height: 844, unknown: true },
        ],
      },
    ],
    [
      'output',
      {
        ...valid,
        output: {
          dir: 'artifacts/viewport-sentinel',
          formats: ['json'],
          unknown: true,
        },
      },
    ],
  ])('rejects unknown keys in the %s object', async (_label, value) => {
    await expect(loadConfig(await configFile(value))).rejects.toThrow(
      'Unrecognized key',
    );
  });

  it.each([
    ['empty $schema', { ...valid, $schema: '' }, '$schema'],
    ['missing version', { ...valid, version: undefined }, 'version'],
    ['wrong version', { ...valid, version: 2 }, 'version'],
    ['timeout below minimum', { ...valid, timeoutMs: 999 }, 'timeoutMs'],
    ['timeout above maximum', { ...valid, timeoutMs: 60_001 }, 'timeoutMs'],
    ['non-integer timeout', { ...valid, timeoutMs: 1_000.5 }, 'timeoutMs'],
  ])('rejects invalid root field: %s', async (_label, value, message) => {
    await expect(loadConfig(await configFile(value))).rejects.toThrow(message);
  });

  it.each([
    'ftp://example.test',
    'file:///tmp/site',
    '//example.test',
    '/relative',
    'not a url',
  ])('rejects non-HTTP baseUrl %s', async (baseUrl) => {
    await expect(
      loadConfig(await configFile({ ...valid, baseUrl })),
    ).rejects.toThrow('baseUrl');
  });

  it('applies all defaults to a minimal valid file', async () => {
    const path = await configFile({
      version: 1,
      pages: [{ name: 'home', url: 'https://example.test/' }],
      viewports: [{ name: 'mobile-320', width: 320, height: 844 }],
    });

    await expect(loadConfig(path)).resolves.toEqual({
      version: 1,
      configPath: path,
      pages: [
        {
          name: 'home',
          url: 'https://example.test/',
          consoleIgnore: [],
        },
      ],
      viewports: [
        {
          name: 'mobile-320',
          width: 320,
          height: 844,
          deviceScaleFactor: 1,
        },
      ],
      timeoutMs: 10_000,
      outputDir: join(dirname(path), 'artifacts/viewport-sentinel'),
      formats: ['json', 'sarif'],
    });
  });

  it.each([
    ['pages empty', { ...valid, pages: [] }, 'pages'],
    [
      'pages above maximum',
      {
        ...valid,
        pages: Array.from({ length: 51 }, (_, index) => ({
          name: `page-${String(index)}`,
          path: `/${String(index)}`,
        })),
      },
      'pages',
    ],
    ['viewports empty', { ...valid, viewports: [] }, 'viewports'],
    [
      'viewports above maximum',
      {
        ...valid,
        viewports: Array.from({ length: 13 }, (_, index) => ({
          name: `viewport-${String(index)}`,
          width: 320,
          height: 844,
        })),
      },
      'viewports',
    ],
  ])('enforces array limits: %s', async (_label, value, message) => {
    await expect(loadConfig(await configFile(value))).rejects.toThrow(message);
  });

  it('accepts page, viewport, and ignore-list upper bounds', async () => {
    const result = await loadConfig(
      await configFile({
        ...valid,
        pages: Array.from({ length: 50 }, (_, index) => ({
          name: `page-${String(index)}`,
          path: `/${String(index)}`,
          consoleIgnore: Array.from(
            { length: 50 },
            (_, item) => `item-${String(item)}`,
          ),
        })),
        viewports: Array.from({ length: 12 }, (_, index) => ({
          name: `viewport-${String(index)}`,
          width: 320,
          height: 844,
        })),
      }),
    );

    expect(result.pages).toHaveLength(50);
    expect(result.pages[0]?.consoleIgnore).toHaveLength(50);
    expect(result.viewports).toHaveLength(12);
  });

  it.each([1_000, 60_000])('accepts timeout boundary %d', async (timeoutMs) => {
    const result = await loadConfig(await configFile({ ...valid, timeoutMs }));

    expect(result.timeoutMs).toBe(timeoutMs);
  });

  it.each([
    [
      'page names',
      {
        ...valid,
        pages: [
          { name: 'same', path: '/' },
          { name: 'same', path: '/two' },
        ],
      },
      'pages',
    ],
    [
      'viewport names',
      {
        ...valid,
        viewports: [
          { name: 'same', width: 320, height: 844 },
          { name: 'same', width: 768, height: 1024 },
        ],
      },
      'viewports',
    ],
  ])('requires unique %s', async (_label, value, message) => {
    await expect(loadConfig(await configFile(value))).rejects.toThrow(message);
    await expect(loadConfig(await configFile(value))).rejects.toThrow('unique');
  });

  it.each([
    '',
    '-leading',
    'UPPERCASE',
    'has_underscore',
    `${'a'.repeat(64)}b`,
  ])('rejects invalid page name %j', async (name) => {
    await expect(
      loadConfig(await configFile({ ...valid, pages: [{ name, path: '/' }] })),
    ).rejects.toThrow('pages.0.name');
  });

  it.each([
    '',
    '-leading',
    'UPPERCASE',
    'has_underscore',
    `${'a'.repeat(64)}b`,
  ])('rejects invalid viewport name %j', async (name) => {
    await expect(
      loadConfig(
        await configFile({
          ...valid,
          viewports: [{ name, width: 320, height: 844 }],
        }),
      ),
    ).rejects.toThrow('viewports.0.name');
  });

  it('accepts 64-character names at the boundary', async () => {
    const name = `a${'b'.repeat(63)}`;
    const result = await loadConfig(
      await configFile({
        ...valid,
        pages: [{ name, path: '/' }],
        viewports: [{ name, width: 320, height: 844 }],
      }),
    );

    expect(result.pages[0]?.name).toBe(name);
    expect(result.viewports[0]?.name).toBe(name);
  });

  it.each([
    ['neither URL nor path', { name: 'clean' }],
    [
      'both URL and path',
      { name: 'clean', path: '/', url: 'https://example.test' },
    ],
  ])('requires exactly one page location: %s', async (_label, page) => {
    await expect(
      loadConfig(await configFile({ ...valid, pages: [page] })),
    ).rejects.toThrow('exactly one');
  });

  it('requires baseUrl when a page uses path', async () => {
    const withoutBaseUrl = { ...valid, baseUrl: undefined };

    await expect(loadConfig(await configFile(withoutBaseUrl))).rejects.toThrow(
      'baseUrl',
    );
  });

  it.each(['clean', './clean', 'https://example.test/clean'])(
    'requires page paths to begin with /: %s',
    async (path) => {
      await expect(
        loadConfig(
          await configFile({ ...valid, pages: [{ name: 'clean', path }] }),
        ),
      ).rejects.toThrow('pages.0.path');
    },
  );

  it.each([
    'ftp://example.test',
    'file:///tmp/site',
    '//example.test',
    '/relative',
    'not a url',
  ])('rejects non-HTTP page URL %s', async (url) => {
    await expect(
      loadConfig(
        await configFile({ ...valid, pages: [{ name: 'clean', url }] }),
      ),
    ).rejects.toThrow('pages.0.url');
  });

  it('preserves an optional ready selector', async () => {
    const result = await loadConfig(
      await configFile({
        ...valid,
        pages: [{ name: 'clean', path: '/', readySelector: '#app' }],
      }),
    );

    expect(result.pages[0]?.readySelector).toBe('#app');
  });

  it.each([
    ['empty selector', '', 'readySelector'],
    ['501-code-point selector', '😀'.repeat(501), 'readySelector'],
  ])('rejects %s', async (_label, readySelector, message) => {
    await expect(
      loadConfig(
        await configFile({
          ...valid,
          pages: [{ name: 'clean', path: '/', readySelector }],
        }),
      ),
    ).rejects.toThrow(message);
  });

  it('counts readySelector length in Unicode code points', async () => {
    const readySelector = '😀'.repeat(500);
    const result = await loadConfig(
      await configFile({
        ...valid,
        pages: [{ name: 'clean', path: '/', readySelector }],
      }),
    );

    expect(result.pages[0]?.readySelector).toBe(readySelector);
  });

  it('preserves console-ignore order exactly', async () => {
    const consoleIgnore = ['first', 'second', 'third'];
    const result = await loadConfig(
      await configFile({
        ...valid,
        pages: [{ name: 'clean', path: '/', consoleIgnore }],
      }),
    );

    expect(result.pages[0]?.consoleIgnore).toEqual(consoleIgnore);
  });

  it.each([
    ['more than 50 items', Array.from({ length: 51 }, () => 'ignored')],
    ['an empty item', ['']],
    ['a 501-code-point item', ['😀'.repeat(501)]],
  ])('rejects invalid consoleIgnore: %s', async (_label, consoleIgnore) => {
    await expect(
      loadConfig(
        await configFile({
          ...valid,
          pages: [{ name: 'clean', path: '/', consoleIgnore }],
        }),
      ),
    ).rejects.toThrow('consoleIgnore');
  });

  it('counts consoleIgnore item length in Unicode code points', async () => {
    const consoleIgnore = ['😀'.repeat(500)];
    const result = await loadConfig(
      await configFile({
        ...valid,
        pages: [{ name: 'clean', path: '/', consoleIgnore }],
      }),
    );

    expect(result.pages[0]?.consoleIgnore).toEqual(consoleIgnore);
  });

  it.each([
    ['width below minimum', { width: 0, height: 844 }],
    ['width above maximum', { width: 10_001, height: 844 }],
    ['width not an integer', { width: 320.5, height: 844 }],
    ['height below minimum', { width: 320, height: 0 }],
    ['height above maximum', { width: 320, height: 10_001 }],
    ['height not an integer', { width: 320, height: 844.5 }],
  ])('rejects invalid viewport dimensions: %s', async (_label, dimensions) => {
    await expect(
      loadConfig(
        await configFile({
          ...valid,
          viewports: [{ name: 'mobile-320', ...dimensions }],
        }),
      ),
    ).rejects.toThrow('viewports.0');
  });

  it('accepts viewport dimension boundaries', async () => {
    const result = await loadConfig(
      await configFile({
        ...valid,
        viewports: [
          { name: 'minimum', width: 1, height: 1 },
          { name: 'maximum', width: 10_000, height: 10_000 },
        ],
      }),
    );

    expect(
      result.viewports.map(({ width, height }) => [width, height]),
    ).toEqual([
      [1, 1],
      [10_000, 10_000],
    ]);
  });

  it.each([0, -1, 4.01])(
    'rejects invalid deviceScaleFactor %s',
    async (deviceScaleFactor) => {
      await expect(
        loadConfig(
          await configFile({
            ...valid,
            viewports: [
              {
                name: 'mobile-320',
                width: 320,
                height: 844,
                deviceScaleFactor,
              },
            ],
          }),
        ),
      ).rejects.toThrow('deviceScaleFactor');
    },
  );

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])(
    'rejects non-finite deviceScaleFactor before JSON serialization: %s',
    (deviceScaleFactor) => {
      const result = ConfigInputSchema.safeParse({
        ...valid,
        viewports: [
          { name: 'mobile-320', width: 320, height: 844, deviceScaleFactor },
        ],
      });

      expect(result.success).toBe(false);
    },
  );

  it('accepts deviceScaleFactor at the upper boundary', async () => {
    const result = await loadConfig(
      await configFile({
        ...valid,
        viewports: [
          { name: 'mobile-320', width: 320, height: 844, deviceScaleFactor: 4 },
        ],
      }),
    );

    expect(result.viewports[0]?.deviceScaleFactor).toBe(4);
  });

  it('accepts a positive fractional deviceScaleFactor', async () => {
    const result = await loadConfig(
      await configFile({
        ...valid,
        viewports: [
          {
            name: 'mobile-320',
            width: 320,
            height: 844,
            deviceScaleFactor: 0.25,
          },
        ],
      }),
    );

    expect(result.viewports[0]?.deviceScaleFactor).toBe(0.25);
  });

  it('preserves page and viewport order exactly', async () => {
    const result = await loadConfig(
      await configFile({
        ...valid,
        pages: [
          { name: 'third', path: '/third' },
          { name: 'first', path: '/first' },
          { name: 'second', path: '/second' },
        ],
        viewports: [
          { name: 'wide', width: 1440, height: 900 },
          { name: 'narrow', width: 320, height: 844 },
        ],
      }),
    );

    expect(result.pages.map(({ name }) => name)).toEqual([
      'third',
      'first',
      'second',
    ]);
    expect(result.viewports.map(({ name }) => name)).toEqual([
      'wide',
      'narrow',
    ]);
  });

  it.each([
    ['empty output dir', { dir: '', formats: ['json'] }, 'output.dir'],
    ['empty formats', { dir: 'reports', formats: [] }, 'output.formats'],
    [
      'too many formats',
      { dir: 'reports', formats: ['json', 'sarif', 'json'] },
      'output.formats',
    ],
    [
      'duplicate formats',
      { dir: 'reports', formats: ['json', 'json'] },
      'unique',
    ],
    [
      'unsupported format',
      { dir: 'reports', formats: ['html'] },
      'output.formats.0',
    ],
  ])('rejects invalid output: %s', async (_label, output, message) => {
    await expect(
      loadConfig(await configFile({ ...valid, output })),
    ).rejects.toThrow(message);
  });

  it('applies output defaults independently when one field is omitted', async () => {
    const dirOnlyPath = await configFile({
      ...valid,
      output: { dir: 'reports' },
    });
    const formatsOnlyPath = await configFile({
      ...valid,
      output: { formats: ['sarif'] },
    });

    const dirOnly = await loadConfig(dirOnlyPath);
    const formatsOnly = await loadConfig(formatsOnlyPath);

    expect(dirOnly.outputDir).toBe(join(dirname(dirOnlyPath), 'reports'));
    expect(dirOnly.formats).toEqual(['json', 'sarif']);
    expect(formatsOnly.outputDir).toBe(
      join(dirname(formatsOnlyPath), 'artifacts/viewport-sentinel'),
    );
    expect(formatsOnly.formats).toEqual(['sarif']);
  });

  it('preserves explicit format order', async () => {
    const result = await loadConfig(
      await configFile({
        ...valid,
        output: { dir: 'reports', formats: ['sarif', 'json'] },
      }),
    );

    expect(result.formats).toEqual(['sarif', 'json']);
  });

  it('keeps absolute output paths absolute', async () => {
    const absoluteOutput = join(tmpdir(), 'viewport-sentinel-absolute-output');
    const result = await loadConfig(
      await configFile({ ...valid, output: { dir: absoluteOutput } }),
    );

    expect(result.outputDir).toBe(absoluteOutput);
  });

  it('uses and resolves the output override from the config directory', async () => {
    const path = await configFile(valid);
    const result = await loadConfig(path, 'override/results');

    expect(result.outputDir).toBe(join(dirname(path), 'override/results'));
  });

  it('keeps an absolute output override absolute', async () => {
    const absoluteOverride = join(tmpdir(), 'viewport-sentinel-override');
    const result = await loadConfig(await configFile(valid), absoluteOverride);

    expect(result.outputDir).toBe(absoluteOverride);
  });

  it('wraps malformed JSON without echoing file contents', async () => {
    const path = await configFile(valid);
    await writeFile(path, '{secret-token');

    let thrown: unknown;
    try {
      await loadConfig(path);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigError);
    expect(thrown).toMatchObject({ name: 'ConfigError' });
    expect(String(thrown)).toContain('viewport-sentinel.config.json');
    expect(String(thrown)).toContain('SyntaxError');
    expect(String(thrown)).not.toContain('secret-token');
    expect(String(thrown)).not.toContain(dirname(path));
  });

  it('reports schema paths and messages without rejected values', async () => {
    const rejectedValue = 'ftp://secret-token@example.test/private';
    const path = await configFile({ ...valid, baseUrl: rejectedValue });

    let thrown: unknown;
    try {
      await loadConfig(path);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigError);
    expect(String(thrown)).toContain('baseUrl');
    expect(String(thrown)).not.toContain(rejectedValue);
  });

  it('stores an absolute config path when called with a relative path', async () => {
    const path = await configFile(valid);
    const relativePath = relative(process.cwd(), path);
    const expectedPath = resolve(relativePath);

    await expect(loadConfig(relativePath)).resolves.toMatchObject({
      configPath: expectedPath,
    });
  });
});
