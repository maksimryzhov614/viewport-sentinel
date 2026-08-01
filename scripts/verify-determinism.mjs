import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import console from 'node:console';
import { startFixtureServer } from '../dist/fixtures/server.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(repositoryRoot, 'dist/cli.js');
const configPath = join(repositoryRoot, 'tests/fixtures/config/golden.json');
const reportNames = ['results.json', 'results.sarif'];

export function parseCount(argv) {
  if (argv.length === 0) {
    return 3;
  }
  if (argv.length !== 1 || !/^(?:[1-9]|1\d|20)$/u.test(argv[0] ?? '')) {
    throw new Error('Count must be one integer from 1 to 20');
  }
  return Number(argv[0]);
}

function firstDifferingByte(expected, actual) {
  const sharedLength = Math.min(expected.length, actual.length);
  for (let offset = 0; offset < sharedLength; offset += 1) {
    if (expected[offset] !== actual[offset]) {
      return offset;
    }
  }
  return expected.length === actual.length ? -1 : sharedLength;
}

export function mismatchMessage(fileName, expected, actual) {
  const offset = firstDifferingByte(expected, actual);
  if (offset === -1) {
    throw new Error('Cannot describe a mismatch between identical buffers');
  }
  return `${fileName} differs at byte ${String(offset)}`;
}

export async function withTemporaryRoot(run) {
  const root = await mkdtemp(join(tmpdir(), 'viewport-sentinel-determinism-'));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function spawnCli(outputDir) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [cliPath, '--config', configPath, '--output', outputDir],
      {
        cwd: repositoryRoot,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: 'ignore',
      },
    );
    child.once('error', rejectRun);
    child.once('close', (code, signal) => {
      resolveRun({ code, signal });
    });
  });
}

async function verifyRuns(count) {
  const fixture = await startFixtureServer(4173);
  try {
    await withTemporaryRoot(async (root) => {
      const expected = new Map();
      for (let iteration = 1; iteration <= count; iteration += 1) {
        const outputDir = join(root, `run-${String(iteration)}`);
        const result = await spawnCli(outputDir);
        if (result.code !== 1) {
          const status =
            result.signal === null
              ? `exit ${String(result.code)}`
              : `signal ${result.signal}`;
          throw new Error(
            `Run ${String(iteration)} returned ${status}; expected exit 1`,
          );
        }

        for (const fileName of reportNames) {
          const bytes = await readFile(join(outputDir, fileName));
          const first = expected.get(fileName);
          if (first === undefined) {
            expected.set(fileName, bytes);
          } else if (!first.equals(bytes)) {
            throw new Error(mismatchMessage(fileName, first, bytes));
          }
        }
      }
    });
  } finally {
    await fixture.close();
  }
}

async function main(argv) {
  let count;
  try {
    count = parseCount(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid count');
    return 2;
  }

  try {
    await verifyRuns(count);
    console.log(`Determinism verified across ${String(count)} runs`);
    return 0;
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'Determinism verification failed',
    );
    return 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  pathToFileURL(resolve(invokedPath)).href === import.meta.url
) {
  process.exitCode = await main(process.argv.slice(2));
}
