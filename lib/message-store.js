/**
 * MessageStore
 *
 * Handles saving and loading chat messages from Supabase.
 * This is the platform's source of truth for message history.
 * Claude CLI sessions are used only for --resume, not for message retrieval.
 *
 * Key concept:
 * - session_id: OUR UUID (generated when user starts a new chat)
 * - cli_session_id: Claude's session ID (set when first response arrives, used for --resume)
 */

const supabase = require('./supabase-client');
const { v4: uuidv4 } = require('uuid');

class MessageStore {
  /**
   * Generate a new session UUID
   */
  generateSessionId() {
    return uuidv4();
  }

  /**
   * Save a message to the database
   *
   * @param {Object} params
   * @param {string} params.sessionId - OUR session UUID (not Claude's)
   * @param {string} params.userId - User ID (e.g., "anon-abc123")
   * @param {string} params.instanceSlug - Bot instance slug
   * @param {string} params.role - 'user' | 'assistant' | 'system'
   * @param {string} params.content - Message content
   * @param {string} [params.cliSessionId] - Claude's session ID (for --resume)
   * @param {string} [params.messageType='text'] - Message type
   * @param {Object} [params.metadata={}] - Additional metadata
   * @returns {Promise<Object>} Saved message record
   */
  async saveMessage({ sessionId, userId, instanceSlug, role, content, cliSessionId = null, messageType = 'text', metadata = {} }) {
    if (!sessionId || !userId || !instanceSlug || !role || !content) {
      console.error('❌ MessageStore.saveMessage: Missing required fields', { sessionId, userId, instanceSlug, role, hasContent: !!content });
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          session_id: sessionId,
          cli_session_id: cliSessionId,
          user_id: userId,
          instance_slug: instanceSlug,
          role,
          content,
          message_type: messageType,
          metadata
        })
        .select()
        .single();

      if (error) {
        console.error('❌ MessageStore.saveMessage error:', error.message);
        return null;
      }

