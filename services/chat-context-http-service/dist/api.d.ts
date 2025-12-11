/**
 * Core API - Main Interface
 *
 * High-level API that orchestrates all core modules
 */
import { CursorDB } from './cursor-db.js';
import { MetadataDB } from './metadata-db.js';
import { type ParseOptions } from './message-parser.js';
import type { SessionMetadata, SessionWithMessages, ProjectInfo } from './types.js';
/**
 * Options for listing sessions
 */
export interface ListSessionsOptions {
    /** Filter by project path */
    projectPath?: string;
    /** Only include sessions with tags */
    taggedOnly?: boolean;
    /** Limit number of results */
    limit?: number;
    /** Filter by specific tag */
    tag?: string;
    /** Sort order (newest first by default) */
    sortBy?: 'newest' | 'oldest' | 'most_messages';
}
/**
 * Options for searching sessions
 */
export interface SearchSessionsOptions {
    /** Search query (searches in first message preview) */
    query: string;
    /** Limit to specific project */
    projectPath?: string;
    /** Only search sessions with tags */
    taggedOnly?: boolean;
    /** Maximum results */
    limit?: number;
    /** Case sensitive search */
    caseSensitive?: boolean;
}
/**
 * Options for getting a session
 */
export interface GetSessionOptions {
    /** Parse options for messages */
    parseOptions?: ParseOptions;
    /** Load full messages or just metadata */
    includeMessages?: boolean;
}
/**
 * Main API for Cursor Context Retrieval
 *
 * High-level interface that orchestrates CursorDB and MetadataDB
 */
export declare class CursorContext {
    private cursorDB;
    private metadataDB;
    private autoSync;
    /**
     * Create a new CursorContext instance
     *
     * @param cursorDBPath - Path to Cursor's database (default: auto-detect)
     * @param metadataDBPath - Path to metadata database (default: ~/.cursor-context/metadata.db)
     * @param autoSync - Automatically sync metadata when accessing sessions (default: true)
     */
    constructor(cursorDBPath?: string, metadataDBPath?: string, autoSync?: boolean);
    /**
     * List sessions with optional filtering
     */
    listSessions(options?: ListSessionsOptions): Promise<SessionMetadata[]>;
    /**
     * Get a single session by ID or nickname
     */
    getSession(idOrNickname: string, options?: GetSessionOptions): Promise<SessionWithMessages>;
    /**
     * Search sessions by content
     */
    searchSessions(options: SearchSessionsOptions): Promise<SessionMetadata[]>;
    /**
     * Set a nickname for a session
     */
    setNickname(sessionId: string, nickname: string): Promise<void>;
    /**
     * Add a tag to a session
     */
    addTag(sessionId: string, tag: string): Promise<void>;
    /**
     * Remove a tag from a session
     */
    removeTag(sessionId: string, tag: string): Promise<void>;
    /**
     * Get all available projects
     */
    getProjects(): ProjectInfo[];
    /**
     * Get all available tags
     */
    getTags(): Array<{
        tag: string;
        count: number;
    }>;
    /**
     * Get statistics about the database
     */
    getStats(): {
        totalSessionsInCursor: number;
        totalSessionsWithMetadata: number;
        sessionsWithNicknames: number;
        sessionsWithTags: number;
        sessionsWithProjects: number;
        totalTags: number;
        totalProjects: number;
    };
    /**
     * Sync a session from Cursor DB to Metadata DB
     *
     * @internal
     */
    private syncSession;
    /**
     * Sync multiple sessions from Cursor DB to Metadata DB
     */
    syncSessions(limit?: number): Promise<number>;
    /**
     * Close database connections
     */
    close(): void;
    /**
     * Get the underlying CursorDB instance (for advanced use)
     */
    getCursorDB(): CursorDB;
    /**
     * Get the underlying MetadataDB instance (for advanced use)
     */
    getMetadataDB(): MetadataDB;
    /**
     * Helper to sort and limit sessions
     */
    private sortAndLimit;
}
//# sourceMappingURL=api.d.ts.map