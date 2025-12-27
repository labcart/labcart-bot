/**
 * Cursor Database Access
 *
 * Safely reads from Cursor's SQLite database in read-only mode.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import { DBConnectionError, DBLockedError, SessionNotFoundError, DataCorruptionError } from './errors.js';
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
     */
    listComposerIds(limit) {
        const db = this.connect();
        try {
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
     * Get composer data for a session
     */
    getComposerData(composerId) {
        const db = this.connect();
        try {
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
//# sourceMappingURL=cursor-db.js.map