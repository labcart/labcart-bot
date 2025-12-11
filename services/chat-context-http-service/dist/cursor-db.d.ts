/**
 * Cursor Database Access
 *
 * Safely reads from Cursor's SQLite database in read-only mode.
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
     */
    listComposerIds(limit?: number): string[];
    /**
     * Get composer data for a session
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
export {};
//# sourceMappingURL=cursor-db.d.ts.map