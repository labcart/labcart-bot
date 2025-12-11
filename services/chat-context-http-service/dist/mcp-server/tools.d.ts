/**
 * MCP Tool Handlers
 *
 * Implementation of each MCP tool using the core library
 */
import { CursorContext } from '../core/index.js';
/**
 * List sessions
 */
export declare function handleListSessions(api: CursorContext, args: any): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
/**
 * Search sessions
 */
export declare function handleSearchSessions(api: CursorContext, args: any): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
/**
 * Get session by ID or nickname
 */
export declare function handleGetSession(api: CursorContext, args: any): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
/**
 * Nickname current session
 */
export declare function handleNicknameCurrentSession(_api: CursorContext, args: any): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
/**
 * Add tag(s) to session
 */
export declare function handleAddTag(api: CursorContext, args: any): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
/**
 * Remove tag(s) from session
 */
export declare function handleRemoveTag(api: CursorContext, args: any): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
/**
 * List all tags
 */
export declare function handleListTags(api: CursorContext): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
/**
 * List all projects
 */
export declare function handleListProjects(api: CursorContext): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
/**
 * Sync sessions from Cursor DB and/or Claude Code to Metadata DB
 */
export declare function handleSyncSessions(api: CursorContext, args: any): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
//# sourceMappingURL=tools.d.ts.map