import * as core from '@actions/core';
import { runCli } from '../cli/run-cli.js';
import type { CliRunResult } from '../model/types.js';

function failureResult(): CliRunResult {
  return { exitCode: 2, findingCount: 0 };
}

function setOutputs(result: CliRunResult): void {
  core.setOutput('exit-code', result.exitCode);
  core.setOutput('finding-count', result.findingCount);
  core.setOutput('output-dir', result.outputDir ?? '');
  core.setOutput('report-json', result.jsonPath ?? '');
  core.setOutput('report-sarif', result.sarifPath ?? '');
}

async function main(): Promise<void> {
  let result = failureResult();

  try {
    const inputConfig = core.getInput('config', { required: true });
    const inputOutput = core.getInput('output').trim();
    result = await runCli([
      '--config',
      inputConfig,
      ...(inputOutput === '' ? [] : ['--output', inputOutput]),
      '--github',
    ]);
  } catch {
    core.error(
      'Viewport Sentinel Action failed unexpectedly; saved outputs indicate an internal failure.',
    );
  }

  setOutputs(result);
  process.exitCode = 0;
}

await main();
