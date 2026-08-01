#!/usr/bin/env node
import { runCli } from './cli/run-cli.js';
const result = await runCli(process.argv.slice(2));
process.exitCode = result.exitCode;
//# sourceMappingURL=cli.js.map