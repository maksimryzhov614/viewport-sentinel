export interface FixtureServer {
    readonly url: string;
    close(): Promise<void>;
}
export declare function startFixtureServer(port?: number): Promise<FixtureServer>;
//# sourceMappingURL=server.d.ts.map