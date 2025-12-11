/**
 * Message Parser
 *
 * Parses Cursor messages (richText + plain text) into unified format.
 */
import type { BubbleData, ParsedMessage } from './types.js';
/**
 * Parse a bubble into a unified message format
 */
export declare function parseBubble(bubble: BubbleData, options?: ParseOptions): ParsedMessage;
/**
 * Parse Lexical richText JSON to plain text
 */
export declare function parseLexicalText(richTextJson: string): string;
/**
 * Options for parsing messages
 */
export interface ParseOptions {
    /** Exclude tool calls from parsed messages */
    excludeTools?: boolean;
    /** Maximum content length (truncate if longer) */
    maxContentLength?: number;
}
/**
 * Parse multiple bubbles into messages
 */
export declare function parseBubbles(bubbles: BubbleData[], options?: ParseOptions): ParsedMessage[];
/**
 * Filter messages by role
 */
export declare function filterMessagesByRole(messages: ParsedMessage[], roles: Array<'user' | 'assistant' | 'tool'>): ParsedMessage[];
/**
 * Get only user/assistant exchanges (exclude tool calls)
 */
export declare function getConversationOnly(messages: ParsedMessage[]): ParsedMessage[];
/**
 * Count tokens (rough estimate based on character count)
 */
export declare function estimateTokens(content: string): number;
//# sourceMappingURL=message-parser.d.ts.map