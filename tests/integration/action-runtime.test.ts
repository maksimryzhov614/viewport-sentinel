import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parsers as yamlParsers } from 'prettier/plugins/yaml';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  startFixtureServer,
  type FixtureServer,
} from '../../src/fixtures/server.js';

const runActionPath = resolve('dist/action/run.js');
const exitActionPath = resolve('dist/action/exit.js');
const configDirectory = resolve('tests/fixtures/config');
const fixturePort = 4176;
const temporaryDirectories: string[] = [];
let fixture: FixtureServer;

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface YamlNode {
  type: string;
  value?: unknown;
  children?: readonly YamlNode[];
}

function spawnNode(
  modulePath: string,
  argv: readonly string[],
  cwd: string,
  env: Readonly<NodeJS.ProcessEnv>,
): Promise<ProcessResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [modulePath, ...argv], {
      cwd,
      env: { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectRun);
    child.once('close', (code) => {
      resolveRun({ code, stdout, stderr });
    });
  });
}

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), `viewport-sentinel-${label}-`),
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function fixtureConfig(
  name: 'clean' | 'golden',
): Promise<{ configPath: string; outputDir: string; cwd: string }> {
  const cwd = await temporaryDirectory(`${name}-action`);
  const outputDir = join(cwd, 'reports');
  const source = JSON.parse(
    await readFile(join(configDirectory, `${name}.json`), 'utf8'),
  ) as Record<string, unknown>;
  const configPath = join(cwd, 'viewport-sentinel.config.json');
  await writeFile(
    configPath,
    JSON.stringify({
      ...source,
      $schema: undefined,
      baseUrl: `http://127.0.0.1:${String(fixturePort)}`,
      output: {
        dir: join(cwd, 'ignored-by-override'),
        formats: ['json', 'sarif'],
      },
    }),
    'utf8',
  );
  return { configPath, outputDir, cwd };
}

async function githubFiles(
  cwd: string,
): Promise<{ outputPath: string; summaryPath: string }> {
  const outputPath = join(cwd, 'github-output.txt');
  const summaryPath = join(cwd, 'github-summary.md');
  await Promise.all([
    writeFile(outputPath, '', 'utf8'),
    writeFile(summaryPath, '', 'utf8'),
  ]);
  return { outputPath, summaryPath };
}

function parseGitHubOutputs(content: string): Map<string, string> {
  const outputs = new Map<string, string>();
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line === '') {
      continue;
    }
    const multiline = /^([^=<>]+)<<(.+)$/u.exec(line);
    if (multiline !== null) {
      const [, name, delimiter] = multiline;
      if (name === undefined || delimiter === undefined) {
        throw new Error('Malformed GitHub multiline output');
      }
      const valueLines: string[] = [];
      index += 1;
      while (index < lines.length && lines[index] !== delimiter) {
        const valueLine = lines[index];
        if (valueLine !== undefined) {
          valueLines.push(valueLine);
        }
        index += 1;
      }
      if (lines[index] !== delimiter) {
        throw new Error(`Unterminated GitHub output: ${name}`);
      }
      outputs.set(name, valueLines.join('\n'));
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      throw new Error(`Malformed GitHub output line: ${line}`);
    }
    outputs.set(line.slice(0, equalsIndex), line.slice(equalsIndex + 1));
  }
  return outputs;
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
    case 'mappingValue':
    case 'sequenceItem':
      return yamlValue(onlyChild(node));
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
      return node.value;
    default:
      throw new Error(`Unsupported YAML node: ${node.type}`);
  }
}

async function parseActionYaml(): Promise<Record<string, unknown>> {
  const source = await readFile(resolve('action.yml'), 'utf8');
  const parsed = (await yamlParsers.yaml.parse(source, {
    filepath: 'action.yml',
  } as never)) as YamlNode;
  const value = yamlValue(parsed);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Action YAML did not contain a mapping');
  }
  return value as Record<string, unknown>;
}

beforeAll(async () => {
  fixture = await startFixtureServer(fixturePort);
}, 30_000);

