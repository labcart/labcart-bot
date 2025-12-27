const { sendToClaudeSession } = require('./claude-client');

/**
 * NudgeManager
 *
 * Manages intelligent, LLM-powered follow-up messages (nudges) for user engagement.
 * Nudges are dynamically generated based on conversation context, not fixed templates.
 */
class NudgeManager {
  constructor(botManager, sessionManager, claudeCmd) {
    this.botManager = botManager;
    this.sessionManager = sessionManager;
    this.claudeCmd = claudeCmd;

    // Check for nudges every minute (for testing - change back to hourly in production)
    this.cronJob = setInterval(() => {
      console.log('⏰ Running nudge check...');
      this.checkNudges().catch(err => {
        console.error('❌ Nudge check failed:', err);
      });
    }, 60 * 1000); // 1 minute (testing)

    console.log('✅ NudgeManager initialized with MINUTE checks (testing mode)');
  }

  /**
   * Main loop - checks all bots for users needing nudges
   */
  async checkNudges() {
    const bots = this.botManager.bots;

    console.log(`🔎 Checking ${bots.size} bots for nudges...`);

    for (const [botId, botInfo] of bots) {
      const brain = botInfo.brain;

      console.log(`  Bot ${botId}: nudges enabled = ${brain.nudges?.enabled}`);

      if (!brain.nudges?.enabled) {
        continue; // This bot doesn't have nudges enabled
      }

      // Get all users with sessions for this bot
      const users = this.sessionManager.getAllUsersForBot(botId);

      console.log(`🔍 Checking ${users.length} users for ${botId} nudges...`);

      for (const userId of users) {
        try {
          await this.checkUserNudges(botId, userId, brain.nudges);
        } catch (err) {
          console.error(`❌ Error checking nudges for ${botId}/${userId}:`, err.message);
        }
      }
    }
  }

  /**
   * Check if a specific user needs a nudge from a bot
   *
   * @param {string} botId - Bot identifier
   * @param {number} userId - Telegram user ID
   * @param {Object} nudgeConfig - Nudge configuration from brain
   */
  async checkUserNudges(botId, userId, nudgeConfig) {
    // Get session metadata
    const metadata = this.sessionManager.loadSessionMetadata(botId, userId);

    if (!metadata || !metadata.lastMessageTime) {
      return; // No conversation yet or no last message time
    }

    // Calculate hours since last user message
    const hoursSinceLastMessage = (Date.now() - metadata.lastMessageTime) / (1000 * 60 * 60);

    // Determine which nudge trigger should fire (if any)
    const trigger = this.getNextNudgeTrigger(
      nudgeConfig.triggers,
      hoursSinceLastMessage,
      metadata.lastNudgeSent || 0
    );

    if (!trigger) {
      return; // No nudge needed yet
    }

    console.log(`📬 Nudge trigger fired for ${botId}/${userId}: ${trigger.delayHours}h`);

    // Send the nudge (will generate message internally based on TTS mode)
    await this.sendNudge(botId, userId, trigger);
  }

  /**
   * Determine which nudge trigger should fire
   *
   * @param {Array} triggers - Array of trigger configs
   * @param {number} hoursSinceLastMessage - Hours since user's last message
   * @param {number} lastNudgeSent - Hours delay of last sent nudge
   * @returns {Object|null} Trigger config or null if none should fire
   */
  getNextNudgeTrigger(triggers, hoursSinceLastMessage, lastNudgeSent) {
    // Find triggers that should fire
    const eligibleTriggers = triggers.filter(trigger => {
      // Must have passed the delay time
      if (hoursSinceLastMessage < trigger.delayHours) return false;

      // Must not have already sent this trigger
      if (trigger.delayHours <= lastNudgeSent) return false;

      // Check condition (currently only 'no_user_message' supported)
      if (trigger.condition === 'no_user_message') {
        return true; // Condition met (user hasn't messaged)
      }

      return false;
    });

    if (eligibleTriggers.length === 0) return null;

    // Return the earliest eligible trigger
    return eligibleTriggers.sort((a, b) => a.delayHours - b.delayHours)[0];
  }

