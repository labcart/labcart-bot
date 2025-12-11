#!/usr/bin/env node

/**
 * Chat Context HTTP Service (Standalone)
 *
 * Self-contained HTTP server that provides chat context/session retrieval.
 * Runs once globally and serves all MCP Router instances.
 *
 * Reads local Cursor/Claude Code SQLite databases
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

// Load configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let config = { port: 3003 };
try {
  const configPath = join(__dirname, 'config.json');
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (error) {
  console.log('ℹ️  No config.json found, using defaults');
}

// Import from local dist directory
import { CursorContext } from './dist/core/index.js';
import {
  handleListSessions,
  handleSearchSessions,
  handleGetSession,
  handleNicknameCurrentSession,
  handleAddTag,
  handleRemoveTag,
  handleSyncSessions,
  handleListTags,
  handleListProjects,
  handleHideSession,
  handleUnhideSession
} from './dist/mcp-server/tools.js';

console.log('💬 Chat Context HTTP Service starting...');

// Initialize Cursor Context API (reused across requests)
const api = new CursorContext();

// Create Express app
const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  const stats = api.getStats();
  res.json({
    status: 'healthy',
    stats: {
      totalSessionsInCursor: stats.totalSessionsInCursor || 0,
      totalSessionsWithMetadata: stats.totalSessionsWithMetadata || 0,
      totalProjects: stats.totalProjects || 0,
      totalTags: stats.totalTags || 0
    }
  });
});

// Get tool schema (for MCP Router to register)
app.get('/schema', (req, res) => {
  res.json([
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
      description: `Remove tag(s) from a session.`,
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
          project: {
            type: 'string',
            description: 'Current project/workspace path (automatically provided)',
          },
          source: {
            type: 'string',
            enum: ['cursor', 'claude', 'all'],
            description: 'Source to sync from (cursor, claude, or all) (default: all)',
          },
        },
      },
    },
  ]);
});

// Execute list_sessions tool
app.post('/list_sessions', async (req, res) => {
  try {
    console.log(`📋 [HTTP] Listing sessions...`);
    const result = await handleListSessions(api, req.body);
    res.json({ content: result.content[0].text });
  } catch (error) {
    console.error('❌ [HTTP] List sessions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute search_sessions tool
app.post('/search_sessions', async (req, res) => {
  try {
    console.log(`🔍 [HTTP] Searching sessions: "${req.body.query}"`);
    const result = await handleSearchSessions(api, req.body);
    res.json({ content: result.content[0].text });
  } catch (error) {
    console.error('❌ [HTTP] Search sessions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute get_session tool
app.post('/get_session', async (req, res) => {
  try {
    console.log(`📖 [HTTP] Getting session: ${req.body.idOrNickname}`);
    const result = await handleGetSession(api, req.body);
    res.json({ content: result.content[0].text });
  } catch (error) {
    console.error('❌ [HTTP] Get session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute nickname_current_session tool
app.post('/nickname_current_session', async (req, res) => {
  try {
    console.log(`🏷️  [HTTP] Nicknaming current session: "${req.body.nickname}"`);
    const result = await handleNicknameCurrentSession(api, req.body);
    res.json({ content: result.content[0].text });
  } catch (error) {
    console.error('❌ [HTTP] Nickname session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute add_tag tool
app.post('/add_tag', async (req, res) => {
  try {
    console.log(`🏷️  [HTTP] Adding tag(s) to session: ${req.body.sessionId}`);
    const result = await handleAddTag(api, req.body);
    res.json({ content: result.content[0].text });
  } catch (error) {
    console.error('❌ [HTTP] Add tag error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute remove_tag tool
app.post('/remove_tag', async (req, res) => {
  try {
    console.log(`🏷️  [HTTP] Removing tag(s) from session: ${req.body.sessionId}`);
    const result = await handleRemoveTag(api, req.body);
    res.json({ content: result.content[0].text });
  } catch (error) {
    console.error('❌ [HTTP] Remove tag error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute list_tags tool
app.post('/list_tags', async (req, res) => {
  try {
    console.log(`🏷️  [HTTP] Listing tags...`);
    const result = await handleListTags(api);
    res.json({ content: result.content[0].text });
  } catch (error) {
    console.error('❌ [HTTP] List tags error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute list_projects tool
app.post('/list_projects', async (req, res) => {
  try {
    console.log(`📁 [HTTP] Listing projects...`);
    const result = await handleListProjects(api);
    res.json({ content: result.content[0].text });
  } catch (error) {
    console.error('❌ [HTTP] List projects error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute sync_sessions tool
app.post('/sync_sessions', async (req, res) => {
  try {
    console.log(`🔄 [HTTP] Syncing sessions...`);
    const result = await handleSyncSessions(api, req.body);
    res.json({ content: result.content[0].text });
  } catch (error) {
    console.error('❌ [HTTP] Sync sessions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute hide_session tool
app.post('/hide_session', async (req, res) => {
  try {
    console.log(`🙈 [HTTP] Hiding session: ${req.body.sessionId}`);
    const result = await handleHideSession(api, req.body);
    res.json({ content: result.content[0].text });
  } catch (error) {
    console.error('❌ [HTTP] Hide session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute unhide_session tool
app.post('/unhide_session', async (req, res) => {
  try {
    console.log(`👁️  [HTTP] Unhiding session: ${req.body.sessionId}`);
    const result = await handleUnhideSession(api, req.body);
    res.json({ content: result.content[0].text });
  } catch (error) {
    console.error('❌ [HTTP] Unhide session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /branch_session - Create a new session branched from an existing one
app.post('/branch_session', async (req, res) => {
  let { sourceSessionId, branchAfterMessageUuid, workspacePath } = req.body;

  if (!sourceSessionId || !branchAfterMessageUuid) {
    return res.status(400).json({
      error: 'Invalid request',
      required: { sourceSessionId: 'string', branchAfterMessageUuid: 'string', workspacePath: 'string (optional)' }
    });
  }

  // Strip source prefix (claude: or cursor:) from session ID
  if (sourceSessionId.includes(':')) {
    sourceSessionId = sourceSessionId.split(':')[1];
  }

  try {
    const { spawn } = await import('child_process');
    const readline = await import('readline');
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    // Determine workspace directory
    const workspace = workspacePath || process.env.LABCART_WORKSPACE || process.cwd();
    const dirName = workspace.replace(/\//g, '-');
    const sessionsDir = path.join(os.homedir(), '.claude/projects', dirName);

    // Read source session file
    const sourceFile = path.join(sessionsDir, `${sourceSessionId}.jsonl`);
    if (!fs.existsSync(sourceFile)) {
      return res.status(404).json({ error: 'Source session not found', sourceSessionId });
    }

    const sourceContent = fs.readFileSync(sourceFile, 'utf8');
    const sourceLines = sourceContent.trim().split('\n').filter(line => line.trim());

    // Find lines up to and including branchAfterMessageUuid
    let branchLines = [];
    let foundBranchPoint = false;
    for (const line of sourceLines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'queue-operation') continue;
        branchLines.push(line);
        if (entry.uuid === branchAfterMessageUuid) {
          foundBranchPoint = true;
          break;
        }
      } catch (e) {}
    }

    if (!foundBranchPoint) {
      return res.status(404).json({
        error: 'Branch point message not found',
        branchAfterMessageUuid,
        hint: 'The message UUID was not found in the source session'
      });
    }

    console.log(`🌿 [HTTP] Branching session ${sourceSessionId.substring(0, 8)}... at message ${branchAfterMessageUuid.substring(0, 8)}...`);
    console.log(`   Copying ${branchLines.length} messages to new branch`);

    // Spawn a new Claude session to get a fresh UUID
    const newSessionPromise = new Promise((resolve, reject) => {
      const child = spawn('claude', [
        '--output-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions'
      ], {
        cwd: workspace,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let newSessionId = null;
      const rl = readline.createInterface({ input: child.stdout });

      rl.on('line', (line) => {
        try {
          const data = JSON.parse(line);
          if (data.type === 'system' && data.session_id) {
            newSessionId = data.session_id;
            child.kill('SIGTERM');
          }
        } catch (e) {}
      });

      child.on('close', () => {
        if (newSessionId) resolve(newSessionId);
        else reject(new Error('Failed to get new session ID'));
      });

      child.on('error', reject);
      child.stdin.write('init\n');
      child.stdin.end();

      setTimeout(() => {
        if (!newSessionId) {
          child.kill('SIGTERM');
          reject(new Error('Timeout waiting for new session'));
        }
      }, 30000);
    });

    const newSessionId = await newSessionPromise;
    console.log(`   New session created: ${newSessionId.substring(0, 8)}...`);

    // Update sessionId in all branch lines and write to new file
    const newFile = path.join(sessionsDir, `${newSessionId}.jsonl`);
    const updatedLines = branchLines.map(line => {
      return line.replace(new RegExp(sourceSessionId, 'g'), newSessionId);
    });

    fs.writeFileSync(newFile, updatedLines.join('\n') + '\n');
    console.log(`   Branch file created: ${newFile}`);

    res.json({
      success: true,
      newSessionId,
      sourceSessionId,
      branchAfterMessageUuid,
      messagesCopied: branchLines.length,
      message: `Successfully branched session at message ${branchAfterMessageUuid.substring(0, 8)}...`
    });

  } catch (error) {
    console.error('❌ [HTTP] Branch session error:', error);
    res.status(500).json({ error: 'Failed to branch session', details: error.message });
  }
});

// Reindex FTS - populate full-text search index for all sessions
app.post('/reindex_fts', async (req, res) => {
  try {
    console.log(`🔍 [HTTP] Reindexing FTS for all sessions...`);
    const result = await api.reindexFTS((indexed, total) => {
      if (indexed % 50 === 0) {
        console.log(`   Progress: ${indexed}/${total}`);
      }
    });
    const content = `✅ FTS Reindex complete!\n\n📊 Results:\n   Indexed: ${result.indexed}\n   Errors: ${result.errors}\n   Total: ${result.total}`;
    res.json({ content });
  } catch (error) {
    console.error('❌ [HTTP] Reindex FTS error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.CHAT_CONTEXT_HTTP_PORT || config.port || 3003;
app.listen(PORT, () => {
  console.log(`\n🚀 Chat Context HTTP Service running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Schema: http://localhost:${PORT}/schema`);
  console.log(`\n📦 This is a SHARED service - one instance serves all bots\n`);
});
