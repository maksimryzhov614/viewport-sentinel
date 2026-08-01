import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  mismatchMessage,
  parseCount,
  withTemporaryRoot,
} from '../../scripts/verify-determinism.mjs';

function spawnScript(argv) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      ['scripts/verify-determinism.mjs', ...argv],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectRun);
    child.once('close', (code) => {
      resolveRun({ code, stdout, stderr });
    });
  });
}

describe('determinism gate helpers', () => {
  it.each([
    [[], 3],
    [['1'], 1],
    [['20'], 20],
  ])('accepts a single bounded integer count', (argv, expected) => {
    expect(parseCount(argv)).toBe(expected);
  });

  it.each([['0'], ['21'], ['1.5'], ['three'], ['1', '2']])(
    'rejects invalid count arguments without coercion',
    (...argv) => {
      expect(() => parseCount(argv)).toThrow(
        'Count must be one integer from 1 to 20',
      );
    },
  );

  it.each([['0'], ['21'], ['1.5'], ['three'], ['1', '2']])(
    'exits two with one safe diagnostic for invalid script arguments',
    async (...argv) => {
      await expect(spawnScript(argv)).resolves.toEqual({
        code: 2,
        stdout: '',
        stderr: 'Count must be one integer from 1 to 20\n',
      });
    },
  );

  it('reports only the file name and first differing byte offset', () => {
    expect(
      mismatchMessage(
        'results.json',
        Buffer.from([0x61, 0x62, 0x63]),
        Buffer.from([0x61, 0x7a, 0x63]),
      ),
    ).toBe('results.json differs at byte 1');
    expect(
      mismatchMessage(
        'results.sarif',
        Buffer.from([0x61, 0x62]),
        Buffer.from([0x61, 0x62, 0x63]),
      ),
    ).toBe('results.sarif differs at byte 2');
  });

  it('removes only its created root when the repeated run fails', async () => {
    const outsideRoot = await mkdtemp(
      join(tmpdir(), 'viewport-sentinel-outside-test-'),
    );
    const marker = join(outsideRoot, 'keep');
    await writeFile(marker, 'keep', 'utf8');
    let createdRoot = '';

    try {
      await expect(
        withTemporaryRoot(async (root) => {
          createdRoot = root;
          await writeFile(join(root, 'partial-report'), 'partial', 'utf8');
          throw new Error('simulated mismatch');
        }),
      ).rejects.toThrow('simulated mismatch');

      await expect(access(createdRoot)).rejects.toThrow();
      await expect(access(marker)).resolves.toBeUndefined();
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
