import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalStringify } from '../core/canonical.js';
import { AuditExecutionError } from '../runner/audit-config.js';
function incompleteResult(result) {
    return result.complete ? { ...result, complete: false } : result;
}
export async function writeJsonReport(result, outputDir) {
    const temporaryPath = join(outputDir, 'results.json.tmp');
    const reportPath = join(outputDir, 'results.json');
    try {
        await mkdir(outputDir, { recursive: true });
        await writeFile(temporaryPath, canonicalStringify(result), 'utf8');
        await rename(temporaryPath, reportPath);
        return reportPath;
    }
    catch {
        try {
            await rm(temporaryPath, { force: true });
        }
        catch {
            // Cleanup is best-effort; the original reporter failure remains decisive.
        }
        throw new AuditExecutionError(incompleteResult(result), 'Audit JSON report writing failed', 'JSON reporter failed');
    }
}
//# sourceMappingURL=json.js.map