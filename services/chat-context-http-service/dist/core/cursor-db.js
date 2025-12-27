/**
 * Cursor Database Access
 *
 * Safely reads from Cursor's SQLite database in read-only mode.
 * Supports both legacy globalStorage and new workspace-specific storage.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import { DBConnectionError, DBLockedError, SessionNotFoundError, DataCorruptionError } from './errors.js';
import { getAllCursorDBPaths } from './platform.js';
export class CursorDB {
    dbPath;
    db = null;
    options;
    constructor(dbPath, options = {}) {
        this.dbPath = dbPath;
        this.options = {
            readonly: options.readonly ?? true,
            timeout: options.timeout ?? 5000,
            maxRetries: options.maxRetries ?? 3
        };
    }
    /**
     * Connect to database with retry logic
     */
    connect() {
        if (this.db) {
            return this.db;
        }
        // Check if database exists
        if (!fs.existsSync(this.dbPath)) {
            throw new DBConnectionError(`Cursor database not found at: ${this.dbPath}`, this.dbPath);
        }
        // Try to connect with retries
        let lastError = null;
        for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
            try {
                this.db = new Database(this.dbPath, {
                    readonly: this.options.readonly,
                    timeout: this.options.timeout,
                    fileMustExist: true
                });
                // Test connection
                this.db.pragma('journal_mode'); // Simple query to verify connection
                return this.db;
            }
            catch (error) {
                lastError = error;
                // Check if it's a busy error
                if (lastError.message.includes('SQLITE_BUSY') || lastError.message.includes('database is locked')) {
                    if (attempt < this.options.maxRetries) {
                        // Wait before retry (exponential backoff)
                        const waitMs = Math.min(100 * Math.pow(2, attempt - 1), 1000);
                        // Synchronous wait (not ideal, but sqlite3 is sync)
                        const start = Date.now();
                        while (Date.now() - start < waitMs) {
                            // Busy wait
                        }
                        continue;
                    }
                    throw new DBLockedError('Database is locked. Make sure Cursor is not performing intensive operations.');
                }
                // Other error, don't retry
                throw new DBConnectionError(`Failed to connect to database: ${lastError.message}`, this.dbPath);
            }
        }
        throw new DBConnectionError(`Failed to connect after ${this.options.maxRetries} attempts: ${lastError?.message}`, this.dbPath);
    }
    /**
     * List all composer session IDs
     * Supports both old format (individual keys) and new format (single JSON object)
     */
    listComposerIds(limit) {
        const db = this.connect();
        try {
            // Try new format first (Cursor latest version - single composer.composerData key)
            const newFormatRow = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
                .get('composer.composerData');
            if (newFormatRow) {
                const data = JSON.parse(newFormatRow.value.toString('utf8'));
                if (data.allComposers && Array.isArray(data.allComposers)) {
                    const composerIds = data.allComposers
                        .map((c) => c.composerId)
                        .filter(Boolean);
                    return limit ? composerIds.slice(0, limit) : composerIds;
                }
            }
            // Fallback to old format (individual composerData:{uuid} keys)
            const query = `
        SELECT key
        FROM cursorDiskKV
        WHERE key LIKE 'composerData:%'
        ORDER BY key DESC
        ${limit ? `LIMIT ${limit}` : ''}
      `;
            const rows = db.prepare(query).all();
            // Extract UUID from key (format: "composerData:uuid")
            return rows.map(row => row.key.split(':')[1]);
        }
        catch (error) {
            throw new DBConnectionError(`Failed to list composer IDs: ${error.message}`, this.dbPath);
        }
    }
    /**
     * Get all sessions with their last updated timestamps (efficient bulk check)
     * Returns map of sessionId -> lastUpdatedAt timestamp (milliseconds since epoch)
     * Supports both old format (individual keys) and new format (single JSON object)
     */
    getAllSessionTimestamps(limit) {
        const db = this.connect();
        try {
            const timestamps = new Map();
            // Try new format first (Cursor latest version - single composer.composerData key)
            const newFormatRow = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
                .get('composer.composerData');
            if (newFormatRow) {
                const data = JSON.parse(newFormatRow.value.toString('utf8'));
                if (data.allComposers && Array.isArray(data.allComposers)) {
                    // Sort by lastUpdatedAt
                    const sorted = [...data.allComposers]
                        .filter(c => c.composerId)
                        .sort((a, b) => {
                        const aTime = a.lastUpdatedAt || a.createdAt || 0;
                        const bTime = b.lastUpdatedAt || b.createdAt || 0;
                        return bTime - aTime;
                    });
                    const limited = limit ? sorted.slice(0, limit) : sorted;
                    for (const composer of limited) {
                        const timestamp = composer.lastUpdatedAt || composer.createdAt || 0;
                        timestamps.set(composer.composerId, timestamp);
                    }
                    return timestamps;
                }
            }
            // Fallback to old format (individual composerData:{uuid} keys)
            const query = `
        SELECT
          key,
          json_extract(value, '$.lastUpdatedAt') as lastUpdatedAt
        FROM cursorDiskKV
        WHERE key LIKE 'composerData:%'
        ORDER BY json_extract(value, '$.lastUpdatedAt') DESC
        ${limit ? `LIMIT ${limit}` : ''}
      `;
            const rows = db.prepare(query).all();
            for (const row of rows) {
                const sessionId = row.key.split(':')[1];
                // Parse timestamp - handle both ISO strings and null
                const timestamp = row.lastUpdatedAt ? Date.parse(row.lastUpdatedAt) : 0;
                timestamps.set(sessionId, timestamp);
            }
            return timestamps;
        }
        catch (error) {
            throw new DBConnectionError(`Failed to get session timestamps: ${error.message}`, this.dbPath);
        }
    }
    /**
     * Get composer data for a session
     * Supports both old format (individual keys) and new format (single JSON object)
     */
    getComposerData(composerId) {
        const db = this.connect();
        try {
            // Try new format first (Cursor latest version - single composer.composerData key)
            const newFormatRow = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
                .get('composer.composerData');
            if (newFormatRow) {
                const data = JSON.parse(newFormatRow.value.toString('utf8'));
                if (data.allComposers && Array.isArray(data.allComposers)) {
                    const composer = data.allComposers.find((c) => c.composerId === composerId);
                    if (composer) {
                        // Convert new format to ComposerData format
                        return {
                            composerId: composer.composerId,
                            createdAt: new Date(composer.createdAt).toISOString(),
                            lastUpdatedAt: composer.lastUpdatedAt ? new Date(composer.lastUpdatedAt).toISOString() : undefined,
                            name: composer.name,
                            // Add other fields as needed
                        };
                    }
                }
            }
            // Fallback to old format (individual composerData:{uuid} keys)
            const key = `composerData:${composerId}`;
            const row = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
                .get(key);
            if (!row) {
                return null;
            }
            // Parse JSON from buffer
            const jsonStr = row.value.toString('utf-8');
            const data = JSON.parse(jsonStr);
            return data;
        }
        catch (error) {
            if (error.message.includes('JSON')) {
                throw new DataCorruptionError(`Invalid JSON in composer data: ${composerId}`);
            }
            throw new DBConnectionError(`Failed to fetch composer data: ${error.message}`, this.dbPath);
        }
    }
    /**
     * Get bubble data for a specific message
     */
    getBubbleData(composerId, bubbleId) {
        const db = this.connect();
        try {
            const key = `bubbleId:${composerId}:${bubbleId}`;
            const row = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
                .get(key);
            if (!row) {
                return null;
            }
            // Parse JSON from buffer
            const jsonStr = row.value.toString('utf-8');
            const data = JSON.parse(jsonStr);
            return data;
        }
        catch (error) {
            if (error.message.includes('JSON')) {
                throw new DataCorruptionError(`Invalid JSON in bubble data: ${bubbleId}`);
            }
            throw new DBConnectionError(`Failed to fetch bubble data: ${error.message}`, this.dbPath);
        }
    }
    /**
     * Get all bubbles for a session
     */
    getSessionBubbles(composerId) {
        // First get composer data to find bubble IDs
        const composerData = this.getComposerData(composerId);
        if (!composerData) {
            throw new SessionNotFoundError(composerId);
        }
        // Get bubble IDs from conversation or fullConversationHeadersOnly
        const bubbleHeaders = composerData.fullConversationHeadersOnly ||
            composerData.conversation ||
            [];
        if (bubbleHeaders.length === 0) {
            return [];
        }
        // Fetch each bubble
        const bubbles = [];
        for (const header of bubbleHeaders) {
            const bubble = this.getBubbleData(composerId, header.bubbleId);
            if (bubble) {
                bubbles.push(bubble);
            }
        }
        return bubbles;
    }
    /**
     * Check if database is connected
     */
    isConnected() {
        return this.db !== null && this.db.open;
    }
    /**
     * Close database connection
     */
    close() {
        if (this.db) {
            try {
                this.db.close();
            }
            catch (error) {
                // Ignore errors on close
            }
            this.db = null;
        }
    }
}
/**
 * Aggregated Cursor Database Access
 *
 * Reads from ALL Cursor databases (both globalStorage and all workspaceStorage).
 * This handles Cursor's migration from centralized to workspace-specific storage.
 */
