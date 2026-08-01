import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { canonicalStringify } from '../../src/core/canonical.js';
import type { AuditResult } from '../../src/model/types.js';
import { writeSarifReport, toSarif } from '../../src/reporters/sarif.js';
import { AuditExecutionError } from '../../src/runner/audit-config.js';

const goldenResultPath = resolve('tests/golden/results.json');
const goldenSarifPath = resolve('tests/golden/results.sarif');
const temporaryDirectories: string[] = [];
let goldenAuditResult: AuditResult;

beforeAll(async () => {
  goldenAuditResult = JSON.parse(
    await readFile(goldenResultPath, 'utf8'),
  ) as AuditResult;
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('toSarif', () => {
  it('maps every finding through the fixed SARIF 2.1.0 catalog in source order', () => {
    const sarif = toSarif(goldenAuditResult, 'viewport-sentinel.config.json');
    const run = sarif.runs[0];

    expect(sarif.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json');
    expect(sarif.version).toBe('2.1.0');
    expect(run?.automationDetails).toEqual({ id: 'viewport-sentinel/v1' });
    expect(run?.properties).toEqual({
      complete: true,
      configFile: 'viewport-sentinel.config.json',
    });
    expect(run?.tool.driver.rules).toEqual([
      {
        id: 'VSRUN001',
        name: 'PageReadinessFailure',
        shortDescription: { text: 'Page readiness failure' },
        fullDescription: {
          text: 'The page did not navigate or become ready before the configured deadline.',
        },
        helpUri:
          'https://github.com/maksimryzhov614/viewport-sentinel/blob/main/docs/rules.md#vsrun001',
      },
      {
        id: 'VS001',
        name: 'HorizontalOverflow',
        shortDescription: { text: 'Horizontal overflow' },
        fullDescription: {
          text: 'The document is wider than the configured viewport.',
        },
        helpUri:
          'https://github.com/maksimryzhov614/viewport-sentinel/blob/main/docs/rules.md#vs001',
      },
      {
        id: 'VS002',
        name: 'BlockedActionableControl',
        shortDescription: { text: 'Blocked actionable control' },
        fullDescription: {
          text: 'A fixed or sticky element obscures an actionable control.',
        },
        helpUri:
          'https://github.com/maksimryzhov614/viewport-sentinel/blob/main/docs/rules.md#vs002',
      },
      {
        id: 'VS003',
        name: 'BrowserSelectedImageFailure',
        shortDescription: { text: 'Browser-selected image failure' },
        fullDescription: {
          text: 'A visible browser-selected image did not load and decode.',
        },
        helpUri:
          'https://github.com/maksimryzhov614/viewport-sentinel/blob/main/docs/rules.md#vs003',
      },
      {
        id: 'VS004',
        name: 'BrowserRuntimeError',
        shortDescription: { text: 'Browser runtime error' },
        fullDescription: {
          text: 'The page emitted an unignored console error or page error.',
        },
        helpUri:
          'https://github.com/maksimryzhov614/viewport-sentinel/blob/main/docs/rules.md#vs004',
      },
    ]);
    expect(run?.results).toHaveLength(goldenAuditResult.findings.length);
    expect(run?.results.map(({ ruleId }) => ruleId)).toEqual(
      goldenAuditResult.findings.map(({ ruleId }) => ruleId),
    );
    expect(canonicalStringify(sarif)).not.toMatch(
      /timestamp|duration|token=/iu,
    );
  });

  it('maps exact result properties, fingerprint, message, and audited URL location', () => {
    const sarif = toSarif(goldenAuditResult, 'viewport-sentinel.config.json');

    for (const [index, finding] of goldenAuditResult.findings.entries()) {
      expect(sarif.runs[0]?.results[index]).toEqual({
        ruleId: finding.ruleId,
        level: 'error',
        message: { text: finding.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: finding.url },
            },
          },
        ],
        partialFingerprints: {
          primaryLocationLineHash: finding.fingerprint.slice('sha256:'.length),
        },
        properties: {
          page: finding.page,
          viewport: finding.viewport,
          selector: finding.selector,
          evidence: finding.evidence,
        },
      });
    }
  });

  it('sanitizes messages, audited URLs, and the config file to a basename', () => {
    const firstFinding = goldenAuditResult.findings[0];
    if (firstFinding === undefined) {
      throw new Error('golden report has no findings');
    }
    const result: AuditResult = {
      ...goldenAuditResult,
      findings: [
        {
          ...firstFinding,
          url: 'https://user:pass@example.test/page?token=secret#private',
          message:
            'Broken https://user:pass@example.test/image?token=secret#private',
        },
      ],
      totals: { ...goldenAuditResult.totals, findingCount: 1 },
    };

    const output = canonicalStringify(
      toSarif(result, '/private/token/config.json'),
    );

    expect(output).toContain('Broken https://example.test/image');
    expect(output).toContain('https://example.test/page');
    expect(output).toContain('"configFile": "config.json"');
    expect(output).not.toMatch(/user:pass|token=|#private|\/private\//u);
  });

  it('matches the reviewed canonical SARIF golden byte for byte', async () => {
    expect(
      canonicalStringify(
        toSarif(goldenAuditResult, 'viewport-sentinel.config.json'),
      ),
    ).toBe(await readFile(goldenSarifPath, 'utf8'));
  });
});

describe('writeSarifReport', () => {
  it('atomically writes canonical SARIF through only results.sarif.tmp', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'viewport-sentinel-sarif-'));
    temporaryDirectories.push(directory);

    const reportPath = await writeSarifReport(
      goldenAuditResult,
      directory,
      'viewport-sentinel.config.json',
    );

    expect(reportPath).toBe(join(directory, 'results.sarif'));
    expect(await readFile(reportPath, 'utf8')).toBe(
      canonicalStringify(
        toSarif(goldenAuditResult, 'viewport-sentinel.config.json'),
      ),
    );
    await expect(
      readFile(join(directory, 'results.sarif.tmp')),
    ).rejects.toThrow();
  });

  it('removes only its tmp file after failure and preserves unrelated output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'viewport-sentinel-sarif-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'unrelated.txt'), 'keep me', 'utf8');
    await mkdir(join(directory, 'results.sarif'));

    let caught: unknown;
    try {
      await writeSarifReport(
        goldenAuditResult,
        directory,
        'viewport-sentinel.config.json',
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuditExecutionError);
    if (!(caught instanceof AuditExecutionError)) {
      throw new Error('expected AuditExecutionError');
    }
    expect(caught.result.complete).toBe(false);
    expect(await readFile(join(directory, 'unrelated.txt'), 'utf8')).toBe(
      'keep me',
    );
    await expect(
      readFile(join(directory, 'results.sarif.tmp')),
    ).rejects.toThrow();
  });
});
