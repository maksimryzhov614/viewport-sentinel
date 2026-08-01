import { parseArgs } from 'node:util';
import { ConfigError } from '../config/load-config.js';

export type ParsedCliArgs =
  | { command: 'help' }
  | { command: 'version' }
  | {
      command: 'run';
      config?: string;
      output?: string;
      github: boolean;
    };

const optionKinds = {
  '--config': 'string',
  '--output': 'string',
  '--github': 'boolean',
  '--help': 'boolean',
  '--version': 'boolean',
} as const;

type OptionName = keyof typeof optionKinds;

function optionName(token: string): string {
  const equalsIndex = token.indexOf('=');
  return equalsIndex === -1 ? token : token.slice(0, equalsIndex);
}

function validateTokens(argv: readonly string[]): void {
  const counts = new Map<OptionName, number>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (!token.startsWith('--')) {
      throw new ConfigError('Positional arguments are not supported');
    }

    const name = optionName(token);
    if (!(name in optionKinds)) {
      throw new ConfigError('Unknown option');
    }
    const typedName = name as OptionName;
    const count = (counts.get(typedName) ?? 0) + 1;
    counts.set(typedName, count);
    if (count > 1) {
      throw new ConfigError(`Option ${typedName} may only be specified once`);
    }

    const hasInlineValue = token.includes('=');
    if (optionKinds[typedName] === 'boolean') {
      if (hasInlineValue) {
        throw new ConfigError(`Option ${typedName} does not take a value`);
      }
      continue;
    }

    if (hasInlineValue) {
      if (token.endsWith('=')) {
        throw new ConfigError(`Option ${typedName} requires a value`);
      }
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new ConfigError(`Option ${typedName} requires a value`);
    }
    index += 1;
  }
}

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  validateTokens(argv);

  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      config: { type: 'string' },
      output: { type: 'string' },
      github: { type: 'boolean' },
      help: { type: 'boolean' },
      version: { type: 'boolean' },
    },
  });

  if (values.help === true || values.version === true) {
    if (argv.length !== 1) {
      throw new ConfigError('--help and --version must be used alone');
    }
    return values.help === true ? { command: 'help' } : { command: 'version' };
  }

  const result: Extract<ParsedCliArgs, { command: 'run' }> = {
    command: 'run',
    github: values.github ?? false,
  };
  if (values.config !== undefined) {
    result.config = values.config;
  }
  if (values.output !== undefined) {
    result.output = values.output;
  }
  return result;
}
