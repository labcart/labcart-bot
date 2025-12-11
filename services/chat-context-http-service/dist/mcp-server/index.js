#!/usr/bin/env node
/**
 * Cursor Context MCP Server
 *
 * Model Context Protocol server for Cursor chat session retrieval
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { CursorContext } from '../core/index.js';
import { handleListSessions, handleSearchSessions, handleGetSession, handleNicknameCurrentSession, handleAddTag, handleRemoveTag, handleSyncSessions, handleListTags, handleListProjects } from './tools.js';
/**
 * Create and start the MCP server
 */
async function main() {
    // Create server instance
    const server = new Server({
        name: 'cursor-context',
        version: '0.1.0',
    }, {
        capabilities: {
            tools: {},
        },
    });
    // Initialize Cursor Context API (reused across requests)
    const api = new CursorContext();
    // Register tool list handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: 'list_sessions',
                    description: `**ONLY use this tool when user asks about PAST/OTHER chat sessions - NOT about the current chat or project code!**

TRIGGER PHRASES:
- "Show my past chat sessions"
- "List my previous conversations"
- "What sessions do I have?"
- "Show my chat history"

DO NOT use for: Understanding project code, current conversation, or explaining functionality.
USE this for: Retrieving the user's actual saved Cursor chat session data from their database.`,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                description: 'Maximum number of sessions to return (default: 20)',
                            },
                            project: {
                                type: 'string',
                                description: 'Filter by project path (or current workspace path if listing current project)',
                            },
                            tag: {
                                type: 'string',
                                description: 'Filter by specific tag',
                            },
                            taggedOnly: {
                                type: 'boolean',
                                description: 'Only show sessions with tags/nicknames',
                            },
                            sort: {
                                type: 'string',
                                enum: ['newest', 'oldest', 'most_messages'],
                                description: 'Sort order (default: newest)',
                            },
                            source: {
                                type: 'string',
                                enum: ['cursor', 'claude', 'all'],
                                description: 'Filter by source (cursor, claude, or all) (default: all)',
                            },
                        },
                    },
                },
                {
                    name: 'search_sessions',
                    description: `**ONLY use this tool to search the user's PAST chat sessions - NOT to understand project code!**

TRIGGER PHRASES:
- "Search my past chats for [topic]"
- "Find a previous conversation about [X]"
- "I discussed [X] before, find that chat"
- "Look in my old sessions for [X]"

DO NOT use for: Reading code, understanding the current chat, or explaining the project.
USE this for: Searching through saved chat session data for specific topics the user mentioned in PAST conversations.`,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'Search query',
                            },
                            project: {
                                type: 'string',
                                description: 'Limit search to specific project',
                            },
                            taggedOnly: {
                                type: 'boolean',
                                description: 'Only search sessions with tags',
                            },
                            limit: {
                                type: 'number',
                                description: 'Maximum results (default: 10)',
                            },
                        },
                        required: ['query'],
                    },
                },
                {
                    name: 'get_session',
                    description: `**ONLY use this to retrieve a specific PAST chat session by ID or nickname.**

TRIGGER PHRASES:
- "Show me session [ID/nickname]"
- "Load my '[nickname]' chat"
- "Get the full conversation for session [ID]"

USE this after search_sessions finds a session, or when user provides a session ID/nickname.`,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            idOrNickname: {
                                type: 'string',
                                description: 'Session ID (UUID) or nickname',
                            },
                            maxMessages: {
                                type: 'number',
                                description: 'Maximum messages to include (default: 50)',
                            },
                            format: {
                                type: 'string',
                                enum: ['markdown', 'json'],
                                description: 'Output format (default: markdown)',
                            },
                        },
                        required: ['idOrNickname'],
                    },
                },
                {
                    name: 'nickname_current_session',
                    description: `Set a nickname for the CURRENT chat session you are in right now.

Use when user wants to name THIS session:
- "Nickname this chat 'auth-implementation'"
- "Name the current session 'bug-fix-cors'"
- "Call this conversation 'database-design'"

The nickname will be applied when this session is synced to the database.`,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            nickname: {
                                type: 'string',
                                description: 'Nickname to assign to the current session',
                            },
                            project: {
                                type: 'string',
                                description: 'Current project/workspace path (automatically provided)',
                            },
                        },
                        required: ['nickname'],
                    },
                },
                {
                    name: 'add_tag',
                    description: `Add tag(s) to a session for organization.
          
Use when user wants to categorize:
- "Tag this as 'feature' and 'backend'"
- "Add 'bugfix' tag"
- "Categorize this as 'documentation'"`,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            sessionId: {
                                type: 'string',
                                description: 'Session ID (UUID) or nickname',
                            },
                            tags: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Tag(s) to add',
                            },
                        },
                        required: ['sessionId', 'tags'],
                    },
                },
                {
                    name: 'remove_tag',
                    description: 'Remove tag(s) from a session.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            sessionId: {
                                type: 'string',
                                description: 'Session ID (UUID) or nickname',
                            },
                            tags: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Tag(s) to remove',
                            },
                        },
                        required: ['sessionId', 'tags'],
                    },
                },
                {
                    name: 'list_tags',
                    description: `**Show all tags used to organize the user's PAST chat sessions.**

TRIGGER: "What tags do I have?" or "Show my chat tags"`,
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'list_projects',
                    description: `**Show all projects that have saved chat sessions.**

TRIGGER: "What projects have I chatted about?" or "Show my session projects"`,
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'sync_sessions',
                    description: `Sync sessions from Cursor and/or Claude Code databases to the metadata database.

Use when user wants to:
- "Sync my sessions"
- "Update the session database"
- "Refresh sessions"
- "Sync the chat sessions"

This will fetch new/updated sessions and make them available for querying.`,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                description: 'Maximum number of sessions to sync (default: all sessions)',
                            },
                            source: {
                                type: 'string',
                                enum: ['cursor', 'claude', 'all'],
                                description: 'Source to sync from (cursor, claude, or all) (default: all)',
                            },
                            project: {
                                type: 'string',
                                description: 'Current project/workspace path (automatically provided)',
                            },
                        },
                    },
                },
            ],
        };
    });
    // Register tool call handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        try {
            const { name, arguments: args } = request.params;
            switch (name) {
                case 'list_sessions':
                    return await handleListSessions(api, args || {});
                case 'search_sessions':
                    return await handleSearchSessions(api, args || {});
                case 'get_session':
                    return await handleGetSession(api, args || {});
                case 'nickname_current_session':
                    return await handleNicknameCurrentSession(api, args || {});
                case 'add_tag':
                    return await handleAddTag(api, args || {});
                case 'remove_tag':
                    return await handleRemoveTag(api, args || {});
                case 'list_tags':
                    return await handleListTags(api);
                case 'list_projects':
                    return await handleListProjects(api);
                case 'sync_sessions':
                    return await handleSyncSessions(api, args || {});
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // Start server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Log startup (goes to stderr, won't interfere with protocol)
    console.error('Cursor Context MCP Server started');
}
// Handle errors
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map