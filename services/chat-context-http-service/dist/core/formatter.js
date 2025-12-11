/**
 * Session Formatters
 *
 * Format sessions for output (Markdown, JSON, etc.)
 */
/**
 * Format session as Markdown
 */
export function formatSessionMarkdown(session, options = {}) {
    const { includeTools = true, maxMessages, includeMetadata = true } = options;
    const lines = [];
    // Header
    if (includeMetadata) {
        lines.push('# Cursor Session');
        lines.push('');
        const metadata = session.metadata;
        if (metadata.nickname) {
            lines.push(`**Nickname:** ${metadata.nickname}`);
        }
        lines.push(`**Session ID:** ${metadata.session_id}`);
        if (metadata.project_name) {
            lines.push(`**Project:** ${metadata.project_name}`);
        }
        if (metadata.project_path) {
            lines.push(`**Path:** \`${metadata.project_path}\``);
        }
        if (metadata.tags && metadata.tags.length > 0) {
            lines.push(`**Tags:** ${metadata.tags.join(', ')}`);
        }
        if (metadata.created_at) {
            const date = new Date(metadata.created_at);
            lines.push(`**Created:** ${date.toLocaleString()}`);
        }
        lines.push(`**Messages:** ${metadata.message_count || session.messages.length}`);
        lines.push('');
        lines.push('---');
        lines.push('');
    }
    // Messages
    const messagesToShow = maxMessages
        ? session.messages.slice(0, maxMessages)
        : session.messages;
    for (let i = 0; i < messagesToShow.length; i++) {
        const msg = messagesToShow[i];
        // Skip tool-only messages if not including tools
        if (!includeTools && msg.toolData && !msg.content) {
            continue;
        }
        // Message header
        const roleLabel = msg.role === 'user' ? '👤 User' :
            msg.role === 'assistant' ? '🤖 Assistant' :
                '🔧 Tool';
        lines.push(`## ${roleLabel}`);
        lines.push('');
        // Content
        if (msg.content) {
            lines.push(msg.content);
            lines.push('');
        }
        // Tool info (if included)
        if (includeTools && msg.toolData) {
            lines.push(`<details>`);
            lines.push(`<summary>🔧 Tool: ${msg.toolData.name}</summary>`);
            lines.push('');
            if (msg.toolData.params) {
                lines.push('**Parameters:**');
                lines.push('```json');
                lines.push(JSON.stringify(msg.toolData.params, null, 2));
                lines.push('```');
                lines.push('');
            }
            if (msg.toolData.workspacePath) {
                lines.push(`**Workspace:** \`${msg.toolData.workspacePath}\``);
                lines.push('');
            }
            lines.push('</details>');
            lines.push('');
        }
        // Separator between messages
        if (i < messagesToShow.length - 1) {
            lines.push('---');
            lines.push('');
        }
    }
    // Show truncation notice
    if (maxMessages && session.messages.length > maxMessages) {
        lines.push('');
        lines.push(`_... and ${session.messages.length - maxMessages} more messages_`);
    }
    return lines.join('\n');
}
/**
 * Format session as JSON
 */
export function formatSessionJSON(session, options = {}) {
    const { includeTools = true, maxMessages } = options;
    // Create a copy to avoid modifying original
    const output = {
        metadata: session.metadata,
        messages: maxMessages
            ? session.messages.slice(0, maxMessages)
            : session.messages
    };
    // Filter out tool data if not including
    if (!includeTools) {
        output.messages = output.messages.map(msg => ({
            ...msg,
            toolData: undefined
        }));
    }
    return JSON.stringify(output, null, 2);
}
/**
 * Format session metadata as compact preview (one line)
 */
export function formatSessionPreview(metadata) {
    const parts = [];
    // Nickname or ID
    if (metadata.nickname) {
        parts.push(`📝 ${metadata.nickname}`);
    }
    else {
        parts.push(`🆔 ${metadata.session_id.substring(0, 8)}...`);
    }
    // Project
    if (metadata.project_name) {
        parts.push(`📁 ${metadata.project_name}`);
    }
    // Tags
    if (metadata.tags && metadata.tags.length > 0) {
        parts.push(`🏷️  ${metadata.tags.slice(0, 2).join(', ')}`);
    }
    // Message count
    if (metadata.message_count) {
        parts.push(`💬 ${metadata.message_count}`);
    }
    // Date
    if (metadata.created_at) {
        const date = new Date(metadata.created_at);
        const daysAgo = Math.floor((Date.now() - metadata.created_at) / (1000 * 60 * 60 * 24));
        if (daysAgo === 0) {
            parts.push('📅 today');
        }
        else if (daysAgo === 1) {
            parts.push('📅 yesterday');
        }
        else if (daysAgo <= 7) {
            parts.push(`📅 ${daysAgo}d ago`);
        }
        else {
            parts.push(`📅 ${date.toLocaleDateString()}`);
        }
    }
    return parts.join(' • ');
}
/**
 * Format session preview for terminal (no emojis)
 */
export function formatSessionPreviewPlain(metadata) {
    const parts = [];
    // Nickname or ID
    if (metadata.nickname) {
        parts.push(metadata.nickname);
    }
    else {
        parts.push(metadata.session_id.substring(0, 8) + '...');
    }
    // Project
    if (metadata.project_name) {
        parts.push(`[${metadata.project_name}]`);
    }
    // Message count
    if (metadata.message_count) {
        parts.push(`${metadata.message_count} msgs`);
    }
    // First message preview
    if (metadata.first_message_preview) {
        const preview = metadata.first_message_preview.substring(0, 50);
        parts.push(`"${preview}${metadata.first_message_preview.length > 50 ? '...' : ''}"`);
    }
    return parts.join(' | ');
}
/**
 * Format multiple sessions as a list
 */
export function formatSessionList(sessions, useEmojis = true) {
    if (sessions.length === 0) {
        return 'No sessions found.';
    }
    const formatter = useEmojis ? formatSessionPreview : formatSessionPreviewPlain;
    return sessions
        .map((session, i) => `${i + 1}. ${formatter(session)}`)
        .join('\n');
}
/**
 * Format a single message
 */
export function formatMessage(message, includeTools = true) {
    const lines = [];
    const roleLabel = message.role === 'user' ? '[USER]' :
        message.role === 'assistant' ? '[ASSISTANT]' :
            '[TOOL]';
    lines.push(roleLabel);
    if (message.content) {
        lines.push(message.content);
    }
    if (includeTools && message.toolData) {
        lines.push(`Tool: ${message.toolData.name}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=formatter.js.map