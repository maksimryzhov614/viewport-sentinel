import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  startFixtureServer,
  type FixtureServer,
} from '../../src/fixtures/server.js';
import {
  defaultRunCliDependencies,
  runCli,
  type RunCliDependencies,
} from '../../src/cli/run-cli.js';
import { ConfigError } from '../../src/config/load-config.js';
import type {
  AuditResult,
  CliEnvironment,
  NormalizedConfig,
  ReportFormat,
  TextSink,
} from '../../src/model/types.js';
import { AuditExecutionError } from '../../src/runner/audit-config.js';

const repositoryRoot = resolve('.');
const cliPath = resolve('dist/cli.js');
const configDirectory = resolve('tests/fixtures/config');
const fixturePort = 4174;
const temporaryDirectories: string[] = [];
let fixture: FixtureServer;

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function spawnCli(
  argv: readonly string[],
  cwd = repositoryRoot,
): Promise<ProcessResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cliPath, ...argv], {
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

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), `viewport-sentinel-${label}-`),
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function fixtureConfig(
  name: 'clean' | 'golden' | 'timeout',
  formats: readonly ReportFormat[] = ['json', 'sarif'],
): Promise<{ configPath: string; outputDir: string }> {
  const directory = await temporaryDirectory(`${name}-cli`);
  const outputDir = join(directory, 'reports');
  const source = JSON.parse(
    await readFile(join(configDirectory, `${name}.json`), 'utf8'),
  ) as Record<string, unknown>;
  const configPath = join(directory, `${name}.json`);
  await writeFile(
    configPath,
    JSON.stringify({
      ...source,
      $schema: undefined,
      baseUrl: `http://127.0.0.1:${String(fixturePort)}`,
      output: { dir: outputDir, formats },
    }),
    'utf8',
  );
  return { configPath, outputDir };
}

function memorySink(fail = false): { sink: TextSink; text(): string } {
  let content = '';
  return {
    sink: {
      write(chunk: string): boolean {
        if (fail) {
          throw new Error('test sink failed with private details');
        }
        content += chunk;
        return true;
      },
    },
    text: () => content,
  };
}

function cliEnvironment(
  cwd: string,
  stdoutFail = false,
): {
  environment: CliEnvironment;
  stdout: ReturnType<typeof memorySink>;
  stderr: ReturnType<typeof memorySink>;
} {
  const stdout = memorySink(stdoutFail);
  const stderr = memorySink();
  return {
    environment: {
      cwd,
      env: { SECRET_TEST_VALUE: 'must-not-leak' },
      stdout: stdout.sink,
      stderr: stderr.sink,
    },
    stdout,
    stderr,
  };
}

function normalizedConfig(
  configPath: string,
  outputDir: string,
  formats: readonly ReportFormat[] = ['json', 'sarif'],
): NormalizedConfig {
  return {
    version: 1,
    configPath,
    pages: [
      {
        name: 'clean',
        url: 'https://example.test/clean',
        consoleIgnore: [],
      },
    ],
    viewports: [
      {
        name: 'mobile-320',
        width: 320,
        height: 844,
        deviceScaleFactor: 1,
      },
    ],
    timeoutMs: 1_000,
    outputDir,
    formats,
  };
}

function auditResult(
  formats: readonly ReportFormat[] = ['json', 'sarif'],
  complete = true,
): AuditResult {
  return {
    schemaVersion: 1,
    complete,
    tool: { name: 'viewport-sentinel', version: '0.1.0' },
    browser: {
      name: 'chromium',
      playwrightVersion: '1.62.1',
      version: complete ? '123.0.4567.8' : '<unavailable>',
    },
    config: {
      version: 1,
      pages: [
        {
          name: 'clean',
          url: 'https://example.test/clean',
          hasReadySelector: false,
          consoleIgnoreCount: 0,
        },
      ],
      viewports: [
        {
          name: 'mobile-320',
          width: 320,
          height: 844,
          deviceScaleFactor: 1,
        },
      ],
      timeoutMs: 1_000,
      formats,
    },
    combinations: {
      total: 1,
      completed: complete ? 1 : 0,
      failedReadiness: 0,
    },
    totals: {
      findingCount: 0,
      suppressedConsoleCount: 0,
      omittedFindingCount: 0,
      omittedByCombination: [],
    },
    findings: [],
  };
}

beforeAll(async () => {
  fixture = await startFixtureServer(fixturePort);
}, 30_000);

