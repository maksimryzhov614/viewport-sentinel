import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { ConfigInputSchema } from './schema.js';
export class ConfigError extends Error {
    name = 'ConfigError';
}
function errorName(error) {
    return error instanceof Error ? error.name : 'UnknownError';
}
function issuePath(path) {
    return path.length === 0 ? 'config' : path.map(String).join('.');
}
function formatIssues(issues) {
    return issues
        .map((issue) => `${issuePath(issue.path)}: ${issue.message}`)
        .join('; ');
}
function normalizePage(page, baseUrl) {
    let url = page.url;
    if (url === undefined && page.path !== undefined && baseUrl !== undefined) {
        url = new URL(page.path, baseUrl).toString();
    }
    if (url === undefined) {
        throw new ConfigError('Page location validation failed');
    }
    const normalized = {
        name: page.name,
        url,
        consoleIgnore: page.consoleIgnore ?? [],
    };
    if (page.readySelector !== undefined) {
        normalized.readySelector = page.readySelector;
    }
    return normalized;
}
function normalizeViewport(viewport) {
    return {
        name: viewport.name,
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    };
}
function normalizeConfig(config, absolutePath, outputOverride) {
    const output = config.output ?? {
        dir: 'artifacts/viewport-sentinel',
        formats: ['json', 'sarif'],
    };
    const outputDir = resolve(dirname(absolutePath), outputOverride ?? output.dir ?? 'artifacts/viewport-sentinel');
    const formats = output.formats ?? ['json', 'sarif'];
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
export async function loadConfig(configPath, outputOverride) {
    const absolutePath = resolve(configPath);
    let raw;
    try {
        raw = JSON.parse(await readFile(absolutePath, 'utf8'));
    }
    catch (error) {
        throw new ConfigError(`Cannot parse config ${basename(absolutePath)}: ${errorName(error)}`);
    }
    const parsed = ConfigInputSchema.safeParse(raw);
    if (!parsed.success) {
        throw new ConfigError(formatIssues(parsed.error.issues));
    }
    return normalizeConfig(parsed.data, absolutePath, outputOverride);
}
//# sourceMappingURL=load-config.js.map