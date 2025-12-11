/**
 * Workspace Path Extractor
 *
 * Extracts workspace/project paths from Cursor session data.
 */
import type { BubbleData, WorkspaceResult } from './types.js';
/**
 * Extract workspace path from tool result in bubble
 */
export declare function parseToolResult(bubble: BubbleData): WorkspaceResult | null;
/**
 * Extract workspace path from composerData fields
 * Comprehensive check of ALL anchor fields discovered through analysis
 */
export declare function extractWorkspaceFromComposerData(composerData: any): string | null;
/**
 * Check if a session is empty (has no messages)
 */
export declare function isEmptySession(composerData: any): boolean;
/**
 * Extract workspace path from a session's bubbles
 * Returns the first workspace found
 */
export declare function extractWorkspacePath(bubbles: BubbleData[]): string | null;
/**
 * Extract all unique workspace paths from a session
 * Useful for detecting multi-workspace sessions
 */
export declare function extractAllWorkspacePaths(bubbles: BubbleData[]): string[];
/**
 * Derive project name from workspace path
 * Example: /Users/me/projects/my-app -> my-app
 */
export declare function getProjectName(workspacePath: string): string;
/**
 * Check if a session has a project (workspace path)
 */
export declare function hasProject(bubbles: BubbleData[]): boolean;
/**
 * Detect if session spans multiple workspaces
 */
export declare function isMultiWorkspace(bubbles: BubbleData[]): boolean;
/**
 * Extract nickname from nickname_current_session tool call
 */
export declare function extractNicknameFromBubbles(bubbles: BubbleData[]): string | null;
/**
 * Get workspace info for a session
 */
export interface WorkspaceInfo {
    primaryPath: string | null;
    projectName: string | null;
    allPaths: string[];
    hasProject: boolean;
    isMultiWorkspace: boolean;
    nickname: string | null;
}
export declare function getWorkspaceInfo(bubbles: BubbleData[]): WorkspaceInfo;
//# sourceMappingURL=workspace-extractor.d.ts.map