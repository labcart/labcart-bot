/**
 * Message Parser
 *
 * Parses Cursor messages (richText + plain text) into unified format.
 */
/**
 * Parse a bubble into a unified message format
 */
export function parseBubble(bubble, options = {}) {
    const role = bubble.type === 1 ? 'user' : (bubble.type === 2 ? 'assistant' : 'tool');
    // Extract content based on message type
    let content = '';
    if (bubble.type === 1) {
        // User message - parse richText
        if (bubble.richText) {
            content = parseLexicalText(bubble.richText);
        }
        else if (bubble.text) {
            content = bubble.text;
        }
    }
    else if (bubble.type === 2) {
        // Assistant message - use plain text
        content = bubble.text || '';
    }
    // Parse tool data if present
    let toolData;
    if (bubble.toolFormerData && !options.excludeTools) {
        toolData = parseToolData(bubble.toolFormerData);
    }
    return {
        role,
        content: content.trim(),
        bubbleId: bubble.bubbleId,
        timestamp: bubble.createdAt,
        toolData
    };
}
/**
 * Parse Lexical richText JSON to plain text
 */
export function parseLexicalText(richTextJson) {
    try {
        const lexical = JSON.parse(richTextJson);
        if (!lexical.root) {
            return '';
        }
        return extractTextFromNode(lexical.root);
    }
    catch (error) {
        // Invalid JSON, return empty
        return '';
    }
}
/**
 * Extract text from a Lexical node (recursive)
 */
function extractTextFromNode(node) {
    const parts = [];
    // Handle text nodes
    if (node.text) {
        parts.push(node.text);
    }
    // Handle code blocks
    if (node.type === 'code') {
        const codeContent = node.children
            ? node.children.map(child => extractTextFromNode(child)).join('')
            : '';
        const language = node.language || '';
        parts.push(`\n\`\`\`${language}\n${codeContent}\n\`\`\`\n`);
    }
    // Handle inline code
    else if (node.type === 'code-highlight') {
        parts.push(`\`${node.text || ''}\``);
    }
    // Recursively process children
    else if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
            const childText = extractTextFromNode(child);
            parts.push(childText);
        }
    }
    // Add line breaks for paragraph nodes
    if (node.type === 'paragraph' && parts.length > 0) {
        parts.push('\n');
    }
    return parts.join('');
}
/**
 * Parse tool data from bubble
 */
function parseToolData(toolData) {
    if (!toolData) {
        return undefined;
    }
    const toolName = toolData.name || (toolData.tool ? `tool_${toolData.tool}` : 'unknown_tool');
    const info = {
        name: toolName
    };
    // Parse params if present
    if (toolData.params) {
        try {
            info.params = JSON.parse(toolData.params);
        }
        catch {
            // Params not valid JSON, skip
        }
    }
    // Parse result if present
    if (toolData.result) {
        try {
            info.result = JSON.parse(toolData.result);
            // Extract workspace path from result
            if (typeof info.result === 'object' && info.result !== null) {
                const resultObj = info.result;
                if (resultObj.success && typeof resultObj.success === 'object') {
                    const success = resultObj.success;
                    if (success.workspaceResults && typeof success.workspaceResults === 'object') {
                        const paths = Object.keys(success.workspaceResults);
                        if (paths.length > 0) {
                            info.workspacePath = paths[0];
                        }
                    }
                }
            }
        }
        catch {
            // Result not valid JSON, skip
        }
    }
    return info;
}
/**
 * Parse multiple bubbles into messages
 */
export function parseBubbles(bubbles, options = {}) {
    const messages = bubbles.map(bubble => parseBubble(bubble, options));
    // Apply max content length if specified
    if (options.maxContentLength) {
        return messages.map(msg => ({
            ...msg,
            content: msg.content.length > options.maxContentLength
                ? msg.content.substring(0, options.maxContentLength) + '...'
                : msg.content
        }));
    }
    return messages;
}
/**
 * Filter messages by role
 */
export function filterMessagesByRole(messages, roles) {
    return messages.filter(msg => roles.includes(msg.role));
}
/**
 * Get only user/assistant exchanges (exclude tool calls)
 */
export function getConversationOnly(messages) {
    return messages.filter(msg => msg.role === 'user' || msg.role === 'assistant');
}
/**
 * Count tokens (rough estimate based on character count)
 */
export function estimateTokens(content) {
    // Rough estimate: ~4 characters per token
    return Math.ceil(content.length / 4);
}
//# sourceMappingURL=message-parser.js.map