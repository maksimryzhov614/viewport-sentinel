import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { z } from 'zod';
import type {
  NormalizedConfig,
  NormalizedPageSpec,
  ReportFormat,
  ViewportSpec,
} from '../model/types.js';
import { ConfigInputSchema } from './schema.js';

type ConfigInput = z.output<typeof ConfigInputSchema>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function issuePath(path: PropertyKey[]): string {
  return path.length === 0 ? 'config' : path.map(String).join('.');
}

function formatIssues(issues: z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => `${issuePath(issue.path)}: ${issue.message}`)
    .join('; ');
}

function normalizePage(
  page: ConfigInput['pages'][number],
  baseUrl: string | undefined,
): NormalizedPageSpec {
  let url = page.url;
  if (url === undefined && page.path !== undefined && baseUrl !== undefined) {
    url = new URL(page.path, baseUrl).toString();
  }
  if (url === undefined) {
    throw new ConfigError('Page location validation failed');
  }

  const normalized: NormalizedPageSpec = {
    name: page.name,
    url,
    consoleIgnore: page.consoleIgnore ?? [],
  };

  if (page.readySelector !== undefined) {
    normalized.readySelector = page.readySelector;
  }

  return normalized;
}

function normalizeViewport(
  viewport: ConfigInput['viewports'][number],
): ViewportSpec {
  return {
    name: viewport.name,
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
  };
}

function normalizeConfig(
  config: ConfigInput,
  absolutePath: string,
  outputOverride: string | undefined,
): NormalizedConfig {
  const output = config.output ?? {
    dir: 'artifacts/viewport-sentinel',
    formats: ['json', 'sarif'] as const,
  };
  const outputDir = resolve(
    dirname(absolutePath),
    outputOverride ?? output.dir ?? 'artifacts/viewport-sentinel',
  );
  const formats: readonly ReportFormat[] = output.formats ?? ['json', 'sarif'];

  return {
    version: 1,
    configPath: absolutePath,
    pages: config.pages.map((page) => normalizePage(page, config.baseUrl)),
    viewports: config.viewports.map(normalizeViewport),
    timeoutMs: config.timeoutMs ?? 10_000,
    outputDir,
    formats,
  };
}

export async function loadConfig(
  configPath: string,
  outputOverride?: string,
): Promise<NormalizedConfig> {
  const absolutePath = resolve(configPath);
  let raw: unknown;

  try {
    raw = JSON.parse(await readFile(absolutePath, 'utf8')) as unknown;
  } catch (error) {
    throw new ConfigError(
      `Cannot parse config ${basename(absolutePath)}: ${errorName(error)}`,
    );
  }

  const parsed = ConfigInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(formatIssues(parsed.error.issues));
  }

  return normalizeConfig(parsed.data, absolutePath, outputOverride);
}
