import { spawn } from 'node:child_process';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startFixtureServer } from '../dist/fixtures/server.js';
import { withTemporaryRoot } from './verify-determinism.mjs';

const thresholdMs = 60_000;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(repositoryRoot, 'dist/cli.js');
const configPath = join(repositoryRoot, 'tests/fixtures/config/golden.json');

export function ensureWithinThreshold(durationMs) {
  if (durationMs > thresholdMs) {
    throw new Error(`Performance gate exceeded ${String(thresholdMs)}ms`);
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

async function verifyPerformance() {
  const fixture = await startFixtureServer(4173);
  try {
    return await withTemporaryRoot(async (root) => {
      const startedAt = performance.now();
      const result = await spawnCli(join(root, 'reports'));
      const durationMs = Math.ceil(performance.now() - startedAt);
      if (result.code !== 1) {
        const status =
          result.signal === null
            ? `exit ${String(result.code)}`
            : `signal ${result.signal}`;
        throw new Error(`Performance run returned ${status}; expected exit 1`);
      }
      ensureWithinThreshold(durationMs);
      return durationMs;
    });
  } finally {
    await fixture.close();
  }
}

async function main() {
  try {
    const durationMs = await verifyPerformance();
    console.log(`Performance duration: ${String(durationMs)}ms`);
    return 0;
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'Performance verification failed',
    );
    return 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  pathToFileURL(resolve(invokedPath)).href === import.meta.url
) {
  process.exitCode = await main();
}
