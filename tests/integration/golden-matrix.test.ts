import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  startFixtureServer,
  type FixtureServer,
} from '../../src/fixtures/server.js';
import { loadConfig } from '../../src/config/load-config.js';
import { canonicalStringify } from '../../src/core/canonical.js';
import { auditConfig } from '../../src/runner/audit-config.js';

const configPath = resolve('tests/fixtures/config/golden.json');
const goldenPath = resolve('tests/golden/results.json');
let fixture: FixtureServer;

beforeAll(async () => {
  fixture = await startFixtureServer(4173);
}, 30_000);

afterAll(async () => {
  await fixture.close();
});

describe('canonical golden matrix', () => {
  it('emits the reviewed six-finding report byte for byte', async () => {
    const result = await auditConfig(await loadConfig(configPath));
    const output = canonicalStringify(result);

    expect(
      result.findings.map(({ page, viewport, ruleId }) => [
        page,
        viewport.name,
        ruleId,
      ]),
    ).toEqual([
      ['overflow', 'mobile-320', 'VS001'],
      ['overlap', 'mobile-320', 'VS002'],
      ['picture', 'mobile-320', 'VS003'],
      ['picture', 'desktop-1440', 'VS003'],
      ['console', 'mobile-320', 'VS004'],
      ['console', 'desktop-1440', 'VS004'],
    ]);
    expect(result.totals).toMatchObject({
      findingCount: 6,
      suppressedConsoleCount: 0,
      omittedFindingCount: 0,
      omittedByCombination: [],
    });
    expect(output).not.toMatch(/https?:\/\/[^"\s]*[?#]/u);
    expect(output).not.toContain(process.cwd());
    expect(output).not.toMatch(
      /"(?:timestamp|duration|configPath|outputDir|env)"/u,
    );
    expect(output).toBe(await readFile(goldenPath, 'utf8'));
  }, 60_000);
});
