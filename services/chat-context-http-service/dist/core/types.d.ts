/**
 * Shared TypeScript types for Cursor Context library
 */
/**
 * Composer session data from Cursor database
 */
export interface ComposerData {
    composerId: string;
    richText?: string;
    text?: string;
    conversation?: ConversationBubble[];
    fullConversationHeadersOnly?: ConversationHeader[];
    context?: SessionContext;
    createdAt?: string;
    lastUpdatedAt?: string;
    name?: string;
}
/**
 * Conversation header with bubble reference
 */
export interface ConversationHeader {
    bubbleId: string;
    type: 1 | 2;
    serverBubbleId?: string;
}
/**
 * Full conversation bubble (message)
 */
export interface ConversationBubble extends ConversationHeader {
}
/**
 * Session context from Cursor
 */
export interface SessionContext {
    fileSelections?: FileSelection[];
    folderSelections?: FolderSelection[];
    mentions?: Mention[];
    cursorRules?: unknown[];
}
/**
 * File selection in context
 */
export interface FileSelection {
    relativeWorkspacePath: string;
}
/**
 * Folder selection in context
 */
export interface FolderSelection {
    path: string;
}
/**
 * Mention (e.g., @file, @folder)
 */
export interface Mention {
    type: string;
    value: string;
}
/**
 * Bubble data from database
 */
export interface BubbleData {
    _v?: number;
    type: 1 | 2;
    bubbleId: string;
    text?: string;
    richText?: string;
    toolFormerData?: ToolData;
    createdAt?: string;
}
/**
 * Tool call data in bubble
 */
export interface ToolData {
    tool: number;
    toolCallId?: string;
    name?: string;
    params?: string;
    result?: string;
    status?: string;
}
/**
 * Parsed message in unified format
 */
export interface ParsedMessage {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    bubbleId: string;
    timestamp?: string;
    toolData?: ToolInfo;
}
/**
 * Tool information extracted from bubble
 */
export interface ToolInfo {
    name: string;
    params?: Record<string, unknown>;
    result?: unknown;
    workspacePath?: string;
}
/**
 * Session metadata stored in our database
 */
export interface SessionMetadata {
    session_id: string;
    source?: 'cursor' | 'claude';
    nickname?: string;
    tags?: string[];
    project_path?: string;
    project_name?: string;
    has_project: boolean;
    created_at?: number;
    last_accessed?: number;
    last_synced_at?: number;
    first_message_preview?: string;
    message_count?: number;
}
/**
 * Complete session with messages
 */
export interface SessionWithMessages {
    metadata: SessionMetadata;
    messages: ParsedMessage[];
}
/**
 * Options for listing sessions
 */
export interface ListOptions {
    limit?: number;
    project?: 'current' | 'all' | string;
    tagged_only?: boolean;
}
/**
 * Options for fetching a session
 */
export interface FetchOptions {
    message_limit?: number;
    include_tools?: boolean;
}
/**
 * Options for searching sessions
 */
export interface SearchOptions {
    query: string;
    project?: 'current' | 'all' | string;
    context_window?: number;
    limit?: number;
}
/**
 * Search result with context
 */
export interface SearchResult {
    session: SessionMetadata;
    matches: SearchMatch[];
}
/**
 * Individual search match
 */
export interface SearchMatch {
    message: ParsedMessage;
    contextBefore: ParsedMessage[];
    contextAfter: ParsedMessage[];
}
/**
 * Project information
 */
export interface ProjectInfo {
    path: string;
    name: string;
    session_count: number;
}
/**
 * Workspace extraction result
 */
export interface WorkspaceResult {
    path: string;
    source: 'tool_result' | 'file_selection' | 'folder_selection';
}
//# sourceMappingURL=types.d.ts.map