export class AggregatedCursorDB {
    dbInstances = new Map();
    dbPaths;
    constructor(options = {}) {
        // Get all database paths (globalStorage + all workspaceStorage)
        this.dbPaths = getAllCursorDBPaths();
        // Create CursorDB instance for each path
        for (const dbPath of this.dbPaths) {
            this.dbInstances.set(dbPath, new CursorDB(dbPath, options));
        }
    }
    /**
     * List all composer session IDs from ALL databases
     */
    listComposerIds(limit) {
        const allIds = new Set();
        for (const db of this.dbInstances.values()) {
            try {
                const ids = db.listComposerIds();
                ids.forEach(id => allIds.add(id));
            }
            catch (error) {
                // Skip databases that can't be read (might be locked or corrupted)
                console.warn(`Skipping database: ${error.message}`);
            }
        }
        const idsArray = Array.from(allIds);
        return limit ? idsArray.slice(0, limit) : idsArray;
    }
    /**
     * Get all sessions with their timestamps from ALL databases
     */
    getAllSessionTimestamps(limit) {
        const allTimestamps = new Map();
        for (const db of this.dbInstances.values()) {
            try {
                const timestamps = db.getAllSessionTimestamps();
                timestamps.forEach((time, id) => {
                    // Keep the most recent timestamp if duplicate IDs exist
                    const existing = allTimestamps.get(id);
                    if (!existing || time > existing) {
                        allTimestamps.set(id, time);
                    }
                });
            }
            catch (error) {
                console.warn(`Skipping database: ${error.message}`);
            }
        }
        // Sort by timestamp and apply limit
        const sorted = Array.from(allTimestamps.entries())
            .sort((a, b) => b[1] - a[1]);
        const limited = limit ? sorted.slice(0, limit) : sorted;
        return new Map(limited);
    }
    /**
     * Get composer data for a session (searches ALL databases)
     */
    getComposerData(composerId) {
        // Try to find the session in any database
        for (const db of this.dbInstances.values()) {
            try {
                const data = db.getComposerData(composerId);
                if (data) {
                    return data;
                }
            }
            catch (error) {
                // Continue searching other databases
            }
        }
        return null;
    }
    /**
     * Get all bubbles for a session (searches ALL databases)
     */
    getSessionBubbles(composerId) {
        // Try to find the session in any database
        for (const db of this.dbInstances.values()) {
            try {
                const bubbles = db.getSessionBubbles(composerId);
                if (bubbles.length > 0) {
                    return bubbles;
                }
            }
            catch (error) {
                // Continue searching other databases
            }
        }
        throw new SessionNotFoundError(composerId);
    }
    /**
     * Get bubble data for a specific message (searches ALL databases)
     */
    getBubbleData(composerId, bubbleId) {
        for (const db of this.dbInstances.values()) {
            try {
                const bubble = db.getBubbleData(composerId, bubbleId);
                if (bubble) {
                    return bubble;
                }
            }
            catch (error) {
                // Continue searching
            }
        }
        return null;
    }
    /**
     * Close all database connections
     */
    close() {
        for (const db of this.dbInstances.values()) {
            db.close();
        }
        this.dbInstances.clear();
    }
    /**
     * Get number of databases being accessed
     */
    getDatabaseCount() {
        return this.dbPaths.length;
    }
    /**
     * Get all database paths
     */
    getDatabasePaths() {
        return [...this.dbPaths];
    }
}
//# sourceMappingURL=cursor-db.js.map