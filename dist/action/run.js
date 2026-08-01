import * as core from '@actions/core';
import { runCli } from '../cli/run-cli.js';
function failureResult() {
    return { exitCode: 2, findingCount: 0 };
}
function setOutputs(result) {
    core.setOutput('exit-code', result.exitCode);
    core.setOutput('finding-count', result.findingCount);
    core.setOutput('output-dir', result.outputDir ?? '');
    core.setOutput('report-json', result.jsonPath ?? '');
    core.setOutput('report-sarif', result.sarifPath ?? '');
}
function annotateWrapperFailure() {
    try {
        core.error('Viewport Sentinel Action failed unexpectedly; saved outputs indicate an internal failure.');
    }
    catch {
        // Annotation output is best-effort when the process output channel is broken.
    }
}
async function main() {
    let result = failureResult();
    let wrapperFailed = false;
    try {
        const inputConfig = core.getInput('config', { required: true });
        const inputOutput = core.getInput('output').trim();
        result = await runCli([
            '--config',
            inputConfig,
            ...(inputOutput === '' ? [] : ['--output', inputOutput]),
            '--github',
        ]);
    }
    catch {
        wrapperFailed = true;
    }
    try {
        setOutputs(result);
    }
    catch {
        wrapperFailed = true;
        try {
            setOutputs(failureResult());
        }
        catch {
            // A broken GITHUB_OUTPUT channel cannot persist even the safe fallback.
        }
    }
    finally {
        if (wrapperFailed) {
            annotateWrapperFailure();
        }
        process.exitCode = 0;
    }
}
await main();
//# sourceMappingURL=run.js.map