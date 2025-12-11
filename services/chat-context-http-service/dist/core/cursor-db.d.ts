/**
 * Cursor Database Access
 *
 * Safely reads from Cursor's SQLite database in read-only mode.
 * Supports both legacy globalStorage and new workspace-specific storage.
 */
import type { ComposerData, BubbleData } from './types.js';
/**
 * Options for database connection
 */
interface DBOptions {
    readonly?: boolean;
    timeout?: number;
    maxRetries?: number;
}
export declare class CursorDB {
    private dbPath;
    private db;
    private readonly options;
    constructor(dbPath: string, options?: DBOptions);
    /**
     * Connect to database with retry logic
     */
    private connect;
    /**
     * List all composer session IDs
     * Supports both old format (individual keys) and new format (single JSON object)
     */
    listComposerIds(limit?: number): string[];
    /**
     * Get all sessions with their last updated timestamps (efficient bulk check)
     * Returns map of sessionId -> lastUpdatedAt timestamp (milliseconds since epoch)
     * Supports both old format (individual keys) and new format (single JSON object)
     */
    getAllSessionTimestamps(limit?: number): Map<string, number>;
    /**
     * Get composer data for a session
     * Supports both old format (individual keys) and new format (single JSON object)
     */
    getComposerData(composerId: string): ComposerData | null;
    /**
     * Get bubble data for a specific message
     */
    getBubbleData(composerId: string, bubbleId: string): BubbleData | null;
    /**
     * Get all bubbles for a session
     */
    getSessionBubbles(composerId: string): BubbleData[];
    /**
     * Check if database is connected
     */
    isConnected(): boolean;
    /**
     * Close database connection
     */
    close(): void;
}
/**
 * Aggregated Cursor Database Access
 *
 * Reads from ALL Cursor databases (both globalStorage and all workspaceStorage).
 * This handles Cursor's migration from centralized to workspace-specific storage.
 */
export declare class AggregatedCursorDB {
    private dbInstances;
    private dbPaths;
    constructor(options?: DBOptions);
    /**
     * List all composer session IDs from ALL databases
     */
    listComposerIds(limit?: number): string[];
    /**
     * Get all sessions with their timestamps from ALL databases
     */
    getAllSessionTimestamps(limit?: number): Map<string, number>;
    /**
     * Get composer data for a session (searches ALL databases)
     */
    getComposerData(composerId: string): ComposerData | null;
    /**
     * Get all bubbles for a session (searches ALL databases)
     */
    getSessionBubbles(composerId: string): BubbleData[];
    /**
     * Get bubble data for a specific message (searches ALL databases)
     */
    getBubbleData(composerId: string, bubbleId: string): BubbleData | null;
    /**
     * Close all database connections
     */
    close(): void;
    /**
     * Get number of databases being accessed
     */
    getDatabaseCount(): number;
    /**
     * Get all database paths
     */
    getDatabasePaths(): string[];
}
export {};
//# sourceMappingURL=cursor-db.d.ts.map