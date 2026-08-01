import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../../src/cli/parse-args.js';

describe('parseCliArgs', () => {
  it('parses every run option without applying filesystem defaults', () => {
    expect(
      parseCliArgs(['--config', 'x.json', '--output', 'out', '--github']),
    ).toEqual({
      command: 'run',
      config: 'x.json',
      output: 'out',
      github: true,
    });
    expect(parseCliArgs([])).toEqual({ command: 'run', github: false });
  });

  it.each([
    [['--help'], { command: 'help' }],
    [['--version'], { command: 'version' }],
  ] as const)('parses exclusive command %j', (argv, expected) => {
    expect(parseCliArgs(argv)).toEqual(expected);
  });

  it.each([
    [['--config'], 'Option --config requires a value'],
    [['--config', ''], 'Option --config requires a value'],
    [['--output'], 'Option --output requires a value'],
    [['--output', ''], 'Option --output requires a value'],
    [['--unknown'], 'Unknown option'],
    [['config.json'], 'Positional arguments are not supported'],
    [['--github=true'], 'Option --github does not take a value'],
  ] as const)('rejects invalid arity or syntax for %j', (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(message);
  });

  it.each([
    ['--config', ['--config', 'a.json', '--config', 'b.json']],
    ['--output', ['--output', 'a', '--output', 'b']],
    ['--github', ['--github', '--github']],
    ['--help', ['--help', '--help']],
    ['--version', ['--version', '--version']],
  ])('rejects duplicate %s options', (option, argv) => {
    expect(() => parseCliArgs(argv)).toThrow(
      `Option ${option} may only be specified once`,
    );
  });

  it.each([
    ['help plus version', ['--help', '--version']],
    ['help plus config', ['--help', '--config', 'x.json']],
    ['help plus output', ['--help', '--output', 'out']],
    ['help plus github', ['--help', '--github']],
    ['version plus config', ['--version', '--config', 'x.json']],
    ['version plus output', ['--version', '--output', 'out']],
    ['version plus github', ['--version', '--github']],
  ])('keeps help and version exclusive: %s', (_label, argv) => {
    expect(() => parseCliArgs(argv)).toThrow(
      '--help and --version must be used alone',
    );
  });
});
