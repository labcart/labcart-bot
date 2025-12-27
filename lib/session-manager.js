const path = require('path');
const fs = require('fs');

/**
 * SessionManager
 *
 * Manages session metadata for multi-user bot conversations.
 * Tracks Claude UUIDs for session persistence across bot restarts.
 *
 * Session isolation is handled by Claude's UUID system via --resume flag.
 * All bots run from the same working directory (the project root).
 */
class SessionManager {
  constructor() {
    this.metadataDir = path.join(process.cwd(), '.sessions');

    // Ensure metadata directory exists
    if (!fs.existsSync(this.metadataDir)) {
      fs.mkdirSync(this.metadataDir, { recursive: true });
    }
  }

  /**
   * Get our internal session ID for a user+bot pair
   *
   * This is OUR identifier that persists across Claude UUID rotations.
   * Format: bot-<botId>-user-<telegramUserId>
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @returns {string} Our internal session ID
   */
  getSessionId(botId, telegramUserId) {
    return `bot-${botId}-user-${telegramUserId}`;
  }

  /**
   * Get metadata file path for a session
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @returns {string} Path to metadata JSON file
   */
  getMetadataPath(botId, telegramUserId) {
    const sessionId = this.getSessionId(botId, telegramUserId);
    return path.join(this.metadataDir, `${sessionId}.json`);
  }

  /**
   * Load session metadata (including current Claude UUID)
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @returns {Object|null} Session metadata or null if doesn't exist
   */
  loadSessionMetadata(botId, telegramUserId) {
    const metadataPath = this.getMetadataPath(botId, telegramUserId);

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(metadataPath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error(`⚠️  Error loading session metadata:`, err.message);
      return null;
    }
  }

  /**
   * Save session metadata (including Claude UUID)
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @param {Object} metadata - Metadata to save
   */
  saveSessionMetadata(botId, telegramUserId, metadata) {
    const metadataPath = this.getMetadataPath(botId, telegramUserId);

    try {
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    } catch (err) {
      console.error(`⚠️  Error saving session metadata:`, err.message);
    }
  }

  /**
   * Get current Claude UUID for a session
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @returns {string|null} Claude UUID or null if no session exists
   */
  getCurrentUuid(botId, telegramUserId) {
    const metadata = this.loadSessionMetadata(botId, telegramUserId);
    return metadata?.currentUuid || null;
  }

  /**
   * Get workspace path for a session
   *
   * @param {string} botId - Bot identifier
   * @param {number|string} telegramUserId - User ID (can be Telegram ID or anonymous ID)
   * @returns {string|null} Workspace path or null if no session exists
   */
  getWorkspacePath(botId, telegramUserId) {
    const metadata = this.loadSessionMetadata(botId, telegramUserId);
    return metadata?.workspacePath || null;
  }

  /**
   * Set current Claude UUID for a session
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @param {string} uuid - Claude session UUID
   * @param {string} [workspacePath] - Optional workspace path for this session
   */
  setCurrentUuid(botId, telegramUserId, uuid, workspacePath = null) {
    let metadata = this.loadSessionMetadata(botId, telegramUserId);

    if (!metadata) {
      // New session
      metadata = {
        sessionId: this.getSessionId(botId, telegramUserId),
        botId,
        telegramUserId,
        currentUuid: uuid,
        createdAt: new Date().toISOString(),
        messageCount: 0,
        uuidHistory: [],
        workspacePath: workspacePath || null
      };
    } else {
      // Rotating UUID - save old one to history
      if (metadata.currentUuid && metadata.currentUuid !== uuid) {
        metadata.uuidHistory = metadata.uuidHistory || [];
        metadata.uuidHistory.push({
          uuid: metadata.currentUuid,
          createdAt: metadata.createdAt, // Preserve creation timestamp
          endedAt: new Date().toISOString()
        });
      }
      metadata.currentUuid = uuid;
      // Reset createdAt for the new UUID
      metadata.createdAt = new Date().toISOString();
      // Update workspace if provided
      if (workspacePath) {
        metadata.workspacePath = workspacePath;
      }
    }

    metadata.updatedAt = new Date().toISOString();
    this.saveSessionMetadata(botId, telegramUserId, metadata);
  }

