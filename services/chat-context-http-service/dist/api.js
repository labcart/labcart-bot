/**
 * Core API - Main Interface
 *
 * High-level API that orchestrates all core modules
 */
import { CursorDB } from './cursor-db.js';
import { MetadataDB } from './metadata-db.js';
import { getCursorDBPath, getMetadataDBPath } from './platform.js';
import { parseBubbles } from './message-parser.js';
import { getWorkspaceInfo } from './workspace-extractor.js';
import { SessionNotFoundError } from './errors.js';
/**
 * Main API for Cursor Context Retrieval
 *
 * High-level interface that orchestrates CursorDB and MetadataDB
 */
export class CursorContext {
    cursorDB;
    metadataDB;
    autoSync;
    /**
     * Create a new CursorContext instance
     *
     * @param cursorDBPath - Path to Cursor's database (default: auto-detect)
     * @param metadataDBPath - Path to metadata database (default: ~/.cursor-context/metadata.db)
     * @param autoSync - Automatically sync metadata when accessing sessions (default: true)
     */
    constructor(cursorDBPath, metadataDBPath, autoSync = true) {
        this.cursorDB = new CursorDB(cursorDBPath || getCursorDBPath());
        this.metadataDB = new MetadataDB(metadataDBPath || getMetadataDBPath());
        this.autoSync = autoSync;
    }
    /**
     * List sessions with optional filtering
     */
    async listSessions(options = {}) {
        const { projectPath, taggedOnly = false, limit, tag, sortBy = 'newest' } = options;
        // If filtering by tag, use tag-based query
        if (tag) {
            const sessions = this.metadataDB.findByTag(tag);
            // Apply additional filters
            let filtered = sessions;
            if (projectPath) {
                filtered = filtered.filter(s => s.project_path === projectPath);
            }
            return this.sortAndLimit(filtered, sortBy, limit);
        }
        // If filtering by project, use project-based query
        if (projectPath) {
            const sessions = this.metadataDB.listSessionsByProject(projectPath);
            if (taggedOnly) {
                const filtered = sessions.filter(s => s.tags && s.tags.length > 0);
                return this.sortAndLimit(filtered, sortBy, limit);
            }
            return this.sortAndLimit(sessions, sortBy, limit);
        }
        // General listing with optional filters
        const sessions = this.metadataDB.listSessions({
            tagged_only: taggedOnly,
            limit
        });
        return this.sortAndLimit(sessions, sortBy, limit);
    }
    /**
     * Get a single session by ID or nickname
     */
    async getSession(idOrNickname, options = {}) {
        const { parseOptions, includeMessages = true } = options;
        // Try to get by nickname first
        let metadata = this.metadataDB.getSessionByNickname(idOrNickname);
        // If not found, try by ID
        if (!metadata) {
            metadata = this.metadataDB.getSessionMetadata(idOrNickname);
        }
        // If still not found and autoSync is enabled, try to fetch from Cursor DB
        if (!metadata && this.autoSync) {
            metadata = await this.syncSession(idOrNickname);
        }
        // If still not found, throw error
        if (!metadata) {
            throw new SessionNotFoundError(idOrNickname);
        }
        // Load messages if requested
        let messages = [];
        if (includeMessages) {
            const bubbles = this.cursorDB.getSessionBubbles(metadata.session_id);
            messages = parseBubbles(bubbles, parseOptions);
        }
        return {
            metadata,
            messages
        };
    }
    /**
     * Search sessions by content
     */
    async searchSessions(options) {
        const { query, projectPath, taggedOnly = false, limit, caseSensitive = false } = options;
        // Get all sessions based on filters
        const sessions = await this.listSessions({
            projectPath,
            taggedOnly,
            limit: undefined // Get all first, then filter
        });
        // Prepare search query
        const searchQuery = caseSensitive ? query : query.toLowerCase();
        // Filter by content
        const matches = sessions.filter(session => {
            // Search in nickname
            if (session.nickname) {
                const nickname = caseSensitive ? session.nickname : session.nickname.toLowerCase();
                if (nickname.includes(searchQuery)) {
                    return true;
                }
            }
            // Search in first message preview
            if (session.first_message_preview) {
                const preview = caseSensitive
                    ? session.first_message_preview
                    : session.first_message_preview.toLowerCase();
                if (preview.includes(searchQuery)) {
                    return true;
                }
            }
            // Search in tags
            if (session.tags) {
                for (const tag of session.tags) {
                    const tagText = caseSensitive ? tag : tag.toLowerCase();
                    if (tagText.includes(searchQuery)) {
                        return true;
                    }
                }
            }
            // Search in project name
            if (session.project_name) {
                const projectName = caseSensitive
                    ? session.project_name
                    : session.project_name.toLowerCase();
                if (projectName.includes(searchQuery)) {
                    return true;
                }
            }
            return false;
        });
        // Apply limit
        return limit ? matches.slice(0, limit) : matches;
    }
    /**
     * Set a nickname for a session
     */
    async setNickname(sessionId, nickname) {
        // Check if session exists in Cursor DB
        const composerData = this.cursorDB.getComposerData(sessionId);
        if (!composerData) {
            throw new SessionNotFoundError(sessionId);
        }
        // If autoSync and no metadata exists, sync first
        if (this.autoSync) {
            const existing = this.metadataDB.getSessionMetadata(sessionId);
            if (!existing) {
                await this.syncSession(sessionId);
            }
        }
        // Set the nickname
        this.metadataDB.setNickname(sessionId, nickname);
    }
    /**
     * Add a tag to a session
     */
    async addTag(sessionId, tag) {
        // Check if session exists
        const composerData = this.cursorDB.getComposerData(sessionId);
        if (!composerData) {
            throw new SessionNotFoundError(sessionId);
        }
        // If autoSync and no metadata exists, sync first
        if (this.autoSync) {
            const existing = this.metadataDB.getSessionMetadata(sessionId);
            if (!existing) {
                await this.syncSession(sessionId);
            }
        }
        this.metadataDB.addTag(sessionId, tag);
    }
    /**
     * Remove a tag from a session
     */
    async removeTag(sessionId, tag) {
        this.metadataDB.removeTag(sessionId, tag);
    }
    /**
     * Get all available projects
     */
    getProjects() {
        return this.metadataDB.listProjects();
    }
    /**
     * Get all available tags
     */
    getTags() {
        return this.metadataDB.listAllTags();
    }
    /**
     * Get statistics about the database
     */
    getStats() {
        const metadataStats = this.metadataDB.getStats();
        const cursorSessions = this.cursorDB.listComposerIds(1000);
        return {
            totalSessionsInCursor: cursorSessions.length,
            totalSessionsWithMetadata: metadataStats.total_sessions,
            sessionsWithNicknames: metadataStats.sessions_with_nicknames,
            sessionsWithTags: metadataStats.sessions_with_tags,
            sessionsWithProjects: metadataStats.sessions_with_projects,
            totalTags: metadataStats.total_tags,
            totalProjects: metadataStats.total_projects
        };
    }
    /**
     * Sync a session from Cursor DB to Metadata DB
     *
     * @internal
     */
    async syncSession(sessionId) {
        try {
            const composerData = this.cursorDB.getComposerData(sessionId);
            if (!composerData) {
                return null;
            }
            const bubbles = this.cursorDB.getSessionBubbles(sessionId);
            const messages = parseBubbles(bubbles);
            const workspaceInfo = getWorkspaceInfo(bubbles);
            const firstUserMsg = messages.find(m => m.role === 'user')?.content || '';
            const metadata = {
                session_id: sessionId,
                project_path: workspaceInfo.primaryPath || undefined,
                project_name: workspaceInfo.projectName || undefined,
                has_project: workspaceInfo.hasProject,
                first_message_preview: firstUserMsg.substring(0, 200),
                message_count: messages.length,
                created_at: composerData.createdAt ? Date.parse(composerData.createdAt) : undefined
            };
            this.metadataDB.upsertSessionMetadata(metadata);
            return metadata;
        }
        catch (error) {
            // Sync failed, return null
            return null;
        }
    }
    /**
     * Sync multiple sessions from Cursor DB to Metadata DB
     */
    async syncSessions(limit) {
        const sessionIds = this.cursorDB.listComposerIds(limit);
        let synced = 0;
        for (const sessionId of sessionIds) {
            // Check if already synced
            const existing = this.metadataDB.getSessionMetadata(sessionId);
            if (existing) {
                continue;
            }
            // Sync this session
            const metadata = await this.syncSession(sessionId);
            if (metadata) {
                synced++;
            }
        }
        return synced;
    }
    /**
     * Close database connections
     */
    close() {
        this.cursorDB.close();
        this.metadataDB.close();
    }
    /**
     * Get the underlying CursorDB instance (for advanced use)
     */
    getCursorDB() {
        return this.cursorDB;
    }
    /**
     * Get the underlying MetadataDB instance (for advanced use)
     */
    getMetadataDB() {
        return this.metadataDB;
    }
    /**
     * Helper to sort and limit sessions
     */
    sortAndLimit(sessions, sortBy, limit) {
        // Sort
        let sorted = [...sessions];
        switch (sortBy) {
            case 'newest':
                sorted.sort((a, b) => {
                    if (!a.created_at && !b.created_at)
                        return 0;
                    if (!a.created_at)
                        return 1;
                    if (!b.created_at)
                        return -1;
                    return b.created_at - a.created_at;
                });
                break;
            case 'oldest':
                sorted.sort((a, b) => {
                    if (!a.created_at && !b.created_at)
                        return 0;
                    if (!a.created_at)
                        return 1;
                    if (!b.created_at)
                        return -1;
                    return a.created_at - b.created_at;
                });
                break;
            case 'most_messages':
                sorted.sort((a, b) => {
                    const aCount = a.message_count || 0;
                    const bCount = b.message_count || 0;
                    return bCount - aCount;
                });
                break;
        }
        // Limit
        return limit ? sorted.slice(0, limit) : sorted;
    }
}
//# sourceMappingURL=api.js.map