/**
 * Core API - Main Interface
 *
 * High-level API that orchestrates all core modules
 */
import { AggregatedCursorDB } from './cursor-db.js';
import { ClaudeCodeDB } from './claude-code-db.js';
import { MetadataDB } from './metadata-db.js';
import { getMetadataDBPath } from './platform.js';
import { parseBubbles } from './message-parser.js';
import { getWorkspaceInfo, extractWorkspaceFromComposerData, getProjectName, isEmptySession } from './workspace-extractor.js';
import { getClaudeWorkspaceInfo } from './claude-workspace-extractor.js';
import { claudeToUnified } from './format-adapters.js';
import { SessionNotFoundError } from './errors.js';
/**
 * Main API for Cursor Context Retrieval
 *
 * High-level interface that orchestrates CursorDB, ClaudeCodeDB and MetadataDB
 */
export class CursorContext {
    cursorDB;
    claudeCodeDB;
    metadataDB;
    autoSync;
    autoSyncLimit;
    lastSyncTime = 0;
    STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    /**
     * Create a new CursorContext instance
     *
     * @param metadataDBPath - Path to metadata database (default: ~/.cursor-context/metadata.db)
     * @param autoSync - Automatically sync metadata when accessing sessions (default: true)
     * @param autoSyncLimit - Maximum number of sessions to check during auto-sync (default: 100000)
     * @param claudeProjectsPath - Path to Claude Code projects (default: ~/.claude/projects)
     */
    constructor(metadataDBPath, autoSync = true, autoSyncLimit = 100000, claudeProjectsPath) {
        this.cursorDB = new AggregatedCursorDB();
        this.claudeCodeDB = new ClaudeCodeDB(claudeProjectsPath);
        this.metadataDB = new MetadataDB(metadataDBPath || getMetadataDBPath());
        this.autoSync = autoSync;
        this.autoSyncLimit = autoSyncLimit;
    }
    /**
     * Check if metadata is stale (older than 5 minutes)
     */
    isStale() {
        return Date.now() - this.lastSyncTime > this.STALE_THRESHOLD_MS;
    }
    /**
     * List sessions with optional filtering
     * Auto-syncs if data is stale (>5 min) or if syncFirst is true
     */
    async listSessions(options = {}) {
        const { projectPath, taggedOnly = false, limit, tag, sortBy = 'newest', syncFirst = false, source = 'all' } = options;
        // Auto-sync if requested OR if data is stale
        if (this.autoSync && (syncFirst || this.isStale())) {
            await this.syncSessions(this.autoSyncLimit, source);
        }
        // If filtering by tag, use tag-based query
        if (tag) {
            const sessions = this.metadataDB.findByTag(tag);
            // Apply additional filters
            let filtered = sessions;
            if (projectPath) {
                filtered = filtered.filter(s => s.project_path === projectPath);
            }
            if (source !== 'all') {
                filtered = filtered.filter(s => s.source === source);
            }
            return this.sortAndLimit(filtered, sortBy, limit);
        }
        // If filtering by project, use project-based query
        if (projectPath) {
            const sessions = this.metadataDB.listSessionsByProject(projectPath);
            let filtered = sessions;
            if (taggedOnly) {
                filtered = filtered.filter(s => s.tags && s.tags.length > 0);
            }
            if (source !== 'all') {
                filtered = filtered.filter(s => s.source === source);
            }
            return this.sortAndLimit(filtered, sortBy, limit);
        }
        // General listing with optional filters
        const sessions = this.metadataDB.listSessions({
            tagged_only: taggedOnly,
            limit
        });
        // Filter by source if needed
        let filtered = sessions;
        if (source !== 'all') {
            filtered = filtered.filter(s => s.source === source);
        }
        return this.sortAndLimit(filtered, sortBy, limit);
    }
    /**
     * Get a single session by ID or nickname
     */
    async getSession(idOrNickname, options = {}) {
        const { parseOptions, includeMessages = true } = options;
        // Try to get by nickname first
        let metadata = this.metadataDB.getSessionByNickname(idOrNickname);
        // If not found, try by exact ID (with prefix)
        if (!metadata) {
            metadata = this.metadataDB.getSessionMetadata(idOrNickname);
        }
        // If not found, try by ID prefix (like git does with commit hashes)
        if (!metadata) {
            metadata = this.metadataDB.findSessionByIdPrefix(idOrNickname);
        }
        // If not found, try adding cursor: prefix
        if (!metadata && !idOrNickname.includes(':')) {
            metadata = this.metadataDB.getSessionMetadata(`cursor:${idOrNickname}`);
        }
        // If still not found and autoSync is enabled, try to fetch from Cursor DB
        if (!metadata && this.autoSync && !idOrNickname.includes(':')) {
            metadata = await this.syncCursorSession(idOrNickname);
        }
        // If still not found, throw error
        if (!metadata) {
            throw new SessionNotFoundError(idOrNickname);
        }
        // Load messages if requested
        let messages = [];
        if (includeMessages) {
            // Strip prefix to get raw session ID
            const parts = metadata.session_id.split(':');
            const source = parts[0];
            const rawId = parts[1];
            if (!rawId) {
                throw new Error(`Invalid session ID format: ${metadata.session_id}`);
            }
            if (source === 'cursor') {
                const bubbles = this.cursorDB.getSessionBubbles(rawId);
                messages = parseBubbles(bubbles, parseOptions);
            }
            else if (source === 'claude') {
                const claudeMessages = this.claudeCodeDB.getSessionMessages(rawId);
                messages = claudeToUnified(claudeMessages);
            }
        }
        return {
            metadata,
            messages
        };
    }
    /**
     * Search sessions by content using FTS5 full-text search
     */
    async searchSessions(options) {
        const { query, projectPath, taggedOnly = false, limit } = options;
        // Use FTS5 for full-text search
        const ftsResults = this.metadataDB.searchFTS(query, {
            project: projectPath,
            limit: limit || 50
        });
        // If FTS found results, return them
        if (ftsResults.length > 0) {
            // Filter by tagged only if requested
            if (taggedOnly) {
                return ftsResults.filter(s => s.nickname || (s.tags && s.tags.length > 0));
            }
            return ftsResults;
        }
        // Fallback: Also search in metadata fields (nickname, project name, tags)
        // This catches cases where content wasn't indexed yet
        const sessions = await this.listSessions({
            projectPath,
            taggedOnly,
            limit: undefined
        });
        const searchQuery = query.toLowerCase();
        const matches = sessions.filter(session => {
            if (session.nickname?.toLowerCase().includes(searchQuery)) return true;
            if (session.project_name?.toLowerCase().includes(searchQuery)) return true;
            if (session.first_message_preview?.toLowerCase().includes(searchQuery)) return true;
            if (session.tags?.some(tag => tag.toLowerCase().includes(searchQuery))) return true;
            return false;
        });
        return limit ? matches.slice(0, limit) : matches;
    }
    /**
     * Set a nickname for a session
     */
    async setNickname(sessionId, nickname) {
        let prefixedId;
        let rawId;
        let source;
        if (sessionId.includes(':')) {
            // Session ID has prefix
            [source, rawId] = sessionId.split(':');
            prefixedId = sessionId;
        }
        else {
            // No prefix - try to find the session in either source
            // Check Cursor first
            const cursorData = this.cursorDB.getComposerData(sessionId);
            const claudeMessages = this.claudeCodeDB.getSessionMessages(sessionId);
            if (cursorData && (!claudeMessages || claudeMessages.length === 0)) {
                // Found in Cursor only
                source = 'cursor';
                rawId = sessionId;
                prefixedId = `cursor:${sessionId}`;
            }
            else if (claudeMessages && claudeMessages.length > 0 && !cursorData) {
                // Found in Claude only
                source = 'claude';
                rawId = sessionId;
                prefixedId = `claude:${sessionId}`;
            }
            else if (cursorData && claudeMessages && claudeMessages.length > 0) {
                // Found in both - this is a collision, require explicit prefix
                throw new Error(`Session ID ${sessionId} exists in both Cursor and Claude Code. Please specify the source using prefix: cursor:${sessionId} or claude:${sessionId}`);
            }
            else {
                // Not found in either
                throw new SessionNotFoundError(sessionId);
            }
        }
        // If autoSync and no metadata exists, sync first
        if (this.autoSync) {
            const existing = this.metadataDB.getSessionMetadata(prefixedId);
            if (!existing) {
                if (source === 'cursor') {
                    await this.syncCursorSession(rawId);
                }
                else {
                    await this.syncClaudeSession(rawId);
                }
            }
        }
        // Set the nickname (use prefixed ID)
        this.metadataDB.setNickname(prefixedId, nickname);
    }
    /**
     * Add a tag to a session
     */
    async addTag(sessionId, tag) {
        let prefixedId;
        let rawId;
        let source;
        if (sessionId.includes(':')) {
            // Session ID has prefix
            [source, rawId] = sessionId.split(':');
            prefixedId = sessionId;
        }
        else {
            // No prefix - try to find the session in either source
            const cursorData = this.cursorDB.getComposerData(sessionId);
            const claudeMessages = this.claudeCodeDB.getSessionMessages(sessionId);
            if (cursorData && (!claudeMessages || claudeMessages.length === 0)) {
                // Found in Cursor only
                source = 'cursor';
                rawId = sessionId;
                prefixedId = `cursor:${sessionId}`;
            }
            else if (claudeMessages && claudeMessages.length > 0 && !cursorData) {
                // Found in Claude only
                source = 'claude';
                rawId = sessionId;
                prefixedId = `claude:${sessionId}`;
            }
            else if (cursorData && claudeMessages && claudeMessages.length > 0) {
                // Found in both - this is a collision, require explicit prefix
                throw new Error(`Session ID ${sessionId} exists in both Cursor and Claude Code. Please specify the source using prefix: cursor:${sessionId} or claude:${sessionId}`);
            }
            else {
                // Not found in either
                throw new SessionNotFoundError(sessionId);
            }
        }
        // If autoSync and no metadata exists, sync first
        if (this.autoSync) {
            const existing = this.metadataDB.getSessionMetadata(prefixedId);
            if (!existing) {
                if (source === 'cursor') {
                    await this.syncCursorSession(rawId);
                }
                else {
                    await this.syncClaudeSession(rawId);
                }
            }
        }
        this.metadataDB.addTag(prefixedId, tag);
    }
    /**
     * Remove a tag from a session
     */
    async removeTag(sessionId, tag) {
        this.metadataDB.removeTag(sessionId, tag);
    }
    /**
     * Set hidden status for a session
     */
    setHidden(sessionId, hidden) {
        this.metadataDB.setHidden(sessionId, hidden);
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
     * Sync a Cursor session from Cursor DB to Metadata DB
     *
     * @internal
     */
    async syncCursorSession(sessionId) {
        try {
            const composerData = this.cursorDB.getComposerData(sessionId);
            if (!composerData) {
                return null;
            }
            // Skip empty sessions (no messages)
            if (isEmptySession(composerData)) {
                return null;
            }
            const bubbles = this.cursorDB.getSessionBubbles(sessionId);
            const messages = parseBubbles(bubbles);
            const workspaceInfo = getWorkspaceInfo(bubbles);
            // If workspace not found in bubbles, check composerData fields
            let workspacePath = workspaceInfo.primaryPath || undefined;
            if (!workspacePath) {
                const pathFromComposer = extractWorkspaceFromComposerData(composerData);
                workspacePath = pathFromComposer || undefined;
            }
            const firstUserMsg = messages.find(m => m.role === 'user')?.content || '';
            const metadata = {
                session_id: `cursor:${sessionId}`,
                source: 'cursor',
                nickname: workspaceInfo.nickname || undefined,
                project_path: workspacePath,
                project_name: workspacePath ? getProjectName(workspacePath) : undefined,
                has_project: !!workspacePath,
                first_message_preview: firstUserMsg.substring(0, 200),
                message_count: messages.length,
                created_at: composerData.createdAt ? Date.parse(composerData.createdAt) : undefined,
                last_synced_at: Date.now()
            };
            this.metadataDB.upsertSessionMetadata(metadata);
            // Index full content for FTS
            const fullContent = messages.map(m => m.content).join('\n');
            this.metadataDB.indexSessionContent(metadata.session_id, fullContent);
            return metadata;
        }
        catch (error) {
            // Sync failed, return null
            return null;
        }
    }
    /**
     * Sync a Claude Code session to Metadata DB
     *
     * @internal
     */
    async syncClaudeSession(sessionId) {
        try {
            const messages = this.claudeCodeDB.getSessionMessages(sessionId);
            if (!messages || messages.length === 0) {
                return null;
            }
            // Extract workspace and nickname
            const workspaceInfo = getClaudeWorkspaceInfo(messages);
            const unified = claudeToUnified(messages);
            const firstUserMsg = unified.find(m => m.role === 'user')?.content || '';
            // Get created timestamp from first message
            const createdAt = messages[0]?.timestamp
                ? new Date(messages[0].timestamp).getTime()
                : undefined;
            const metadata = {
                session_id: `claude:${sessionId}`,
                source: 'claude',
                nickname: workspaceInfo.nickname || undefined,
                project_path: workspaceInfo.primaryPath || undefined,
                project_name: workspaceInfo.primaryPath ? getProjectName(workspaceInfo.primaryPath) : undefined,
                has_project: !!workspaceInfo.primaryPath,
                first_message_preview: firstUserMsg.substring(0, 200),
                message_count: unified.length,
                created_at: createdAt,
                last_synced_at: Date.now()
            };
            this.metadataDB.upsertSessionMetadata(metadata);
            // Index full content for FTS
            const fullContent = unified.map(m => m.content).join('\n');
            this.metadataDB.indexSessionContent(metadata.session_id, fullContent);
            return metadata;
        }
        catch (error) {
            // Sync failed, return null
            return null;
        }
    }
    /**
     * Sync multiple sessions from Cursor DB to Metadata DB
     * Only syncs sessions that are new or have been updated since last sync
     */
    async syncSessions(limit, source = 'cursor') {
        let synced = 0;
        // Sync Cursor sessions
        if (source === 'cursor' || source === 'all') {
            synced += await this.syncCursorSessions(limit);
        }
        // Sync Claude Code sessions
        if (source === 'claude' || source === 'all') {
            synced += await this.syncClaudeSessions(limit);
        }
        // Update last sync time
        this.lastSyncTime = Date.now();
        return synced;
    }
    /**
     * Sync Cursor sessions only
     */
    async syncCursorSessions(limit) {
        const cursorTimestamps = this.cursorDB.getAllSessionTimestamps(limit);
        let synced = 0;
        for (const [sessionId, lastUpdatedAt] of cursorTimestamps.entries()) {
            const prefixedId = `cursor:${sessionId}`;
            const existing = this.metadataDB.getSessionMetadata(prefixedId);
            const needsSync = !existing ||
                !existing.last_synced_at ||
                lastUpdatedAt > existing.last_synced_at;
            if (needsSync) {
                const metadata = await this.syncCursorSession(sessionId);
                if (metadata) {
                    synced++;
                }
            }
        }
        return synced;
    }
    /**
     * Sync Claude Code sessions only
     */
    async syncClaudeSessions(limit) {
        const claudeTimestamps = this.claudeCodeDB.getSessionTimestamps(limit);
        let synced = 0;
        for (const [sessionId, lastAccessedAt] of claudeTimestamps.entries()) {
            const prefixedId = `claude:${sessionId}`;
            const existing = this.metadataDB.getSessionMetadata(prefixedId);
            const needsSync = !existing ||
                !existing.last_synced_at ||
                lastAccessedAt > existing.last_synced_at;
            if (needsSync) {
                const metadata = await this.syncClaudeSession(sessionId);
                if (metadata) {
                    synced++;
                }
            }
        }
        return synced;
    }
    /**
     * Reindex all sessions for full-text search
     * This fetches all message content and populates the FTS index
     */
    async reindexFTS(progressCallback) {
        const allMetadata = this.metadataDB.listAllSessions();
        let indexed = 0;
        let errors = 0;
        for (const meta of allMetadata) {
            try {
                const sessionId = meta.session_id;
                const [source, rawId] = sessionId.includes(':')
                    ? sessionId.split(':')
                    : ['cursor', sessionId];
                let content = '';
                if (source === 'cursor') {
                    const bubbles = this.cursorDB.getSessionBubbles(rawId);
                    if (bubbles && bubbles.length > 0) {
                        const messages = parseBubbles(bubbles);
                        content = messages.map(m => m.content).join('\n');
                    }
                } else if (source === 'claude') {
                    const messages = this.claudeCodeDB.getSessionMessages(rawId);
                    if (messages && messages.length > 0) {
                        content = messages.map(m => m.content).join('\n');
                    }
                }
                if (content) {
                    this.metadataDB.indexSessionContent(sessionId, content);
                    indexed++;
                }
                if (progressCallback) {
                    progressCallback(indexed, allMetadata.length);
                }
            } catch (err) {
                errors++;
                console.error(`Failed to index ${meta.session_id}:`, err.message);
            }
        }
        return { indexed, errors, total: allMetadata.length };
    }
    /**
     * Close database connections
     */
    close() {
        this.cursorDB.close();
        this.metadataDB.close();
    }
    /**
     * Get the underlying AggregatedCursorDB instance (for advanced use)
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