/**
 * Session Formatters
 *
 * Format sessions for output (Markdown, JSON, etc.)
 */
import type { SessionWithMessages, SessionMetadata, ParsedMessage } from './types.js';
/**
 * Options for formatting sessions
 */
export interface FormatOptions {
    /** Include tool calls in output */
    includeTools?: boolean;
    /** Maximum messages to include (undefined = all) */
    maxMessages?: number;
    /** Include metadata header */
    includeMetadata?: boolean;
}
/**
 * Format session as Markdown
 */
export declare function formatSessionMarkdown(session: SessionWithMessages, options?: FormatOptions): string;
/**
 * Format session as JSON
 */
export declare function formatSessionJSON(session: SessionWithMessages, options?: FormatOptions): string;
/**
 * Format session metadata as compact preview (one line)
 */
export declare function formatSessionPreview(metadata: SessionMetadata): string;
/**
 * Format session preview for terminal (no emojis)
 */
export declare function formatSessionPreviewPlain(metadata: SessionMetadata): string;
/**
 * Format multiple sessions as a list
 */
export declare function formatSessionList(sessions: SessionMetadata[], useEmojis?: boolean): string;
/**
 * Format a single message
 */
export declare function formatMessage(message: ParsedMessage, includeTools?: boolean): string;
//# sourceMappingURL=formatter.d.ts.map