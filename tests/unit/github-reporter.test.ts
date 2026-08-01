import * as core from '@actions/core';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultRunCliDependencies,
  runCli,
  type RunCliDependencies,
} from '../../src/cli/run-cli.js';
import type {
  AuditResult,
  CliEnvironment,
  Finding,
  NormalizedConfig,
  TextSink,
} from '../../src/model/types.js';
import { writeGitHubReport } from '../../src/reporters/github.js';

const temporaryDirectories: string[] = [];
let previousSummaryPath: string | undefined;

interface TestGitHubEnvironment extends NodeJS.ProcessEnv {
  summaryPath: string;
}

function emptyAuditResult(): AuditResult {
  return {
    schemaVersion: 1,
    complete: true,
    tool: { name: 'viewport-sentinel', version: '0.0.0' },
    browser: {
      name: 'chromium',
      playwrightVersion: '1.62.1',
      version: '123.0.4567.8',
    },
    config: {
      version: 1,
      pages: [],
      viewports: [],
      timeoutMs: 1_000,
      formats: ['json', 'sarif'],
    },
    combinations: { total: 0, completed: 0, failedReadiness: 0 },
    totals: {
      findingCount: 0,
      suppressedConsoleCount: 0,
      omittedFindingCount: 0,
      omittedByCombination: [],
    },
    findings: [],
  };
}

function findingAt(index: number): Finding {
  const page = index < 26 ? 'catalog <featured>' : 'checkout & pay';
  const viewport =
    index % 2 === 0
      ? {
          name: 'mobile <320>',
          width: 320,
          height: 844,
          deviceScaleFactor: 1,
        }
      : {
          name: 'desktop & wide',
          width: 1440,
          height: 900,
          deviceScaleFactor: 1,
        };
  return {
    ruleId: 'VS001',
    severity: 'error',
    message:
      `Failure ${String(index + 1)} at ` +
      'https://user:password@example.test/private?token=secret#fragment <unsafe>',
    selector: `#item-${String(index + 1)} > img[data-label="private&unsafe"]`,
    evidence: {
      kind: 'overflow',
      viewportWidth: viewport.width,
      documentWidth: viewport.width + 1,
      overflowPx: 1,
      offenders: [],
    },
    page,
    url: 'https://example.test/private?token=secret#fragment',
    viewport,
    fingerprint: `sha256:${index.toString(16).padStart(64, '0')}`,
  };
}

function auditResultWithFindings(count: number): AuditResult {
  const findings = Array.from({ length: count }, (_, index) =>
    findingAt(index),
  );
  return {
    ...emptyAuditResult(),
    combinations: { total: 4, completed: 4, failedReadiness: 0 },
    totals: {
      findingCount: count,
      suppressedConsoleCount: 7,
      omittedFindingCount: 5,
      omittedByCombination: [],
    },
    findings,
  };
}

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), `viewport-sentinel-${label}-`),
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function githubEnvironment(
  label: string,
): Promise<TestGitHubEnvironment> {
  const directory = await temporaryDirectory(label);
  const summaryPath = join(directory, 'summary.md');
  await writeFile(summaryPath, '', 'utf8');
  process.env.GITHUB_STEP_SUMMARY = summaryPath;
  return { GITHUB_STEP_SUMMARY: summaryPath, summaryPath };
}

async function captureWorkflowCommands(
  operation: () => Promise<void>,
): Promise<string> {
  let output = '';
  const write = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    });
  try {
    await operation();
  } finally {
    write.mockRestore();
  }
  return output;
}

function resetCoreSummary(): void {
  core.summary.emptyBuffer();
  Reflect.deleteProperty(core.summary, '_filePath');
}

function memorySink(): { sink: TextSink; text(): string } {
  let content = '';
  return {
    sink: {
      write(chunk: string): boolean {
        content += chunk;
        return true;
      },
    },
    text: () => content,
  };
}

