/**
 * Claude Code Database Reader
 *
 * Reads chat sessions from Claude Code's JSONL files
 * Location: ~/.claude/projects/[project-path]/[session-id].jsonl
 */
/**
 * Single message from Claude Code JSONL file
 */
export interface ClaudeCodeMessage {
    parentUuid: string | null;
    isSidechain: boolean;
    userType: string;
    cwd: string;
    sessionId: string;
    version: string;
    gitBranch: string;
    type: 'user' | 'assistant';
    message: {
        role: 'user' | 'assistant';
        content: string | Array<{
            type: 'text' | 'tool_use' | 'tool_result';
            text?: string;
            id?: string;
            name?: string;
            input?: any;
            tool_use_id?: string;
            content?: string;
        }>;
        model?: string;
        id?: string;
        usage?: any;
    };
    uuid: string;
    timestamp: string;
    requestId?: string;
}
/**
 * Claude Code session metadata
 */
export interface ClaudeCodeSession {
    sessionId: string;
    projectPath: string;
    projectName: string;
    messageCount: number;
    createdAt: number;
    lastAccessedAt: number;
    firstMessagePreview?: string;
}
/**
 * Database reader for Claude Code sessions
 */
export declare class ClaudeCodeDB {
    private claudeProjectsPath;
    constructor(claudeProjectsPath?: string);
    /**
     * Get all Claude Code sessions across all projects
     */
    getAllSessions(): ClaudeCodeSession[];
    /**
     * Get all session files in a project directory
     */
    private getSessionFilesInProject;
    /**
     * Parse a session JSONL file
     */
    private parseSessionFile;
    /**
     * Extract project name from directory name
     * Example: "-Users-macbook-play-chat-context-mcp" -> "chat-context-mcp"
     */
    private extractProjectNameFromDir;
    /**
     * Extract project path from directory name
     * Example: "-Users-macbook-play-chat-context-mcp" -> "/Users/macbook/play/chat-context-mcp"
     */
    private extractProjectPathFromDir;
    /**
     * Get messages for a specific session
     */
    getSessionMessages(sessionId: string): ClaudeCodeMessage[];
    /**
     * Read all messages from a JSONL file
     */
    private readMessagesFromFile;
    /**
     * Get session timestamps for sync optimization
     * Returns Map<sessionId, lastAccessedTimestamp>
     */
    getSessionTimestamps(limit?: number): Map<string, number>;
    /**
     * Get all session IDs
     */
    getAllSessionIds(): string[];
    /**
     * Close the database connection (no-op for file-based storage)
     */
    close(): void;
}
//# sourceMappingURL=claude-code-db.d.ts.map