  /**
   * Generate dynamic nudge message using bot's LLM (TEXT MODE ONLY)
   * For TTS mode, this is handled directly in sendNudge()
   *
   * @param {string} botId - Bot identifier
   * @param {number} userId - Telegram user ID
   * @param {Object} trigger - Trigger configuration
   * @returns {Promise<string|null>} Generated message or null if failed
   */
  async generateNudgeMessage(botId, userId, trigger) {
    // Get session UUID
    const sessionId = this.sessionManager.getCurrentUuid(botId, userId);

    if (!sessionId) {
      console.warn(`⚠️  No session found for ${botId}/${userId}, skipping nudge`);
      return null;
    }

    try {
      console.log(`🎯 Generating dynamic nudge (TEXT MODE) for ${botId}/${userId} using LLM...`);

      // Call Claude with the prompt template
      // The bot has full conversation context and will generate a personalized message
      const result = await sendToClaudeSession({
        message: trigger.promptTemplate,
        sessionId: sessionId,
        claudeCmd: this.claudeCmd
      });

      // Extract the message (strip any extra explanations)
      const message = result.text.trim();

      console.log(`✅ Generated nudge (TEXT): "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);

      return message;
    } catch (err) {
      console.error(`❌ Error generating nudge message:`, err.message);
      return null;
    }
  }

  /**
   * Send nudge to user and update session
   *
   * @param {string} botId - Bot identifier
   * @param {number} userId - Telegram user ID
   * @param {Object} trigger - Trigger configuration
   */
  async sendNudge(botId, userId, trigger) {
    const botInfo = this.botManager.bots.get(botId);

    if (!botInfo) {
      console.error(`❌ Bot ${botId} not found`);
      return;
    }

    const bot = botInfo.bot;
    const brain = botInfo.brain;

    try {
      // Check if TTS is enabled for this bot
      const ttsEnabled = brain.tts?.enabled === true;

      let message = null; // The actual nudge text that was generated

      if (ttsEnabled) {
        // TTS MODE: Use 2-turn flow (Turn 1: Generate nudge, Turn 2: TTS)
        const audioResult = await this.generateTTSForNudge(trigger.promptTemplate, brain.tts, botId, userId);

        if (audioResult?.audioPath && audioResult?.text) {
          // Send voice message
          await bot.sendVoice(userId, audioResult.audioPath);
          message = audioResult.text; // Capture the generated text
          console.log(`📤 Nudge sent (voice) to user ${userId} from ${botId}`);
        } else if (audioResult?.text) {
          // Fallback to text if TTS fails but we have the text
          await bot.sendMessage(userId, audioResult.text);
          message = audioResult.text;
          console.log(`📤 Nudge sent (text fallback) to user ${userId} from ${botId}`);
        } else {
          // Complete fallback - generate text-only nudge
          console.warn(`⚠️  TTS failed, falling back to text-only nudge`);
          message = await this.generateNudgeMessage(botId, userId, trigger);
          if (message) {
            await bot.sendMessage(userId, message);
            console.log(`📤 Nudge sent (text fallback) to user ${userId} from ${botId}`);
          } else {
            console.error(`❌ Failed to generate fallback nudge message`);
            return;
          }
        }
      } else {
        // TEXT MODE: Generate and send plain text
        message = await this.generateNudgeMessage(botId, userId, trigger);

        if (!message) {
          console.error(`❌ Failed to generate nudge message`);
          return;
        }

        await bot.sendMessage(userId, message);
        console.log(`📤 Nudge sent (text) to user ${userId} from ${botId}`);
      }

      // 2. Update Claude session so bot "remembers" sending this nudge
      const sessionId = this.sessionManager.getCurrentUuid(botId, userId);

      if (sessionId) {
        // Inject into session as a system note
        await sendToClaudeSession({
          message: `[SYSTEM NOTE: You just sent a follow-up nudge to the user: "${message}"]\n\nUser's response (if any):`,
          sessionId: sessionId,
          claudeCmd: this.claudeCmd
        });

        console.log(`💾 Session updated with nudge context`);
      }

