import type { NormalizedConfig } from '../model/types.js';
export declare class ConfigError extends Error {
    readonly name = "ConfigError";
}
export declare function loadConfig(configPath: string, outputOverride?: string): Promise<NormalizedConfig>;
//# sourceMappingURL=load-config.d.ts.map