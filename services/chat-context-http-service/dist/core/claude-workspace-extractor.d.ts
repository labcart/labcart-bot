/**
 * Claude Code Workspace Extractor
 *
 * Extracts workspace paths and nicknames from Claude Code JSONL messages
 */
import type { ClaudeCodeMessage } from './claude-code-db.js';
/**
 * Extract project path from Claude Code messages
 * Claude Code stores the project path in the `cwd` field of each message
 */
export declare function extractWorkspaceFromClaudeMessages(messages: ClaudeCodeMessage[]): string | null;
/**
 * Extract nickname from nickname_current_session tool calls in Claude Code messages
 */
export declare function extractNicknameFromClaudeMessages(messages: ClaudeCodeMessage[]): string | null;
/**
 * Get project name from workspace path
 */
export declare function getProjectNameFromPath(workspacePath: string): string;
/**
 * Extract all unique project paths from messages
 */
export declare function extractAllWorkspacePathsFromClaudeMessages(messages: ClaudeCodeMessage[]): string[];
/**
 * Check if Claude Code session has a project
 */
export declare function hasProjectInClaudeMessages(messages: ClaudeCodeMessage[]): boolean;
/**
 * Get workspace info for Claude Code session
 */
export interface ClaudeWorkspaceInfo {
    primaryPath: string | null;
    projectName: string | null;
    allPaths: string[];
    hasProject: boolean;
    isMultiWorkspace: boolean;
    nickname: string | null;
}
export declare function getClaudeWorkspaceInfo(messages: ClaudeCodeMessage[]): ClaudeWorkspaceInfo;
//# sourceMappingURL=claude-workspace-extractor.d.ts.map