      // 3. Record nudge in metadata
      const nudgeData = {
        timestamp: Date.now(),
        delayHours: trigger.delayHours,
        message: message,
        userResponded: false,
        stopSequence: trigger.stopSequence || false
      };

      this.sessionManager.recordNudge(botId, userId, nudgeData);

      console.log(`✅ Nudge complete for ${botId}/${userId}`);

    } catch (err) {
      console.error(`❌ Error sending nudge:`, err.message);
    }
  }

  /**
   * Generate TTS audio for a nudge using 2-turn flow
   * Turn 1: Send prompt template → Claude generates nudge text
   * Turn 2: Request TTS tool call → Generate audio
   *
   * @param {string} promptTemplate - The prompt template to generate the nudge
   * @param {Object} ttsConfig - TTS configuration from brain
   * @param {string} botId - Bot identifier
   * @param {number} userId - Telegram user ID
   * @returns {Promise<Object|null>} Audio result with audioPath and text, or null if failed
   */
  async generateTTSForNudge(promptTemplate, ttsConfig, botId, userId) {
    const { sendToClaudeWithTTS } = require('./claude-client');

    try {
      // Get session UUID
      const sessionId = this.sessionManager.getCurrentUuid(botId, userId);
      if (!sessionId) {
        console.warn(`⚠️  No session for TTS nudge ${botId}/${userId}`);
        return null;
      }

      console.log(`🎯 Generating dynamic nudge (TTS MODE) for ${botId}/${userId} using 2-turn flow...`);

      // Use the EXACT SAME 2-turn function as regular TTS messages
      // Turn 1: Send prompt template → Claude generates nudge text
      // Turn 2: Request TTS tool call → Generate audio from that text
      const result = await sendToClaudeWithTTS({
        message: promptTemplate, // The prompt template (NOT pre-generated text)
        sessionId: sessionId,
        claudeCmd: this.claudeCmd,
        ttsVoice: ttsConfig.voice || 'nova',
        ttsSpeed: ttsConfig.speed || 1.0,
        ttsProvider: ttsConfig.provider || null,
        botId: botId,
        telegramUserId: userId,
        timeout: 30000 // 30 second timeout per turn
      });

      // Return audioPath AND text if successful
      if (result.success && result.audioPath && result.text) {
        console.log(`🎵 Nudge audio generated: ${result.audioPath}`);
        console.log(`✅ Generated nudge (TTS): "${result.text.substring(0, 100)}${result.text.length > 100 ? '...' : ''}"`);
        return {
          audioPath: result.audioPath,
          text: result.text // Return the generated text so we can record it
        };
      } else if (result.success && result.text) {
        // Audio failed but we have the text
        console.warn(`⚠️  Audio generation failed, but text was generated`);
        return {
          audioPath: null,
          text: result.text
        };
      }

      console.warn(`⚠️  No audio or text in TTS result for nudge`);
      return null;

    } catch (err) {
      const isTimeout = err.timeout === true;
      if (isTimeout) {
        console.error(`⏱️  TTS generation timed out for nudge ${botId}/${userId} - will send text instead`);
      } else {
        console.error(`❌ TTS generation failed for nudge:`, err.message);
      }
      return null;
    }
  }

  /**
   * Stop the nudge manager (cleanup on shutdown)
   */
  stop() {
    if (this.cronJob) {
      clearInterval(this.cronJob);
      console.log('🛑 NudgeManager stopped');
    }
  }
}

module.exports = NudgeManager;
