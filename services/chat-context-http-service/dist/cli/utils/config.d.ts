/**
 * Configuration Management
 */
import type { CLIConfig } from '../types.js';
/**
 * Load configuration from file
 */
export declare function loadConfig(): CLIConfig;
/**
 * Save configuration to file
 */
export declare function saveConfig(config: CLIConfig): void;
/**
 * Get a specific config value
 */
export declare function getConfigValue(key: keyof CLIConfig): any;
/**
 * Set a specific config value
 */
export declare function setConfigValue(key: keyof CLIConfig, value: any): void;
/**
 * Reset configuration to defaults
 */
export declare function resetConfig(): void;
/**
 * Get configuration file path
 */
export declare function getConfigPath(): string;
//# sourceMappingURL=config.d.ts.map