import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { parsers as yamlParsers } from 'prettier/plugins/yaml';
import { describe, expect, it } from 'vitest';

interface YamlNode {
  type: string;
  value?: unknown;
  children?: readonly YamlNode[];
}

const execFileAsync = promisify(execFile);

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

async function workflow(name: string): Promise<Record<string, unknown>> {
  const path = resolve('.github/workflows', name);
  const parsed = (await yamlParsers.yaml.parse(await readFile(path, 'utf8'), {
    filepath: path,
  } as never)) as YamlNode;
  const value = yamlValue(parsed);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} did not contain a mapping`);
  }
  return value as Record<string, unknown>;
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

describe('dormant publication workflows', () => {
  const nonceDispatch = {
    inputs: {
      nonce: {
        description: 'Unique dispatch nonce',
        required: 'true',
        type: 'string',
      },
    },
  };

  it('uses OIDC trusted publishing without token auth', async () => {
    const release = await workflow('release.yml');
    expect(release.on).toEqual({
      push: { tags: ['v[0-9]*.[0-9]*.[0-9]*'] },
    });
    expect(release.permissions).toEqual({
      contents: 'write',
      'id-token': 'write',
    });
    expect(release).not.toHaveProperty('env');

    const releaseSteps = steps(object(release.jobs).release);
    expect(
      releaseSteps.map((step) => step.name ?? step.uses ?? step.run),
    ).toEqual([
      'actions/checkout@v6',
      'actions/setup-node@v6',
      'Install dependencies',
      'Install Chromium',
      'Assert exact release tag',
      'Verify release candidate',
      'Verify 20-run determinism',
      'Verify performance',
      'Publish release with trusted publishing',
      'Create GitHub release from changelog',
    ]);
    const setup = releaseSteps[1];
    expect(setup).toEqual({
      uses: 'actions/setup-node@v6',
      with: {
        'node-version': '24',
        'registry-url': 'https://registry.npmjs.org',
      },
    });
    const assertion = releaseSteps[4];
    expect(assertion?.run).toBe(
      'PACKAGE_VERSION="$(node -p "require(\'./package.json\').version")"\n' +
        'TAG_VERSION="${GITHUB_REF_NAME#v}"\n' +
        'if [[ ! "$GITHUB_REF_NAME" =~ ^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]] || [[ "$TAG_VERSION" != "$PACKAGE_VERSION" ]]; then\n' +
        '  echo "Release tag must be exact semver and match package.json" >&2\n' +
        '  exit 1\n' +
        'fi\n',
    );
    const publish = releaseSteps[8];
    expect(publish).toEqual({
      name: 'Publish release with trusted publishing',
      run: 'npm publish --provenance --access public',
    });
    expect(JSON.stringify(release)).not.toContain('NODE_AUTH_TOKEN');
    expect(JSON.stringify(release)).not.toContain('NPM_INITIAL_PUBLISH_TOKEN');

    const assertionScript = assertion?.run;
    if (typeof assertionScript !== 'string') {
      throw new Error('Release assertion must be a shell script');
    }
    await expect(
      execFileAsync('bash', ['-euo', 'pipefail', '-c', assertionScript], {
        cwd: resolve('.'),
        env: { ...process.env, GITHUB_REF_NAME: 'v0.1.0' },
      }),
    ).resolves.toMatchObject({ stderr: '' });
    await expect(
      execFileAsync('bash', ['-euo', 'pipefail', '-c', assertionScript], {
        cwd: resolve('.'),
        env: { ...process.env, GITHUB_REF_NAME: 'v1' },
      }),
    ).rejects.toMatchObject({ code: 1 });
  });

  it('keeps the demo manual, preserves Action reports, and fails last on findings', async () => {
    const demo = await workflow('demo.yml');
    expect(demo.on).toEqual({ workflow_dispatch: nonceDispatch });
    expect(demo['run-name']).toBe('Verified demo [${{ inputs.nonce }}]');
    expect(demo.permissions).toEqual({ contents: 'read' });
    const demoSteps = steps(object(demo.jobs).demo);
    expect(demoSteps.at(-1)).toEqual({
      name: 'Run seeded failing audit',
      uses: './',
      with: {
        config: 'tests/fixtures/config/golden.json',
        output: 'artifacts/demo',
      },
    });
    expect(JSON.stringify(demo)).not.toMatch(
      /continue-on-error|token|secret/iu,
    );
  });

  it('keeps the remote v1 consumer manual and clean', async () => {
    const consumer = await workflow('consumer.yml');
    expect(consumer.on).toEqual({ workflow_dispatch: nonceDispatch });
    expect(consumer['run-name']).toBe(
      'Published Action consumer [${{ inputs.nonce }}]',
    );
    expect(consumer.permissions).toEqual({ contents: 'read' });
    const consumerSteps = steps(object(consumer.jobs).consumer);
    expect(consumerSteps.at(-1)).toEqual({
      name: 'Consume viewport-sentinel@v1',
      uses: 'maksimryzhov614/viewport-sentinel@v1',
      with: {
        config: 'tests/fixtures/config/clean.json',
        output: 'artifacts/consumer',
      },
    });
  });
});