  /**
   * Increment message count for a specific session UUID
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @param {string} sessionUuid - Session UUID to increment count for
   */
  incrementMessageCount(botId, telegramUserId, sessionUuid) {
    const metadata = this.loadSessionMetadata(botId, telegramUserId);
    if (metadata && sessionUuid) {
      // Initialize uuidCounts if it doesn't exist
      if (!metadata.uuidCounts) {
        metadata.uuidCounts = {};
      }

      // Increment count for this specific UUID
      metadata.uuidCounts[sessionUuid] = (metadata.uuidCounts[sessionUuid] || 0) + 1;

      // Also update global messageCount for backwards compatibility
      metadata.messageCount = (metadata.messageCount || 0) + 1;

      metadata.updatedAt = new Date().toISOString();
      this.saveSessionMetadata(botId, telegramUserId, metadata);
    }
  }

  /**
   * Reset conversation - starts fresh Claude session but keeps tracking
   *
   * Moves current UUID to history and clears it.
   * Next message will create new Claude conversation.
   * Preserves all metadata (messageCount, sessionId, etc.)
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @returns {boolean} True if reset successful, false if no session exists
   */
  resetConversation(botId, telegramUserId) {
    const metadata = this.loadSessionMetadata(botId, telegramUserId);

    if (!metadata) {
      return false; // No session to reset
    }

    // Move current UUID to history (if exists)
    if (metadata.currentUuid) {
      metadata.uuidHistory = metadata.uuidHistory || [];
      metadata.uuidHistory.push({
        uuid: metadata.currentUuid,
        createdAt: metadata.createdAt, // Preserve creation timestamp
        resetAt: new Date().toISOString(),
        messageCount: metadata.messageCount
      });
    }

    // Clear current UUID - next message will start fresh
    metadata.currentUuid = null;
    metadata.messageCount = 0; // Reset message count for new session
    metadata.updatedAt = new Date().toISOString();

    this.saveSessionMetadata(botId, telegramUserId, metadata);
    return true;
  }

  /**
   * Get TTS preference for a user
   *
   * Returns the user's TTS preference (true/false) or null if not set.
   * Null means "use brain default".
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @returns {boolean|null} TTS preference or null if not set
   */
  getTtsPreference(botId, telegramUserId) {
    const metadata = this.loadSessionMetadata(botId, telegramUserId);

    // Return null if no metadata or ttsEnabled not set (undefined)
    if (!metadata || metadata.ttsEnabled === undefined) {
      return null;
    }

    return metadata.ttsEnabled;
  }

  /**
   * Set TTS preference for a user
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @param {boolean} enabled - TTS enabled/disabled
   */
  setTtsPreference(botId, telegramUserId, enabled) {
    let metadata = this.loadSessionMetadata(botId, telegramUserId);

    if (!metadata) {
      // New session - create metadata with TTS preference
      metadata = {
        sessionId: this.getSessionId(botId, telegramUserId),
        botId,
        telegramUserId,
        currentUuid: null,
        createdAt: new Date().toISOString(),
        messageCount: 0,
        uuidHistory: [],
        ttsEnabled: enabled
      };
    } else {
      // Existing session - update TTS preference
      metadata.ttsEnabled = enabled;
      metadata.updatedAt = new Date().toISOString();
    }

    this.saveSessionMetadata(botId, telegramUserId, metadata);
  }

