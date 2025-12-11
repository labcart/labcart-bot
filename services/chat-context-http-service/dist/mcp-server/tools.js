/**
 * MCP Tool Handlers
 *
 * Implementation of each MCP tool using the core library
 */
import { formatSessionMarkdown, formatSessionJSON } from '../core/index.js';
/**
 * List sessions
 */
export async function handleListSessions(api, args) {
    const sessions = await api.listSessions({
        limit: args.limit || 20,
        projectPath: args.project,
        tag: args.tag,
        taggedOnly: args.taggedOnly || false,
        sortBy: args.sort || 'newest',
        source: (args.source || 'all'),
    });
    // Format as readable text
    const lines = sessions.map((s, i) => {
        const nickname = s.nickname || s.session_id;
        const project = s.project_name || 'no project';
        const msgs = s.message_count || 0;
        const tags = s.tags && s.tags.length > 0 ? s.tags.join(', ') : 'no tags';
        const date = s.created_at ? formatDate(s.created_at) : 'unknown';
        return `${i + 1}. ${nickname} | ${project} | ${msgs} msgs | ${tags} | ${date}`;
    });
    const result = sessions.length > 0
        ? `Found ${sessions.length} session(s):\n\n${lines.join('\n')}`
        : 'No sessions found matching criteria.';
    return {
        content: [
            {
                type: 'text',
                text: result,
            },
        ],
    };
}
/**
 * Search sessions
 */
export async function handleSearchSessions(api, args) {
    if (!args.query) {
        throw new Error('query is required');
    }
    const results = await api.searchSessions({
        query: args.query,
        projectPath: args.project,
        taggedOnly: args.taggedOnly || false,
        limit: args.limit || 10,
    });
    if (results.length === 0) {
        return {
            content: [
                {
                    type: 'text',
                    text: `No sessions found matching "${args.query}".`,
                },
            ],
        };
    }
    // Format results
    const lines = results.map((s, i) => {
        const nickname = s.nickname || s.session_id.substring(0, 8) + '...';
        const project = s.project_name || 'no project';
        const preview = s.first_message_preview
            ? s.first_message_preview.substring(0, 80) + '...'
            : 'no preview';
        const tags = s.tags && s.tags.length > 0 ? ` [${s.tags.join(', ')}]` : '';
        return `${i + 1}. **${nickname}** (${project})${tags}\n   ID: ${s.session_id}\n   Preview: "${preview}"`;
    });
    const result = `Found ${results.length} session(s) matching "${args.query}":\n\n${lines.join('\n\n')}`;
    return {
        content: [
            {
                type: 'text',
                text: result,
            },
        ],
    };
}
/**
 * Get session by ID or nickname
 */
export async function handleGetSession(api, args) {
    if (!args.idOrNickname) {
        throw new Error('idOrNickname is required');
    }
    const session = await api.getSession(args.idOrNickname, {
        parseOptions: {
            maxContentLength: 100000,
        },
    });
    // Limit messages if requested
    if (args.maxMessages && session.messages.length > args.maxMessages) {
        session.messages = session.messages.slice(0, args.maxMessages);
    }
    // Format based on requested format
    const format = args.format || 'markdown';
    const content = format === 'json'
        ? formatSessionJSON(session)
        : formatSessionMarkdown(session, { maxMessages: args.maxMessages });
    return {
        content: [
            {
                type: 'text',
                text: content,
            },
        ],
    };
}
/**
 * Nickname current session
 */
export async function handleNicknameCurrentSession(_api, args) {
    if (!args.nickname) {
        throw new Error('nickname is required');
    }
    // This tool just records the nickname in the tool call params
    // The actual nickname will be applied when this session is synced
    // The workspace extractor will find this tool call and extract the nickname
    return {
        content: [
            {
                type: 'text',
                text: `✓ Nickname "${args.nickname}" will be applied to this session when it is synced to the database.`,
            },
        ],
    };
}
/**
 * Add tag(s) to session
 */