function normalizedConfig(
  configPath: string,
  outputDir: string,
): NormalizedConfig {
  return {
    version: 1,
    configPath,
    pages: [],
    viewports: [],
    timeoutMs: 1_000,
    outputDir,
    formats: ['json', 'sarif'],
  };
}

beforeEach(() => {
  previousSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  delete process.env.GITHUB_STEP_SUMMARY;
  resetCoreSummary();
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetCoreSummary();
  if (previousSummaryPath === undefined) {
    delete process.env.GITHUB_STEP_SUMMARY;
  } else {
    process.env.GITHUB_STEP_SUMMARY = previousSummaryPath;
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('GitHub reporter', () => {
  it('annotates only the first 50 ordered findings and summarizes the rest', async () => {
    const result = auditResultWithFindings(53);
    const githubEnv = await githubEnvironment('github-cap');

    const output = await captureWorkflowCommands(() =>
      writeGitHubReport(result, 'viewport-sentinel.config.json', githubEnv),
    );

    expect(output.match(/::error /gu)).toHaveLength(50);
    expect(output).toContain(
      '::error title=VS001,file=viewport-sentinel.config.json,line=1,endLine=1::' +
        'VS001 catalog <featured>/mobile <320> ' +
        '#item-1 > img[data-label="private&unsafe"]:',
    );
    expect(output).toContain('Failure 50');
    expect(output).not.toContain('Failure 51');
    expect(output).not.toMatch(/[?&]token=secret|user:password/gu);

    const summary = await readFile(githubEnv.summaryPath, 'utf8');
    expect(summary).toContain('Total findings: 53');
    expect(summary).toContain('Suppressed console messages: 7');
    expect(summary).toContain('Omitted findings: 5');
    expect(summary).toContain('3 additional findings');
    expect(summary).toContain('Failure 50');
    expect(summary).not.toContain('Failure 51');
  });

  it('groups summary findings by page then viewport and HTML-escapes every value', async () => {
    const result = auditResultWithFindings(4);
    const githubEnv = await githubEnvironment('github-groups');

    await captureWorkflowCommands(() =>
      writeGitHubReport(result, 'config.json', githubEnv),
    );

    const summary = await readFile(githubEnv.summaryPath, 'utf8');
    const pageIndex = summary.indexOf('catalog &lt;featured&gt;');
    const mobileIndex = summary.indexOf('mobile &lt;320&gt;');
    const desktopIndex = summary.indexOf('desktop &amp; wide');
    expect(pageIndex).toBeGreaterThan(-1);
    expect(mobileIndex).toBeGreaterThan(pageIndex);
    expect(desktopIndex).toBeGreaterThan(mobileIndex);
    expect(summary).toContain(
      '#item-1 &gt; img[data-label=&quot;private&amp;unsafe&quot;]',
    );
    expect(summary).toContain('Failure 1 at https://example.test/private');
    expect(summary).toContain('&lt;unsafe&gt;');
    expect(summary).not.toMatch(/[?&]token=secret|user:password/gu);
    expect(summary).not.toContain('<featured>');
    expect(summary).not.toContain('<unsafe>');
  });

  it('writes a success summary without error annotations', async () => {
    const githubEnv = await githubEnvironment('github-clean');

    const output = await captureWorkflowCommands(() =>
      writeGitHubReport(emptyAuditResult(), 'config.json', githubEnv),
    );

    expect(output).not.toContain('::error');
    expect(await readFile(githubEnv.summaryPath, 'utf8')).toContain(
      'No findings detected',
    );
  });

  it('clears stale process-global summary content before writing', async () => {
    const githubEnv = await githubEnvironment('github-global-state');
    core.summary.addRaw('stale private summary content');

    await captureWorkflowCommands(() =>
      writeGitHubReport(emptyAuditResult(), 'config.json', githubEnv),
    );

    expect(await readFile(githubEnv.summaryPath, 'utf8')).not.toContain(
      'stale private summary content',
    );
    expect(core.summary.isEmptyBuffer()).toBe(true);
  });

  it('keeps annotations and emits exactly one warning when summary is unavailable', async () => {
    const result = auditResultWithFindings(2);

    const output = await captureWorkflowCommands(() =>
      writeGitHubReport(result, 'config.json', {}),
    );

    expect(output.match(/::error /gu)).toHaveLength(2);
    expect(output.match(/::warning::/gu)).toHaveLength(1);
    expect(output).toContain('GitHub step summary is unavailable');
  });
});

describe('runCli GitHub reporting seam', () => {
  it('runs GitHub reporting after configured report files close and before terminal', async () => {
    const directory = await temporaryDirectory('github-cli-order');
    const configPath = join(directory, 'viewport-sentinel.config.json');
    const outputDir = join(directory, 'reports');
    const config = normalizedConfig(configPath, outputDir);
    const audit = emptyAuditResult();
    const order: string[] = [];
    const stdout = memorySink();
    const stderr = memorySink();
    const environment: CliEnvironment = {
      cwd: directory,
      env: {},
      stdout: stdout.sink,
      stderr: stderr.sink,
    };
    const dependencies: RunCliDependencies = {
      ...defaultRunCliDependencies,
      loadConfig: vi.fn().mockResolvedValue(config),
      auditConfig: vi.fn().mockResolvedValue(audit),
      writeJsonReport: vi.fn().mockImplementation(() => {
        order.push('json-closed');
        return Promise.resolve(join(outputDir, 'results.json'));
      }),
      writeSarifReport: vi.fn().mockImplementation(() => {
        order.push('sarif-closed');
        return Promise.resolve(join(outputDir, 'results.sarif'));
      }),
      writeGitHubReport: vi.fn().mockImplementation(() => {
        order.push('github');
        return Promise.resolve();
      }),
      writeTerminalSummary: vi.fn().mockImplementation(() => {
        order.push('terminal');
      }),
    };

    const result = await runCli(
      ['--config', basename(configPath), '--github'],
      environment,
      dependencies,
    );

    expect(order).toEqual([
      'json-closed',
      'sarif-closed',
      'github',
      'terminal',
    ]);
    expect(result).toEqual({
      exitCode: 0,
      findingCount: 0,
      outputDir,
      jsonPath: join(outputDir, 'results.json'),
      sarifPath: join(outputDir, 'results.sarif'),
    });
    expect(stderr.text()).toBe('');
  });

  it('returns reporter exit 2 and retains closed report paths when GitHub writing fails', async () => {
    const directory = await temporaryDirectory('github-cli-failure');
    const configPath = join(directory, 'viewport-sentinel.config.json');
    const outputDir = join(directory, 'reports');
    const config = normalizedConfig(configPath, outputDir);
    const audit = emptyAuditResult();
    const jsonPath = join(outputDir, 'results.json');
    const sarifPath = join(outputDir, 'results.sarif');
    const stdout = memorySink();
    const stderr = memorySink();
    const github = vi.fn().mockRejectedValue(new Error('secret reporter path'));

    const result = await runCli(
      ['--config', basename(configPath), '--github'],
      {
        cwd: directory,
        env: {},
        stdout: stdout.sink,
        stderr: stderr.sink,
      },
      {
        ...defaultRunCliDependencies,
        loadConfig: vi.fn().mockResolvedValue(config),
        auditConfig: vi.fn().mockResolvedValue(audit),
        writeJsonReport: vi.fn().mockResolvedValue(jsonPath),
        writeSarifReport: vi.fn().mockResolvedValue(sarifPath),
        writeGitHubReport: github,
        writeTerminalSummary: vi.fn(),
      },
    );

    expect(github).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      exitCode: 2,
      findingCount: 0,
      outputDir,
      jsonPath,
      sarifPath,
    });
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe(
      'Report writing failed: check the output directory permissions and retry.\n',
    );
    expect(stderr.text()).not.toContain('secret reporter path');
  });
});
