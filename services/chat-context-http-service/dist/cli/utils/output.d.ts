/**
 * Output Formatters
 */
import type { SessionMetadata } from '../../core/types.js';
/**
 * Check if colors should be used
 */
export declare function useColors(): boolean;
/**
 * Format session list as table
 */
export declare function formatAsTable(sessions: SessionMetadata[]): string;
/**
 * Format session list as compact
 */
export declare function formatAsCompact(sessions: SessionMetadata[]): string;
/**
 * Format session list as JSON
 */
export declare function formatAsJSON(data: any): string;
/**
 * Format a single session based on format
 */
export declare function formatSession(session: any, format: 'json' | 'markdown' | 'table' | 'compact'): string;
/**
 * Print error message
 */
export declare function printError(message: string): void;
/**
 * Print success message
 */
export declare function printSuccess(message: string): void;
/**
 * Print info message
 */
export declare function printInfo(message: string): void;
/**
 * Print warning message
 */
export declare function printWarning(message: string): void;
/**
 * Format statistics as table
 */
export declare function formatStatsTable(stats: any): string;
/**
 * Format projects as table
 */
export declare function formatProjectsTable(projects: Array<{
    path: string;
    name: string;
    session_count: number;
}>): string;
/**
 * Format tags as table
 */
export declare function formatTagsTable(tags: Array<{
    tag: string;
    count: number;
}>): string;
//# sourceMappingURL=output.d.ts.map