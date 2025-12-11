/**
 * Metadata Database
 *
 * Manages session metadata (nicknames, tags, project paths) in a separate SQLite database.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
const SCHEMA_VERSION = 1;
export class MetadataDB {
    dbPath;
    db = null;
    constructor(dbPath) {
        this.dbPath = dbPath;
    }
    /**
     * Connect to database (lazy initialization)
     */
    connect() {
        if (this.db) {
            return this.db;
        }
        // Create directory if it doesn't exist
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Open database
        this.db = new Database(this.dbPath);
        // Initialize schema
        this.initialize();
        return this.db;
    }
    /**
     * Initialize database and create tables
     */
    initialize() {
        if (!this.db) {
            return;
        }
        // Create schema version table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `);
        // Check current version
        const versionRow = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get();
        const currentVersion = versionRow?.version || 0;
        if (currentVersion === 0) {
            // First time setup
            this.db.exec(`
        CREATE TABLE IF NOT EXISTS session_metadata (
          session_id TEXT PRIMARY KEY,
          nickname TEXT UNIQUE,
          tags TEXT,
          project_path TEXT,
          project_name TEXT,
          has_project INTEGER DEFAULT 0,
          created_at INTEGER,
          last_accessed INTEGER,
          first_message_preview TEXT,
          message_count INTEGER DEFAULT 0
        );
        
        CREATE INDEX IF NOT EXISTS idx_nickname ON session_metadata(nickname);
        CREATE INDEX IF NOT EXISTS idx_project_path ON session_metadata(project_path);
        CREATE INDEX IF NOT EXISTS idx_project_name ON session_metadata(project_name);
        CREATE INDEX IF NOT EXISTS idx_has_project ON session_metadata(has_project);
        CREATE INDEX IF NOT EXISTS idx_created_at ON session_metadata(created_at DESC);
        
        INSERT OR REPLACE INTO schema_version (version) VALUES (${SCHEMA_VERSION});
      `);
        }
        // Future migrations would go here
        // if (currentVersion < 2) { ... }
    }
    /**
     * Upsert session metadata
     */
    upsertSessionMetadata(metadata) {
        const db = this.connect();
        const stmt = db.prepare(`
      INSERT INTO session_metadata (
        session_id, nickname, tags, project_path, project_name, has_project,
        created_at, last_accessed, first_message_preview, message_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        nickname = excluded.nickname,
        tags = excluded.tags,
        project_path = excluded.project_path,
        project_name = excluded.project_name,
        has_project = excluded.has_project,
        last_accessed = excluded.last_accessed,
        first_message_preview = excluded.first_message_preview,
        message_count = excluded.message_count
    `);
        stmt.run(metadata.session_id, metadata.nickname || null, metadata.tags ? JSON.stringify(metadata.tags) : null, metadata.project_path || null, metadata.project_name || null, metadata.has_project ? 1 : 0, metadata.created_at || Date.now(), metadata.last_accessed || Date.now(), metadata.first_message_preview || null, metadata.message_count || 0);
    }
    /**
     * Get session metadata by ID
     */
    getSessionMetadata(sessionId) {
        const db = this.connect();
        const row = db.prepare('SELECT * FROM session_metadata WHERE session_id = ?')
            .get(sessionId);
        if (!row) {
            return null;
        }
        return this.rowToMetadata(row);
    }
    /**
     * Convert database row to SessionMetadata
     */
    rowToMetadata(row) {
        return {
            session_id: row.session_id,
            nickname: row.nickname || undefined,
            tags: row.tags ? JSON.parse(row.tags) : undefined,
            project_path: row.project_path || undefined,
            project_name: row.project_name || undefined,
            has_project: Boolean(row.has_project),
            created_at: row.created_at || undefined,
            last_accessed: row.last_accessed || undefined,
            first_message_preview: row.first_message_preview || undefined,
            message_count: row.message_count || undefined
        };
    }
    /**
     * Set nickname for a session
     */
    setNickname(sessionId, nickname) {
        const db = this.connect();
        // Check if nickname already exists for a different session
        const existing = this.getSessionByNickname(nickname);
        if (existing && existing.session_id !== sessionId) {
            throw new Error(`Nickname '${nickname}' is already in use by session ${existing.session_id}`);
        }
        const stmt = db.prepare('UPDATE session_metadata SET nickname = ? WHERE session_id = ?');
        const result = stmt.run(nickname, sessionId);
        if (result.changes === 0) {
            // Session doesn't exist, create it
            this.upsertSessionMetadata({
                session_id: sessionId,
                nickname,
                has_project: false
            });
        }
    }
    /**
     * Get session by nickname
     */
    getSessionByNickname(nickname) {
        const db = this.connect();
        const row = db.prepare('SELECT * FROM session_metadata WHERE nickname = ?')
            .get(nickname);
        if (!row) {
            return null;
        }
        return this.rowToMetadata(row);
    }
    /**
     * List all nicknames
     */
    listNicknames() {
        const db = this.connect();
        const rows = db.prepare('SELECT nickname FROM session_metadata WHERE nickname IS NOT NULL ORDER BY nickname')
            .all();
        return rows.map(row => row.nickname);
    }
    /**
     * Add tag to session
     */
    addTag(sessionId, tag) {
        this.connect(); // Ensure DB is initialized
        const metadata = this.getSessionMetadata(sessionId);
        if (!metadata) {
            // Create metadata with tag
            this.upsertSessionMetadata({
                session_id: sessionId,
                tags: [tag],
                has_project: false
            });
            return;
        }
        const tags = metadata.tags || [];
        if (!tags.includes(tag)) {
            tags.push(tag);
            metadata.tags = tags;
            this.upsertSessionMetadata(metadata);
        }
    }
    /**
     * Remove tag from session
     */
    removeTag(sessionId, tag) {
        const metadata = this.getSessionMetadata(sessionId);
        if (!metadata || !metadata.tags) {
            return;
        }
        metadata.tags = metadata.tags.filter(t => t !== tag);
        this.upsertSessionMetadata(metadata);
    }
    /**
     * Find sessions by tag
     */
    findByTag(tag) {
        const db = this.connect();
        const rows = db.prepare('SELECT * FROM session_metadata WHERE tags IS NOT NULL')
            .all();
        return rows
            .map(row => this.rowToMetadata(row))
            .filter(metadata => metadata.tags?.includes(tag));
    }
    /**
     * List all tags with counts
     */
    listAllTags() {
        const db = this.connect();
        const rows = db.prepare('SELECT tags FROM session_metadata WHERE tags IS NOT NULL')
            .all();
        const tagCounts = new Map();
        for (const row of rows) {
            const tags = JSON.parse(row.tags);
            for (const tag of tags) {
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
        }
        return Array.from(tagCounts.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);
    }
    /**
     * List sessions by project
     */
    listSessionsByProject(projectPath) {
        const db = this.connect();
        const rows = db.prepare('SELECT * FROM session_metadata WHERE project_path = ? ORDER BY created_at DESC')
            .all(projectPath);
        return rows.map(row => this.rowToMetadata(row));
    }
    /**
     * List all projects with session counts
     */
    listProjects() {
        const db = this.connect();
        const rows = db.prepare(`
      SELECT project_path, project_name, COUNT(*) as session_count
      FROM session_metadata
      WHERE project_path IS NOT NULL
      GROUP BY project_path
      ORDER BY session_count DESC
    `).all();
        return rows.map(row => ({
            path: row.project_path,
            name: row.project_name || 'unknown',
            session_count: row.session_count
        }));
    }
    /**
     * List all sessions with optional filters
     */
    listSessions(options = {}) {
        const db = this.connect();
        let query = 'SELECT * FROM session_metadata WHERE 1=1';
        const params = [];
        if (options.project) {
            query += ' AND project_path = ?';
            params.push(options.project);
        }
        if (options.tagged_only) {
            query += ' AND nickname IS NOT NULL';
        }
        query += ' ORDER BY created_at DESC';
        if (options.limit) {
            query += ' LIMIT ?';
            params.push(options.limit);
        }
        const rows = db.prepare(query).all(...params);
        return rows.map(row => this.rowToMetadata(row));
    }
    /**
     * Delete session metadata
     */
    deleteSessionMetadata(sessionId) {
        const db = this.connect();
        db.prepare('DELETE FROM session_metadata WHERE session_id = ?').run(sessionId);
    }
    /**
     * Get database statistics
     */
    getStats() {
        const db = this.connect();
        const stats = db.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        COALESCE(SUM(CASE WHEN nickname IS NOT NULL THEN 1 ELSE 0 END), 0) as sessions_with_nicknames,
        COALESCE(SUM(CASE WHEN tags IS NOT NULL AND tags != '' THEN 1 ELSE 0 END), 0) as sessions_with_tags,
        COALESCE(SUM(CASE WHEN has_project = 1 THEN 1 ELSE 0 END), 0) as sessions_with_projects,
        COUNT(DISTINCT CASE WHEN project_path IS NOT NULL THEN project_path END) as total_projects
      FROM session_metadata
    `).get();
        // Count total unique tags using listAllTags method
        const allTags = this.listAllTags();
        const totalTags = allTags.length;
        return {
            total_sessions: stats.total_sessions,
            sessions_with_nicknames: stats.sessions_with_nicknames,
            sessions_with_tags: stats.sessions_with_tags,
            sessions_with_projects: stats.sessions_with_projects,
            total_projects: stats.total_projects,
            total_tags: totalTags
        };
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
//# sourceMappingURL=metadata-db.js.map