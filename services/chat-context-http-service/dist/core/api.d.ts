/**
 * Core API - Main Interface
 *
 * High-level API that orchestrates all core modules
 */
import { AggregatedCursorDB } from './cursor-db.js';
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
    /** Force sync before listing (default: auto-sync if >5min stale) */
    syncFirst?: boolean;
    /** Filter by source (cursor, claude, or all) */
    source?: 'cursor' | 'claude' | 'all';
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
 * High-level interface that orchestrates CursorDB, ClaudeCodeDB and MetadataDB
 */
export declare class CursorContext {
    private cursorDB;
    private claudeCodeDB;
    private metadataDB;
    private autoSync;
    private autoSyncLimit;
    private lastSyncTime;
    private readonly STALE_THRESHOLD_MS;
    /**
     * Create a new CursorContext instance
     *
     * @param metadataDBPath - Path to metadata database (default: ~/.cursor-context/metadata.db)
     * @param autoSync - Automatically sync metadata when accessing sessions (default: true)
     * @param autoSyncLimit - Maximum number of sessions to check during auto-sync (default: 100000)
     * @param claudeProjectsPath - Path to Claude Code projects (default: ~/.claude/projects)
     */
    constructor(metadataDBPath?: string, autoSync?: boolean, autoSyncLimit?: number, claudeProjectsPath?: string);
    /**
     * Check if metadata is stale (older than 5 minutes)
     */
    private isStale;
    /**
     * List sessions with optional filtering
     * Auto-syncs if data is stale (>5 min) or if syncFirst is true
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
     * Sync a Cursor session from Cursor DB to Metadata DB
     *
     * @internal
     */
    private syncCursorSession;
    /**
     * Sync a Claude Code session to Metadata DB
     *
     * @internal
     */
    private syncClaudeSession;
    /**
     * Sync multiple sessions from Cursor DB to Metadata DB
     * Only syncs sessions that are new or have been updated since last sync
     */
    syncSessions(limit?: number, source?: 'cursor' | 'claude' | 'all'): Promise<number>;
    /**
     * Sync Cursor sessions only
     */
    private syncCursorSessions;
    /**
     * Sync Claude Code sessions only
     */
    private syncClaudeSessions;
    /**
     * Close database connections
     */
    close(): void;
    /**
     * Get the underlying AggregatedCursorDB instance (for advanced use)
     */
    getCursorDB(): AggregatedCursorDB;
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