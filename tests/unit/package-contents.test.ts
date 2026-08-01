import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve('.');

interface PackFile {
  path: string;
}

interface PackResult {
  files: PackFile[];
}

function sourceMapPaths(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Source map must be an object');
  }
  const map = value as { sourceRoot?: unknown; sources?: unknown };
  const paths: string[] = [];
  if (typeof map.sourceRoot === 'string' && map.sourceRoot !== '') {
    paths.push(map.sourceRoot);
  }
  if (
    !Array.isArray(map.sources) ||
    !map.sources.every((item) => typeof item === 'string')
  ) {
    throw new Error('Source map sources must be strings');
  }
  paths.push(...map.sources);
  return paths;
}

function isAbsoluteSourcePath(value: string): boolean {
  return (
    isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    /^file:/iu.test(value)
  );
}

describe('published package contents', () => {
  it('ships only the release allowlist with runnable CLI and Action artifacts', async () => {
    const { stdout } = await execFileAsync(
      'npm',
      ['pack', '--json', '--dry-run'],
      { cwd: repositoryRoot, maxBuffer: 10 * 1024 * 1024 },
    );
    const result = (JSON.parse(stdout) as PackResult[])[0];
    if (result === undefined) {
      throw new Error('npm pack returned no package');
    }
    const paths = result.files.map(({ path }) => path).sort();

    expect(paths).toEqual(
      expect.arrayContaining([
        'LICENSE',
        'README.md',
        'action.yml',
        'config.schema.json',
        'dist/action/exit.js',
        'dist/action/run.js',
        'dist/cli.js',
        'package.json',
      ]),
    );
    expect(
      paths.every(
        (path) =>
          path.startsWith('dist/') ||
          [
            'LICENSE',
            'README.md',
            'action.yml',
            'config.schema.json',
            'package.json',
          ].includes(path),
      ),
    ).toBe(true);
    expect(
      paths.filter((path) =>
        /(?:^|\/)(?:tests?|fixtures?|artifacts?|env|git|\.git)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|private/iu.test(
          path,
        ),
      ),
    ).toEqual([]);

    for (const path of paths.filter((file) => file.endsWith('.map'))) {
      const sourceMap = JSON.parse(
        await readFile(resolve(repositoryRoot, path), 'utf8'),
      ) as unknown;
      expect(sourceMapPaths(sourceMap).filter(isAbsoluteSourcePath)).toEqual(
        [],
      );
    }
  }, 30_000);
});
