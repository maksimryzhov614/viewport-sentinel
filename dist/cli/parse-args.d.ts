export type ParsedCliArgs = {
    command: 'help';
} | {
    command: 'version';
} | {
    command: 'run';
    config?: string;
    output?: string;
    github: boolean;
};
export declare function parseCliArgs(argv: readonly string[]): ParsedCliArgs;
//# sourceMappingURL=parse-args.d.ts.map