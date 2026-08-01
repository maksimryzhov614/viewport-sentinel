import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startFixtureServer,
  type FixtureServer,
} from '../../src/fixtures/server.js';

const repositoryRoot = resolve('.');
const temporaryRoots: string[] = [];

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<ProcessResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
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

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'viewport-sentinel-readme-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('README quick start', () => {
  it('installs the actual v0.1.0 tarball and produces the documented clean result', async () => {
    const readme = await readFile(join(repositoryRoot, 'README.md'), 'utf8');
    const configMatch =
      /<!-- quick-start-config -->\s*```json\s*([\s\S]*?)\s*```/u.exec(readme);
    const commandMatch =
      /<!-- quick-start-command -->\s*```sh\s*([^\n]+)\s*```/u.exec(readme);
    expect(configMatch?.[1]).toBeDefined();
    expect(commandMatch?.[1]).toBe(
      'npx viewport-sentinel --config viewport-sentinel.config.json',
    );
    const configSource = configMatch?.[1];
    if (configSource === undefined) {
      throw new Error('README quick-start config is missing');
    }
    const documentedConfig = JSON.parse(configSource) as unknown;
    expect(documentedConfig).toMatchObject({
      version: 1,
      baseUrl: 'http://127.0.0.1:4173',
    });

    const root = await temporaryRoot();
    const pack = await run(
      'npm',
      ['pack', '--json', '--pack-destination', root],
      repositoryRoot,
    );
    expect(pack.code).toBe(0);
    const packResult = (JSON.parse(pack.stdout) as { filename: string }[])[0];
    if (packResult === undefined) {
      throw new Error('npm pack returned no artifact');
    }
    expect(basename(packResult.filename)).toBe('viewport-sentinel-0.1.0.tgz');

    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'readme-consumer', private: true }),
      'utf8',
    );
    const install = await run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        join(root, packResult.filename),
      ],
      root,
    );
    expect(install).toMatchObject({ code: 0, stderr: '' });
    await writeFile(
      join(root, 'viewport-sentinel.config.json'),
      configSource,
      'utf8',
    );

    let fixture: FixtureServer | undefined;
    try {
      fixture = await startFixtureServer(4173);
      const audit = await run(
        'npx',
        ['viewport-sentinel', '--config', 'viewport-sentinel.config.json'],
        root,
      );
      expect(audit).toEqual({
        code: 0,
        stdout: 'Viewport Sentinel: 0 findings (2/2 combinations completed)\n',
        stderr: '',
      });
      const report = JSON.parse(
        await readFile(
          join(root, 'artifacts/viewport-sentinel/results.json'),
          'utf8',
        ),
      ) as { complete?: unknown; totals?: { findingCount?: unknown } };
      expect(report).toMatchObject({
        complete: true,
        totals: { findingCount: 0 },
      });
      await expect(
        readFile(
          join(root, 'artifacts/viewport-sentinel/results.sarif'),
          'utf8',
        ),
      ).resolves.toContain('"version": "2.1.0"');
    } finally {
      await fixture?.close();
    }
  }, 120_000);
});