      return data;
    } catch (err) {
      console.error('❌ MessageStore.saveMessage exception:', err.message);
      return null;
    }
  }

  /**
   * Link Claude's CLI session ID to all messages in a session
   * Called when we get Claude's first response
   *
   * @param {string} sessionId - Our session UUID
   * @param {string} cliSessionId - Claude's session ID
   */
  async linkCliSession(sessionId, cliSessionId) {
    if (!sessionId || !cliSessionId) return false;

    try {
      const { error } = await supabase
        .from('chat_messages')
        .update({ cli_session_id: cliSessionId })
        .eq('session_id', sessionId)
        .is('cli_session_id', null);

      if (error) {
        console.error('❌ MessageStore.linkCliSession error:', error.message);
        return false;
      }

      console.log(`🔗 Linked CLI session ${cliSessionId.substring(0, 8)}... to session ${sessionId.substring(0, 8)}...`);
      return true;
    } catch (err) {
      console.error('❌ MessageStore.linkCliSession exception:', err.message);
      return false;
    }
  }

  /**
   * Get the CLI session ID for a session (for --resume)
   *
   * @param {string} sessionId - Our session UUID
   * @returns {Promise<string|null>} Claude's CLI session ID
   */
  async getCliSessionId(sessionId) {
    if (!sessionId) return null;

    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('cli_session_id')
        .eq('session_id', sessionId)
        .not('cli_session_id', 'is', null)
        .limit(1)
        .single();

      if (error || !data) return null;
      return data.cli_session_id;
    } catch (err) {
      return null;
    }
  }

  /**
   * Save a user message (saved IMMEDIATELY before calling Claude)
   */
  async saveUserMessage(sessionId, userId, instanceSlug, content, cliSessionId = null) {
    return this.saveMessage({
      sessionId,
      userId,
      instanceSlug,
      role: 'user',
      content,
      cliSessionId,
      messageType: 'text'
    });
  }

  /**
   * Save an assistant message (saved when Claude responds)
   */
  async saveAssistantMessage(sessionId, userId, instanceSlug, content, cliSessionId = null, metadata = {}) {
    return this.saveMessage({
      sessionId,
      userId,
      instanceSlug,
      role: 'assistant',
      content,
      cliSessionId,
      messageType: 'text',
      metadata
    });
  }

  /**
   * Save a workflow event message
   *
   * @param {string} sessionId - Our session UUID
   * @param {string} userId
   * @param {string} instanceSlug
   * @param {string} workflowType - 'plan' | 'discovery' | 'progress' | 'complete' | 'error'
   * @param {Object} workflowData - Workflow-specific data
   * @param {string} [displayMessage] - Human-readable message to show in chat
   * @param {string} [cliSessionId] - Claude's session ID
   */
  async saveWorkflowMessage(sessionId, userId, instanceSlug, workflowType, workflowData, displayMessage = '', cliSessionId = null) {
    const messageTypeMap = {
      plan: 'workflow_plan',
      discovery: 'workflow_discovery',
      progress: 'workflow_progress',
      complete: 'workflow_complete',
      error: 'workflow_error'
    };

    return this.saveMessage({
      sessionId,
      userId,
      instanceSlug,
      role: 'assistant',
      content: displayMessage || `Workflow ${workflowType}`,
      cliSessionId,
      messageType: messageTypeMap[workflowType] || 'text',
      metadata: workflowData
    });
  }

  /**
   * Save an asset message (image, audio, etc.)
   */
  async saveAssetMessage(sessionId, userId, instanceSlug, assetType, assetUrl, cliSessionId = null, metadata = {}) {
    return this.saveMessage({
      sessionId,
      userId,
      instanceSlug,
      role: 'assistant',
      content: assetUrl,
      cliSessionId,
      messageType: 'asset',
      metadata: {
        assetType, // 'image' | 'audio' | 'file'
        url: assetUrl,
        ...metadata
      }
    });
  }

  /**
   * Get sessions for a user+instance combination
   * Returns distinct sessions ordered by most recent message
   *
   * @param {string} userId
   * @param {string} instanceSlug
   * @param {number} [limit=20]
   * @returns {Promise<Array>} Array of session summaries
   */
  async getSessionsForUser(userId, instanceSlug, limit = 20) {
    try {
      // Get distinct sessions with their first message as preview
      const { data, error } = await supabase
        .from('chat_messages')
        .select('session_id, cli_session_id, created_at, content')
        .eq('user_id', userId)
        .eq('instance_slug', instanceSlug)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(limit * 10); // Get more to dedupe

      if (error) {
        console.error('❌ MessageStore.getSessionsForUser error:', error.message);
        return [];
      }

      // Dedupe by session_id, keep first (most recent)
      const seen = new Set();
      const sessions = [];
      for (const row of data || []) {
        if (!seen.has(row.session_id)) {
          seen.add(row.session_id);
          sessions.push({
            sessionId: row.session_id,
            cliSessionId: row.cli_session_id,
            preview: row.content?.substring(0, 100) || '',
            lastActivity: row.created_at
          });
          if (sessions.length >= limit) break;
        }
      }

      return sessions;
    } catch (err) {
      console.error('❌ MessageStore.getSessionsForUser exception:', err.message);
      return [];
    }
  }

  /**
   * Load all messages for a session
   *
   * @param {string} sessionId - Claude session UUID
   * @param {number} [limit=1000] - Max messages to return
   * @returns {Promise<Array>} Array of messages ordered by created_at
   */
  async loadMessages(sessionId, limit = 1000) {
    if (!sessionId) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) {
        console.error('❌ MessageStore.loadMessages error:', error.message);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('❌ MessageStore.loadMessages exception:', err.message);
      return [];
    }
  }

  /**
   * Load messages for a user+instance, optionally filtering by session
   *
   * @param {string} userId
   * @param {string} instanceSlug
   * @param {string} [sessionId] - Optional session filter
   * @param {number} [limit=1000]
   * @returns {Promise<Array>}
   */
  async loadMessagesForInstance(userId, instanceSlug, sessionId = null, limit = 1000) {
    try {
      let query = supabase
        .from('chat_messages')
        .select('*')
        .eq('user_id', userId)
        .eq('instance_slug', instanceSlug)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (sessionId) {
        query = query.eq('session_id', sessionId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ MessageStore.loadMessagesForInstance error:', error.message);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('❌ MessageStore.loadMessagesForInstance exception:', err.message);
      return [];
    }
  }

  /**
   * Get message count for a session
   */
  async getMessageCount(sessionId) {
    if (!sessionId) return 0;

    try {
      const { count, error } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId);

      if (error) {
        console.error('❌ MessageStore.getMessageCount error:', error.message);
        return 0;
      }

      return count || 0;
    } catch (err) {
      console.error('❌ MessageStore.getMessageCount exception:', err.message);
      return 0;
    }
  }

  /**
   * Delete all messages for a session (for testing/cleanup)
   */
  async deleteSessionMessages(sessionId) {
    if (!sessionId) return false;

    try {
      const { error } = await supabase
        .from('chat_messages')
        .delete()
        .eq('session_id', sessionId);

      if (error) {
        console.error('❌ MessageStore.deleteSessionMessages error:', error.message);
        return false;
      }

      return true;
    } catch (err) {
      console.error('❌ MessageStore.deleteSessionMessages exception:', err.message);
      return false;
    }
  }
}

module.exports = new MessageStore();
