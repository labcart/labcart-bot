const TelegramBot = require('node-telegram-bot-api');
const BrainLoader = require('./brain-loader');
const ImageProfileLoader = require('./image-profile-loader');
const SessionManager = require('./session-manager');
const RateLimiter = require('./rate-limiter');
const { sendToClaudeSession, sendToClaudeWithTTS, sendToClaudeWithImage } = require('./claude-client');
const { clearRequest } = require('./restart-recovery');
const logger = require('./logger');
const path = require('path');
const fs = require('fs');

/**
 * BotManager
 *
 * Manages multiple Telegram bot instances, each with its own personality (brain).
 * Handles message routing, session management, and Claude integration.
 */
class BotManager {
  constructor(options = {}) {
    this.bots = new Map(); // botId → { bot: TelegramBot, config: {...}, brain: {...}, lastHealthCheck: Date, status: 'healthy' }
    this.brainLoader = new BrainLoader();
    this.imageProfileLoader = new ImageProfileLoader();
    this.sessionManager = new SessionManager();
    this.rateLimiter = new RateLimiter();
    this.claudeCmd = options.claudeCmd || 'claude';

    // Track active conversations (for streaming)
    this.activeConversations = new Map(); // chatId → { statusMsg, lastUpdate }

    // Track pending photo confirmations (for promptOnImageUpload flow)
    this.pendingPhotos = new Map(); // chatId → { photoBase64, photoMediaType, photoPath, timestamp }

    // Check if Telegram polling is disabled via env var
    this.telegramEnabled = process.env.TELEGRAM_ENABLED !== 'false';

    // Health check interval (every 30 seconds) - only if Telegram is enabled
    if (this.telegramEnabled) {
      this.healthCheckInterval = setInterval(() => this.performHealthChecks(), 30000);
    }
  }

  /**
   * Add a bot to the manager
   *
   * @param {Object} config - Bot configuration
   * @param {string} config.id - Unique bot identifier
   * @param {string} config.token - Telegram bot token
   * @param {string} config.brain - Brain file name
   * @param {boolean} [config.active=true] - Whether bot is active
   */
  async addBot(config) {
    const { id, token, brain, active = true, webOnly = false } = config;

    if (!id || !brain) {
      throw new Error('Bot config must include: id, brain');
    }

    if (!active && !webOnly) {
      console.log(`⏸️  Bot ${id} is inactive, skipping`);
      return;
    }

    // Load and validate brain
    const brainConfig = await this.brainLoader.load(brain);

    // For web-only bots (like Claude), skip Telegram bot creation
    if (webOnly || id === 'claude') {
      this.bots.set(id, {
        bot: null, // No Telegram bot instance
        config,
        brain: brainConfig,
        status: 'healthy',
        lastHealthCheck: new Date(),
        messageCount: 0,
        errorCount: 0,
        webOnly: true
      });

      logger.bot(id, 'info', `Web-only bot registered: ${brainConfig.name || id}`);
      return;
    }

    if (!token) {
      throw new Error('Telegram bots must have a token');
    }

    // Skip Telegram bot creation if Telegram is disabled
    if (!this.telegramEnabled) {
      logger.bot(id, 'info', `Telegram disabled - skipping bot: ${brainConfig.name || id}`);
      return;
    }

    // Create Telegram bot instance
    const bot = new TelegramBot(token, { polling: true });

    // Store bot info
    this.bots.set(id, {
      bot,
      config,
      brain: brainConfig,
      status: 'healthy',
      lastHealthCheck: new Date(),
      messageCount: 0,
      errorCount: 0
    });

    // Set up message handler
    bot.on('message', (msg) => this.handleMessage(id, msg));

    // Set up callback query handler (for inline button clicks)
    bot.on('callback_query', (query) => this.handleCallbackQuery(id, query));

    // Set up error handler
    bot.on('polling_error', (error) => {
      logger.bot(id, 'error', 'Polling error', { error: error.message });
      this.handleBotError(id, error);
    });

    // Set bot commands menu (bottom-left menu in Telegram)
    this.setupBotCommands(bot, id);

    logger.bot(id, 'info', `Bot started: ${brainConfig.name || id}`);
  }

  /**
   * Setup bot commands menu (appears in bottom-left of Telegram)
   */
  async setupBotCommands(bot, botId) {
    let commands = [];

    // Focus bots: ONLY /team command
    if (['finnshipley', 'mattyatlas', 'rickd'].includes(botId)) {
      commands = [
        { command: 'team', description: 'Share context with another bot' }
      ];
    } else {
      // Other bots: standard commands
      commands = [
        { command: 'help', description: 'Show help message' },
        { command: 'tts', description: 'Toggle voice/text mode' },
        { command: 'stats', description: 'Show conversation stats' }
      ];

      // Add /restart for CartoonGen
      if (botId === 'cartooned') {
        commands.push({ command: 'restart', description: 'Start fresh conversation' });
      }
    }

    try {
      await bot.setMyCommands(commands);
    } catch (err) {
      console.error(`⚠️ Failed to set commands for ${botId}:`, err.message);
    }
  }