  /**
   * Update last message time for a session
   * Used by nudge system to track user activity
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   */
  updateLastMessageTime(botId, telegramUserId) {
    let metadata = this.loadSessionMetadata(botId, telegramUserId);

    if (!metadata) return; // No session yet

    metadata.lastMessageTime = Date.now();
    metadata.updatedAt = new Date().toISOString();

    // Check if last nudge had stopSequence: false
    // If so, clear lastNudgeSent to allow recurring nudges
    if (metadata.nudgeHistory && metadata.nudgeHistory.length > 0) {
      const lastNudge = metadata.nudgeHistory[metadata.nudgeHistory.length - 1];
      if (!lastNudge.stopSequence) {
        // This was a recurring nudge - reset lastNudgeSent so it can fire again
        metadata.lastNudgeSent = 0;
      }
      // If stopSequence was true, keep lastNudgeSent to prevent future nudges
    }

    this.saveSessionMetadata(botId, telegramUserId, metadata);
  }

  /**
   * Record that a nudge was sent
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @param {Object} nudgeData - Nudge information
   */
  recordNudge(botId, telegramUserId, nudgeData) {
    let metadata = this.loadSessionMetadata(botId, telegramUserId);

    if (!metadata) return;

    if (!metadata.nudgeHistory) {
      metadata.nudgeHistory = [];
    }

    metadata.nudgeHistory.push(nudgeData);
    metadata.lastNudgeSent = nudgeData.delayHours;
    metadata.updatedAt = new Date().toISOString();

    this.saveSessionMetadata(botId, telegramUserId, metadata);
  }

  /**
   * Mark that user responded after a nudge
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   * @param {number} nudgeTimestamp - Timestamp of the nudge to mark
   */
  markNudgeResponded(botId, telegramUserId, nudgeTimestamp) {
    let metadata = this.loadSessionMetadata(botId, telegramUserId);

    if (!metadata || !metadata.nudgeHistory) return;

    // Find the nudge and mark it as responded
    const nudge = metadata.nudgeHistory.find(n => n.timestamp === nudgeTimestamp);
    if (nudge) {
      nudge.userResponded = true;
      metadata.updatedAt = new Date().toISOString();
      this.saveSessionMetadata(botId, telegramUserId, metadata);
    }
  }

  /**
   * Get all user IDs that have sessions with a specific bot
   * Used by nudge system to check all users
   *
   * @param {string} botId - Bot identifier
   * @returns {Array<number>} Array of Telegram user IDs
   */
  getAllUsersForBot(botId) {
    const users = [];
    const files = fs.readdirSync(this.metadataDir);

    const prefix = `bot-${botId}-user-`;

    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.json')) {
        // Extract user ID from filename: bot-{botId}-user-{userId}.json
        const userIdStr = file.replace(prefix, '').replace('.json', '');
        const userId = parseInt(userIdStr);

        if (!isNaN(userId)) {
          users.push(userId);
        }
      }
    }

    return users;
  }

  /**
   * Rotate session - archive current UUID and start fresh
   *
   * @param {string} botId - Bot identifier
   * @param {number} telegramUserId - Telegram user ID
   */
  rotateSession(botId, telegramUserId) {
    const metadata = this.loadSessionMetadata(botId, telegramUserId);
    if (!metadata) return;

    const logger = require('./logger');

    // Move current UUID to history
    if (metadata.currentUuid) {
      metadata.uuidHistory = metadata.uuidHistory || [];
      metadata.uuidHistory.push({
        uuid: metadata.currentUuid,
        createdAt: metadata.createdAt, // Preserve creation timestamp
        rotatedAt: new Date().toISOString(),
        messageCount: metadata.messageCount,
        reason: 'auto-rotation'
      });

      logger.user(botId, telegramUserId, 'info', 'Session rotated', {
        messageCount: metadata.messageCount,
        oldUuid: metadata.currentUuid
      });
    }

    // Clear current UUID (next message will create new session)
    metadata.currentUuid = null;
    metadata.messageCount = 0;
    metadata.rotatedAt = new Date().toISOString();
    metadata.updatedAt = new Date().toISOString();

    this.saveSessionMetadata(botId, telegramUserId, metadata);
  }

}

module.exports = SessionManager;
