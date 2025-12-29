#!/usr/bin/env node

/**
 * Claude Bot Platform - Main Server
 *
 * Multi-bot Telegram platform powered by Claude Code CLI.
 * Each bot has its own personality defined in brain files.
 *
 * Usage:
 *   node server.js
 *   npm start
 *   npm run dev (with nodemon)
 */

require('dotenv').config();
const BotManager = require('./lib/bot-manager');
const TerminalManager = require('./lib/terminal-manager');
const { recoverFromRestart } = require('./lib/restart-recovery');
const WorkflowHandler = require('./lib/workflow-handler');
const messageStore = require('./lib/message-store');
const TunnelManager = require('./lib/tunnel-manager');
const fs = require('fs');
const path = require('path');

// Global tunnel URL - dynamically detected, not from .env
let currentTunnelUrl = null;

// Clear Node.js require cache for all brain files to ensure fresh loads
const brainsDir = path.join(__dirname, 'brains');
if (fs.existsSync(brainsDir)) {
  const brainFiles = fs.readdirSync(brainsDir).filter(f => f.endsWith('.js'));
  let cleared = 0;
  brainFiles.forEach(file => {
    const brainPath = path.join(brainsDir, file);
    try {
      const resolvedPath = require.resolve(brainPath);
      if (require.cache[resolvedPath]) {
        delete require.cache[resolvedPath];
        cleared++;
      }
    } catch (err) {
      // Brain not in cache yet, that's fine
    }
  });
  if (cleared > 0) {
    console.log(`🔄 Cleared require cache for ${cleared} brain files`);
  }
}

// ASCII art banner
console.log(`
╔═══════════════════════════════════════╗
║   🤖 Claude Bot Platform v1.0         ║
║   Multi-Bot Telegram Manager          ║
╚═══════════════════════════════════════╝
`);

// Create bot manager
const manager = new BotManager({
  claudeCmd: process.env.CLAUDE_CMD || 'claude'
});

// Create terminal manager
const terminalManager = new TerminalManager();

// Create workflow handler for multi-agent orchestration
const workflowHandler = new WorkflowHandler();

/**
 * Marketplace Server Initialization
 *
 * Agents are loaded on-demand from Supabase marketplace_agents table
 * when users connect via WebSocket and send messages.
 */
console.log('');
console.log('╔═══════════════════════════════════════╗');
console.log('║   🛒 Marketplace Agent Server         ║');
console.log('╚═══════════════════════════════════════╝');
console.log('');

// Start HTTP server for external delegation requests
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();

// CORS middleware for HTTP requests (fetch API calls from browser)
app.use((req, res, next) => {
  const allowedOrigins = ['http://localhost:3000', 'https://labcart.io'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:3000', 'https://labcart.io'],
    methods: ['GET', 'POST']
  }
});

const HTTP_PORT = process.env.BOT_SERVER_PORT || 3010;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;

// Response queue for bot callbacks
// Key: requestId, Value: { response, timestamp, resolved }
const responseQueue = new Map();

// Wire up workflow handler events to socket.io broadcasts
// When a new agent is created by a workflow, broadcast to all connected clients
workflowHandler.on('agent:created', (data) => {
  console.log(`📣 Broadcasting agent:created event for workflow ${data.workflowId}:`, data.agent?.slug);
  io.emit('agent:created', {
    workflowId: data.workflowId,
    agent: data.agent
  });
});

// Track which terminals belong to which socket for cleanup
// Key: socketId, Value: Set of terminalIds
const socketTerminals = new Map();

// Helper to generate unique request IDs
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// POST /trigger-bot - Receive delegation from external sessions (VSCode, etc)
app.post('/trigger-bot', async (req, res) => {
  const { targetBot, task, messages, userId, waitForResponse, responseFormat } = req.body;

  // Validate admin user
  if (!ADMIN_USER_ID || String(userId) !== String(ADMIN_USER_ID)) {
    return res.status(403).json({ error: 'Unauthorized - admin only' });
  }

  // Validate request
  if (!targetBot || !task || !Array.isArray(messages)) {
    return res.status(400).json({
      error: 'Invalid request',
      required: { targetBot: 'string', task: 'string', messages: 'array', userId: 'number' }
    });
  }

  try {
    // Generate request ID if waiting for response
    const requestId = waitForResponse ? generateRequestId() : null;

    // Use the existing delegation logic from bot-manager
    await manager.delegateToBot(
      'external', // source bot (not a real bot, just for logging)
      targetBot,
      parseInt(userId),
      task,
      messages,
      requestId,
      responseFormat
    );

    const response = {
      success: true,
      targetBot,
      messageCount: messages.length,
      message: `Context delegated to ${targetBot}`
    };

    if (requestId) {
      response.requestId = requestId;
      response.waitingForResponse = true;
      response.pollUrl = `/response/${requestId}`;
    }

    res.json(response);
  } catch (error) {
    console.error('❌ Trigger-bot endpoint error:', error);
    res.status(500).json({
      error: 'Delegation failed',
      details: error.message
    });
  }
});

// POST /callback/:requestId - Receive response from bot
app.post('/callback/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const { response, reasoning } = req.body;

  console.log(`📥 Received callback for request ${requestId}:`, { response, reasoning });

  // Store the response
  responseQueue.set(requestId, {
    response,
    reasoning,
    timestamp: Date.now(),
    resolved: true
  });

  res.json({ success: true, message: 'Response received' });
});

// GET /response/:requestId - Poll for response (used by MCP tool)
app.get('/response/:requestId', (req, res) => {
  const { requestId } = req.params;
  const result = responseQueue.get(requestId);

  if (!result) {
    return res.status(404).json({
      waiting: true,
      message: 'No response yet'
    });
  }

  if (result.resolved) {
    // Clean up after retrieval
    responseQueue.delete(requestId);
    return res.json({
      waiting: false,
      response: result.response,
      reasoning: result.reasoning,
      timestamp: result.timestamp
    });
  }

  res.status(404).json({
    waiting: true,
    message: 'Response not ready'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    bots: Array.from(manager.bots.keys()),
    uptime: process.uptime(),
    pendingResponses: responseQueue.size
  });
});

// GET /sessions/:botId/:userId - Get session history for a bot+user
app.get('/sessions/:botId/:userId', (req, res) => {
  const { botId, userId } = req.params;
  const { workspace } = req.query; // Optional workspace filter

  try {
    // Parse userId - use as-is if it's a string (anonymous), otherwise parseInt
    const parsedUserId = userId.startsWith('anon-') ? userId : parseInt(userId);

    // Load current session metadata
    const metadata = manager.sessionManager.loadSessionMetadata(botId, parsedUserId);

    if (!metadata) {
      return res.json({
        currentSession: null,
        history: []
      });
    }

    // If workspace filter is provided, check if this session matches
    if (workspace && metadata.workspacePath && metadata.workspacePath !== workspace) {
      // Session is from a different workspace, return empty
      return res.json({
        currentSession: null,
        history: []
      });
    }

    // Build current session info (only if it matches workspace filter or no filter)
    const currentSession = metadata.currentUuid ? {
      uuid: metadata.currentUuid,
      botId: botId,
      userId: parsedUserId,
      // Use per-UUID count if available, fallback to global count for backwards compatibility
      messageCount: (metadata.uuidCounts && metadata.uuidCounts[metadata.currentUuid]) || metadata.messageCount || 0,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      isCurrent: true,
      workspacePath: metadata.workspacePath || null
    } : null;

    // Build history from uuidHistory
    // Filter out the current UUID from history (it shouldn't appear in both places)
    const history = (metadata.uuidHistory || [])
      .filter(entry => entry.uuid !== metadata.currentUuid)  // Exclude current UUID from history
      .map(entry => ({
        uuid: entry.uuid,
        botId: botId,
        userId: parsedUserId,
        createdAt: entry.createdAt || entry.startedAt,
        endedAt: entry.endedAt || entry.resetAt || entry.rotatedAt,
        // Use per-UUID count if available, fallback to entry.messageCount for backwards compatibility
        messageCount: (metadata.uuidCounts && metadata.uuidCounts[entry.uuid]) || entry.messageCount || 0,
        reason: entry.reason || (entry.resetAt ? 'reset' : 'rotation'),
        isCurrent: false
      }))
      .reverse(); // Most recent first

    res.json({
      currentSession,
      history,
      totalSessions: history.length + (currentSession ? 1 : 0)
    });
  } catch (error) {
    console.error('❌ Error fetching sessions:', error);
    res.status(500).json({
      error: 'Failed to fetch sessions',
      details: error.message
    });
  }
});

