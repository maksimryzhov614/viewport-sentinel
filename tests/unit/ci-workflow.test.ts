import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parsers as yamlParsers } from 'prettier/plugins/yaml';
import { describe, expect, it } from 'vitest';

interface YamlNode {
  type: string;
  value?: unknown;
  children?: readonly YamlNode[];
}

function onlyChild(node: YamlNode): YamlNode {
  const children = node.children?.filter(
    (child) => child.type !== 'documentHead',
  );
  if (children?.length !== 1 || children[0] === undefined) {
    throw new Error(`Unexpected YAML ${node.type} node`);
  }
  return children[0];
}

function yamlValue(node: YamlNode): unknown {
  switch (node.type) {
    case 'root':
    case 'document':
    case 'documentBody':
    case 'mappingKey':
    case 'sequenceItem':
      return yamlValue(onlyChild(node));
    case 'mappingValue':
      return node.children?.length === 0 || node.children === undefined
        ? null
        : yamlValue(onlyChild(node));
    case 'mapping': {
      const value: Record<string, unknown> = {};
      for (const item of node.children ?? []) {
        if (item.type !== 'mappingItem' || item.children?.length !== 2) {
          throw new Error('Unexpected YAML mapping item');
        }
        const keyNode = item.children[0];
        const valueNode = item.children[1];
        if (keyNode === undefined || valueNode === undefined) {
          throw new Error('Incomplete YAML mapping item');
        }
        const key = yamlValue(keyNode);
        if (typeof key !== 'string') {
          throw new Error('Non-string YAML key');
        }
        value[key] = yamlValue(valueNode);
      }
      return value;
    }
    case 'sequence':
      return (node.children ?? []).map((child) => yamlValue(child));
    case 'plain':
    case 'quoteDouble':
    case 'quoteSingle':
    case 'blockLiteral':
      return node.value;
    default:
      throw new Error(`Unsupported YAML node: ${node.type}`);
  }
}

async function parseWorkflow(): Promise<Record<string, unknown>> {
  const path = resolve('.github/workflows/ci.yml');
  const parsed = (await yamlParsers.yaml.parse(await readFile(path, 'utf8'), {
    filepath: path,
  } as never)) as YamlNode;
  const workflow = yamlValue(parsed);
  if (
    typeof workflow !== 'object' ||
    workflow === null ||
    Array.isArray(workflow)
  ) {
    throw new Error('CI workflow did not contain a mapping');
  }
  return workflow as Record<string, unknown>;
}

async function packageScripts(): Promise<Record<string, string>> {
  const metadata = JSON.parse(
    await readFile(resolve('package.json'), 'utf8'),
  ) as { scripts?: unknown };
  if (
    typeof metadata.scripts !== 'object' ||
    metadata.scripts === null ||
    Array.isArray(metadata.scripts)
  ) {
    throw new Error('package.json scripts must be a mapping');
  }
  return metadata.scripts as Record<string, string>;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected YAML mapping');
  }
  return value as Record<string, unknown>;
}

function steps(job: unknown): Record<string, unknown>[] {
  const value = object(job).steps;
  if (!Array.isArray(value)) {
    throw new Error('Expected job steps');
  }
  return value.map(object);
}

function containsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsKey(item, key));
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.hasOwn(record, key) ||
    Object.values(record).some((item) => containsKey(item, key))
  );
}

describe('CI workflow', () => {
  it('parses into the exact least-privilege trigger and local self-consumer gate', async () => {
    const workflow = await parseWorkflow();

    expect(workflow.on).toEqual({
      pull_request: null,
      push: { branches: ['main'] },
    });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow).not.toHaveProperty('env');

    const jobs = object(workflow.jobs);
    expect(Object.keys(jobs)).toEqual([
      'compatibility',
      'browser',
      'self-consumer',
    ]);
    const compatibility = object(jobs.compatibility);
    expect(compatibility.strategy).toEqual({
      matrix: { 'node-version': ['22', '24', '26'] },
    });
    expect(steps(compatibility)).toEqual([
      { uses: 'actions/checkout@v6' },
      {
        uses: 'actions/setup-node@v6',
        with: { 'node-version': '${{ matrix.node-version }}' },
      },
      { run: 'npm ci' },
      { run: 'npm run format:check' },
      { run: 'npm run lint' },
      { run: 'npm run typecheck' },
      { run: 'npm run test:unit' },
      { run: 'npm run build' },
      { run: 'npm run generated:check' },
    ]);

    const browser = object(jobs.browser);
    expect(steps(browser)).toEqual([
      { uses: 'actions/checkout@v6' },
      {
        uses: 'actions/setup-node@v6',
        with: { 'node-version': '24' },
      },
      { run: 'npm ci' },
      { run: 'npx playwright install --with-deps chromium' },
      { run: 'npm run test:integration' },
      { run: 'npm run verify:determinism -- 3' },
      { run: 'npm run verify:performance' },
      { run: 'npm pack --dry-run' },
      { run: 'npm run generated:check' },
      {
        if: '${{ failure() }}',
        uses: 'actions/upload-artifact@v5',
        with: {
          name: 'test-artifacts',
          path: 'artifacts/',
          'if-no-files-found': 'ignore',
        },
      },
    ]);
    expect(containsKey(workflow, 'env')).toBe(false);

    const selfConsumer = object(jobs['self-consumer']);
    expect(steps(selfConsumer)).toEqual([
      { uses: 'actions/checkout@v6' },
      {
        uses: 'actions/setup-node@v6',
        with: { 'node-version': '24' },
      },
      { run: 'npm ci' },
      { run: 'npm run build' },
      { run: 'npm run generated:check' },
      {
        name: 'Start fixture and wait for readiness',
        run:
          'npm run fixture > /tmp/viewport-sentinel-fixture.log 2>&1 &\n' +
          'for attempt in {1..30}; do\n  curl --fail --silent http://127.0.0.1:4173/clean >/dev/null && exit 0\n  sleep 1\ndone\n' +
          'cat /tmp/viewport-sentinel-fixture.log\nexit 1\n',
      },
      {
        name: 'Consume the local Action',
        uses: './',
        with: {
          config: 'tests/fixtures/config/clean.json',
          output: 'artifacts/self-consumer',
        },
      },
    ]);

    const scripts = await packageScripts();
    expect(scripts['generated:check']).toBe(
      'git diff --exit-code -- dist config.schema.json',
    );
    expect(scripts.verify).toBe(
      'npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm pack --dry-run && npm run generated:check',
    );
  });
});
