import { normalizeMessage } from '../core/privacy.js';
export function writeTerminalSummary(result, sink) {
    const findingCount = result.totals.findingCount;
    const findingLabel = findingCount === 1 ? 'finding' : 'findings';
    const lines = [
        `Viewport Sentinel: ${String(findingCount)} ${findingLabel} (${String(result.combinations.completed)}/${String(result.combinations.total)} combinations completed)`,
    ];
    for (const finding of result.findings) {
        lines.push(`  ${finding.ruleId} ${normalizeMessage(finding.page)}/${normalizeMessage(finding.viewport.name)} ${normalizeMessage(finding.selector)}: ${normalizeMessage(finding.message)}`);
    }
    sink.write(`${lines.join('\n')}\n`);
}
//# sourceMappingURL=terminal.js.map