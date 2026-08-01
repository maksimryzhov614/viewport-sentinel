import * as core from '@actions/core';
import { normalizeMessage } from '../core/privacy.js';
const MAX_DISPLAYED_FINDINGS = 50;
const SUMMARY_FILE_PATH_PROPERTY = '_filePath';
let summaryStateQueue = Promise.resolve();
function escapeHtml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
function safeHtml(value) {
    return escapeHtml(normalizeMessage(value));
}
function annotationMessage(finding) {
    return (`${finding.ruleId} ${normalizeMessage(finding.page)}/` +
        `${normalizeMessage(finding.viewport.name)} ` +
        `${normalizeMessage(finding.selector)}: ${normalizeMessage(finding.message)}`);
}
function groupedFindings(findings) {
    const pages = new Map();
    for (const finding of findings) {
        let viewports = pages.get(finding.page);
        if (viewports === undefined) {
            viewports = new Map();
            pages.set(finding.page, viewports);
        }
        let viewportFindings = viewports.get(finding.viewport.name);
        if (viewportFindings === undefined) {
            viewportFindings = [];
            viewports.set(finding.viewport.name, viewportFindings);
        }
        viewportFindings.push(finding);
    }
    return pages;
}
function summaryHtml(result) {
    const displayedFindings = result.findings.slice(0, MAX_DISPLAYED_FINDINGS);
    const lines = [
        '<h1>Viewport Sentinel</h1>',
        '<p>',
        `Total findings: ${String(result.totals.findingCount)}<br>`,
        `Suppressed console messages: ${String(result.totals.suppressedConsoleCount)}<br>`,
        `Omitted findings: ${String(result.totals.omittedFindingCount)}`,
        '</p>',
    ];
    if (result.totals.findingCount === 0) {
        lines.push('<p>No findings detected.</p>');
    }
    else {
        for (const [page, viewports] of groupedFindings(displayedFindings)) {
            lines.push(`<h2>Page: ${safeHtml(page)}</h2>`);
            for (const [viewport, findings] of viewports) {
                lines.push(`<h3>Viewport: ${safeHtml(viewport)}</h3>`, '<ul>');
                for (const finding of findings) {
                    lines.push('<li>' +
                        `<strong>${safeHtml(finding.ruleId)}</strong> ` +
                        `<code>${safeHtml(finding.selector)}</code>: ` +
                        `${safeHtml(finding.message)}</li>`);
                }
                lines.push('</ul>');
            }
        }
    }
    const additionalFindingCount = Math.max(0, result.findings.length - displayedFindings.length);
    if (additionalFindingCount > 0) {
        lines.push(`<p>${String(additionalFindingCount)} additional findings not shown.</p>`);
    }
    return `${lines.join('\n')}\n`;
}
async function withExclusiveSummaryState(operation) {
    let release = () => undefined;
    const previous = summaryStateQueue;
    summaryStateQueue = new Promise((resolveQueue) => {
        release = resolveQueue;
    });
    await previous;
    try {
        await operation();
    }
    finally {
        release();
    }
}
async function writeInjectedSummary(html, summaryPath) {
    await withExclusiveSummaryState(async () => {
        const previousEnvironmentPath = process.env.GITHUB_STEP_SUMMARY;
        const hadCachedPath = Reflect.has(core.summary, SUMMARY_FILE_PATH_PROPERTY);
        const previousCachedPath = Reflect.get(core.summary, SUMMARY_FILE_PATH_PROPERTY);
        const previousBuffer = core.summary.stringify();
        process.env.GITHUB_STEP_SUMMARY = summaryPath;
        Reflect.deleteProperty(core.summary, SUMMARY_FILE_PATH_PROPERTY);
        core.summary.emptyBuffer().addRaw(html);
        try {
            await core.summary.write();
        }
        finally {
            core.summary.emptyBuffer().addRaw(previousBuffer);
            if (hadCachedPath) {
                Reflect.set(core.summary, SUMMARY_FILE_PATH_PROPERTY, previousCachedPath);
            }
            else {
                Reflect.deleteProperty(core.summary, SUMMARY_FILE_PATH_PROPERTY);
            }
            if (previousEnvironmentPath === undefined) {
                delete process.env.GITHUB_STEP_SUMMARY;
            }
            else {
                process.env.GITHUB_STEP_SUMMARY = previousEnvironmentPath;
            }
        }
    });
}
export async function writeGitHubReport(result, relativeConfigPath, environment) {
    for (const finding of result.findings.slice(0, MAX_DISPLAYED_FINDINGS)) {
        core.error(annotationMessage(finding), {
            file: relativeConfigPath,
            startLine: 1,
            endLine: 1,
            title: finding.ruleId,
        });
    }
    const summaryPath = environment.GITHUB_STEP_SUMMARY?.trim();
    if (!summaryPath) {
        core.warning('GitHub step summary is unavailable; annotations were emitted.');
        return;
    }
    await writeInjectedSummary(summaryHtml(result), summaryPath);
}
//# sourceMappingURL=github.js.map