// POST /switch-session - Load a specific session
app.post('/switch-session', (req, res) => {
  const { botId, userId, sessionUuid } = req.body;

  if (!botId || !userId || !sessionUuid) {
    return res.status(400).json({
      error: 'Invalid request',
      required: { botId: 'string', userId: 'string | number', sessionUuid: 'string' }
    });
  }

  try {
    // Parse userId - use as-is if it's a string (anonymous), otherwise parseInt
    const parsedUserId = typeof userId === 'string' && userId.startsWith('anon-') ? userId : parseInt(userId);

    const metadata = manager.sessionManager.loadSessionMetadata(botId, parsedUserId);

    if (!metadata) {
      return res.status(404).json({ error: 'No session found for this user' });
    }

    // Check if the UUID is in history
    const historyEntry = (metadata.uuidHistory || []).find(entry => entry.uuid === sessionUuid);

    if (!historyEntry && metadata.currentUuid !== sessionUuid) {
      return res.status(404).json({ error: 'Session UUID not found' });
    }

    // If switching to a historical session, move current to history and restore the old one
    if (metadata.currentUuid && metadata.currentUuid !== sessionUuid) {
      // Archive current session
      metadata.uuidHistory = metadata.uuidHistory || [];
      metadata.uuidHistory.push({
        uuid: metadata.currentUuid,
        createdAt: metadata.createdAt, // Preserve creation timestamp
        switchedAwayAt: new Date().toISOString(),
        messageCount: metadata.messageCount
      });
    }

    // Set the requested UUID as current
    metadata.currentUuid = sessionUuid;

    // If switching to a history entry, restore its timestamps and messageCount
    if (historyEntry) {
      metadata.createdAt = historyEntry.createdAt || new Date().toISOString();
      metadata.messageCount = historyEntry.messageCount || 0;
      // Restore updatedAt from history entry if it exists, otherwise use current time
      if (historyEntry.switchedAwayAt || historyEntry.resetAt || historyEntry.rotatedAt) {
        metadata.updatedAt = historyEntry.switchedAwayAt || historyEntry.resetAt || historyEntry.rotatedAt;
      }
    } else {
      // New session - reset timestamps and messageCount
      metadata.createdAt = new Date().toISOString();
      metadata.messageCount = 0;
      metadata.updatedAt = new Date().toISOString();
    }

    // Remove from history if it was there
    if (historyEntry) {
      metadata.uuidHistory = metadata.uuidHistory.filter(e => e.uuid !== sessionUuid);
    }

    manager.sessionManager.saveSessionMetadata(botId, parsedUserId, metadata);

    res.json({
      success: true,
      currentSession: sessionUuid,
      message: 'Session switched successfully'
    });
  } catch (error) {
    console.error('❌ Error switching session:', error);
    res.status(500).json({
      error: 'Failed to switch session',
      details: error.message
    });
  }
});

// POST /new-session - Create a new session
app.post('/new-session', (req, res) => {
  const { botId, userId } = req.body;

  if (!botId || !userId) {
    return res.status(400).json({
      error: 'Invalid request',
      required: { botId: 'string', userId: 'string | number' }
    });
  }

  try {
    // Parse userId - use as-is if it's a string (anonymous), otherwise parseInt
    const parsedUserId = typeof userId === 'string' && userId.startsWith('anon-') ? userId : parseInt(userId);

    const success = manager.sessionManager.resetConversation(botId, parsedUserId);

    if (!success) {
      // No existing session - that's fine, next message will create one
      return res.json({
        success: true,
        message: 'Ready to start new session on next message'
      });
    }

    res.json({
      success: true,
      message: 'New session created - previous session archived'
    });
  } catch (error) {
    console.error('❌ Error creating new session:', error);
    res.status(500).json({
      error: 'Failed to create new session',
      details: error.message
    });
  }
});

// GET /all-sessions - List all session files from Claude projects folder
app.get('/all-sessions', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  try {
    // Get workspace from query params (e.g., /all-sessions?workspace=/opt/lab)
    const workspacePath = req.query.workspace || '/opt/lab/claude-bot';

    // Convert workspace path to Claude projects directory name
    // Example: /opt/lab -> -opt-lab
    const dirName = workspacePath.replace(/\//g, '-');
    const sessionsDir = path.join(os.homedir(), '.claude/projects', dirName);

    if (!fs.existsSync(sessionsDir)) {
      return res.json({ sessions: [] });
    }

    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
      .map(f => {
        const filePath = path.join(sessionsDir, f);
        const stats = fs.statSync(filePath);
        const uuid = f.replace('.jsonl', '');

        // Count messages by reading file
        let messageCount = 0;
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.trim().split('\n').filter(line => line.trim());
          for (const line of lines) {
            const entry = JSON.parse(line);
            if (entry.type === 'user' || entry.type === 'assistant') {
              messageCount++;
            }
          }
        } catch (err) {
          // Skip count if error
        }

        return {
          uuid,
          messageCount,
          updatedAt: stats.mtime.toISOString(),
          createdAt: stats.birthtime.toISOString(),
          size: stats.size
        };
      })
      .filter(s => s.size > 0) // Only non-empty sessions
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    res.json({
      sessions: files,
      totalSessions: files.length
    });
  } catch (error) {
    console.error('❌ Error listing sessions:', error);
    res.status(500).json({
      error: 'Failed to list sessions',
      details: error.message
    });
  }
});

// GET /messages/:sessionUuid - Get messages from database (source of truth)
app.get('/messages/:sessionUuid', async (req, res) => {
  const { sessionUuid } = req.params;

  try {
    // Load messages from database (new source of truth)
    const messages = await messageStore.loadMessages(sessionUuid, 1000);

    if (messages.length > 0) {
      // Transform to frontend format
      const formattedMessages = messages.map((msg) => ({
        id: msg.id,
        text: msg.content,
        sender: msg.role === 'user' ? 'user' : 'bot',
        timestamp: new Date(msg.created_at).getTime(),
        role: msg.role,
        messageType: msg.message_type,
        metadata: msg.metadata
      }));

      res.json({
        sessionUuid,
        messages: formattedMessages,
        messageCount: formattedMessages.length,
        source: 'database'
      });
    } else {
      // Fallback to Claude CLI files for sessions created before migration
      // This can be removed once all old sessions are migrated
      let workspacePath = req.query.workspace;
      const botId = req.query.botId;
      const userId = req.query.userId;

      if (!workspacePath && botId && userId) {
        const metadata = manager.sessionManager.loadSessionMetadata(botId, parseInt(userId));
        if (metadata && metadata.workspacePath) {
          workspacePath = metadata.workspacePath;
        }
      }

      const legacyMessages = manager.readSessionMessages(sessionUuid, 1000, workspacePath);

      const formattedMessages = legacyMessages.map((msg, index) => ({
        id: `legacy-${msg.role}-${index}`,
        text: msg.text,
        sender: msg.role === 'user' ? 'user' : 'bot',
        timestamp: Date.now() - (legacyMessages.length - index) * 1000,
        role: msg.role,
        messageType: 'text',
        metadata: {}
      }));

      res.json({
        sessionUuid,
        messages: formattedMessages,
        messageCount: formattedMessages.length,
        source: 'legacy_cli'
      });
    }
  } catch (error) {
    console.error('❌ Error reading session messages:', error);
    res.status(500).json({
      error: 'Failed to read session messages',
      details: error.message
    });
  }
});

