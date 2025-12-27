/**
 * Format Adapters
 *
 * Convert between Cursor and Claude Code message formats to a unified format
 */
import type { BubbleData, ParsedMessage } from './types.js';
import type { ClaudeCodeMessage } from './claude-code-db.js';
/**
 * Convert Cursor bubbles to unified message format
 */
export declare function cursorToUnified(bubbles: BubbleData[]): ParsedMessage[];
/**
 * Convert Claude Code messages to unified message format
 */
export declare function claudeToUnified(messages: ClaudeCodeMessage[]): ParsedMessage[];
/**
 * Detect message format and convert to unified
 */
export declare function toUnified(messages: BubbleData[] | ClaudeCodeMessage[]): ParsedMessage[];
//# sourceMappingURL=format-adapters.d.ts.map