/**
 * Metadata Database
 *
 * Manages session metadata (nicknames, tags, project paths) in a separate SQLite database.
 */
import type { SessionMetadata, ProjectInfo } from './types.js';
export declare class MetadataDB {
    private dbPath;
    private db;
    constructor(dbPath: string);
    /**
     * Connect to database (lazy initialization)
     */
    private connect;
    /**
     * Initialize database and create tables
     */
    private initialize;
    /**
     * Upsert session metadata
     */
    upsertSessionMetadata(metadata: SessionMetadata): void;
    /**
     * Get session metadata by ID
     */
    getSessionMetadata(sessionId: string): SessionMetadata | null;
    /**
     * Convert database row to SessionMetadata
     */
    private rowToMetadata;
    /**
     * Set nickname for a session
     */
    setNickname(sessionId: string, nickname: string): void;
    /**
     * Get session by nickname
     */
    getSessionByNickname(nickname: string): SessionMetadata | null;
    /**
     * Find session by ID prefix (supports partial UUIDs like git does)
     */
    findSessionByIdPrefix(prefix: string): SessionMetadata | null;
    /**
     * List all nicknames
     */
    listNicknames(): string[];
    /**
     * Add tag to session
     */
    addTag(sessionId: string, tag: string): void;
    /**
     * Remove tag from session
     */
    removeTag(sessionId: string, tag: string): void;
    /**
     * Find sessions by tag
     */
    findByTag(tag: string): SessionMetadata[];
    /**
     * List all tags with counts
     */
    listAllTags(): {
        tag: string;
        count: number;
    }[];
    /**
     * List sessions by project
     */
    listSessionsByProject(projectPath: string): SessionMetadata[];
    /**
     * List all projects with session counts
     */
    listProjects(): ProjectInfo[];
    /**
     * List all sessions with optional filters
     */
    listSessions(options?: {
        project?: string;
        tagged_only?: boolean;
        limit?: number;
    }): SessionMetadata[];
    /**
     * Delete session metadata
     */
    deleteSessionMetadata(sessionId: string): void;
    /**
     * Get database statistics
     */
    getStats(): {
        total_sessions: number;
        sessions_with_nicknames: number;
        sessions_with_tags: number;
        sessions_with_projects: number;
        total_projects: number;
        total_tags: number;
    };
    /**
     * Check if database is connected
     */
    isConnected(): boolean;
    /**
     * Close database connection
     */
    close(): void;
}
//# sourceMappingURL=metadata-db.d.ts.map