afterAll(async () => {
  await fixture.close();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('built CLI process', () => {
  it('keeps the executable thin, shebang-based, and ESM-compatible', async () => {
    const compiled = await readFile(cliPath, 'utf8');

    expect(compiled.startsWith('#!/usr/bin/env node\n')).toBe(true);
    const result = await spawnCli(['--version']);
    expect(result).toEqual({ code: 0, stdout: '0.1.1\n', stderr: '' });
  });

  it('prints exact help without requiring a config or launching Chromium', async () => {
    const emptyCwd = await temporaryDirectory('help');
    const result = await spawnCli(['--help'], emptyCwd);

    expect(result).toEqual({
      code: 0,
      stdout:
        'Usage: viewport-sentinel [options]\n\n' +
        'Options:\n' +
        '  --config <path>  JSON configuration file\n' +
        '  --output <dir>   Override report directory\n' +
        '  --github         Emit GitHub annotations and step summary\n' +
        '  --help           Show help\n' +
        '  --version        Show version\n',
      stderr: '',
    });
  });

  it('returns 0 for the clean matrix and writes exact terminal plus both reports', async () => {
    const { configPath, outputDir } = await fixtureConfig('clean');
    const result = await spawnCli(['--config', configPath]);

    expect(result).toEqual({
      code: 0,
      stdout: 'Viewport Sentinel: 0 findings (2/2 combinations completed)\n',
      stderr: '',
    });
    const json = JSON.parse(
      await readFile(join(outputDir, 'results.json'), 'utf8'),
    ) as AuditResult;
    const sarif = JSON.parse(
      await readFile(join(outputDir, 'results.sarif'), 'utf8'),
    ) as { runs?: { results?: unknown[] }[] };
    expect(json.complete).toBe(true);
    expect(json.totals.findingCount).toBe(0);
    expect(sarif.runs?.[0]?.results).toEqual([]);
  }, 60_000);

  it('returns 1 for the six-finding golden matrix after writing both reports', async () => {
    const { configPath, outputDir } = await fixtureConfig('golden');
    const result = await spawnCli(['--config', configPath]);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      'Viewport Sentinel: 6 findings (10/10 combinations completed)\n' +
        '  VS001 overflow/mobile-320 html: Document is 160px wider than the viewport\n' +
        '  VS002 overlap/mobile-320 #checkout: Fixed/sticky element #mobile-cover covers actionable #checkout\n' +
        '  VS003 picture/mobile-320 #product-image: Browser-selected image did not load and decode\n' +
        '  VS003 picture/desktop-1440 #product-image: Browser-selected image did not load and decode\n' +
        '  VS004 console/mobile-320 document: viewport-sentinel fixture error\n' +
        '  VS004 console/desktop-1440 document: viewport-sentinel fixture error\n',
    );
    const json = JSON.parse(
      await readFile(join(outputDir, 'results.json'), 'utf8'),
    ) as AuditResult;
    const sarif = JSON.parse(
      await readFile(join(outputDir, 'results.sarif'), 'utf8'),
    ) as { runs?: { results?: unknown[] }[] };
    expect(json.totals.findingCount).toBe(6);
    expect(sarif.runs?.[0]?.results).toHaveLength(6);
  }, 60_000);

  it('returns 1 with one VSRUN001 when a ready selector times out', async () => {
    const { configPath, outputDir } = await fixtureConfig('timeout');
    const result = await spawnCli(['--config', configPath]);

    expect(result).toEqual({
      code: 1,
      stdout:
        'Viewport Sentinel: 1 finding (0/1 combinations completed)\n' +
        '  VSRUN001 timeout/mobile-320 document: Page readiness failed at ready-selector\n',
      stderr: '',
    });
    const json = JSON.parse(
      await readFile(join(outputDir, 'results.json'), 'utf8'),
    ) as AuditResult;
    expect(json.findings.map(({ ruleId }) => ruleId)).toEqual(['VSRUN001']);
    expect(
      JSON.parse(await readFile(join(outputDir, 'results.sarif'), 'utf8')),
    ).toMatchObject({ runs: [{ results: [{ ruleId: 'VSRUN001' }] }] });
  }, 60_000);

  it.each([['json' as const], ['sarif' as const]])(
    'writes only the configured %s format',
    async (format) => {
      const { configPath, outputDir } = await fixtureConfig('clean', [format]);
      const result = await spawnCli(['--config', configPath, '--github']);

      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      await expect(
        readFile(join(outputDir, `results.${format}`)),
      ).resolves.toBeTruthy();
      const otherFormat = format === 'json' ? 'sarif' : 'json';
      await expect(
        readFile(join(outputDir, `results.${otherFormat}`)),
      ).rejects.toThrow();
    },
    60_000,
  );

  it('returns 2 for missing and malformed configs without echoing secret content', async () => {
    const directory = await temporaryDirectory('invalid-config');
    const missing = await spawnCli([
      '--config',
      join(directory, 'missing.json'),
    ]);
    const malformedPath = join(directory, 'malformed.json');
    await writeFile(
      malformedPath,
      '{"version":1,"apiKey":"top-secret","pages":',
      'utf8',
    );
    const malformed = await spawnCli(['--config', malformedPath]);

    expect(missing).toEqual({
      code: 2,
      stdout: '',
      stderr: 'Configuration error: Cannot parse config missing.json: Error\n',
    });
    expect(malformed).toEqual({
      code: 2,
      stdout: '',
      stderr:
        'Configuration error: Cannot parse config malformed.json: SyntaxError\n',
    });
    expect(`${missing.stderr}${malformed.stderr}`).not.toContain('top-secret');
  });
});

describe('runCli service', () => {
  it('resolves an existing default config from injected cwd and orders reports before terminal', async () => {
    const directory = await temporaryDirectory('default-config');
    const configPath = join(directory, 'viewport-sentinel.config.json');
    const outputDir = join(directory, 'reports');
    await writeFile(configPath, '{}', 'utf8');
    const config = normalizedConfig(configPath, outputDir);
    const result = auditResult();
    const order: string[] = [];
    const loadConfig = vi
      .fn<RunCliDependencies['loadConfig']>()
      .mockResolvedValue(config);
    const dependencies: RunCliDependencies = {
      ...defaultRunCliDependencies,
      loadConfig,
      auditConfig: vi.fn().mockResolvedValue(result),
      writeJsonReport: vi.fn().mockImplementation(() => {
        order.push('json');
        return Promise.resolve(join(outputDir, 'results.json'));
      }),
      writeSarifReport: vi.fn().mockImplementation(() => {
        order.push('sarif');
        return Promise.resolve(join(outputDir, 'results.sarif'));
      }),
      writeTerminalSummary: vi.fn().mockImplementation(() => {
        order.push('terminal');
      }),
    };
    const { environment, stderr } = cliEnvironment(directory);

    const cliResult = await runCli([], environment, dependencies);

    expect(loadConfig).toHaveBeenCalledWith(configPath, undefined);
    expect(order).toEqual(['json', 'sarif', 'terminal']);
    expect(stderr.text()).toBe('');
    expect(cliResult).toEqual({
      exitCode: 0,
      findingCount: 0,
      outputDir,
      jsonPath: join(outputDir, 'results.json'),
      sarifPath: join(outputDir, 'results.sarif'),
    });
  });

  it('returns 2 before audit when injected cwd has no default config', async () => {
    const directory = await temporaryDirectory('missing-default');
    const { environment, stdout, stderr } = cliEnvironment(directory);
    const audit = vi.fn<RunCliDependencies['auditConfig']>();

    const result = await runCli([], environment, {
      ...defaultRunCliDependencies,
      auditConfig: audit,
    });

    expect(result).toEqual({ exitCode: 2, findingCount: 0 });
    expect(audit).not.toHaveBeenCalled();
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe(
      'Configuration error: Config file not found; pass --config <path>\n',
    );
  });

  it('normalizes config failures to one URL-sanitized stderr line', async () => {
    const directory = await temporaryDirectory('private-config-error');
    const { environment, stdout, stderr } = cliEnvironment(directory);

    const result = await runCli(['--config', 'config.json'], environment, {
      ...defaultRunCliDependencies,
      loadConfig: vi
        .fn()
        .mockRejectedValue(
          new ConfigError(
            'Bad config\nhttps://user:pass@example.test/?token=secret#private',
          ),
        ),
    });

    expect(result).toEqual({ exitCode: 2, findingCount: 0 });
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe(
      'Configuration error: Bad config https://example.test/\n',
    );
    expect(stderr.text().trim().split('\n')).toHaveLength(1);
  });

  it.each([
    [['--help'], 'Usage: viewport-sentinel [options]\n', 0],
    [['--version'], '0.1.1\n', 0],
  ] as const)(
    'handles %j through injected sinks without loading config',
    async (argv, prefix, exitCode) => {
      const directory = await temporaryDirectory('command');
      const { environment, stdout, stderr } = cliEnvironment(directory);
      const loadConfig = vi.fn<RunCliDependencies['loadConfig']>();
      const audit = vi.fn<RunCliDependencies['auditConfig']>();

      const result = await runCli(argv, environment, {
        ...defaultRunCliDependencies,
        loadConfig,
        auditConfig: audit,
      });

      expect(result.exitCode).toBe(exitCode);
      expect(result.findingCount).toBe(0);
      expect(stdout.text()).toMatch(prefix);
      expect(stderr.text()).toBe('');
      expect(loadConfig).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    },
  );

  it('writes configured partial reports after browser launch failure and emits one safe line', async () => {
    const directory = await temporaryDirectory('browser-failure');
    const configPath = join(directory, 'config.json');
    const outputDir = join(directory, 'reports');
    const config = normalizedConfig(configPath, outputDir);
    const partial = auditResult(['json', 'sarif'], false);
    const { environment, stdout, stderr } = cliEnvironment(directory);

    const result = await runCli(
      ['--config', basename(configPath)],
      environment,
      {
        ...defaultRunCliDependencies,
        loadConfig: vi.fn().mockResolvedValue(config),
        auditConfig: vi
          .fn()
          .mockRejectedValue(
            new AuditExecutionError(
              partial,
              'Audit execution failed during browser launch',
              'Browser launch failed with top-secret details',
            ),
          ),
      },
    );

    expect(result).toEqual({
      exitCode: 2,
      findingCount: 0,
      outputDir,
      jsonPath: join(outputDir, 'results.json'),
      sarifPath: join(outputDir, 'results.sarif'),
    });
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe(
      'Audit could not start: install Chromium with "npx playwright install chromium" and retry.\n',
    );
    expect(stderr.text()).not.toContain('top-secret');
    const json = JSON.parse(
      await readFile(join(outputDir, 'results.json'), 'utf8'),
    ) as AuditResult;
    expect(json.complete).toBe(false);
    expect(
      JSON.parse(await readFile(join(outputDir, 'results.sarif'), 'utf8')),
    ).toMatchObject({ runs: [{ properties: { complete: false } }] });
  });

  it('preserves a successful JSON path and attempts every partial reporter when SARIF fails', async () => {
    const directory = await temporaryDirectory('sarif-failure');
    const configPath = join(directory, 'config.json');
    const outputDir = join(directory, 'reports');
    const config = normalizedConfig(configPath, outputDir);
    const complete = auditResult();
    const partial = { ...complete, complete: false };
    const jsonPath = join(outputDir, 'results.json');
    const jsonWriter = vi.fn().mockResolvedValue(jsonPath);
    const sarifWriter = vi
      .fn()
      .mockRejectedValue(
        new AuditExecutionError(
          partial,
          'Audit SARIF report writing failed',
          'SARIF reporter failed with top-secret details',
        ),
      );
    const terminal = vi.fn();
    const { environment, stdout, stderr } = cliEnvironment(directory);

    const result = await runCli(['--config', 'config.json'], environment, {
      ...defaultRunCliDependencies,
      loadConfig: vi.fn().mockResolvedValue(config),
      auditConfig: vi.fn().mockResolvedValue(complete),
      writeJsonReport: jsonWriter,
      writeSarifReport: sarifWriter,
      writeTerminalSummary: terminal,
    });

    expect(result).toEqual({
      exitCode: 2,
      findingCount: 0,
      outputDir,
      jsonPath,
    });
    expect(jsonWriter).toHaveBeenCalledTimes(2);
    expect(jsonWriter.mock.calls[1]?.[0]).toMatchObject({ complete: false });
    expect(sarifWriter).toHaveBeenCalledTimes(2);
    expect(sarifWriter.mock.calls[1]?.[0]).toMatchObject({ complete: false });
    expect(terminal).not.toHaveBeenCalled();
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe(
      'Report writing failed: check the output directory permissions and retry.\n',
    );
    expect(stderr.text()).not.toContain('top-secret');
  });

  it('marks reports incomplete and retains both paths if the terminal sink fails later', async () => {
    const directory = await temporaryDirectory('terminal-failure');
    const configPath = join(directory, 'config.json');
    const outputDir = join(directory, 'reports');
    const config = normalizedConfig(configPath, outputDir);
    const complete = auditResult();
    const jsonPath = join(outputDir, 'results.json');
    const sarifPath = join(outputDir, 'results.sarif');
    const jsonWriter = vi.fn().mockResolvedValue(jsonPath);
    const sarifWriter = vi.fn().mockResolvedValue(sarifPath);
    const { environment, stdout, stderr } = cliEnvironment(directory, true);

    const result = await runCli(['--config', 'config.json'], environment, {
      ...defaultRunCliDependencies,
      loadConfig: vi.fn().mockResolvedValue(config),
      auditConfig: vi.fn().mockResolvedValue(complete),
      writeJsonReport: jsonWriter,
      writeSarifReport: sarifWriter,
      writeTerminalSummary: defaultRunCliDependencies.writeTerminalSummary,
    });

    expect(result).toEqual({
      exitCode: 2,
      findingCount: 0,
      outputDir,
      jsonPath,
      sarifPath,
    });
    expect(jsonWriter).toHaveBeenCalledTimes(2);
    expect(jsonWriter.mock.calls[1]?.[0]).toMatchObject({ complete: false });
    expect(sarifWriter).toHaveBeenCalledTimes(2);
    expect(sarifWriter.mock.calls[1]?.[0]).toMatchObject({ complete: false });
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe(
      'Audit failed: an unexpected internal error occurred; partial reports were written when possible.\n',
    );
  });
});