afterAll(async () => {
  await fixture.close();
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('compiled Action runtime', () => {
  it('saves finding outputs and reports before propagating the parsed status', async () => {
    const { configPath, outputDir, cwd } = await fixtureConfig('golden');
    const { outputPath, summaryPath } = await githubFiles(cwd);

    const audit = await spawnNode(runActionPath, [], cwd, {
      INPUT_CONFIG: configPath,
      INPUT_OUTPUT: outputDir,
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    });

    expect(audit.code).toBe(0);
    expect(audit.stderr).toBe('');
    expect(audit.stdout.match(/::error /gu)).toHaveLength(6);
    const outputs = parseGitHubOutputs(await readFile(outputPath, 'utf8'));
    expect(Object.fromEntries(outputs)).toEqual({
      'exit-code': '1',
      'finding-count': '6',
      'output-dir': outputDir,
      'report-json': join(outputDir, 'results.json'),
      'report-sarif': join(outputDir, 'results.sarif'),
    });

    expect((await stat(outputs.get('report-json') ?? '')).isFile()).toBe(true);
    expect((await stat(outputs.get('report-sarif') ?? '')).isFile()).toBe(true);
    const summary = await readFile(summaryPath, 'utf8');
    expect(summary).toContain('Total findings: 6');
    expect(summary).toContain('Page: overflow');
    expect(summary).toContain('Viewport: mobile-320');

    const savedExitCode = outputs.get('exit-code');
    expect(savedExitCode).toBe('1');
    const finalizer = await spawnNode(
      exitActionPath,
      savedExitCode === undefined ? [] : [savedExitCode],
      cwd,
      {},
    );
    expect(finalizer).toEqual({ code: 1, stdout: '', stderr: '' });
  }, 60_000);

  it('keeps a clean audit successful with safe empty-or-present declared outputs', async () => {
    const { configPath, outputDir, cwd } = await fixtureConfig('clean');
    const { outputPath, summaryPath } = await githubFiles(cwd);

    const audit = await spawnNode(runActionPath, [], cwd, {
      INPUT_CONFIG: configPath,
      INPUT_OUTPUT: outputDir,
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    });

    expect(audit.code).toBe(0);
    expect(audit.stderr).toBe('');
    expect(audit.stdout).not.toContain('::error');
    const outputs = parseGitHubOutputs(await readFile(outputPath, 'utf8'));
    expect(Object.fromEntries(outputs)).toEqual({
      'exit-code': '0',
      'finding-count': '0',
      'output-dir': outputDir,
      'report-json': join(outputDir, 'results.json'),
      'report-sarif': join(outputDir, 'results.sarif'),
    });
    expect(await readFile(summaryPath, 'utf8')).toContain(
      'No findings detected',
    );
    expect(await spawnNode(exitActionPath, ['0'], cwd, {})).toEqual({
      code: 0,
      stdout: '',
      stderr: '',
    });
  }, 60_000);

  it('turns wrapper exceptions into safe outputs and one sanitized annotation', async () => {
    const cwd = await temporaryDirectory('wrapper-failure');
    const { outputPath } = await githubFiles(cwd);

    const audit = await spawnNode(runActionPath, [], cwd, {
      INPUT_CONFIG: '',
      INPUT_OUTPUT: 'top-secret-output',
      GITHUB_OUTPUT: outputPath,
      TOP_SECRET_VALUE: 'must-not-leak',
    });

    expect(audit.code).toBe(0);
    expect(audit.stderr).toBe('');
    expect(audit.stdout.match(/::error/gu)).toHaveLength(1);
    expect(audit.stdout).toContain(
      'Viewport Sentinel Action failed unexpectedly',
    );
    expect(audit.stdout).not.toMatch(
      /top-secret|must-not-leak|Input required/gu,
    );
    expect(
      Object.fromEntries(
        parseGitHubOutputs(await readFile(outputPath, 'utf8')),
      ),
    ).toEqual({
      'exit-code': '2',
      'finding-count': '0',
      'output-dir': '',
      'report-json': '',
      'report-sarif': '',
    });
  });

  it('keeps process exit zero and emits one safe annotation when GITHUB_OUTPUT is invalid', async () => {
    const { configPath, outputDir, cwd } = await fixtureConfig('clean');
    const { summaryPath } = await githubFiles(cwd);

    const audit = await spawnNode(runActionPath, [], cwd, {
      INPUT_CONFIG: configPath,
      INPUT_OUTPUT: outputDir,
      GITHUB_OUTPUT: cwd,
      GITHUB_STEP_SUMMARY: summaryPath,
    });

    expect(audit.code).toBe(0);
    expect(audit.stderr).toBe('');
    expect(audit.stdout.match(/::error/gu)).toHaveLength(1);
    expect(audit.stdout).toContain(
      'Viewport Sentinel Action failed unexpectedly',
    );
    expect(audit.stdout).not.toMatch(/EISDIR|github-output|top-secret/gu);
    expect((await stat(join(outputDir, 'results.json'))).isFile()).toBe(true);
    expect((await stat(join(outputDir, 'results.sarif'))).isFile()).toBe(true);
    expect(await readFile(summaryPath, 'utf8')).toContain(
      'No findings detected',
    );
    await expect(readFile(cwd, 'utf8')).rejects.toThrow();
  }, 60_000);

  it('uses literal argument-array inputs and never executes invalid input text', async () => {
    const cwd = await temporaryDirectory('input-injection');
    const { outputPath } = await githubFiles(cwd);
    const markerPath = join(cwd, 'must-not-exist');
    const maliciousConfig = `missing.json; touch ${markerPath}`;

    const audit = await spawnNode(runActionPath, [], cwd, {
      INPUT_CONFIG: maliciousConfig,
      INPUT_OUTPUT: '   ',
      GITHUB_OUTPUT: outputPath,
    });

    expect(audit.code).toBe(0);
    expect(
      parseGitHubOutputs(await readFile(outputPath, 'utf8')).get('exit-code'),
    ).toBe('2');
    await expect(stat(markerPath)).rejects.toThrow();
  });

  it('maps only exact finalizer strings and never evaluates invalid status text', async () => {
    const cwd = await temporaryDirectory('exit-map');
    const markerPath = join(cwd, 'must-not-exist');

    expect(await spawnNode(exitActionPath, ['2'], cwd, {})).toEqual({
      code: 2,
      stdout: '',
      stderr: '',
    });
    expect(await spawnNode(exitActionPath, ['9'], cwd, {})).toEqual({
      code: 2,
      stdout: '',
      stderr: '',
    });
    expect(
      await spawnNode(exitActionPath, [`1; touch ${markerPath}`], cwd, {}),
    ).toEqual({ code: 2, stdout: '', stderr: '' });
    expect(await spawnNode(exitActionPath, [], cwd, {})).toEqual({
      code: 2,
      stdout: '',
      stderr: '',
    });
    await expect(stat(markerPath)).rejects.toThrow();
  });
});

describe('composite Action metadata', () => {
  it('parses into the exact fail-last step graph and public output contract', async () => {
    const action = await parseActionYaml();

    expect(action).toMatchObject({
      name: 'Viewport Sentinel',
      description:
        'Deterministic responsive and media regression checks in Chromium',
      inputs: {
        config: {
          description: 'Path to viewport-sentinel.config.json',
          required: 'true',
        },
        output: {
          description: 'Optional report-directory override',
          required: 'false',
        },
      },
      outputs: {
        'finding-count': {
          description: 'Number of emitted findings',
          value: '${{ steps.audit.outputs.finding-count }}',
        },
        'report-json': {
          description: 'Path to results.json',
          value: '${{ steps.audit.outputs.report-json }}',
        },
        'report-sarif': {
          description: 'Path to results.sarif',
          value: '${{ steps.audit.outputs.report-sarif }}',
        },
      },
      runs: { using: 'composite' },
    });
    const outputs = action.outputs as Record<string, unknown>;
    expect(Object.keys(outputs)).toEqual([
      'finding-count',
      'report-json',
      'report-sarif',
    ]);
    const runs = action.runs as Record<string, unknown>;
    const steps = runs.steps as Record<string, unknown>[];
    expect(steps).toEqual([
      {
        uses: 'actions/setup-node@v6',
        with: { 'node-version': '24', 'package-manager-cache': 'false' },
      },
      {
        name: 'Install action runtime',
        shell: 'bash',
        'working-directory': '${{ github.action_path }}',
        run: 'npm ci --omit=dev --ignore-scripts',
      },
      {
        name: 'Install matching Chromium',
        shell: 'bash',
        'working-directory': '${{ github.action_path }}',
        run: 'npx --no-install playwright install --with-deps chromium',
      },
      {
        id: 'audit',
        name: 'Audit viewports',
        shell: 'bash',
        'working-directory': '${{ github.workspace }}',
        env: {
          INPUT_CONFIG: '${{ inputs.config }}',
          INPUT_OUTPUT: '${{ inputs.output }}',
        },
        run: 'node "$GITHUB_ACTION_PATH/dist/action/run.js"',
      },
      {
        name: 'Upload reports',
        if: "${{ always() && steps.audit.outputs.output-dir != '' }}",
        uses: 'actions/upload-artifact@v5',
        with: {
          name: 'viewport-sentinel-${{ github.run_id }}-${{ github.run_attempt }}',
          path: '${{ steps.audit.outputs.output-dir }}',
          'if-no-files-found': 'ignore',
        },
      },
      {
        name: 'Propagate audit status',
        if: '${{ always() }}',
        shell: 'bash',
        env: {
          VIEWPORT_SENTINEL_EXIT_CODE: '${{ steps.audit.outputs.exit-code }}',
        },
        run: 'node "$GITHUB_ACTION_PATH/dist/action/exit.js" "$VIEWPORT_SENTINEL_EXIT_CODE"',
      },
    ]);
  });
});