  /**
   * Handle incoming Telegram message
   *
   * @param {string} botId - Bot identifier
   * @param {Object} msg - Telegram message object
   */
  async handleMessage(botId, msg) {
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || msg.caption?.trim() || '';
    const hasPhoto = msg.photo && msg.photo.length > 0;

    // Ignore messages with no text AND no photo
    if (!text && !hasPhoto) return;

    const botInfo = this.bots.get(botId);
    if (!botInfo) {
      console.error(`❌ Bot ${botId} not found`);
      return;
    }

    const { bot, brain } = botInfo;

    // Check if bot is private and user is authorized
    if (brain.private) {
      const adminUserIds = process.env.ADMIN_USER_IDS?.split(',').map(id => parseInt(id.trim())) || [];
      const userId = msg.from.id;

      if (!adminUserIds.includes(userId)) {
        logger.user(botId, userId, 'warn', 'Unauthorized access attempt to private bot', {
          username: msg.from.username || msg.from.first_name
        });
        await bot.sendMessage(chatId, '🔒 This bot is private and requires authorization.');
        return;
      }
    }

    // Log incoming message
    const logText = hasPhoto ? `[PHOTO] ${text || '(no caption)'}` : text;
    logger.user(botId, msg.from.id, 'info', 'Message received', {
      username: msg.from.username || msg.from.first_name,
      text: logText.substring(0, 100),
      hasPhoto
    });

    // Update message count
    botInfo.messageCount++;

    // Handle commands
    if (text.startsWith('/')) {
      // Check for /team command first
      if (text.startsWith('/team')) {
        // If just "/team" with no args, show menu
        if (text.trim() === '/team') {
          return this.showTeamMenu(botId, chatId);
        }
        // Otherwise handle as full team command with args
        return this.handleTeamCommand(botId, msg);
      }
      // Check for /respond command (for callback responses)
      if (text.startsWith('/respond')) {
        return this.handleRespondCommand(botId, msg);
      }
      return this.handleCommand(botId, msg);
    }

    // Check rate limit
    const rateLimit = this.rateLimiter.checkLimit(botId, msg.from.id, brain);
    if (!rateLimit.allowed) {
      const resetTime = new Date();
      resetTime.setHours(24, 0, 0, 0); // Midnight
      await bot.sendMessage(chatId,
        `⏸️ You've reached your daily limit of ${rateLimit.limit} messages.\n\n` +
        `Resets at midnight. Current: ${rateLimit.current}/${rateLimit.limit}`
      );
      logger.user(botId, msg.from.id, 'warn', 'Rate limit exceeded', rateLimit);
      return;
    }

    // NEW: Check if user is confirming a pending photo cartoonification
    const pendingPhoto = this.pendingPhotos.get(chatId);
    if (pendingPhoto && text) {
      // Check if text looks like confirmation
      const confirmWords = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'do it', 'go', 'yea', 'y'];
      const textLower = text.toLowerCase().trim();
      const isConfirmation = confirmWords.some(word => textLower.startsWith(word));

      if (isConfirmation) {
        // User confirmed! Process the photo
        console.log(`✅ [${botId}] User confirmed cartoonification: "${text}"`);

        // Extract custom instructions (everything after "yes" / "yeah" / etc)
        let customInstructions = '';
        for (const word of confirmWords) {
          if (textLower.startsWith(word)) {
            customInstructions = text.substring(word.length).trim();
            // Remove leading "but" if present
            if (customInstructions.toLowerCase().startsWith('but ')) {
              customInstructions = customInstructions.substring(4).trim();
            }
            break;
          }
        }

        // Clear pending photo
        this.pendingPhotos.delete(chatId);

        // Now handle this as a special image-to-cartoon request
        // We'll send to Claude with the image + special prompt to describe it and output marker

        // Send "Drawing..." indicator
        const statusMsg = await bot.sendMessage(chatId, '🎨 Drawing...');

        // Build special prompt for Claude to describe image and output marker
        const systemPrompt = await this.brainLoader.buildSystemPrompt(
          botInfo.config.brain,
          msg.from
        );

        const describePrompt = customInstructions
          ? `Describe this image in detail and output [[IMAGE_PROMPT: description with these modifications: ${customInstructions}]]. Focus on what to draw, not how to draw it.`
          : `Describe this image in detail and output [[IMAGE_PROMPT: description]]. Focus on what to draw, not how to draw it.`;

        // Build message content with image
        const messageContent = [
          {
            type: 'text',
            text: `${systemPrompt}\n\nUser says: ${describePrompt}`
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: pendingPhoto.photoMediaType,
              data: pendingPhoto.photoBase64
            }
          }
        ];

        // Call Claude to describe image and output marker
        try {
          const currentUuid = this.sessionManager.getCurrentUuid(botId, msg.from.id);

          const result = await sendToClaudeSession({
            message: describePrompt,
            messageContent: messageContent,
            sessionId: currentUuid,
            claudeCmd: this.claudeCmd,
            workspacePath: this.sessionManager.getWorkspacePath(botId, msg.from.id) || botInfo.config.workspace || process.env.LABCART_WORKSPACE || process.cwd(),
            botId,
            telegramUserId: msg.from.id,
            chatId,
            statusMsgId: statusMsg.message_id,
            onStreamUpdate: async (partialText) => {
              // Keep showing "🎨 Drawing..." during streaming
              // (Don't update, just keep the status as is)
            }
          });

          // Detect image generation marker in result
          if (result.success && result.text) {
            const markerRegex = /\[\[IMAGE_PROMPT:\s*(.+?)\]\]/s;
            const match = result.text.match(markerRegex);

            if (match) {
              const imagePrompt = match[1].trim();
              console.log(`🎨 [${botId}] Detected image generation marker from cartoonify flow`);
              console.log(`📝 [${botId}] IMAGE DESCRIPTION:\n${imagePrompt}`);

              // Load image config
              const imageConfig = this.imageProfileLoader.load(brain.imageGen.profile);

              // Generate organized output directory
              const imagesOutputDir = path.join(process.cwd(), 'images-output');
              const organizedDir = path.join(imagesOutputDir, `bot-${botId}`, `user-${msg.from.id}`);
              fs.mkdirSync(organizedDir, { recursive: true });

              const imageFilename = `bot-${botId}-user-${msg.from.id}-${Date.now()}`;

              // Build final prompt: Profile's style context + Claude's subject description
              const finalPrompt = imageConfig.promptContext
                ? `${imageConfig.promptContext}\n\n${imagePrompt}`
                : imagePrompt;

              console.log(`📏 [${botId}] Final prompt length: ${finalPrompt.length} chars`);

              // Call image generation HTTP service
              const imageResponse = await fetch('http://localhost:3002/generate_image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt: finalPrompt,
                  model: imageConfig.model,
                  size: imageConfig.size,
                  quality: imageConfig.quality,
                  style: imageConfig.style,
                  filename: imageFilename,
                  output_dir: organizedDir,
                  include_base64: false
                })
              });

              if (!imageResponse.ok) {
                const errorText = await imageResponse.text();
                console.error(`❌ Image service error: ${imageResponse.status} - ${errorText}`);
                await bot.editMessageText('❌ Image generation failed. Try again.', {
                  chat_id: chatId,
                  message_id: statusMsg.message_id
                });
                return;
              }

              const imageResult = await imageResponse.json();
              if (imageResult.success && imageResult.image_path) {
                console.log(`✅ [${botId}] Cartoon generated: ${imageResult.image_path}`);

                // Delete status message
                try {
                  await bot.deleteMessage(chatId, statusMsg.message_id);
                } catch (e) {
                  // Ignore
                }

                // Send cartoon image
                await bot.sendPhoto(chatId, imageResult.image_path);

                logger.user(botId, msg.from.id, 'info', 'Cartoon generated successfully', {
                  imagePrompt: imagePrompt.substring(0, 100),
                  imagePath: imageResult.image_path
                });

                return; // Done!
              } else {
                await bot.editMessageText('❌ Image generation failed. Please try again.', {
                  chat_id: chatId,
                  message_id: statusMsg.message_id
                });
                return;
              }
            } else {
              // No marker found - shouldn't happen, but handle gracefully
              await bot.editMessageText(result.text || '❌ Could not process image', {
                chat_id: chatId,
                message_id: statusMsg.message_id
              });
              return;
            }
          } else {
            // Claude failed
            await bot.editMessageText('❌ Failed to process image', {
              chat_id: chatId,
              message_id: statusMsg.message_id
            });
            return;
          }

        } catch (error) {
          console.error(`❌ [${botId}] Cartoonify error:`, error.message);
          await bot.editMessageText('❌ Failed to generate cartoon', {
            chat_id: chatId,
            message_id: statusMsg.message_id
          });
          return;
        }
      } else {
        // Not a confirmation - clear pending and handle normally
        console.log(`❌ [${botId}] Not a confirmation, clearing pending photo`);
        this.pendingPhotos.delete(chatId);
      }
    }

    // Handle regular message
    try {
      // Send "thinking" indicator
      const statusMsg = await bot.sendMessage(chatId, '⏳ Thinking...');

      // Helper function to call Claude with automatic retry on timeout
      const callClaudeWithRetry = async (claudeFunction, options, maxRetries = 1) => {
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            if (attempt > 0) {
              console.log(`🔄 [${botId}] Retry attempt ${attempt}/${maxRetries} for user ${msg.from.id}`);
              // Update status message for retry
              try {
                await bot.editMessageText(`⏳ Retrying... (${attempt}/${maxRetries})`, {
                  chat_id: chatId,
                  message_id: statusMsg.message_id
                });
              } catch (e) {
                // Ignore edit errors
              }
            }

            const result = await claudeFunction(options);
            return result;
          } catch (error) {
            lastError = error;
            const isTimeout = error.timeout === true;

            if (isTimeout && attempt < maxRetries) {
              console.warn(`⏱️  [${botId}] Timeout on attempt ${attempt + 1}, retrying...`);
              continue; // Try again
            } else {
              // Final attempt failed or non-timeout error
              throw error;
            }
          }
        }

        // All retries exhausted
        throw lastError;
      };

      // Handle photo if present
      let photoBase64 = null;
      let photoMediaType = null;
      let photoPath = null;
      if (hasPhoto) {
        try {
          // Get highest quality photo (last item in array)
          const photo = msg.photo[msg.photo.length - 1];
          const file = await bot.getFile(photo.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${botInfo.config.token}/${file.file_path}`;

          // Create images directory if it doesn't exist
          const imagesDir = require('path').join(process.cwd(), 'telegram-images');
          if (!require('fs').existsSync(imagesDir)) {
            require('fs').mkdirSync(imagesDir, { recursive: true });
          }

          // Download and save the image
          const timestamp = Date.now();
          const filename = `${botId}-user-${msg.from.id}-${timestamp}.jpg`;
          photoPath = require('path').join(imagesDir, filename);

          // Download using node-fetch or https
          const https = require('https');
          const fs = require('fs');
          const fileStream = fs.createWriteStream(photoPath);

          await new Promise((resolve, reject) => {
            https.get(fileUrl, (response) => {
              response.pipe(fileStream);
              fileStream.on('finish', () => {
                fileStream.close();
                resolve();
              });
            }).on('error', (err) => {
              fs.unlink(photoPath, () => {}); // Delete partial file
              reject(err);
            });
          });

          console.log(`📸 [${botId}] Downloaded photo: ${photoPath}`);

          // Convert to base64 for Claude API
          const imageBuffer = fs.readFileSync(photoPath);
          photoBase64 = imageBuffer.toString('base64');
          photoMediaType = 'image/jpeg'; // Telegram photos are always JPEG

          console.log(`🔄 [${botId}] Converted photo to base64 (${photoBase64.length} chars)`);
        } catch (photoError) {
          console.error(`❌ [${botId}] Failed to process photo:`, photoError.message);
          // Continue without photo
        }
      }

      // NEW: Check if photo upload requires confirmation (promptOnImageUpload flow)
      if (photoBase64 && brain.imageGen?.promptOnImageUpload === true && !text) {
        // User uploaded photo with no caption → Ask if they want to cartoonify/transform it
        // Store photo info for later
        this.pendingPhotos.set(chatId, {
          photoBase64,
          photoMediaType,
          photoPath,
          timestamp: Date.now()
        });

        // Delete the "Thinking..." status message
        try {
          await bot.deleteMessage(chatId, statusMsg.message_id);
        } catch (e) {
          // Ignore delete errors
        }

        // Ask user for confirmation (wording based on bot personality)
        await bot.sendMessage(chatId, 'cartoonify this?');

        console.log(`📸 [${botId}] Asking user to confirm cartoonification`);
        return; // Exit early, wait for user's response
      }

      // Build system prompt
      const systemPrompt = await this.brainLoader.buildSystemPrompt(
        botInfo.config.brain,
        msg.from
      );

      // Debug: Log first 300 chars of system prompt
      console.log(`🧠 [${botId}] System prompt preview: ${systemPrompt.substring(0, 300)}...`);

      // Get session info - use session manager for persistence
      const currentUuid = this.sessionManager.getCurrentUuid(botId, msg.from.id);
      const isNewSession = !currentUuid;

      if (isNewSession) {
        console.log(`🆕 [${botId}] New session for user ${msg.from.id}`);
      } else {
        console.log(`📝 [${botId}] Resuming session ${currentUuid.substring(0, 8)}... for user ${msg.from.id}`);
      }

      // Prepare message
      // For new sessions, include system prompt
      // For resumed sessions, just send the user message (context is persisted)

      // Security reminder - sent with EVERY message to prevent role drift
      // Get from brain loader (respects brain's security profile)
      const securityReminder = await this.brainLoader.getSecurityReminder(botInfo.config.brain);

      // Build message content based on whether we have an image
      let fullMessage;
      let messageContent = null; // For structured content (images)

      if (photoBase64) {
        // MULTI-MODAL MODE: Image present
        // We need to structure content as an array for Claude API
        // System prompt and security reminder go in text, then user content is structured

        let prefixText;
        if (isNewSession) {
          // New session: system prompt + security reminder (if enabled)
          prefixText = securityReminder
            ? `${systemPrompt}\n\n---\n\n${securityReminder}\n\nUser says:`
            : `${systemPrompt}\n\nUser says:`;
        } else {
          // Resumed session: just security reminder (if enabled)
          prefixText = securityReminder
            ? `${securityReminder}\n\nUser says:`
            : `User says:`;
        }

        messageContent = [
          {
            type: 'text',
            text: `${prefixText}\n${text || '(user sent an image)'}`
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: photoMediaType,
              data: photoBase64
            }
          }
        ];

        // fullMessage is not used when we have messageContent, but set it for logging
        fullMessage = `${prefixText}\n${text || '(user sent an image)'} [IMAGE]`;

      } else {
        // TEXT-ONLY MODE: No image
        // Use traditional string format (more efficient)
        if (isNewSession) {
          // New session: system prompt + security reminder (if enabled)
          // Wrap user text in delimiters so we can extract it when reading logs
          fullMessage = securityReminder
            ? `${systemPrompt}\n\n---\n\n${securityReminder}\n\n<<<USER_TEXT_START>>>${text}<<<USER_TEXT_END>>>`
            : `${systemPrompt}\n\n<<<USER_TEXT_START>>>${text}<<<USER_TEXT_END>>>`;
        } else {
          // Resumed session: just security reminder (if enabled)
          // Wrap user text in delimiters so we can extract it when reading logs
          fullMessage = securityReminder
            ? `${securityReminder}\n\n<<<USER_TEXT_START>>>${text}<<<USER_TEXT_END>>>`
            : `<<<USER_TEXT_START>>>${text}<<<USER_TEXT_END>>>`;
        }
      }

      // Check if image generation is enabled and how it should be handled
      const imageGenEnabled = brain.imageGen?.enabled === true;
      const useOrganicImageFlow = brain.imageGen?.toolsAlwaysAvailable === true;

      // OLD APPROACH (forced 2-turn): Only for legacy bots without toolsAlwaysAvailable
      // Detect image keywords and force tool call
      const isImageRequest = imageGenEnabled && !useOrganicImageFlow && (
        text.toLowerCase().includes('image') ||
        text.toLowerCase().includes('picture') ||
        text.toLowerCase().includes('photo') ||
        text.toLowerCase().includes('draw') ||
        text.toLowerCase().includes('generate') ||
        text.toLowerCase().includes('create a')
      );

      // Check if TTS is enabled
      // Priority: User preference > Brain default
      const userTtsPreference = this.sessionManager.getTtsPreference(botId, msg.from.id);
      const ttsEnabled = userTtsPreference !== null
        ? userTtsPreference  // Use user preference if set
        : (brain.tts?.enabled === true);  // Otherwise use brain default

      let result;

      if (isImageRequest) {
        // LEGACY IMAGE MODE: 2-turn forced conversation (for old-style image bots)
        // This approach is deprecated - use toolsAlwaysAvailable: true instead
        // IMAGE MODE: 2-turn conversation (identical to TTS)
        // Turn 1: Get Claude's understanding
        // Turn 2: Call image tool → download image file → send to user

        // Load image generation configuration
        // Brain can specify a profile OR inline config (profile takes precedence)
        let imageConfig;
        if (brain.imageGen.profile) {
          // Load profile (throws if profile doesn't exist)
          try {
            imageConfig = this.imageProfileLoader.load(brain.imageGen.profile);
            console.log(`🎨 Using image profile: ${brain.imageGen.profile}`);
          } catch (err) {
            console.error(`❌ Failed to load image profile: ${err.message}`);
            // Fall back to inline config if profile fails
            imageConfig = {
              model: brain.imageGen.model || 'dall-e-2',
              size: brain.imageGen.size || '256x256',
              quality: brain.imageGen.quality || 'standard',
              style: brain.imageGen.style || 'vivid',
              promptContext: brain.imageGen.promptContext || ''
            };
          }
        } else {
          // Use inline config from brain
          imageConfig = {
            model: brain.imageGen.model || 'dall-e-2',
            size: brain.imageGen.size || '256x256',
            quality: brain.imageGen.quality || 'standard',
            style: brain.imageGen.style || 'vivid',
            promptContext: brain.imageGen.promptContext || ''
          };
        }

        result = await callClaudeWithRetry(sendToClaudeWithImage, {
          message: fullMessage,
          messageContent: messageContent,
          userText: text,  // Pass raw user text for image prompt
          sessionId: currentUuid,
          claudeCmd: this.claudeCmd,
          workspacePath: botInfo.config.workspace || null,
          botId,
          telegramUserId: msg.from.id,
          chatId,
          statusMsgId: statusMsg.message_id,
          imageModel: imageConfig.model,
          imageSize: imageConfig.size,
          imageQuality: imageConfig.quality,
          imageStyle: imageConfig.style,
          imagePromptContext: imageConfig.promptContext,
          onTurn2Start: async () => {
            // Update status from "Thinking..." to "Drawing..."
            try {
              await bot.editMessageText('🎨 Drawing...', {
                chat_id: chatId,
                message_id: statusMsg.message_id
              });
            } catch (e) {
              // Ignore edit errors
            }
          }
        });
      } else if (ttsEnabled) {
        // TTS MODE: 2-turn conversation (convert Claude's text response to audio)
        result = await callClaudeWithRetry(sendToClaudeWithTTS, {
          message: fullMessage,
          messageContent: messageContent, // Pass structured content if we have images
          sessionId: currentUuid, // Use UUID for --resume
          claudeCmd: this.claudeCmd,
          workspacePath: botInfo.config.workspace || null,
          chatId,
          statusMsgId: statusMsg.message_id,
          ttsVoice: brain.tts.voice || 'nova',
          ttsSpeed: brain.tts.speed || 1.0,
          ttsProvider: brain.tts.provider || null,  // Pass provider from brain config
          botId,
          telegramUserId: msg.from.id,
          onTurn2Start: async () => {
            // Update status from "Thinking..." to "Recording..."
            try {
              await bot.editMessageText('🎙️ Recording...', {
                chat_id: chatId,
                message_id: statusMsg.message_id
              });
            } catch (e) {
              // Ignore edit errors
            }
          }
        });
      } else {
        // TEXT MODE: Streaming enabled (Claude may call tools during response)
        // If useOrganicImageFlow is true, image tools will be available for Claude to use
        let streamedText = '';
        let lastUpdate = Date.now();
        let generatedImages = []; // Track images generated during response

        const onStream = async (chunk) => {
          streamedText += chunk;

          // Throttle updates to avoid rate limits (max 1 per second)
          const now = Date.now();
          if (now - lastUpdate > 1000) {
            lastUpdate = now;
            try {
              const preview = streamedText.length > 400
                ? streamedText.substring(0, 400) + '...'
                : streamedText;

              await bot.editMessageText(preview, {
                chat_id: chatId,
                message_id: statusMsg.message_id
              });
            } catch (e) {
              // Ignore edit errors (message might be too old or identical)
            }
          }
        };

        // Determine MCP profile based on bot configuration
        // If toolsAlwaysAvailable, enable image tools for organic calling
        // If useMarkerDetection, disable tools (we'll detect markers instead)
        const useMarkerDetection = brain.imageGen?.useMarkerDetection === true;
        const mcpProfile = (useOrganicImageFlow && !useMarkerDetection) ? 'with-image-tools' : 'no-image-tools';

        result = await callClaudeWithRetry(sendToClaudeSession, {
          message: fullMessage,
          messageContent: messageContent, // Pass structured content if we have images
          sessionId: currentUuid, // Use UUID for --resume (null for new sessions)
          claudeCmd: this.claudeCmd,
          workspacePath: botInfo.config.workspace || null,
          mcpProfile: mcpProfile, // NEW: Pass MCP profile to enable/disable image tools
          chatId,
          statusMsgId: statusMsg.message_id,
          botId,
          telegramUserId: msg.from.id,
          onStream,
          onToolResult: (toolName, toolResult) => {
            // Watch for image generation tool calls (organic flow)
            if (toolName === 'mcp__image-gen__generate_image') {
              try {
                const imageData = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
                if (imageData.success && imageData.image_path) {
                  console.log(`🖼️  [${botId}] Image generated organically: ${imageData.image_path}`);
                  generatedImages.push(imageData.image_path);
                }
              } catch (e) {
                console.error(`⚠️  Failed to parse image result:`, e.message);
              }
            }
          }
        });

        // Attach generated images to result
        result.generatedImages = generatedImages;

        // NEW: Marker-based image generation detection
        if (useMarkerDetection && result.success && result.text) {
          const markerRegex = /\[\[IMAGE_PROMPT:\s*(.+?)\]\]/s;
          const match = result.text.match(markerRegex);

          if (match) {
            const imagePrompt = match[1].trim();
            console.log(`🎨 [${botId}] Detected image generation marker`);
            console.log(`📝 [${botId}] Prompt: ${imagePrompt.substring(0, 100)}...`);

            // Remove marker from visible text
            result.text = result.text.replace(markerRegex, '').trim();

            // Load image config
            let imageConfig;
            if (brain.imageGen.profile) {
              try {
                imageConfig = this.imageProfileLoader.load(brain.imageGen.profile);
              } catch (err) {
                console.error(`❌ Failed to load image profile: ${err.message}`);
                imageConfig = {
                  model: 'dall-e-2',
                  size: '256x256',
                  quality: 'standard',
                  style: 'vivid'
                };
              }
            } else {
              imageConfig = {
                model: brain.imageGen.model || 'dall-e-2',
                size: brain.imageGen.size || '256x256',
                quality: brain.imageGen.quality || 'standard',
                style: brain.imageGen.style || 'vivid'
              };
            }

            // Generate organized output directory
            const audioOutputDir = path.join(process.cwd(), 'images-output');
            const organizedDir = path.join(audioOutputDir, `bot-${botId}`, `user-${msg.from.id}`);
            require('fs').mkdirSync(organizedDir, { recursive: true });

            const imageFilename = `bot-${botId}-user-${msg.from.id}-${Date.now()}`;

            // Call image generation HTTP service directly
            try {
              console.log(`🖼️  [${botId}] Calling image generation service...`);
              const imageResponse = await fetch('http://localhost:3002/generate_image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt: imagePrompt,
                  model: imageConfig.model,
                  size: imageConfig.size,
                  quality: imageConfig.quality,
                  style: imageConfig.style,
                  filename: imageFilename,
                  output_dir: organizedDir,
                  include_base64: false
                })
              });

              if (!imageResponse.ok) {
                const errorText = await imageResponse.text();
                console.error(`❌ Image service error: ${imageResponse.status} - ${errorText}`);
              } else {
                const imageResult = await imageResponse.json();
                if (imageResult.success && imageResult.image_path) {
                  console.log(`✅ [${botId}] Image generated: ${imageResult.image_path}`);
                  result.generatedImages = result.generatedImages || [];
                  result.generatedImages.push(imageResult.image_path);
                }
              }
            } catch (error) {
              console.error(`❌ [${botId}] Image generation error:`, error.message);
            }
          }
        }
      }

      // Capture and store the UUID from Claude's response
      let claudeUuid = null;
      if (result.success && result.metadata?.sessionInfo?.sessionId) {
        claudeUuid = result.metadata.sessionInfo.sessionId;
        const workspace = botInfo.config.workspace || null;
        this.sessionManager.setCurrentUuid(botId, msg.from.id, claudeUuid, workspace);
        console.log(`💾 [${botId}] Saved UUID ${claudeUuid.substring(0, 8)}... for user ${msg.from.id} (workspace: ${workspace || 'none'})`);
      }

      // Increment message count (count both user message + bot response = 2)
      // Pass claudeUuid to track counts per session
      this.sessionManager.incrementMessageCount(botId, msg.from.id, claudeUuid);
      this.sessionManager.incrementMessageCount(botId, msg.from.id, claudeUuid);

      // Increment rate limit counter
      this.rateLimiter.increment(botId, msg.from.id);

      // Update last message time (for nudge system)
      this.sessionManager.updateLastMessageTime(botId, msg.from.id);

      // Mark last nudge as responded (if there was one)
      const metadata = this.sessionManager.loadSessionMetadata(botId, msg.from.id);
      if (metadata?.nudgeHistory?.length > 0) {
        const lastNudge = metadata.nudgeHistory[metadata.nudgeHistory.length - 1];
        if (!lastNudge.userResponded) {
          this.sessionManager.markNudgeResponded(botId, msg.from.id, lastNudge.timestamp);
        }
      }

      // Delete thinking message
      try {
        await bot.deleteMessage(chatId, statusMsg.message_id);
      } catch (e) {
        // Ignore delete errors
      }

      // Clear request tracking (request completed successfully)
      await clearRequest(botId, msg.from.id);

      // Send final response
      console.log(`🐛 [${botId}] Result:`, JSON.stringify({success: result.success, hasText: !!result.text, hasImagePath: !!result.imagePath, hasAudioPath: !!result.audioPath}, null, 2));
      // Accept result if: success AND (has text OR has image OR has audio)
      if (result.success && (result.text || result.imagePath || result.audioPath)) {
        let cleanResponse = result.text || '';

        // Clean up response (remove system prompt echo if present)
        if (cleanResponse && cleanResponse.includes('User:')) {
          // Sometimes Claude echoes the prompt, remove it
          const userIndex = cleanResponse.lastIndexOf('User:');
          if (userIndex > 0) {
            cleanResponse = cleanResponse.substring(userIndex + 5).trim();
          }
        }

        // Check if audio was generated
        const hasAudio = result.audioPath && result.audioPath !== null;
        const sendTextTooAudio = brain.tts?.sendTextToo === true; // Default to false (audio only)

        // Check if images were generated
        // - 2-turn flow: result.imagePath (single image from sendToClaudeWithImage)
        // - 1-turn flow: result.generatedImages (array from tool monitoring)
        const hasImageFrom2Turn = result.imagePath && result.imagePath !== null;
        const hasImagesFrom1Turn = result.generatedImages && result.generatedImages.length > 0;
        const hasImages = hasImageFrom2Turn || hasImagesFrom1Turn;
        const sendTextTooImage = brain.imageGen?.sendTextToo === true; // Default to false (image only)

        // Send audio if available
        if (hasAudio) {
          try {
            await bot.sendVoice(chatId, result.audioPath);
            console.log(`✅ [${botId}] Voice message sent: ${result.audioPath}`);
          } catch (audioError) {
            console.error(`❌ [${botId}] Failed to send audio:`, audioError.message);
            // Fall back to text if audio fails
            await bot.sendMessage(chatId, cleanResponse);
          }
        }

        // Send images if available
        if (hasImages) {
          // 2-turn flow: single image
          if (hasImageFrom2Turn) {
            try {
              await bot.sendPhoto(chatId, result.imagePath);
              console.log(`✅ [${botId}] Image sent (2-turn): ${result.imagePath}`);
            } catch (imageError) {
              console.error(`❌ [${botId}] Failed to send image:`, imageError.message);
            }
          }

          // 1-turn flow: multiple images (if any)
          if (hasImagesFrom1Turn) {
            for (const imagePath of result.generatedImages) {
              try {
                await bot.sendPhoto(chatId, imagePath);
                console.log(`✅ [${botId}] Image sent (1-turn): ${imagePath}`);
              } catch (imageError) {
                console.error(`❌ [${botId}] Failed to send image:`, imageError.message);
              }
            }
          }
        }

        // Send text version ONLY if:
        // - No audio/image was generated (text mode) OR
        // - Audio was generated but sendTextToo is true OR
        // - Image was generated but sendTextToo is true
        const shouldSendText = (!hasAudio && !hasImages) ||
                               (hasAudio && sendTextTooAudio) ||
                               (hasImages && sendTextTooImage);

        if (shouldSendText) {
          // Split into chunks if needed (Telegram limit: 4096 chars)
          const MAX_LENGTH = 4000;
          if (cleanResponse.length <= MAX_LENGTH) {
            await bot.sendMessage(chatId, cleanResponse);
          } else {
            // Send in chunks
            for (let i = 0; i < cleanResponse.length; i += MAX_LENGTH) {
              const chunk = cleanResponse.substring(i, i + MAX_LENGTH);
              await bot.sendMessage(chatId, chunk);
            }
          }
        }

        // Log response
        let responseType;
        if (hasAudio && sendTextTooAudio) {
          responseType = '(voice + text)';
        } else if (hasAudio) {
          responseType = '(voice only)';
        } else if (hasImages && sendTextTooImage) {
          const imageCount = hasImagesFrom1Turn ? result.generatedImages.length : 1;
          responseType = `(${imageCount} image(s) + text)`;
        } else if (hasImages) {
          const imageCount = hasImagesFrom1Turn ? result.generatedImages.length : 1;
          responseType = `(${imageCount} image(s) only)`;
        } else {
          responseType = '(text only)';
        }
        console.log(`✅ [${botId}] Response sent ${responseType} (${cleanResponse.length} chars)`);

        // Check if we should send a Call-to-Action message
        if (brain.callToAction?.enabled) {
          const metadata = this.sessionManager.loadSessionMetadata(botId, msg.from.id);
          const triggerEvery = brain.callToAction.triggerEvery || 5;
          const sendOnFirst = brain.callToAction.sendOnFirstMessage === true;

          // Send CTA if:
          // 1. It's the first message AND sendOnFirstMessage is true, OR
          // 2. Message count is a multiple of triggerEvery
          const shouldSendCTA = metadata && (
            (sendOnFirst && metadata.messageCount === 1) ||
            (metadata.messageCount % triggerEvery === 0)
          );

          if (shouldSendCTA) {
            // Get delay in seconds (default to 0 for immediate send)
            const delaySeconds = brain.callToAction.delaySeconds || 0;
            const delayMs = delaySeconds * 1000;

            // Send CTA after delay
            setTimeout(async () => {
              try {
                if (brain.callToAction.image) {
                  // Send photo with caption
                  const imagePath = require('path').join(process.cwd(), brain.callToAction.image);
                  await bot.sendPhoto(chatId, imagePath, {
                    caption: brain.callToAction.message
                  });
                  console.log(`📢 [${botId}] CTA sent (with image) to user ${msg.from.id} (message #${metadata.messageCount}) after ${delaySeconds}s delay`);
                } else {
                  // Send text message with link preview
                  await bot.sendMessage(chatId, brain.callToAction.message, {
                    disable_web_page_preview: false
                  });
                  console.log(`📢 [${botId}] CTA sent to user ${msg.from.id} (message #${metadata.messageCount}) after ${delaySeconds}s delay`);
                }
              } catch (ctaError) {
                console.error(`❌ [${botId}] Failed to send CTA:`, ctaError.message);
              }
            }, delayMs);

            if (delaySeconds > 0) {
              console.log(`⏰ [${botId}] CTA scheduled for user ${msg.from.id} in ${delaySeconds} seconds`);
            }
          }
        }
      } else {
        // Error from Claude
        // Delete thinking message
        try {
          await bot.deleteMessage(chatId, statusMsg.message_id);
        } catch (e) {
          // Ignore delete errors
        }

        // Clear request tracking (request failed)
        await clearRequest(botId, msg.from.id);

        await bot.sendMessage(chatId, `❌ Sorry, I encountered an error: ${result.error || 'Unknown error'}\n\nPlease try sending your message again.`);
        console.error(`❌ [${botId}] Claude error:`, result.error);
      }
    } catch (error) {
      console.error(`❌ [${botId}] Error handling message:`, error);

      // Delete thinking message
      try {
        await bot.deleteMessage(chatId, statusMsg.message_id);
      } catch (e) {
        // Ignore delete errors
      }

      // Clear request tracking (request crashed)
      await clearRequest(botId, msg.from.id);

      // Send user-friendly error message based on error type
      const isTimeout = error.timeout === true;
      const errorMsg = isTimeout
        ? `⏱️ Sorry, I'm taking too long to respond. Please try again.`
        : `❌ Sorry, something went wrong. Please try sending your message again.`;

      // Log technical details to console for debugging
      if (isTimeout) {
        console.error(`❌ [${botId}] Request timed out after retries for user ${msg.from.id}`);
      } else {
        console.error(`❌ [${botId}] Error details:`, error.message, error.stack);
      }

      try {
        await bot.sendMessage(chatId, errorMsg);
      } catch (e) {
        // Failed to send error message
        console.error(`❌ [${botId}] Failed to send error message:`, e.message);
      }
    }
  }

  /**
   * Handle bot commands
   *
   * @param {string} botId - Bot identifier
   * @param {Object} msg - Telegram message object
   */
  async handleCommand(botId, msg) {
    const chatId = msg.chat.id;
    const command = msg.text.split(' ')[0].toLowerCase();

    const botInfo = this.bots.get(botId);
    if (!botInfo) return;

    const { bot, brain } = botInfo;

    switch (command) {
      case '/start':
      case '/help':
        let helpText = `👋 Hi! I'm ${brain.name || 'a bot'}.

Just send me a message and I'll respond.

Commands:
/help - Show this help message
/tts - Toggle voice/text mode
/stats - Show conversation stats`;

        // Add /team command for focus bots
        if (['finnshipley', 'mattyatlas', 'rickd'].includes(botId)) {
          helpText += `\n/team - Share context with another bot`;
        }

        // Add /restart command for CartoonGen only
        if (botId === 'cartooned') {
          helpText += `\n/restart - Start fresh conversation`;
        }

        await bot.sendMessage(chatId, helpText);
        break;

      case '/reset':
        // INTERNAL: Silent reset - clears UUID but keeps tracking
        // Moves current UUID to history, next message starts fresh Claude conversation
        this.sessionManager.resetConversation(botId, msg.from.id);
        // No user notification - happens silently
        console.log(`🔄 [${botId}] Conversation reset for user ${msg.from.id} (silent)`);
        break;

      case '/restart':
        // USER-FACING: Reset conversation with confirmation
        // Only available for CartoonGen bot
        if (botId === 'cartooned') {
          this.sessionManager.resetConversation(botId, msg.from.id);
          await bot.sendMessage(chatId, '🔄 Conversation restarted!');
          console.log(`🔄 [${botId}] Conversation restarted for user ${msg.from.id}`);
        } else {
          await bot.sendMessage(chatId, '❓ This command is not available for this bot. Try /help');
        }
        break;

      case '/tts':
        // Toggle TTS on/off for this user
        const currentTtsPref = this.sessionManager.getTtsPreference(botId, msg.from.id);
        const brainDefault = brain.tts?.enabled === true;

        // If no preference set, use opposite of brain default
        // If preference is set, toggle it
        const currentState = currentTtsPref !== null ? currentTtsPref : brainDefault;
        const newState = !currentState;

        this.sessionManager.setTtsPreference(botId, msg.from.id, newState);

        const confirmationMsg = newState
          ? '🎙️ Speech Mode Activated'
          : '💬 Text Mode Activated';

        await bot.sendMessage(chatId, confirmationMsg);
        console.log(`🔊 [${botId}] TTS toggled for user ${msg.from.id}: ${currentState} → ${newState}`);
        break;

      case '/stats':
        // Show session metadata
        const metadata = this.sessionManager.loadSessionMetadata(botId, msg.from.id);
        if (metadata) {
          const statsText = `📊 **Conversation Stats**

Messages: ${metadata.messageCount}
Started: ${metadata.created.toLocaleDateString()}
Last message: ${metadata.modified.toLocaleString()}
Session size: ${(metadata.sizeBytes / 1024).toFixed(1)} KB`;

          await bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
        } else {
          await bot.sendMessage(chatId, '📊 No conversation history yet. Send a message to start!');
        }
        break;

      case '/team':
        // Show team menu if no args provided
        if (msg.text.trim() === '/team') {
          await this.showTeamMenu(botId, chatId);
        } else {
          // Handle as normal team command with args
          await this.handleTeamCommand(botId, msg);
        }
        break;

      default:
        // Unknown command
        await bot.sendMessage(chatId, `❓ Unknown command. Try /help for available commands.`);
    }
  }

  /**
   * Show team menu with quick action buttons
   */
  async showTeamMenu(botId, chatId) {
    const botInfo = this.bots.get(botId);
    if (!botInfo) return;

    const { bot } = botInfo;

    // Focus bots: finnshipley, mattyatlas, rickd
    const focusBots = ['finnshipley', 'mattyatlas', 'rickd'];
    const availableBots = focusBots.filter(b => b !== botId && this.bots.has(b));

    if (availableBots.length === 0) {
      await bot.sendMessage(chatId, '⚠️ No other bots available for team delegation.');
      return;
    }

    // Create inline keyboard buttons
    const buttons = availableBots.map(targetBot => {
      const targetBotInfo = this.bots.get(targetBot);
      const displayName = targetBotInfo?.brain?.name || targetBot;
      return [{
        text: `📨 Send to ${displayName}`,
        callback_data: `team:${targetBot}`
      }];
    });

    await bot.sendMessage(chatId,
      `📨 **Team Context Sharing**\n\n` +
      `Select a bot to send your last 15 messages to:\n` +
      `(They'll receive context and wait for your direction)`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: buttons
        }
      }
    );
  }

  /**
   * Handle inline button clicks (callback queries)
   */
  async handleCallbackQuery(botId, query) {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const data = query.data;

    // Log callback query received
    logger.user(botId, userId, 'info', 'Callback query received', {
      callbackData: data,
      username: query.from.username
    });

    const botInfo = this.bots.get(botId);
    if (!botInfo) return;

    const { bot } = botInfo;

    // Answer the callback to remove loading state
    await bot.answerCallbackQuery(query.id);

    // Parse callback data
    if (data.startsWith('team:')) {
      const targetBotId = data.replace('team:', '');

      logger.user(botId, userId, 'info', 'Processing team button click', {
        targetBot: targetBotId
      });

      // Get recent messages
      let recentMessages = [];
      try {
        recentMessages = await this.getRecentMessages(botId, userId, 15);
        logger.user(botId, userId, 'info', 'Retrieved context messages', {
          messageCount: recentMessages.length
        });
      } catch (err) {
        console.error(`⚠️ Failed to read session context for ${botId}:`, err.message);
        logger.user(botId, userId, 'error', 'Failed to retrieve context', {
          error: err.message
        });
      }

      // Delegate with default task message
      const task = 'Please review this context and let me know your thoughts';

      try {
        logger.user(botId, userId, 'info', 'Starting delegation to target bot', {
          targetBot: targetBotId,
          messageCount: recentMessages.length
        });

        await this.delegateToBot(botId, targetBotId, userId, task, recentMessages);

        const targetBotInfo = this.bots.get(targetBotId);
        const targetName = targetBotInfo?.brain?.name || targetBotId;

        logger.user(botId, userId, 'info', 'Delegation completed successfully', {
          targetBot: targetBotId,
          targetName: targetName
        });

        // Edit the original message to show success
        await bot.editMessageText(
          `✅ **Context sent to ${targetName}!**\n\n` +
          `📝 Shared ${recentMessages.length} messages\n` +
          `Check your conversation with @${targetBotId} to continue.`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
          }
        );

        logger.user(botId, userId, 'info', 'Team delegation via button', {
          targetBot: targetBotId,
          messageCount: recentMessages.length
        });
      } catch (err) {
        console.error(`❌ Failed to delegate to ${targetBotId}:`, err.message);
        logger.user(botId, userId, 'error', 'Team delegation failed', {
          targetBot: targetBotId,
          error: err.message,
          stack: err.stack
        });

        await bot.editMessageText(
          `❌ **Failed to send context**\n\n` +
          `Error: ${err.message}`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
          }
        );
      }
    }
  }

  /**
   * Start all bots
   *
   * This is called after all bots have been added.
   */
  startAll() {
    console.log(`\n🤖 Bot Platform Running`);
    console.log(`📊 Active bots: ${this.bots.size}`);

    // List all bots
    for (const [id, { brain }] of this.bots) {
      console.log(`   - ${brain.name || id} (brain: ${brain.version || '1.0'})`);
    }

    console.log(`\n✨ Ready to receive messages!\n`);
  }

  /**
   * Stop all bots
   *
   * Gracefully shut down all Telegram bot instances.
   */
  async stopAll() {
    logger.info('Shutting down bots...');

    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    for (const [id, { bot }] of this.bots) {
      try {
        await bot.stopPolling();
        logger.bot(id, 'info', 'Bot stopped');
      } catch (error) {
        logger.bot(id, 'error', 'Error stopping bot', { error: error.message });
      }
    }

    this.bots.clear();
    logger.info('All bots stopped');
  }

  /**
   * Get bot by ID
   *
   * @param {string} botId - Bot identifier
   * @returns {Object|null} Bot info or null if not found
   */
  getBot(botId) {
    return this.bots.get(botId) || null;
  }

  /**
   * List all active bots
   *
   * @returns {Array<Object>} Array of bot info objects
   */
  listBots() {
    return Array.from(this.bots.entries()).map(([id, info]) => ({
      id,
      name: info.brain.name,
      version: info.brain.version,
      description: info.brain.description
    }));
  }

  /**
   * Perform health checks on all bots
   */
  performHealthChecks() {
    const now = new Date();

    for (const [id, botInfo] of this.bots) {
      try {
        const { bot, status, lastHealthCheck, messageCount, errorCount, config } = botInfo;

        // Skip health checks for webOnly bots (they don't have Telegram polling)
        if (config.webOnly) {
          continue;
        }

        // Check if bot is still responsive
        const isHealthy = bot.isPolling();

        // Update status
        if (isHealthy && status !== 'healthy') {
          logger.bot(id, 'info', 'Bot recovered', { messageCount, errorCount });
          botInfo.status = 'healthy';
          botInfo.errorCount = 0;
        } else if (!isHealthy && status !== 'unhealthy') {
          logger.bot(id, 'warn', 'Bot unhealthy - not polling', { lastHealthCheck });
          botInfo.status = 'unhealthy';

          // Attempt recovery
          this.recoverBot(id);
        }

        botInfo.lastHealthCheck = now;

      } catch (error) {
        logger.bot(id, 'error', 'Health check failed', { error: error.message });
        botInfo.errorCount++;

        // If too many errors, attempt recovery
        if (botInfo.errorCount >= 3) {
          this.recoverBot(id);
        }
      }
    }
  }

  /**
   * Attempt to recover a bot
   */
  async recoverBot(id) {
    logger.bot(id, 'warn', 'Attempting bot recovery...');

    const botInfo = this.bots.get(id);
    if (!botInfo) return;

    const { bot, config } = botInfo;

    try {
      // Stop polling
      await bot.stopPolling();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Recreate bot instance
      const newBot = new TelegramBot(config.token, { polling: true });

      // Set up handlers
      newBot.on('message', (msg) => this.handleMessage(id, msg));
      newBot.on('polling_error', (error) => {
        logger.bot(id, 'error', 'Polling error', { error: error.message });
        this.handleBotError(id, error);
      });

      // Update bot info
      botInfo.bot = newBot;
      botInfo.status = 'healthy';
      botInfo.errorCount = 0;
      botInfo.lastHealthCheck = new Date();

      logger.bot(id, 'info', 'Bot recovered successfully');

    } catch (error) {
      logger.bot(id, 'error', 'Bot recovery failed', { error: error.message });
      botInfo.status = 'failed';
    }
  }

  /**
   * Handle bot errors
   */
  handleBotError(id, error) {
    const botInfo = this.bots.get(id);
    if (!botInfo) return;

    botInfo.errorCount++;

    // If too many errors, mark as unhealthy
    if (botInfo.errorCount >= 5) {
      botInfo.status = 'unhealthy';
      logger.bot(id, 'error', 'Bot marked unhealthy - too many errors', {
        errorCount: botInfo.errorCount
      });
    }
  }

  /**
   * Handle /team command for cross-bot delegation
   *
   * Usage: /team @botname task description
   * Usage with custom msg count: /team @botname -m 30 task description
   * Example: /team @finnshipley implement the authentication system
   * Example: /team @finnshipley -m 20 review our conversation about auth
   */
  async handleTeamCommand(sourceBotId, msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const text = msg.text || '';

    const sourceBotInfo = this.bots.get(sourceBotId);
    if (!sourceBotInfo) return;

    const sourceBot = sourceBotInfo.bot;

    // Parse: "/team @finn @priest task description here"
    const botMentions = text.match(/@(\w+)/g) || [];
    const targetBots = botMentions.map(m => m.slice(1).toLowerCase());

    // Extract optional -m flag for message count
    const msgCountMatch = text.match(/-m\s+(\d+)/);
    const msgCount = msgCountMatch ? parseInt(msgCountMatch[1]) : 15; // Default 15 messages

    // Extract task (everything after /team, minus @mentions and -m flag)
    const task = text
      .replace('/team', '')
      .replace(/@\w+/g, '')
      .replace(/-m\s+\d+/, '')
      .trim();

    // Validation
    if (targetBots.length === 0) {
      await sourceBot.sendMessage(chatId,
        `ℹ️ **/team Command Usage**\n\n` +
        `Send context to another bot:\n` +
        `/team @botname task description\n` +
        `/team @botname -m 30 task description (custom message count)\n\n` +
        `**Available bots:**\n${Array.from(this.bots.keys()).map(b => `• @${b}`).join('\n')}\n\n` +
        `Default: 15 messages shared`
      );
      return;
    }

    if (!task) {
      await sourceBot.sendMessage(chatId,
        `⚠️ Please provide a task description.\n\n` +
        `Example: /team @finnshipley review this code`
      );
      return;
    }

    // Get recent context from source bot's session
    let recentMessages = [];
    try {
      recentMessages = await this.getRecentMessages(sourceBotId, userId, msgCount);
    } catch (err) {
      console.error(`⚠️ Failed to read session context for ${sourceBotId}:`, err.message);
      // Continue with empty context
    }

    // Send to each target bot
    const results = [];
    for (const targetBotId of targetBots) {
      try {
        await this.delegateToBot(sourceBotId, targetBotId, userId, task, recentMessages);
        results.push(`✅ @${targetBotId}`);
      } catch (err) {
        console.error(`❌ Failed to delegate to ${targetBotId}:`, err.message);
        results.push(`❌ @${targetBotId} (${err.message})`);
      }
    }

    // Confirm to user in source bot's chat
    await sourceBot.sendMessage(chatId,
      `📨 **Context shared with:**\n${results.join('\n')}\n\n` +
      `📝 Sent ${recentMessages.length} messages of context\n` +
      `Check your conversation with each bot to continue.`
    );

    logger.user(sourceBotId, userId, 'info', 'Team delegation', {
      targetBots,
      task: task.substring(0, 50)
    });
  }

  /**
   * Handle /respond command for callback responses
   * Format: /respond <requestId> <YES/NO> <reasoning>
   */
  async handleRespondCommand(botId, msg) {
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    // Parse: /respond req_123 YES This looks good
    const parts = text.split(' ');
    if (parts.length < 3) {
      const botInfo = this.bots.get(botId);
      if (botInfo) {
        await botInfo.bot.sendMessage(chatId,
          '❌ Invalid format. Use:\n/respond <requestId> <YES/NO> <reasoning>');
      }
      return;
    }

    const requestId = parts[1];
    const response = parts[2].toUpperCase();
    const reasoning = parts.slice(3).join(' ');

    if (response !== 'YES' && response !== 'NO') {
      const botInfo = this.bots.get(botId);
      if (botInfo) {
        await botInfo.bot.sendMessage(chatId,
          '❌ Response must be YES or NO');
      }
      return;
    }

    // Send callback to server
    try {
      const BOT_SERVER_PORT = process.env.BOT_SERVER_PORT || 3010;
      const callbackResponse = await fetch(`http://localhost:${BOT_SERVER_PORT}/callback/${requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: response === 'YES',
          reasoning: reasoning || 'No reasoning provided'
        })
      });

      if (callbackResponse.ok) {
        const botInfo = this.bots.get(botId);
        if (botInfo) {
          await botInfo.bot.sendMessage(chatId,
            `✅ Response recorded!\n\n` +
            `Decision: **${response}**\n` +
            `Reasoning: ${reasoning || '(none provided)'}`);
        }

        logger.user(botId, msg.from.id, 'info', 'Callback response sent', {
          requestId,
          response,
          reasoning: reasoning?.substring(0, 50)
        });
      } else {
        throw new Error('Callback failed');
      }
    } catch (error) {
      console.error('❌ Failed to send callback:', error);
      const botInfo = this.bots.get(botId);
      if (botInfo) {
        await botInfo.bot.sendMessage(chatId,
          '❌ Failed to send response. Please try again.');
      }
    }
  }

  /**
   * Delegate task to a target bot with context
   */
  async delegateToBot(sourceBotId, targetBotId, userId, task, recentMessages, requestId = null, responseFormat = null) {
    // Check if target bot exists
    const targetBotInfo = this.bots.get(targetBotId);
    if (!targetBotInfo) {
      throw new Error(`Bot not found: ${targetBotId}`);
    }

    // Check if user has a session with target bot
    const targetSessionId = this.sessionManager.getCurrentUuid(targetBotId, userId);
    if (!targetSessionId) {
      throw new Error(`No active session. Start a conversation with @${targetBotId} first.`);
    }

    // Build delegation message
    const contextMsg = this.buildDelegationMessage(sourceBotId, task, recentMessages, requestId, responseFormat);

    // Send to target bot's session
    const result = await sendToClaudeSession({
      message: contextMsg,
      sessionId: targetSessionId,
      claudeCmd: this.claudeCmd,
      workspacePath: targetBotInfo.config.workspace || null,
      botId: targetBotId,
      telegramUserId: userId,
      chatId: userId, // DM with user
      statusMsgId: null, // Don't show "thinking..." for delegations
      onStream: null // Let it complete without streaming
    });

    if (!result.success) {
      throw new Error(result.error || 'Delegation failed');
    }

    // Send Claude's response to Telegram (for user visibility)
    if (result.text) {
      const { bot } = targetBotInfo;

      // Add header to show this is a callback response
      let responseMessage = result.text;
      if (requestId) {
        const sourceLabel = sourceBotId === 'external' ? 'Claude Query' : sourceBotId.toUpperCase();
        responseMessage = `🔄 **Responding to ${sourceLabel}:**\n\n${result.text}`;
      }

      await bot.sendMessage(userId, responseMessage, { parse_mode: 'Markdown' });

      logger.user(targetBotId, userId, 'info', 'Delegation response sent', {
        responseLength: result.text.length,
        hasRequestId: !!requestId,
        responsePreview: result.text.substring(0, 100)
      });

      // If this is a callback request, parse response and send callback
      if (requestId && responseFormat) {
        const responseText = result.text.toLowerCase();
        let booleanResponse = null;

        // Parse for YES/NO
        if (responseText.includes('yes') || responseText.includes('agree') || responseText.includes('approve')) {
          booleanResponse = true;
        } else if (responseText.includes('no') || responseText.includes('disagree') || responseText.includes('reject')) {
          booleanResponse = false;
        }

        if (booleanResponse !== null) {
          // Send callback to server
          const BOT_SERVER_PORT = process.env.BOT_SERVER_PORT || 3010;
          try {
            const callbackResponse = await fetch(`http://localhost:${BOT_SERVER_PORT}/callback/${requestId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                response: booleanResponse,
                reasoning: result.text.substring(0, 500) // First 500 chars as reasoning
              })
            });

            if (callbackResponse.ok) {
              console.log(`✅ Callback sent for request ${requestId}: ${booleanResponse ? 'YES' : 'NO'}`);

              // Send confirmation to user on Telegram
              await bot.sendMessage(userId,
                `✅ **Callback processed:**\n` +
                `Decision: **${booleanResponse ? 'YES' : 'NO'}**\n` +
                `Request ID: \`${requestId}\``,
                { parse_mode: 'Markdown' }
              );
            }
          } catch (error) {
            console.error(`❌ Failed to send callback for ${requestId}:`, error);
          }
        }
      }
    }

    console.log(`✅ Delegated from ${sourceBotId} to ${targetBotId} for user ${userId}${requestId ? ` (request: ${requestId})` : ''}`);
  }

  /**
   * Build delegation message with context
   */
  buildDelegationMessage(sourceBotId, task, recentMessages, requestId = null, responseFormat = null) {
    const sourceBot = sourceBotId.toUpperCase();

    let contextSection = '';
    if (recentMessages && recentMessages.length > 0) {
      contextSection = '\n\n**Recent context from ' + sourceBot + ':**\n' +
        recentMessages.map(m => {
          const prefix = m.role === 'user' ? 'User' : sourceBot;
          // Handle both 'text' (from bot messages) and 'content' (from external messages)
          const messageText = m.text || m.content || '';
          const text = messageText.substring(0, 200);
          const truncated = messageText.length > 200 ? '...' : '';
          return `• ${prefix}: ${text}${truncated}`;
        }).join('\n');
    }

    let responseSection = '';
    if (requestId && responseFormat === 'boolean') {
      responseSection = `

**IMPORTANT:** Please provide a clear YES or NO answer in your response.`;
    }

    return `📨 **Context Received from ${sourceBot}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Task:** ${task}
${contextSection}
${responseSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I've added this context to our conversation. What would you like me to do next?`;
  }

  /**
   * Get recent messages from a bot's session
   */
  async getRecentMessages(botId, userId, limit = 5) {
    const sessionId = this.sessionManager.getCurrentUuid(botId, userId);
    if (!sessionId) {
      return [];
    }

    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const sessionPath = path.join(
      os.homedir(),
      '.claude/projects/-opt-lab-claude-bot',
      `${sessionId}.jsonl`
    );

    if (!fs.existsSync(sessionPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(sessionPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.trim());

      const messages = [];

      // Parse all lines and extract only real user/assistant conversation
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          // Skip if not a user or assistant message type
          if (entry.type !== 'user' && entry.type !== 'assistant') {
            continue;
          }

          const role = entry.message?.role || entry.type;
          let text = '';
          const content = entry.message?.content;

          // Extract text
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            const textBlock = content.find(c => c.type === 'text');
            text = textBlock?.text || '';
          }

          // Filter out security wrappers and orchestrator context - ONLY for user messages
          if (role === 'user') {
            // Check for workflow orchestrator context markers
            // These are tasks sent to worker agents with full context
            if (text.includes('=== YOUR SPECIFIC TASK ===')) {
              // Extract just the task portion (after "=== YOUR SPECIFIC TASK ===")
              const taskMatch = text.match(/=== YOUR SPECIFIC TASK ===\s*\n(.+)/s);
              if (taskMatch) {
                text = taskMatch[1].trim();
              }
            } else if (text.includes('=== ORIGINAL USER REQUEST ===') || text.includes('=== CONTEXT FROM PREVIOUS STEPS ===')) {
              // Has orchestrator context but no specific task marker - skip entirely
              continue;
            }

            // Look for delimiter tags that wrap the actual user message
            const delimiterMatch = text.match(/<<<USER_TEXT_START>>>(.+?)<<<USER_TEXT_END>>>/s);
            if (delimiterMatch) {
              // Extract text between delimiters
              text = delimiterMatch[1].trim();
            } else if (text.includes('[ABSOLUTE SECURITY REMINDER')) {
              // Old message with security wrapper but no delimiters
              // Try to extract text after "User: " if present
              const userMatch = text.match(/User:\s*(.+)/s);
              if (userMatch) {
                text = userMatch[1].trim();
              } else {
                // No "User:" found - might be just a security wrapper, skip it
                continue;
              }
            } else if (text.startsWith('User: ')) {
              // Simple case: just "User: " prefix, no security wrapper
              text = text.replace(/^User: /, '');
            }
            // If none of the above, keep text as-is (shouldn't happen, but safe fallback)
          }
          // For assistant messages, filter out:
          // 1. System prompt acknowledgments (start with "You are a")
          // 2. Raw JSON orchestrator output (workflow commands)
          if (role === 'assistant') {
            const trimmedText = text.trim();

            // Skip if it looks like a system prompt (from orchestrator sessions)
            if (trimmedText.startsWith('You are a Workflow Orchestrator') ||
                (trimmedText.startsWith('You are a ') && trimmedText.includes('Your job is'))) {
              continue;
            }

            // Skip raw JSON orchestrator output (plans, delegates, etc.)
            // Keep the human-readable "message" field if present, otherwise skip
            if (trimmedText.startsWith('{')) {
              try {
                const parsed = JSON.parse(trimmedText);
                if (parsed.type && ['plan', 'delegate', 'continue', 'complete', 'discovery', 'clarify'].includes(parsed.type)) {
                  // This is orchestrator JSON - extract human-readable message if available
                  if (parsed.message) {
                    text = parsed.message;
                  } else {
                    // No human-readable message, skip this entry
                    continue;
                  }
                }
              } catch {
                // Not valid JSON, keep as-is
              }
            }
          }

          // Only add if there's actual text
          if (text.trim()) {
            messages.push({ role, text: text.trim() });
          }
        } catch (err) {
          // Skip malformed lines
          continue;
        }
      }

      // Return last N messages
      return messages.slice(-limit);
    } catch (err) {
      console.error(`Failed to read session ${sessionId}:`, err.message);
      return [];
    }
  }

  /**
   * Read all messages from a session by UUID
   * Used by web UI to load session history
   */
  readSessionMessages(sessionUuid, limit = 1000, workspacePath = null) {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    let sessionPath;

    // If workspace provided, use it
    if (workspacePath) {
      const dirName = workspacePath.replace(/\//g, '-');
      sessionPath = path.join(
        os.homedir(),
        `.claude/projects/${dirName}`,
        `${sessionUuid}.jsonl`
      );
    } else {
      // No workspace provided - search for the UUID across all workspace directories
      const projectsDir = path.join(os.homedir(), '.claude/projects');

      if (fs.existsSync(projectsDir)) {
        const workspaceDirs = fs.readdirSync(projectsDir)
          .filter(name => name.startsWith('-'))
          .filter(name => fs.statSync(path.join(projectsDir, name)).isDirectory());

        // Search for the UUID file in each workspace
        for (const dirName of workspaceDirs) {
          const candidatePath = path.join(projectsDir, dirName, `${sessionUuid}.jsonl`);
          if (fs.existsSync(candidatePath)) {
            sessionPath = candidatePath;
            const workspace = '/' + dirName.substring(1).replace(/-/g, '/');
            console.log(`🔍 Found session ${sessionUuid.substring(0, 8)}... in workspace: ${workspace}`);
            break;
          }
        }
      }

      // Fallback if not found
      if (!sessionPath) {
        const dirName = '/opt/lab/claude-bot'.replace(/\//g, '-');
        sessionPath = path.join(
          os.homedir(),
          `.claude/projects/${dirName}`,
          `${sessionUuid}.jsonl`
        );
      }
    }

    if (!fs.existsSync(sessionPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(sessionPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.trim());

      const messages = [];

      // Parse all lines and extract only real user/assistant conversation
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          // Skip if not a user or assistant message type
          if (entry.type !== 'user' && entry.type !== 'assistant') {
            continue;
          }

          const role = entry.message?.role || entry.type;
          let text = '';
          const content = entry.message?.content;

          // Extract text
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            const textBlock = content.find(c => c.type === 'text');
            text = textBlock?.text || '';
          }

          // Filter out security wrappers and orchestrator context - ONLY for user messages
          if (role === 'user') {
            // Check for workflow orchestrator context markers
            // These are tasks sent to worker agents with full context
            if (text.includes('=== YOUR SPECIFIC TASK ===')) {
              // Extract just the task portion (after "=== YOUR SPECIFIC TASK ===")
              const taskMatch = text.match(/=== YOUR SPECIFIC TASK ===\s*\n(.+)/s);
              if (taskMatch) {
                text = taskMatch[1].trim();
              }
            } else if (text.includes('=== ORIGINAL USER REQUEST ===') || text.includes('=== CONTEXT FROM PREVIOUS STEPS ===')) {
              // Has orchestrator context but no specific task marker - skip entirely
              continue;
            }

            // Look for delimiter tags that wrap the actual user message
            const delimiterMatch = text.match(/<<<USER_TEXT_START>>>(.+?)<<<USER_TEXT_END>>>/s);
            if (delimiterMatch) {
              // Extract text between delimiters
              text = delimiterMatch[1].trim();
            } else if (text.includes('[ABSOLUTE SECURITY REMINDER')) {
              // Old message with security wrapper but no delimiters
              // Try to extract text after "User: " if present
              const userMatch = text.match(/User:\s*(.+)/s);
              if (userMatch) {
                text = userMatch[1].trim();
              } else {
                // No "User:" found - might be just a security wrapper, skip it
                continue;
              }
            } else if (text.startsWith('User: ')) {
              // Simple case: just "User: " prefix, no security wrapper
              text = text.replace(/^User: /, '');
            }
            // If none of the above, keep text as-is (shouldn't happen, but safe fallback)
          }
          // For assistant messages, filter out:
          // 1. System prompt acknowledgments (start with "You are a")
          // 2. Raw JSON orchestrator output (workflow commands)
          if (role === 'assistant') {
            const trimmedText = text.trim();

            // Skip if it looks like a system prompt (from orchestrator sessions)
            if (trimmedText.startsWith('You are a Workflow Orchestrator') ||
                (trimmedText.startsWith('You are a ') && trimmedText.includes('Your job is'))) {
              continue;
            }

            // Skip raw JSON orchestrator output (plans, delegates, etc.)
            // Keep the human-readable "message" field if present, otherwise skip
            if (trimmedText.startsWith('{')) {
              try {
                const parsed = JSON.parse(trimmedText);
                if (parsed.type && ['plan', 'delegate', 'continue', 'complete', 'discovery', 'clarify'].includes(parsed.type)) {
                  // This is orchestrator JSON - extract human-readable message if available
                  if (parsed.message) {
                    text = parsed.message;
                  } else {
                    // No human-readable message, skip this entry
                    continue;
                  }
                }
              } catch {
                // Not valid JSON, keep as-is
              }
            }
          }

          // Only add if there's actual text
          if (text.trim()) {
            messages.push({ role, text: text.trim() });
          }
        } catch (err) {
          // Skip malformed lines
          continue;
        }
      }

      // Return last N messages
      return messages.slice(-limit);
    } catch (err) {
      console.error(`Failed to read session ${sessionUuid}:`, err.message);
      return [];
    }
  }
}

module.exports = BotManager;