export async function handleAddTag(api, args) {
    if (!args.sessionId || !args.tags) {
        throw new Error('sessionId and tags are required');
    }
    const tags = Array.isArray(args.tags) ? args.tags : [args.tags];
    for (const tag of tags) {
        await api.addTag(args.sessionId, tag);
    }
    return {
        content: [
            {
                type: 'text',
                text: `✓ Added ${tags.length} tag(s) to session: ${tags.join(', ')}`,
            },
        ],
    };
}
/**
 * Remove tag(s) from session
 */
export async function handleRemoveTag(api, args) {
    if (!args.sessionId || !args.tags) {
        throw new Error('sessionId and tags are required');
    }
    const tags = Array.isArray(args.tags) ? args.tags : [args.tags];
    for (const tag of tags) {
        await api.removeTag(args.sessionId, tag);
    }
    return {
        content: [
            {
                type: 'text',
                text: `✓ Removed ${tags.length} tag(s) from session`,
            },
        ],
    };
}
/**
 * List all tags
 */
export async function handleListTags(api) {
    const tags = api.getTags();
    if (tags.length === 0) {
        return {
            content: [
                {
                    type: 'text',
                    text: 'No tags found.',
                },
            ],
        };
    }
    const lines = tags.map((t, i) => `${i + 1}. ${t.tag} (${t.count} session${t.count !== 1 ? 's' : ''})`);
    return {
        content: [
            {
                type: 'text',
                text: `Available tags:\n\n${lines.join('\n')}`,
            },
        ],
    };
}
/**
 * List all projects
 */
export async function handleListProjects(api) {
    const projects = api.getProjects();
    if (projects.length === 0) {
        return {
            content: [
                {
                    type: 'text',
                    text: 'No projects found.',
                },
            ],
        };
    }
    const lines = projects.map((p, i) => {
        const name = p.name || 'unknown';
        return `${i + 1}. **${name}** (${p.session_count} session${p.session_count !== 1 ? 's' : ''})\n   Path: ${p.path}`;
    });
    return {
        content: [
            {
                type: 'text',
                text: `Projects:\n\n${lines.join('\n\n')}`,
            },
        ],
    };
}
/**
 * Sync sessions from Cursor DB and/or Claude Code to Metadata DB
 */
export async function handleSyncSessions(api, args) {
    const limit = args.limit || undefined; // undefined = sync all
    const source = (args.source || 'all');
    const sourceLabel = source === 'all'
        ? 'Cursor and Claude Code'
        : source === 'cursor'
            ? 'Cursor'
            : 'Claude Code';
    const synced = await api.syncSessions(limit, source);
    const stats = api.getStats();
    return {
        content: [
            {
                type: 'text',
                text: `✅ Synced ${synced} session(s) from ${sourceLabel}

📊 Current Stats:
   Total sessions in Cursor: ${stats.totalSessionsInCursor || 0}
   Total sessions with metadata: ${stats.totalSessionsWithMetadata || 0}
   Sessions with projects: ${stats.sessionsWithProjects || 0}
   Total projects: ${stats.totalProjects || 0}
   Total tags: ${stats.totalTags || 0}`,
            },
        ],
    };
}
/**
 * Hide a session
 */
export async function handleHideSession(api, args) {
    if (!args.sessionId) {
        throw new Error('sessionId is required');
    }
    api.setHidden(args.sessionId, true);
    return {
        content: [
            {
                type: 'text',
                text: `✓ Session hidden: ${args.sessionId}`,
            },
        ],
    };
}
/**
 * Unhide a session
 */
export async function handleUnhideSession(api, args) {
    if (!args.sessionId) {
        throw new Error('sessionId is required');
    }
    api.setHidden(args.sessionId, false);
    return {
        content: [
            {
                type: 'text',
                text: `✓ Session unhidden: ${args.sessionId}`,
            },
        ],
    };
}
/**
 * Helper to format dates
 */
function formatDate(timestamp) {
    const daysAgo = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    if (daysAgo === 0)
        return 'today';
    if (daysAgo === 1)
        return 'yesterday';
    if (daysAgo < 7)
        return `${daysAgo}d ago`;
    if (daysAgo < 30)
        return `${Math.floor(daysAgo / 7)}w ago`;
    if (daysAgo < 365)
        return `${Math.floor(daysAgo / 30)}mo ago`;
    return `${Math.floor(daysAgo / 365)}y ago`;
}
//# sourceMappingURL=tools.js.map