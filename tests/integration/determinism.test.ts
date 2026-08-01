import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startFixtureServer,
  type FixtureServer,
} from '../../src/fixtures/server.js';

const repositoryRoot = resolve('.');
const cliPath = resolve('dist/cli.js');
const fixturePort = 4178;
let fixture: FixtureServer;
let temporaryRoot: string;
let configPath: string;

interface ProcessResult {
  code: number | null;
  stderr: string;
}

function spawnCli(outputDir: string): Promise<ProcessResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [cliPath, '--config', configPath, '--output', outputDir],
      {
        cwd: repositoryRoot,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectRun);
    child.once('close', (code) => {
      resolveRun({ code, stderr });
    });
  });
}

beforeAll(async () => {
  temporaryRoot = await mkdtemp(
    join(tmpdir(), 'viewport-sentinel-determinism-test-'),
  );
  const source = JSON.parse(
    await readFile(resolve('tests/fixtures/config/golden.json'), 'utf8'),
  ) as Record<string, unknown>;
  configPath = join(temporaryRoot, 'golden.json');
  await writeFile(
    configPath,
    JSON.stringify({
      ...source,
      $schema: undefined,
      baseUrl: `http://127.0.0.1:${String(fixturePort)}`,
    }),
    'utf8',
  );
  fixture = await startFixtureServer(fixturePort);
}, 30_000);

afterAll(async () => {
  await fixture.close();
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe('built report determinism', () => {
  it('returns one and emits byte-identical JSON and SARIF across repeated runs', async () => {
    const firstOutput = join(temporaryRoot, 'run-1');
    const secondOutput = join(temporaryRoot, 'run-2');
    const first = await spawnCli(firstOutput);
    const second = await spawnCli(secondOutput);

    expect(first).toEqual({ code: 1, stderr: '' });
    expect(second).toEqual({ code: 1, stderr: '' });

    for (const fileName of ['results.json', 'results.sarif']) {
      const firstBytes = await readFile(join(firstOutput, fileName));
      const secondBytes = await readFile(join(secondOutput, fileName));
      expect(
        firstBytes.equals(secondBytes),
        `${fileName} differs across identical runs`,
      ).toBe(true);
    }
  }, 60_000);
});
