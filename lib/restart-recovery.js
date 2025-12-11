const fs = require('fs').promises;
const path = require('path');

/**
 * Restart Recovery System
 *
 * Tracks active Claude CLI processes and cleans up orphaned "Thinking..." messages
 * when the server restarts mid-request.
 */

const ACTIVE_REQUESTS_DIR = path.join(process.cwd(), '.active-requests');
const MAX_REQUEST_AGE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Initialize the active requests directory
 */
async function initRequestTracking() {
  try {
    await fs.mkdir(ACTIVE_REQUESTS_DIR, { recursive: true });
  } catch (err) {
    console.error('⚠️  Failed to create .active-requests directory:', err.message);
  }
}

/**
 * Track an active request by writing metadata to disk
 *
 * @param {string} botId - Bot identifier
 * @param {number} userId - Telegram user ID
 * @param {Object} data - Request data (chatId, msgId, pid, mode, etc)
 */
async function trackRequest(botId, userId, data) {
  try {
    const filename = `${botId}-${userId}.json`;
    const filepath = path.join(ACTIVE_REQUESTS_DIR, filename);

    const payload = {
      ...data,
      startTime: Date.now(),
      botId,
      userId
    };

    await fs.writeFile(filepath, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error(`⚠️  Failed to track request for ${botId}/${userId}:`, err.message);
  }
}

/**
 * Clear tracking for a completed request
 *
 * @param {string} botId - Bot identifier
 * @param {number} userId - Telegram user ID
 */
async function clearRequest(botId, userId) {
  try {
    const filename = `${botId}-${userId}.json`;
    const filepath = path.join(ACTIVE_REQUESTS_DIR, filename);
    await fs.unlink(filepath);
  } catch (err) {
    // File might not exist, that's fine
    if (err.code !== 'ENOENT') {
      console.error(`⚠️  Failed to clear request for ${botId}/${userId}:`, err.message);
    }
  }
}

/**
 * Check if a process is still alive
 *
 * @param {number} pid - Process ID
 * @returns {boolean} True if process is running
 */
function isPidAlive(pid) {
  try {
    // kill with signal 0 checks existence without actually killing
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Recover from server restart by cleaning up orphaned requests
 *
 * @param {Object} botManager - The bot manager instance
 */
async function recoverFromRestart(botManager) {
  try {
    // Ensure directory exists
    await initRequestTracking();

    // Read all active request files
    let files;
    try {
      files = await fs.readdir(ACTIVE_REQUESTS_DIR);
    } catch (err) {
      // Directory doesn't exist or is empty
      return;
    }

    if (files.length === 0) {
      return; // No orphaned requests
    }

    console.log(`🔄 Checking ${files.length} orphaned request(s) from previous session...`);

    let cleaned = 0;
    let recovered = 0;

    for (const filename of files) {
      if (!filename.endsWith('.json')) continue;

      try {
        const filepath = path.join(ACTIVE_REQUESTS_DIR, filename);
        const data = JSON.parse(await fs.readFile(filepath, 'utf8'));

        const age = Date.now() - data.startTime;
        const isAlive = isPidAlive(data.claudePid);

        if (isAlive && age < MAX_REQUEST_AGE_MS) {
          // Process still running and not too old - it might complete on its own
          console.log(`   ℹ️  Request ${data.botId}/${data.userId} still active (PID ${data.claudePid}, ${Math.round(age / 1000)}s old)`);
          recovered++;
          // Leave the tracking file - process might finish

        } else if (age > MAX_REQUEST_AGE_MS) {
          // Too old - assume hung
          console.log(`   🧹 Cleaning up old request ${data.botId}/${data.userId} (${Math.round(age / 60000)}min old)`);

          if (isAlive) {
            // Kill the hung process
            try {
              process.kill(data.claudePid, 'SIGTERM');
              console.log(`      Killed hung process PID ${data.claudePid}`);
            } catch (e) {
              // Already dead
            }
          }

          // Delete orphaned Telegram message
          await cleanupThinkingMessage(botManager, data.botId, data.chatId, data.statusMsgId);
          cleaned++;

          // Remove tracking file
          await fs.unlink(filepath);

        } else {
          // Process dead, not too old
          console.log(`   🧹 Cleaning up failed request ${data.botId}/${data.userId} (process died)`);

          // Delete orphaned Telegram message
          await cleanupThinkingMessage(botManager, data.botId, data.chatId, data.statusMsgId);
          cleaned++;

          // Remove tracking file
          await fs.unlink(filepath);
        }

      } catch (err) {
        console.error(`   ⚠️  Error processing ${filename}:`, err.message);
        // Try to delete the corrupted tracking file
        try {
          await fs.unlink(path.join(ACTIVE_REQUESTS_DIR, filename));
        } catch (e) {
          // Ignore
        }
      }
    }

    if (cleaned > 0) {
      console.log(`✅ Cleaned up ${cleaned} orphaned request(s)`);
    }
    if (recovered > 0) {
      console.log(`ℹ️  ${recovered} request(s) still active`);
    }

  } catch (err) {
    console.error('❌ Error during restart recovery:', err.message);
  }
}

/**
 * Delete orphaned "Thinking..." message from Telegram
 *
 * @param {Object} botManager - The bot manager instance
 * @param {string} botId - Bot identifier
 * @param {number} chatId - Telegram chat ID
 * @param {number} msgId - Message ID to delete
 */
async function cleanupThinkingMessage(botManager, botId, chatId, msgId) {
  try {
    const botInfo = botManager.getBot(botId);
    if (!botInfo) {
      console.warn(`      ⚠️  Bot ${botId} not found, cannot cleanup message`);
      return;
    }

    const bot = botInfo.bot;
    await bot.deleteMessage(chatId, msgId);
    console.log(`      Deleted orphaned "Thinking..." message ${msgId}`);
  } catch (err) {
    // Message might already be deleted or too old
    if (err.message.includes('message to delete not found') ||
        err.message.includes('message can\'t be deleted')) {
      // This is fine - message already gone
    } else {
      console.warn(`      ⚠️  Could not delete message ${msgId}:`, err.message);
    }
  }
}

module.exports = {
  initRequestTracking,
  trackRequest,
  clearRequest,
  recoverFromRestart
};