// WebSocket connection handling for UI
io.on('connection', (socket) => {
  console.log(`🔌 UI client connected: ${socket.id}`);

  // Handle incoming messages from UI
  socket.on('send-message', async (data) => {
    const { botId, userId, message, workspacePath, sessionUuid: requestedSessionUuid } = data;
    console.log(`📨 Message from UI for bot ${botId} (workspace: ${workspacePath})${requestedSessionUuid ? ` [session: ${requestedSessionUuid.substring(0, 8)}...]` : ''}:`, message);

    try {
      // Check if bot instance exists in manager
      let botInfo = manager.bots.get(botId);

      if (!botInfo) {
        // Bot not loaded yet - load on-demand from bot instance
        console.log(`🔄 Loading bot instance ${botId} on-demand from database`);

        try {
          // botId is now instance_slug - fetch the bot instance
          const { createClient } = require('@supabase/supabase-js');
          const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
          );

          // Fetch bot instance
          const { data: instance, error: instanceError } = await supabase
            .from('my_agents')
            .select('*, agent:marketplace_agents(*)')
            .eq('instance_slug', botId)
            .single();

          if (instanceError || !instance) {
            console.error(`❌ Bot instance ${botId} not found:`, instanceError);
            socket.emit('error', { message: `Bot instance ${botId} not found` });
            return;
          }

          console.log(`✅ Found bot instance ${botId}, agent: ${instance.agent.slug}`);

          // Merge agent brain_config with instance config_overrides
          const mergedConfig = {
            ...instance.agent.brain_config,
            ...instance.config_overrides
          };

          // Add bot to manager with merged config
          await manager.addBot({
            id: botId, // Use instance_slug as botId
            brain: instance.agent.slug, // Agent slug for brain loading
            brainConfig: mergedConfig, // Pass merged config
            webOnly: true
          });

          botInfo = manager.bots.get(botId);

          if (!botInfo) {
            console.error(`❌ Bot instance ${botId} not found in manager after loading`);
            socket.emit('error', { message: `Bot instance ${botId} not found` });
            return;
          }

          console.log(`✅ Bot instance ${botId} loaded successfully`);
        } catch (error) {
          console.error(`❌ Failed to load bot instance ${botId}:`, error.message, error.stack);

          let errorMessage = `Bot instance ${botId} not available`;

          if (error.message && error.message.includes('not found')) {
            errorMessage = `Bot instance ${botId} not found`;
          } else if (error.message && error.message.includes('database')) {
            errorMessage = 'Marketplace temporarily unavailable';
          } else if (error.message) {
            errorMessage = `Failed to load bot instance: ${error.message}`;
          }

          socket.emit('error', { message: errorMessage });
          return;
        }
      }

      // ========== Orchestrator Routing ==========
      // If this is an orchestrator agent, route to workflow system instead of normal chat
      // BUT still use the same session tracking so history persists
      const isOrchestrator = botInfo.config?.brain === 'orchestrator' ||
                              botInfo.config?.brainConfig?.isOrchestrator === true;

      if (isOrchestrator) {
        console.log(`🎭 [${botId}] Orchestrator detected - routing to workflow system`);

        // ========== ORCHESTRATOR SESSION MANAGEMENT ==========
        // Same approach: we control session IDs, Claude's is just for --resume
        let ourSessionId = requestedSessionUuid;
        let isNewOrchestratorSession = false;

        if (!ourSessionId || ourSessionId === 'new') {
          ourSessionId = messageStore.generateSessionId();
          isNewOrchestratorSession = true;
          console.log(`🆕 [${botId}] New orchestrator session ${ourSessionId.substring(0, 8)}... for user ${userId}`);
        }

        // Get CLI session ID for existing sessions
        let cliSessionId = null;
        if (!isNewOrchestratorSession) {
          cliSessionId = await messageStore.getCliSessionId(ourSessionId);
        }

        // ========== SAVE USER MESSAGE IMMEDIATELY ==========
        await messageStore.saveUserMessage(ourSessionId, userId, botId, message, cliSessionId);
        console.log(`💾 [${botId}] Saved orchestrator user message to DB BEFORE workflow`);

        const logicalWorkspace = workspacePath || process.cwd();

        try {
          // Start workflow with the user's message as the goal
          const result = await workflowHandler.startWorkflow({
            userId,
            goal: message,
            sessionId: cliSessionId, // Pass CLI session for --resume (if exists)
            onProgress: (type, progressData) => {
              socket.emit('workflow:progress', { type, ...progressData });
            }
          });

          // Get CLI session ID from workflow result
          const newCliSessionId = result.sessionId;

          // Link CLI session to our session
          if (newCliSessionId && isNewOrchestratorSession) {
            await messageStore.linkCliSession(ourSessionId, newCliSessionId);
            cliSessionId = newCliSessionId;
          }

          // Update legacy session manager
          manager.sessionManager.setCurrentUuid(botId, userId, ourSessionId, logicalWorkspace);
          manager.sessionManager.incrementMessageCount(botId, userId, ourSessionId);
          manager.sessionManager.incrementMessageCount(botId, userId, ourSessionId);

          // Emit the appropriate event based on result status
          if (result.status === 'needs_discovery') {
            // Orchestrator needs more info before creating plan
            socket.emit('workflow:discovery', {
              workflowId: result.workflowId,
              status: 'needs_discovery',
              questions: result.questions,
              message: result.message
            });
            console.log(`❓ [${botId}] Workflow needs discovery: ${result.workflowId}`);

            const discoveryMessage = result.message || '❓ I need a bit more information to create a plan. Please answer the questions in the workflow panel.';

            // Save workflow discovery message to database
            await messageStore.saveWorkflowMessage(
              ourSessionId, userId, botId, 'discovery',
              { workflowId: result.workflowId, questions: result.questions },
              discoveryMessage, cliSessionId
            );
            console.log(`💾 [${botId}] Saved workflow discovery message to DB`);

            socket.emit('bot-message', {
              botId,
              userId,
              message: discoveryMessage,
              sessionUuid: ourSessionId,
              hasAudio: false,
              hasImages: false,
              timestamp: Date.now()
            });
          } else if (result.status === 'needs_clarification') {
            // Orchestrator needs single clarification
            socket.emit('workflow:clarify', {
              workflowId: result.workflowId,
              status: 'needs_clarification',
              question: result.question,
              message: result.message
            });
            console.log(`❓ [${botId}] Workflow needs clarification: ${result.workflowId}`);

            const clarifyMessage = result.message || result.question;

            // Save workflow clarification message to database
            await messageStore.saveWorkflowMessage(
              ourSessionId, userId, botId, 'discovery',
              { workflowId: result.workflowId, question: result.question },
              clarifyMessage, cliSessionId
            );
            console.log(`💾 [${botId}] Saved workflow clarification message to DB`);

            socket.emit('bot-message', {
              botId,
              userId,
              message: clarifyMessage,
              sessionUuid: ourSessionId,
              hasAudio: false,
              hasImages: false,
              timestamp: Date.now()
            });
          } else {
            // Regular plan created
            socket.emit('workflow:planned', result);
            console.log(`✅ [${botId}] Workflow plan created: ${result.workflowId}`);

            const planMessage = `📋 **Workflow Plan Created**\n\nI've analyzed your goal and created a plan with ${result.plan?.steps?.length || 0} steps. Check the workflow panel to review and approve it.`;

            // Save workflow plan message to database
            await messageStore.saveWorkflowMessage(
              ourSessionId, userId, botId, 'plan',
              { workflowId: result.workflowId, plan: result.plan },
              planMessage, cliSessionId
            );
            console.log(`💾 [${botId}] Saved workflow plan message to DB`);

            socket.emit('bot-message', {
              botId,
              userId,
              message: planMessage,
              sessionUuid: ourSessionId,
              hasAudio: false,
              hasImages: false,
              timestamp: Date.now()
            });
          }

        } catch (error) {
          console.error(`❌ [${botId}] Workflow error:`, error);
          socket.emit('workflow:error', { error: error.message });

          const errorMessage = `❌ Error creating workflow plan: ${error.message}`;

          // Save workflow error message to database
          // ourSessionId is always defined at this point (generated at start of orchestrator block)
          await messageStore.saveWorkflowMessage(
            ourSessionId, userId, botId, 'error',
            { error: error.message },
            errorMessage, cliSessionId
          ).catch(e => console.error('Failed to save error message:', e));

          socket.emit('bot-message', {
            botId,
            userId,
            message: errorMessage,
            sessionUuid: ourSessionId,
            hasAudio: false,
            hasImages: false,
            timestamp: Date.now()
          });
        }

        return; // Skip normal chat flow (orchestrator handled above)
      }

      // ========== NEW SESSION MANAGEMENT ==========
      // We now control session IDs ourselves. Claude's session ID is just for --resume.
      //
      // requestedSessionUuid = OUR session UUID from frontend (for loading existing sessions)
      // cliSessionId = Claude's session ID (stored in DB, used for --resume)

      // Determine our session UUID
      let ourSessionId = requestedSessionUuid;
      let isNewSession = false;

      if (!ourSessionId || ourSessionId === 'new') {
        // New session: generate our own UUID
        ourSessionId = messageStore.generateSessionId();
        isNewSession = true;
        console.log(`🆕 [${botId}] New session ${ourSessionId.substring(0, 8)}... for user ${userId}`);
      } else {
        console.log(`📝 [${botId}] Resuming session ${ourSessionId.substring(0, 8)}... for user ${userId}`);
      }

      // Get CLI session ID for --resume (if this is an existing session)
      let cliSessionId = null;
      if (!isNewSession) {
        cliSessionId = await messageStore.getCliSessionId(ourSessionId);
        if (cliSessionId) {
          console.log(`🔗 [${botId}] Found CLI session ${cliSessionId.substring(0, 8)}... for --resume`);
        }
      }

      // ========== SAVE USER MESSAGE IMMEDIATELY ==========
      // This ensures the message is persisted even if Claude fails
      await messageStore.saveUserMessage(ourSessionId, userId, botId, message, cliSessionId);
      console.log(`💾 [${botId}] Saved user message to DB BEFORE calling Claude`);

      // Build system prompt for new sessions
      const brain = botInfo.brain;
      let fullMessage;

      if (isNewSession) {
        // New session: include system prompt from brain
        const systemPrompt = await manager.brainLoader.buildSystemPrompt(
          botInfo.config.brain,
          { id: userId, username: 'ui_user' } // Mock user object for UI
        );
        const securityReminder = await manager.brainLoader.getSecurityReminder(botInfo.config.brain);

        // Debug: Log first 300 chars of system prompt
        console.log(`🧠 [${botId}] System prompt preview: ${systemPrompt.substring(0, 300)}...`);

        // Wrap user text in delimiters so we can extract it when reading logs
        fullMessage = securityReminder
          ? `${systemPrompt}\n\n---\n\n${securityReminder}\n\n<<<USER_TEXT_START>>>${message}<<<USER_TEXT_END>>>`
          : `${systemPrompt}\n\n<<<USER_TEXT_START>>>${message}<<<USER_TEXT_END>>>`;
      } else {
        // Resumed session: just security reminder (if enabled)
        const securityReminder = await manager.brainLoader.getSecurityReminder(botInfo.config.brain);

        // Wrap user text in delimiters so we can extract it when reading logs
        fullMessage = securityReminder
          ? `${securityReminder}\n\n<<<USER_TEXT_START>>>${message}<<<USER_TEXT_END>>>`
          : `<<<USER_TEXT_START>>>${message}<<<USER_TEXT_END>>>`;
      }

      // Send to Claude directly (bypass Telegram)
      const { sendToClaudeSession } = require('./lib/claude-client');

      socket.emit('bot-thinking', { botId });

      const result = await sendToClaudeSession({
        message: fullMessage,
        sessionId: cliSessionId, // Pass CLI session ID for --resume (null for new sessions)
        claudeCmd: manager.claudeCmd,
        // IMPORTANT: Always use process.cwd() for physical spawning (all instances share same directory)
        // workspacePath is only for logical tracking/organization
        workspacePath: process.cwd(),
        // Stream chunks to frontend as they arrive
        onStream: (chunk) => {
          socket.emit('bot-chunk', {
            botId,
            userId,
            chunk,
            timestamp: Date.now()
          });
        }
      });

      // Get Claude's CLI session ID from the response
      const newCliSessionId = result.metadata?.sessionInfo?.sessionId;

      // Link CLI session ID to our session (for future --resume)
      if (newCliSessionId && isNewSession) {
        await messageStore.linkCliSession(ourSessionId, newCliSessionId);
        cliSessionId = newCliSessionId;
      }

      // Update legacy session manager (for backwards compatibility)
      if (newCliSessionId) {
        const logicalWorkspace = workspacePath || process.cwd();
        manager.sessionManager.setCurrentUuid(botId, userId, ourSessionId, logicalWorkspace);
        manager.sessionManager.incrementMessageCount(botId, userId, ourSessionId);
        manager.sessionManager.incrementMessageCount(botId, userId, ourSessionId);
      }

      if (result.success && result.text) {
        // Save assistant message to database
        await messageStore.saveAssistantMessage(ourSessionId, userId, botId, result.text, cliSessionId);
        console.log(`💾 [${botId}] Saved assistant message to DB`);

        // Send response back to UI (include OUR sessionUuid so frontend can use it)
        socket.emit('bot-message', {
          botId,
          userId,
          message: result.text,
          sessionUuid: ourSessionId, // OUR session ID, not Claude's
          hasAudio: false,  // REQUIRED by frontend BotMessage interface
          hasImages: false, // REQUIRED by frontend BotMessage interface
          timestamp: Date.now()
        });

        console.log(`✅ [${botId}] Response sent to UI (${result.text.length} chars)`);
      } else {
        socket.emit('error', { message: 'Bot returned no response' });
      }
    } catch (error) {
      console.error('❌ Error handling UI message:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // Terminal handlers
  socket.on('terminal:create', (data) => {
    const { terminalId, cwd, cols, rows, botId } = data;
    console.log(`🖥️  Create terminal request: ${terminalId}`);

    try {
      // If terminal already exists, kill it first (handles refresh/remount)
      const existing = terminalManager.get(terminalId);
      if (existing) {
        console.log(`🔄 Terminal ${terminalId} already exists, killing and recreating...`);
        terminalManager.kill(terminalId);
      }

      const terminal = terminalManager.create(terminalId, {
        cwd: cwd || process.cwd(),
        cols: cols || 80,
        rows: rows || 30,
        botId
      });

      // Track this terminal for this socket
      if (!socketTerminals.has(socket.id)) {
        socketTerminals.set(socket.id, new Set());
      }
      socketTerminals.get(socket.id).add(terminalId);

      // Attach data listener to stream output to client
      const terminalObj = terminalManager.get(terminalId);
      if (terminalObj) {
        terminalObj.ptyProcess.onData((data) => {
          socket.emit('terminal:output', { terminalId, data });
        });

        terminalObj.ptyProcess.onExit(({ exitCode, signal }) => {
          console.log(`🖥️  Terminal ${terminalId} exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ''}`);
          socket.emit('terminal:exit', { terminalId, exitCode, signal });
          terminalManager.kill(terminalId);
        });
      }

      socket.emit('terminal:created', { terminalId, ...terminal });
    } catch (error) {
      console.error(`❌ Error creating terminal ${terminalId}:`, error);
      socket.emit('terminal:error', { terminalId, error: error.message });
    }
  });

  socket.on('terminal:input', (data) => {
    const { terminalId, data: inputData } = data;
    try {
      terminalManager.write(terminalId, inputData);
    } catch (error) {
      console.error(`❌ Error writing to terminal ${terminalId}:`, error);
      socket.emit('terminal:error', { terminalId, error: error.message });
    }
  });

  socket.on('terminal:resize', (data) => {
    const { terminalId, cols, rows } = data;
    try {
      terminalManager.resize(terminalId, cols, rows);
    } catch (error) {
      console.error(`❌ Error resizing terminal ${terminalId}:`, error);
      socket.emit('terminal:error', { terminalId, error: error.message });
    }
  });

  socket.on('terminal:kill', (data) => {
    const { terminalId } = data;
    try {
      terminalManager.kill(terminalId);

      // Remove from tracking
      const terminals = socketTerminals.get(socket.id);
      if (terminals) {
        terminals.delete(terminalId);
      }

      socket.emit('terminal:killed', { terminalId });
    } catch (error) {
      console.error(`❌ Error killing terminal ${terminalId}:`, error);
      socket.emit('terminal:error', { terminalId, error: error.message });
    }
  });

  // ========== Workflow Handlers ==========

  // Start a new workflow with a user goal
  socket.on('workflow:start', async (data) => {
    const { userId, goal } = data;
    console.log(`🔄 [Workflow] Starting workflow for user ${userId}: "${goal.substring(0, 50)}..."`);

    try {
      const result = await workflowHandler.startWorkflow({
        userId,
        goal,
        onProgress: (type, progressData) => {
          socket.emit('workflow:progress', { type, ...progressData });
        }
      });

      socket.emit('workflow:planned', result);
      console.log(`✅ [Workflow] Plan created: ${result.workflowId}`);

    } catch (error) {
      console.error(`❌ [Workflow] Error starting workflow:`, error);
      socket.emit('workflow:error', { error: error.message });
    }
  });

  // Approve and execute a workflow plan
  socket.on('workflow:approve', async (data) => {
    const { workflowId, stepConfigs } = data;
    console.log(`✅ [Workflow] User approved workflow: ${workflowId}`);
    if (stepConfigs?.length) {
      console.log(`   📋 With ${stepConfigs.length} action step config(s)`);
    }

    try {
      const result = await workflowHandler.executeWorkflow(
        workflowId,
        (type, progressData) => {
          socket.emit('workflow:progress', { workflowId, type, ...progressData });
        },
        { stepConfigs }
      );

      socket.emit('workflow:complete', result);
      console.log(`✅ [Workflow] Completed: ${workflowId}`);

    } catch (error) {
      console.error(`❌ [Workflow] Error executing workflow:`, error);
      socket.emit('workflow:error', { workflowId, error: error.message });
    }
  });

  // Resume a paused workflow with user input
  socket.on('workflow:resume', async (data) => {
    const { workflowId, userInput } = data;
    console.log(`🔄 [Workflow] Resuming workflow ${workflowId} with input`);

    try {
      const result = await workflowHandler.resumeWorkflow(
        workflowId,
        userInput,
        (type, progressData) => {
          socket.emit('workflow:progress', { workflowId, type, ...progressData });
        }
      );

      if (result.status === 'completed') {
        socket.emit('workflow:complete', result);
      } else {
        socket.emit('workflow:status', result);
      }

    } catch (error) {
      console.error(`❌ [Workflow] Error resuming workflow:`, error);
      socket.emit('workflow:error', { workflowId, error: error.message });
    }
  });

  // Cancel a workflow
  socket.on('workflow:cancel', (data) => {
    const { workflowId } = data;
    console.log(`🛑 [Workflow] Cancelling workflow: ${workflowId}`);

    workflowHandler.cancelWorkflow(workflowId);
    socket.emit('workflow:cancelled', { workflowId });
  });

  // Get workflow status
  socket.on('workflow:status', (data) => {
    const { workflowId } = data;
    const status = workflowHandler.getWorkflowStatus(workflowId);

    if (status) {
      socket.emit('workflow:status', status);
    } else {
      socket.emit('workflow:error', { workflowId, error: 'Workflow not found' });
    }
  });

  // ========== Agent Management Handlers ==========

  // Create a new agent
  socket.on('agent:create', async (data) => {
    const {
      userId,
      slug,
      name,
      description,
      systemPrompt,
      agentType = 'utility',
      capabilities = ['text'],
      inputSchema = null,
      outputSchema = null
    } = data;

    console.log(`🤖 [Agent] Creating agent "${slug}" for user ${userId}`);

    // Validate required fields
    if (!userId || !slug || !name || !systemPrompt) {
      socket.emit('agent:error', {
        error: 'Missing required fields: userId, slug, name, systemPrompt'
      });
      return;
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      socket.emit('agent:error', {
        error: 'Invalid slug format. Must be lowercase alphanumeric with hyphens.'
      });
      return;
    }

    try {
      const newAgent = await workflowHandler.createAgentInDatabase({
        userId,
        slug,
        name,
        description: description || `Agent: ${name}`,
        systemPrompt,
        agentType,
        capabilities,
        inputSchema,
        outputSchema
      });

      console.log(`✅ [Agent] Created agent "${slug}"`);
      socket.emit('agent:created', { agent: newAgent });

    } catch (error) {
      console.error(`❌ [Agent] Error creating agent:`, error);
      socket.emit('agent:error', { error: error.message });
    }
  });

  // List agents for a user
  socket.on('agent:list', async (data) => {
    const { userId } = data;

    if (!userId) {
      socket.emit('agent:error', { error: 'userId is required' });
      return;
    }

    try {
      const agents = await workflowHandler.getAvailableAgents(userId);
      socket.emit('agent:list', { agents });
    } catch (error) {
      console.error(`❌ [Agent] Error listing agents:`, error);
      socket.emit('agent:error', { error: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔌 UI client disconnected: ${socket.id}`);

    // Clean up terminals associated with this socket
    const terminals = socketTerminals.get(socket.id);
    if (terminals && terminals.size > 0) {
      console.log(`🧹 Cleaning up ${terminals.size} terminal(s) for socket ${socket.id}`);
      for (const terminalId of terminals) {
        try {
          terminalManager.kill(terminalId);
          console.log(`  ✓ Killed terminal ${terminalId}`);
        } catch (error) {
          console.error(`  ❌ Error killing terminal ${terminalId}:`, error.message);
        }
      }
      socketTerminals.delete(socket.id);
    }
  });
});

// Store reference to io for bot manager to emit messages
manager.io = io;

/**
 * Connect to WebSocket proxy for remote IDE connections
 * Includes auto-reconnect with exponential backoff
 */
let proxyReconnectAttempts = 0;
let proxyReconnectTimer = null;
let isConnectingToProxy = false;
let keepaliveInterval = null;
let currentProxySocket = null; // Store reference for forced reconnection

/**
 * Force reconnect to proxy with a new URL (called when tunnel URL changes)
 */
function forceReconnectProxy() {
  console.log('🔄 Forcing proxy reconnection with new tunnel URL...');

  // Clear any pending reconnect
  if (proxyReconnectTimer) {
    clearTimeout(proxyReconnectTimer);
    proxyReconnectTimer = null;
  }

  // Close existing connection
  if (currentProxySocket) {
    try {
      currentProxySocket.close(1000, 'Reconnecting with new URL');
    } catch (err) {
      // Ignore close errors
    }
    currentProxySocket = null;
  }

  // Reset state
  isConnectingToProxy = false;
  proxyReconnectAttempts = 0;

  // Reconnect
  connectToProxy();
}

async function connectToProxy() {
  const userId = process.env.USER_ID;
  const proxyUrl = process.env.IDE_WS_PROXY_URL || 'wss://ide-ws.labcart.io';

  if (!userId) {
    console.log('ℹ️  No USER_ID configured - skipping proxy connection');
    console.log('   Set USER_ID env var to enable IDE proxy\n');
    return;
  }

  // Prevent multiple simultaneous connection attempts
  if (isConnectingToProxy) {
    console.log('⏸️  Already connecting to IDE proxy, skipping...');
    return;
  }

  isConnectingToProxy = true;

  try {
    const WebSocket = require('ws');

    // Use dynamically detected tunnel URL (or fallback to .env for backward compatibility)
    const serverUrl = currentTunnelUrl || process.env.SERVER_URL || `http://localhost:${HTTP_PORT}`;

    console.log(`🔌 Connecting to IDE WebSocket proxy...`);
    console.log(`   Proxy URL: ${proxyUrl}`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Server URL: ${serverUrl}${currentTunnelUrl ? ' (dynamic)' : ' (static from .env)'}`);

    // Warn if using stale .env URL
    if (!currentTunnelUrl && process.env.SERVER_URL) {
      console.log(`   ⚠️  Using SERVER_URL from .env - tunnel manager not active`);
    }

    // Connect as bot-server to proxy using raw WebSocket
    const wsUrl = `${proxyUrl}?userId=${encodeURIComponent(userId)}&type=bot-server&serverUrl=${encodeURIComponent(serverUrl)}`;
    const proxySocket = new WebSocket(wsUrl);
    currentProxySocket = proxySocket; // Store reference for forced reconnection

    proxySocket.on('open', () => {
      console.log(`✅ IDE proxy bridge established`);
      isConnectingToProxy = false;
      proxyReconnectAttempts = 0; // Reset reconnect counter on success

      // Setup keepalive ping every 30 seconds
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      keepaliveInterval = setInterval(() => {
        if (proxySocket.readyState === WebSocket.OPEN) {
          proxySocket.ping();
        }
      }, 30000);
    });

    proxySocket.on('close', (code, reason) => {
      console.log(`⚠️  Disconnected from IDE proxy: ${reason || code}`);
      isConnectingToProxy = false;

      // Clear keepalive
      if (keepaliveInterval) {
        clearInterval(keepaliveInterval);
        keepaliveInterval = null;
      }

      // Auto-reconnect with exponential backoff
      const delays = [5000, 10000, 20000, 30000]; // 5s, 10s, 20s, 30s (max)
      const delay = delays[Math.min(proxyReconnectAttempts, delays.length - 1)];

      proxyReconnectAttempts++;
      console.log(`🔄 Attempting reconnect ${proxyReconnectAttempts} in ${delay/1000}s...`);

      if (proxyReconnectTimer) clearTimeout(proxyReconnectTimer);
      proxyReconnectTimer = setTimeout(() => {
        connectToProxy();
      }, delay);
    });

    proxySocket.on('error', (error) => {
      console.error(`❌ IDE proxy error:`, error.message);
      isConnectingToProxy = false;
    });

    proxySocket.on('pong', () => {
      // Keepalive pong received - connection alive
    });

    // Handle messages from proxy (from frontend IDE clients)
    proxySocket.on('message', async (rawData) => {
      try {
        const message = JSON.parse(rawData.toString());
        const eventType = message.event || message.type;
        const data = message.data;
        console.log('📨 Received from IDE proxy:', eventType || 'unknown');

        // Helper to send response back through proxy
        const sendToProxy = (event, data) => {
          if (proxySocket.readyState === WebSocket.OPEN) {
            proxySocket.send(JSON.stringify({ event, data }));
          }
        };

        // Process messages directly (no Socket.IO clients exist in proxy mode)
        switch (eventType) {
          case 'chat:send':
          case 'send-message': {
            const { botId, userId, message: userMessage, workspacePath, sessionUuid: requestedSessionUuid } = data;
            console.log(`📨 Message from IDE for bot ${botId} (workspace: ${workspacePath}):`, userMessage);

            try {
              let botInfo = manager.bots.get(botId);

              if (!botInfo) {
                // Bot not loaded yet - load on-demand from Supabase
                // IDE now sends instance_slug (same as Market mode)
                console.log(`🔄 Loading bot instance ${botId} on-demand from database (IDE mode)`);

                try {
                  const { createClient } = require('@supabase/supabase-js');
                  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
                  const supabase = createClient(
                    supabaseUrl,
                    process.env.SUPABASE_SERVICE_ROLE_KEY
                  );

                  // IDE now sends instance_slug (same as Market mode)
                  const { data: instance, error: instanceError } = await supabase
                    .from('my_agents')
                    .select('*, agent:marketplace_agents(*)')
                    .eq('instance_slug', botId)
                    .single();

                  if (instanceError || !instance) {
                    console.error(`❌ Bot instance ${botId} not found:`, instanceError);
                    sendToProxy('error', { message: `Bot instance ${botId} not found` });
                    return;
                  }

                  console.log(`✅ Found bot instance ${botId}, agent: ${instance.agent?.slug || instance.instance_slug}`);

                  // Merge agent brain_config with instance config_overrides
                  const mergedConfig = {
                    ...(instance.agent?.brain_config || {}),
                    ...instance.config_overrides
                  };

                  // Add bot to manager with merged config
                  await manager.addBot({
                    id: botId,
                    brain: instance.agent?.slug || instance.instance_slug,
                    brainConfig: mergedConfig,
                    webOnly: true
                  });

                  botInfo = manager.bots.get(botId);

                  if (!botInfo) {
                    console.error(`❌ Bot instance ${botId} not found in manager after loading`);
                    sendToProxy('error', { message: `Bot instance ${botId} not found` });
                    return;
                  }

                  console.log(`✅ Bot instance ${botId} loaded successfully (IDE mode)`);
                } catch (loadError) {
                  console.error(`❌ Failed to load bot instance ${botId}:`, loadError.message);
                  sendToProxy('error', { message: `Failed to load bot: ${loadError.message}` });
                  return;
                }
              }

              // ========== SESSION MANAGEMENT (same as Market mode) ==========
              let ourSessionId = requestedSessionUuid;
              let isNewSession = false;

              if (!ourSessionId || ourSessionId === 'new') {
                ourSessionId = messageStore.generateSessionId();
                isNewSession = true;
                console.log(`🆕 [${botId}] New IDE session ${ourSessionId.substring(0, 8)}... for user ${userId}`);
              } else {
                console.log(`📝 [${botId}] Resuming IDE session ${ourSessionId.substring(0, 8)}... for user ${userId}`);
              }

              // Get CLI session ID for --resume (if existing session)
              let cliSessionId = null;
              if (!isNewSession) {
                cliSessionId = await messageStore.getCliSessionId(ourSessionId);
                if (cliSessionId) {
                  console.log(`🔗 [${botId}] Found CLI session ${cliSessionId.substring(0, 8)}... for --resume`);
                }
              }

              // ========== SAVE USER MESSAGE IMMEDIATELY ==========
              await messageStore.saveUserMessage(ourSessionId, userId, botId, userMessage, cliSessionId);
              console.log(`💾 [${botId}] Saved user message to DB BEFORE calling Claude`);

              // Build system prompt for new sessions
              let fullMessage;
              if (isNewSession) {
                const systemPrompt = await manager.brainLoader.buildSystemPrompt(
                  botInfo.config.brain,
                  { id: userId, username: 'ide_user' }
                );
                const securityReminder = await manager.brainLoader.getSecurityReminder(botInfo.config.brain);

                fullMessage = securityReminder
                  ? `${systemPrompt}\n\n---\n\n${securityReminder}\n\n<<<USER_TEXT_START>>>${userMessage}<<<USER_TEXT_END>>>`
                  : `${systemPrompt}\n\n<<<USER_TEXT_START>>>${userMessage}<<<USER_TEXT_END>>>`;
              } else {
                const securityReminder = await manager.brainLoader.getSecurityReminder(botInfo.config.brain);
                fullMessage = securityReminder
                  ? `${securityReminder}\n\n<<<USER_TEXT_START>>>${userMessage}<<<USER_TEXT_END>>>`
                  : `<<<USER_TEXT_START>>>${userMessage}<<<USER_TEXT_END>>>`;
              }

              // Send to Claude directly
              const { sendToClaudeSession } = require('./lib/claude-client');

              sendToProxy('bot-thinking', { botId });

              const result = await sendToClaudeSession({
                message: fullMessage,
                sessionId: cliSessionId,  // Use CLI session ID for --resume
                claudeCmd: manager.claudeCmd,
                workspacePath: workspacePath || process.env.LABCART_WORKSPACE || process.cwd(),
                // Stream chunks to frontend as they arrive
                onStream: (chunk) => {
                  sendToProxy('bot-chunk', {
                    botId,
                    userId,
                    chunk,
                    timestamp: Date.now()
                  });
                }
              });

              // Get Claude's CLI session ID from the response
              const newCliSessionId = result.metadata?.sessionInfo?.sessionId;

              // Link CLI session ID to our session (for future --resume)
              if (newCliSessionId && isNewSession) {
                await messageStore.linkCliSession(ourSessionId, newCliSessionId);
                cliSessionId = newCliSessionId;
              }

              // Update legacy session manager (for backwards compatibility)
              if (newCliSessionId) {
                const logicalWorkspace = workspacePath || process.env.LABCART_WORKSPACE || process.cwd();
                manager.sessionManager.setCurrentUuid(botId, userId, ourSessionId, logicalWorkspace);
                manager.sessionManager.incrementMessageCount(botId, userId, ourSessionId);
                manager.sessionManager.incrementMessageCount(botId, userId, ourSessionId);
              }

              if (result.success && result.text) {
                // Save assistant message to database
                await messageStore.saveAssistantMessage(ourSessionId, userId, botId, result.text, cliSessionId);
                console.log(`💾 [${botId}] Saved assistant message to DB`);

                // Send response back to UI (include OUR sessionUuid so frontend can use it)
                sendToProxy('bot-message', {
                  botId,
                  userId,
                  message: result.text,
                  sessionUuid: ourSessionId,  // OUR session ID, not Claude's
                  hasAudio: false,
                  hasImages: false,
                  timestamp: Date.now()
                });

                console.log(`✅ [${botId}] Response sent to IDE (${result.text.length} chars)`);
              } else {
                sendToProxy('error', { message: 'Bot returned no response' });
              }
            } catch (error) {
              console.error('❌ Error handling IDE message:', error);
              sendToProxy('error', { message: error.message });
            }
            break;
          }

          case 'terminal:create': {
            const { terminalId, cwd, cols, rows, botId } = data;
            console.log(`🖥️  Create terminal request from IDE: ${terminalId}`);

            try {
              // If terminal already exists, kill it first
              const existing = terminalManager.get(terminalId);
              if (existing) {
                console.log(`🔄 Terminal ${terminalId} already exists, killing and recreating...`);
                terminalManager.kill(terminalId);
              }

              const terminal = terminalManager.create(terminalId, {
                cwd: cwd || process.cwd(),
                cols: cols || 80,
                rows: rows || 30,
                botId
              });

              // Attach data listener to stream output back to IDE
              const terminalObj = terminalManager.get(terminalId);
              if (terminalObj) {
                terminalObj.ptyProcess.onData((data) => {
                  sendToProxy('terminal:output', { terminalId, data });
                });

                terminalObj.ptyProcess.onExit(({ exitCode, signal }) => {
                  console.log(`🖥️  Terminal ${terminalId} exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ''}`);
                  sendToProxy('terminal:exit', { terminalId, exitCode, signal });
                  terminalManager.kill(terminalId);
                });
              }

              sendToProxy('terminal:created', { terminalId, ...terminal });
            } catch (error) {
              console.error(`❌ Error creating terminal ${terminalId}:`, error);
              sendToProxy('terminal:error', { terminalId, error: error.message });
            }
            break;
          }

          case 'terminal:input': {
            const { terminalId, data: inputData } = data;
            try {
              terminalManager.write(terminalId, inputData);
            } catch (error) {
              console.error(`❌ Error writing to terminal ${terminalId}:`, error);
              sendToProxy('terminal:error', { terminalId, error: error.message });
            }
            break;
          }

          case 'terminal:resize': {
            const { terminalId, cols, rows } = data;
            try {
              terminalManager.resize(terminalId, cols, rows);
            } catch (error) {
              console.error(`❌ Error resizing terminal ${terminalId}:`, error);
              sendToProxy('terminal:error', { terminalId, error: error.message });
            }
            break;
          }

          case 'terminal:kill': {
            const { terminalId } = data;
            try {
              terminalManager.kill(terminalId);
              sendToProxy('terminal:killed', { terminalId });
            } catch (error) {
              console.error(`❌ Error killing terminal ${terminalId}:`, error);
              sendToProxy('terminal:error', { terminalId, error: error.message });
            }
            break;
          }

          default:
            console.log('⚠️  Unknown message from IDE:', eventType, message);
        }
      } catch (error) {
        console.error('❌ Error parsing proxy message:', error);
      }
    });

    // Store proxy socket reference for bot manager to emit messages back
    manager.proxySocket = proxySocket;

  } catch (error) {
    console.error(`❌ Failed to connect to IDE proxy:`, error.message);
  }
}

/**
 * Register this bot server with the coordination API
 * @param {string} urlOverride - Optional URL override (for dynamic URL updates)
 */
let heartbeatInterval = null; // Store heartbeat interval for cleanup

async function registerServer(urlOverride) {
  const serverId = process.env.SERVER_ID || `server-${require('os').hostname()}`;
  // Priority: urlOverride > currentTunnelUrl > .env > localhost fallback
  const serverUrl = urlOverride || currentTunnelUrl || process.env.SERVER_URL || `http://localhost:${HTTP_PORT}`;
  const userId = process.env.USER_ID;
  const coordinationUrl = process.env.COORDINATION_URL || 'http://localhost:3000/api/servers/register';

  if (!userId) {
    console.log('ℹ️  No USER_ID configured - skipping server registration');
    console.log('   Set USER_ID env var to enable coordination\n');
    return;
  }

  try {
    console.log(`📡 Registering server with coordination API...`);
    console.log(`   Server ID: ${serverId}`);
    console.log(`   Server URL: ${serverUrl}${urlOverride ? ' (updated)' : ''}`);
    console.log(`   User ID: ${userId}`);

    const response = await fetch(coordinationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId,
        userId,
        serverUrl,
        serverName: require('os').hostname(),
        status: 'online',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ Failed to register server: ${error}`);
      return;
    }

    const data = await response.json();
    console.log(`✅ Server registered successfully`);

    // Clear existing heartbeat interval if re-registering
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    // Send heartbeat every 30 seconds with CURRENT tunnel URL
    heartbeatInterval = setInterval(async () => {
      try {
        // Always use the latest tunnel URL for heartbeats
        const heartbeatUrl = currentTunnelUrl || process.env.SERVER_URL || `http://localhost:${HTTP_PORT}`;
        await fetch(coordinationUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverId,
            userId,
            serverUrl: heartbeatUrl,
            serverName: require('os').hostname(),
            status: 'online',
          }),
        });
      } catch (err) {
        console.error('❌ Heartbeat failed:', err.message);
      }
    }, 30000);

  } catch (error) {
    console.error(`❌ Error registering server:`, error.message);
  }
}

// Workspace folder resolution endpoint
app.post('/resolve-workspace', async (req, res) => {
  try {
    const { folderName } = req.body;

    if (!folderName) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const { execSync } = require('child_process');
    const sanitizedName = folderName.replace(/['"\\]/g, '');

    // Search locations - prioritize common project locations
    const home = process.env.HOME || '/Users';
    const searchPaths = [
      `${home}/play`,
      `${home}/projects`,
      `${home}/Desktop`,
      `${home}/Documents`,
      `${home}/code`,
      `${home}/dev`,
      process.cwd(),
    ];

    let foundPath = null;

    // Try each search location with reduced depth and timeout
    for (const searchPath of searchPaths) {
      try {
        const result = execSync(
          `find "${searchPath}" -maxdepth 3 -type d -name "${sanitizedName}" 2>/dev/null | head -1`,
          { encoding: 'utf-8', timeout: 2000 }
        ).trim();

        if (result) {
          foundPath = result;
          console.log(`✅ Found workspace at: ${result}`);
          break;
        }
      } catch (err) {
        // Continue to next search path
      }
    }

    if (!foundPath) {
      return res.status(404).json({
        error: 'Folder not found',
        message: `Could not find folder "${sanitizedName}" in any search location`
      });
    }

    res.json({ path: foundPath });
  } catch (error) {
    console.error('Error resolving workspace:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Discover workspaces by reading Claude CLI session files (cwd field)
app.get('/discover-workspaces', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const home = process.env.HOME || process.env.USERPROFILE;

    console.log('🔍 Discovering workspaces via Claude CLI session files...');

    // Claude CLI stores sessions at ~/.claude/projects/<workspace-path-with-dashes>/
    const claudeProjectsDir = path.join(home, '.claude', 'projects');

    if (!fs.existsSync(claudeProjectsDir)) {
      console.log('⚠️  No Claude projects directory found');
      return res.json({ workspaces: [] });
    }

    const discoveredWorkspaces = [];
    const seenPaths = new Set();
    const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });

    // Filter out system/temp directories we don't want to show
    const systemPaths = ['/opt', '/private/tmp', '/tmp', '/var', '/usr', '/System'];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      try {
        const projectDir = path.join(claudeProjectsDir, entry.name);

        // Get the actual workspace path by reading session files
        let workspacePath = null;
        let lastUsed = null;

        // Find a .jsonl file to read
        const sessionFiles = fs.readdirSync(projectDir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => path.join(projectDir, f));

        // Read first non-empty session file to get cwd
        for (const sessionFile of sessionFiles) {
          try {
            const stat = fs.statSync(sessionFile);
            if (stat.size === 0) continue;

            const content = fs.readFileSync(sessionFile, 'utf-8');
            const firstLine = content.trim().split('\n')[0];
            if (!firstLine) continue;

            const msg = JSON.parse(firstLine);
            if (msg.cwd) {
              workspacePath = msg.cwd;
              lastUsed = new Date(msg.timestamp);
              break;
            }
          } catch (err) {
            continue;
          }
        }

        // Fallback: extract path from directory name if cwd not found
        if (!workspacePath) {
          const dashedName = entry.name;
          if (dashedName.startsWith('-')) {
            workspacePath = '/' + dashedName.substring(1).replace(/-/g, '/');
          } else {
            continue;
          }
        }

        // Skip if we've already seen this path
        if (seenPaths.has(workspacePath)) continue;
        seenPaths.add(workspacePath);

        // Skip system/temp directories
        const isSystemPath = systemPaths.some(sysPath => workspacePath.startsWith(sysPath));
        if (isSystemPath) {
          console.log(`   Skipping system path: ${workspacePath}`);
          continue;
        }

        // Check if workspace directory actually exists
        if (!fs.existsSync(workspacePath)) {
          console.log(`   Skipping non-existent path: ${workspacePath}`);
          continue;
        }

        // Use project directory mtime if we don't have a session timestamp
        if (!lastUsed) {
          const stats = fs.statSync(projectDir);
          lastUsed = stats.mtime;
        }

        // Get workspace info
        const name = path.basename(workspacePath);
        const isGitRepo = fs.existsSync(path.join(workspacePath, '.git'));

        discoveredWorkspaces.push({
          name,
          path: workspacePath,
          isGitRepo,
          lastUsed,
          source: 'claude-session',
        });
      } catch (err) {
        console.error(`Error processing ${entry.name}:`, err.message);
      }
    }

    // Sort by most recently used
    discoveredWorkspaces.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));

    console.log(`✅ Discovered ${discoveredWorkspaces.length} workspaces from Claude CLI sessions`);

    res.json({ workspaces: discoveredWorkspaces });
  } catch (error) {
    console.error('Error discovering workspaces:', error);
    res.status(500).json({ error: 'Failed to discover workspaces', message: error.message });
  }
});

// List available workspaces in ~/labcart-projects/
app.get('/list-workspaces', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const home = process.env.HOME || process.env.USERPROFILE;
    const workspacesDir = path.join(home, 'labcart-projects');

    // Create directory if it doesn't exist
    if (!fs.existsSync(workspacesDir)) {
      fs.mkdirSync(workspacesDir, { recursive: true });
    }

    // Read directories
    const entries = fs.readdirSync(workspacesDir, { withFileTypes: true });
    const workspaces = entries
      .filter(entry => entry.isDirectory())
      .map(entry => {
        const workspacePath = path.join(workspacesDir, entry.name);
        const stats = fs.statSync(workspacePath);

        // Check if it's a git repo
        const isGitRepo = fs.existsSync(path.join(workspacePath, '.git'));

        return {
          name: entry.name,
          path: workspacePath,
          isGitRepo,
          lastModified: stats.mtime,
        };
      })
      .sort((a, b) => b.lastModified - a.lastModified);

    res.json({ workspaces });
  } catch (error) {
    console.error('Error listing workspaces:', error);
    res.status(500).json({ error: 'Failed to list workspaces', message: error.message });
  }
});

// Clone GitHub repository to ~/labcart-projects/
app.post('/clone-repo', async (req, res) => {
  try {
    const { repoUrl } = req.body;

    if (!repoUrl) {
      return res.status(400).json({ error: 'Repository URL is required' });
    }

    // Validate GitHub URL format
    const githubPattern = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+/;
    if (!githubPattern.test(repoUrl)) {
      return res.status(400).json({
        error: 'Invalid GitHub URL',
        message: 'Please provide a valid GitHub repository URL'
      });
    }

    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');
    const home = process.env.HOME || process.env.USERPROFILE;
    const workspacesDir = path.join(home, 'labcart-projects');

    // Create directory if it doesn't exist
    if (!fs.existsSync(workspacesDir)) {
      fs.mkdirSync(workspacesDir, { recursive: true });
    }

    // Extract repo name from URL
    const repoName = repoUrl.split('/').pop().replace(/\.git$/, '');
    const targetPath = path.join(workspacesDir, repoName);

    // Check if directory already exists
    if (fs.existsSync(targetPath)) {
      return res.status(409).json({
        error: 'Workspace already exists',
        message: `A workspace named "${repoName}" already exists`,
        path: targetPath
      });
    }

    console.log(`📦 Cloning ${repoUrl} to ${targetPath}...`);

    try {
      execSync(`git clone "${repoUrl}" "${targetPath}"`, {
        stdio: 'pipe',
        timeout: 60000
      });

      console.log(`✅ Successfully cloned ${repoName}`);

      res.json({
        success: true,
        name: repoName,
        path: targetPath,
        message: `Successfully cloned ${repoName}`
      });
    } catch (cloneError) {
      console.error(`❌ Git clone failed:`, cloneError.message);

      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }

      return res.status(500).json({
        error: 'Clone failed',
        message: cloneError.message
      });
    }

  } catch (error) {
    console.error('Error cloning repository:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Workspace identification endpoint - creates/reads .labcart/workspace.json
app.post('/workspace/identify', async (req, res) => {
  try {
    const { workspacePath } = req.body;

    if (!workspacePath || typeof workspacePath !== 'string') {
      return res.status(400).json({ error: 'Workspace path is required' });
    }

    const fs = require('fs');
    const path = require('path');
    const { randomUUID } = require('crypto');

    // Verify the workspace path exists
    if (!fs.existsSync(workspacePath)) {
      return res.status(404).json({ error: 'Workspace path does not exist' });
    }

    const stats = fs.statSync(workspacePath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Workspace path must be a directory' });
    }

    const labcartDir = path.join(workspacePath, '.labcart');
    const workspaceFile = path.join(labcartDir, 'workspace.json');

    let workspaceId;
    let isNew = false;

    if (fs.existsSync(workspaceFile)) {
      try {
        const fileContent = fs.readFileSync(workspaceFile, 'utf8');
        const data = JSON.parse(fileContent);

        if (data.workspaceId && typeof data.workspaceId === 'string') {
          workspaceId = data.workspaceId;
          console.log(`🔵 Workspace identified: ${workspaceId} at ${workspacePath}`);
        } else {
          throw new Error('Invalid workspace.json format');
        }
      } catch (error) {
        console.error('Error reading workspace.json:', error);
        workspaceId = randomUUID();
        isNew = true;
      }
    } else {
      workspaceId = randomUUID();
      isNew = true;
      console.log(`🟢 New workspace created: ${workspaceId} at ${workspacePath}`);
    }

    if (isNew) {
      if (!fs.existsSync(labcartDir)) {
        fs.mkdirSync(labcartDir, { recursive: true });
      }

      const workspaceData = {
        workspaceId,
        createdAt: new Date().toISOString(),
        path: workspacePath,
      };

      fs.writeFileSync(workspaceFile, JSON.stringify(workspaceData, null, 2), 'utf8');

      const gitignorePath = path.join(labcartDir, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, '# LabCart workspace metadata\n*\n', 'utf8');
      }

      console.log(`✓ Created .labcart/workspace.json`);
    }

    res.json({
      success: true,
      workspaceId,
      workspacePath,
      isNew,
    });

  } catch (error) {
    console.error('Error identifying workspace:', error);
    res.status(500).json({ error: 'Failed to identify workspace', message: error.message });
  }
});

// File system listing endpoint
app.get('/files', (req, res) => {
  try {
    const workspacePath = req.query.workspace || process.cwd();
    const dirPath = req.query.path || workspacePath;

    // Security: Ensure we're only reading from the workspace
    const normalizedPath = path.normalize(dirPath);
    const normalizedWorkspace = path.normalize(workspacePath);
    if (!normalizedPath.startsWith(normalizedWorkspace)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const items = fs.readdirSync(normalizedPath, { withFileTypes: true });

    const files = items.map(item => ({
      name: item.name,
      path: path.join(normalizedPath, item.name),
      isDirectory: item.isDirectory(),
      isFile: item.isFile(),
    }))
    .filter(item => !item.name.startsWith('.')) // Hide hidden files
    .sort((a, b) => {
      // Directories first, then files, alphabetically
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ files, path: normalizedPath });
  } catch (error) {
    console.error('Error reading directory:', error);
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

// File system watching endpoint (Server-Sent Events)
app.get('/files/watch', (req, res) => {
  const workspacePath = req.query.workspace || process.cwd();
  const dirPath = req.query.path || workspacePath;

  if (!dirPath) {
    return res.status(400).send('Path is required');
  }

  if (!fs.existsSync(dirPath)) {
    return res.status(404).send('Directory does not exist');
  }

  // Security check
  const normalizedPath = path.normalize(dirPath);
  const normalizedWorkspace = path.normalize(workspacePath);
  if (!normalizedPath.startsWith(normalizedWorkspace)) {
    return res.status(403).send('Access denied');
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // Watch the directory for changes
  const watcher = fs.watch(normalizedPath, { recursive: false }, (eventType, filename) => {
    if (filename) {
      console.log(`File system change detected: ${eventType} - ${filename}`);
      const event = {
        type: 'change',
        eventType,
        filename,
        timestamp: Date.now(),
      };
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    watcher.close();
    console.log(`Stopped watching: ${normalizedPath}`);
  });
});

// ========== R2 Asset Storage Endpoints ==========

const r2Storage = require('./services/r2-storage');

// POST /assets/upload - Upload a file to R2
app.post('/assets/upload', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  const { workflowId, filename, contentType } = req.query;

  if (!workflowId || !filename) {
    return res.status(400).json({
      error: 'Missing required params',
      required: { workflowId: 'string', filename: 'string' }
    });
  }

  try {
    const result = await r2Storage.uploadWorkflowAsset(
      req.body,
      workflowId,
      filename,
      contentType || 'application/octet-stream'
    );

    res.json({
      success: true,
      key: result.key,
      signedUrl: result.publicUrl  // Public URL (no expiration)
    });
  } catch (error) {
    console.error('❌ Asset upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /assets/download - Get signed download URL for an asset
app.get('/assets/download', async (req, res) => {
  const key = req.query.key;

  if (!key) {
    return res.status(400).json({ error: 'Asset key is required (pass as ?key=...)' });
  }

  try {
    const signedUrl = await r2Storage.getSignedDownloadUrl(key);
    res.json({ signedUrl });
  } catch (error) {
    console.error('❌ Asset fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /assets/presigned-upload - Get a presigned URL for direct upload
app.post('/assets/presigned-upload', async (req, res) => {
  const { workflowId, filename, contentType } = req.body;

  if (!workflowId || !filename) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: { workflowId: 'string', filename: 'string' }
    });
  }

  try {
    const ext = filename.split('.').pop() || '';
    const key = `workflows/${workflowId}/${require('crypto').randomUUID()}.${ext}`;
    const uploadUrl = await r2Storage.getSignedUploadUrl(key, contentType || 'application/octet-stream');

    res.json({
      uploadUrl,
      key,
      expiresIn: 3600
    });
  } catch (error) {
    console.error('❌ Presigned upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /assets/delete - Delete an asset
app.delete('/assets/delete', async (req, res) => {
  const key = req.query.key;

  if (!key) {
    return res.status(400).json({ error: 'Asset key is required (pass as ?key=...)' });
  }

  try {
    await r2Storage.deleteFile(key);
    res.json({ success: true, deleted: key });
  } catch (error) {
    console.error('❌ Asset delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== Workflow HTTP Endpoints ==========

// POST /workflow/start - Start a new workflow
app.post('/workflow/start', async (req, res) => {
  const { userId, goal } = req.body;

  if (!userId || !goal) {
    return res.status(400).json({
      error: 'Invalid request',
      required: { userId: 'string', goal: 'string' }
    });
  }

  try {
    const result = await workflowHandler.startWorkflow({
      userId,
      goal,
      onProgress: () => {} // HTTP doesn't support streaming, ignore progress
    });

    res.json(result);
  } catch (error) {
    console.error('❌ Workflow start error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /workflow/:workflowId/approve - Approve and execute workflow
app.post('/workflow/:workflowId/approve', async (req, res) => {
  const { workflowId } = req.params;
  const { stepConfigs } = req.body || {}; // Optional action step configurations

  try {
    const result = await workflowHandler.executeWorkflow(workflowId, () => {}, { stepConfigs });
    res.json(result);
  } catch (error) {
    console.error('❌ Workflow approve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /workflow/:workflowId - Get workflow status
app.get('/workflow/:workflowId', (req, res) => {
  const { workflowId } = req.params;
  const status = workflowHandler.getWorkflowStatus(workflowId);

  if (status) {
    res.json(status);
  } else {
    res.status(404).json({ error: 'Workflow not found' });
  }
});

// POST /workflow/:workflowId/cancel - Cancel a workflow
app.post('/workflow/:workflowId/cancel', (req, res) => {
  const { workflowId } = req.params;

  workflowHandler.cancelWorkflow(workflowId);
  res.json({ success: true, message: 'Workflow cancelled' });
});

// POST /workflow/:workflowId/respond - Respond to discovery/clarification questions
app.post('/workflow/:workflowId/respond', async (req, res) => {
  const { workflowId } = req.params;
  const { answers, answer } = req.body;

  // Support both formats:
  // - { answers: { topic: "...", audience: "..." } } for discovery
  // - { answer: "..." } for single clarification
  const userInput = answers || answer;

  if (!userInput) {
    return res.status(400).json({ error: 'Missing "answers" or "answer" in request body' });
  }

  try {
    const result = await workflowHandler.resumeWorkflow(workflowId, userInput);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== Agent Management HTTP Endpoints ==========

// POST /agents/create - Create a new agent
app.post('/agents/create', async (req, res) => {
  const {
    userId,
    slug,
    name,
    description,
    systemPrompt,
    agentType = 'utility',
    capabilities = ['text'],
    inputSchema = null,
    outputSchema = null
  } = req.body;

  // Validate required fields
  if (!userId || !slug || !name || !systemPrompt) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: {
        userId: 'string',
        slug: 'string (lowercase, alphanumeric with hyphens)',
        name: 'string',
        systemPrompt: 'string (at least 10 characters)'
      },
      optional: {
        description: 'string',
        agentType: 'string (utility, personality, orchestrator)',
        capabilities: 'array of strings',
        inputSchema: 'object (JSON schema)',
        outputSchema: 'object (JSON schema)'
      }
    });
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({
      error: 'Invalid slug format. Must be lowercase alphanumeric with hyphens.'
    });
  }

  try {
    const newAgent = await workflowHandler.createAgentInDatabase({
      userId,
      slug,
      name,
      description: description || `Agent: ${name}`,
      systemPrompt,
      agentType,
      capabilities,
      inputSchema,
      outputSchema
    });

    console.log(`✅ [Agent] Created agent "${slug}" for user ${userId}`);
    res.json({ success: true, agent: newAgent });

  } catch (error) {
    console.error(`❌ [Agent] Error creating agent:`, error);
    res.status(500).json({ error: error.message });
  }
});

// GET /agents/:userId - List all agents for a user
app.get('/agents/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const agents = await workflowHandler.getAvailableAgents(userId);
    res.json({ agents });
  } catch (error) {
    console.error(`❌ [Agent] Error listing agents:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Bot sync endpoint - Sync bots from database to bots.json
app.post('/sync-bots', async (req, res) => {
  try {
    const userId = process.env.USER_ID;
    const coordinationUrl = process.env.COORDINATION_URL?.replace('/register', '') || 'http://localhost:3000/api';

    if (!userId) {
      return res.status(400).json({ error: 'USER_ID not configured' });
    }

    console.log(`📡 Syncing bots from database for user ${userId}...`);

    // Fetch bots from database
    const response = await fetch(`${coordinationUrl}/bots?userId=${userId}`);

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ Failed to fetch bots: ${error}`);
      return res.status(500).json({ error: 'Failed to fetch bots from database' });
    }

    const data = await response.json();
    const bots = data.bots || [];

    // Convert database format to bots.json format
    const botsConfig = bots
      .filter(bot => bot.active)
      .map(bot => ({
        id: bot.id,
        name: bot.name,
        systemPrompt: bot.system_prompt,
        workspace: bot.workspace || '/opt/lab/claude-bot',
        webOnly: bot.web_only,
        token: bot.telegram_token,
        active: bot.active,
      }));

    // Write to bots.json
    const botsConfigPath = path.join(__dirname, 'bots.json');
    fs.writeFileSync(botsConfigPath, JSON.stringify(botsConfig, null, 2));

    console.log(`✅ Synced ${botsConfig.length} bots to bots.json`);

    res.json({
      success: true,
      synced: botsConfig.length,
      bots: botsConfig,
    });

  } catch (error) {
    console.error('Error syncing bots:', error);
    res.status(500).json({ error: 'Failed to sync bots', message: error.message });
  }
});

httpServer.listen(HTTP_PORT, async () => {
  console.log(`\n🌐 HTTP Server listening on port ${HTTP_PORT}`);
  console.log(`   POST /trigger-bot - External delegation endpoint`);
  console.log(`   POST /resolve-workspace - Workspace folder resolution`);
  console.log(`   GET  /health      - Health check`);
  console.log(`   POST /workflow/start - Start a workflow`);
  console.log(`   GET  /workflow/:id - Get workflow status`);
  console.log(`   POST /agents/create - Create a new agent`);
  console.log(`   GET  /agents/:userId - List agents for user`);
  console.log(`   WebSocket enabled for UI connections\n`);

  // Recover any interrupted workflows from previous run
  try {
    await workflowHandler.recoverInterruptedWorkflows();
  } catch (err) {
    console.error('Failed to recover interrupted workflows:', err.message);
  }

  // Initialize tunnel manager if USER_ID is configured (VPS deployment)
  // Skip tunnel management for local development
  const shouldManageTunnel = process.env.USER_ID && !process.env.SKIP_TUNNEL_MANAGER;

  if (shouldManageTunnel) {
    console.log('\n🚇 Initializing Cloudflare Tunnel Manager...');
    const tunnelManager = new TunnelManager({ port: HTTP_PORT });

    // Handle URL changes
    tunnelManager.on('url-changed', async (newUrl, oldUrl) => {
      console.log(`\n🔄 Tunnel URL changed: ${oldUrl || '(none)'} → ${newUrl}`);
      currentTunnelUrl = newUrl;

      // Re-register with new URL
      await registerServer(newUrl);

      // Force reconnect proxy with new URL
      forceReconnectProxy();
    });

    tunnelManager.on('error', (error) => {
      console.error('🚇 Tunnel error:', error.message);
    });

    tunnelManager.on('max-restarts-reached', () => {
      console.error('🚇 Tunnel failed to start after max attempts - falling back to .env URL');
      // Fall back to .env URL if tunnel manager fails
      registerServer();
      connectToProxy();
    });

    // Start the tunnel
    tunnelManager.start();

    // Wait for initial URL detection before registering
    try {
      const url = await tunnelManager.waitForUrl(30000);
      console.log(`✅ Tunnel ready: ${url}\n`);
    } catch (err) {
      console.error('⚠️  Tunnel URL not detected in time, falling back to .env');
      // Proceed with registration anyway (will use .env fallback)
      await registerServer();
      await connectToProxy();
    }
  } else {
    // Local development or SKIP_TUNNEL_MANAGER=true
    if (process.env.USER_ID) {
      console.log('\n⏭️  Tunnel manager skipped (SKIP_TUNNEL_MANAGER=true)');
    }

    // Register with coordination API using .env URL
    await registerServer();

    // Connect to WebSocket proxy for remote IDE connections
    await connectToProxy();
  }
});

// Graceful shutdown handlers
const shutdown = async () => {
  console.log('\n\n🛑 Received shutdown signal...');
  terminalManager.killAll();
  await manager.stopAll();
  process.exit(0);
};

process.on('SIGINT', shutdown);  // Ctrl+C
process.on('SIGTERM', shutdown); // Kill signal

// Uncaught error handlers
process.on('uncaughtException', (error) => {
  console.error('\n❌ Uncaught Exception:', error);
  console.error('   Stack:', error.stack);
  // Don't exit - keep bots running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ Unhandled Rejection at:', promise);
  console.error('   Reason:', reason);
  // Don't exit - keep bots running
});

// Optional: Periodic cleanup of old sessions
if (process.env.CLEANUP_OLD_SESSIONS === 'true') {
  const cleanupIntervalHours = parseInt(process.env.CLEANUP_INTERVAL_HOURS || '24');
  const cleanupAgeDays = parseInt(process.env.CLEANUP_AGE_DAYS || '90');

  console.log(`🧹 Session cleanup enabled: Every ${cleanupIntervalHours}h, delete sessions older than ${cleanupAgeDays} days\n`);

  setInterval(() => {
    console.log('\n🧹 Running session cleanup...');
    for (const [botId] of manager.bots) {
      const deleted = manager.sessionManager.cleanupOldSessions(botId, cleanupAgeDays);
      if (deleted > 0) {
        console.log(`   Deleted ${deleted} old sessions for bot ${botId}`);
      }
    }
  }, cleanupIntervalHours * 60 * 60 * 1000);
}
