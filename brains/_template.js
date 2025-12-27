/**
 * Brain File Template
 *
 * This template shows all available fields for creating a bot personality.
 * Copy this file to create a new brain, then customize the fields below.
 */

module.exports = {
  // Bot identity
  name: "BotName",
  version: "1.0",
  description: "Brief description of bot's purpose",

  /**
   * System Prompt (REQUIRED)
   *
   * This is the core personality definition. It gets injected into every
   * conversation with Claude. Be specific about:
   * - Who the bot is (character, role)
   * - Personality traits
   * - Tone and speaking style
   * - Rules and constraints
   * - Example interactions (optional but helpful)
   *
   * Aim for 200-500 words. Too short = inconsistent personality.
   * Too long = wasted tokens + slower responses.
   */
  systemPrompt: `You are [CHARACTER DESCRIPTION].

PERSONALITY:
- [Trait 1: e.g., "Witty and sarcastic"]
- [Trait 2: e.g., "Helpful but not pushy"]
- [Trait 3: e.g., "Self-aware about being an AI"]

TONE:
- [How the bot speaks: e.g., "Casual and conversational"]
- [Language style: e.g., "Use occasional internet slang"]
- [Length: e.g., "Keep responses brief, 2-3 sentences max"]

RULES:
- [Constraint 1: e.g., "Never break character"]
- [Constraint 2: e.g., "If you don't know something, admit it playfully"]
- [Constraint 3: e.g., "Keep responses under 100 words"]

AVAILABLE TOOLS:
You have access to Claude Code's built-in tools: web search, file operations (read/write/edit), bash commands, and code execution. Use these when appropriate to help the user accomplish their goals.

EXAMPLES (optional):
User: "Example question"
You: "Example response that demonstrates your personality"`,

  /**
   * Context Prefix (OPTIONAL)
   *
   * Function that generates additional context for each conversation.
   * Useful for adding user-specific information to the system prompt.
   *
   * @param {Object} user - Telegram user object
   * @param {number} user.id - Telegram user ID
   * @param {string} user.username - Telegram username (if set)
   * @param {string} user.first_name - User's first name
   * @returns {string} Additional context to inject
   */
  contextPrefix: (user) => {
    return `Chatting with Telegram user ${user.username || user.first_name || user.id}`;
  },

  /**
   * Response Style Hints (OPTIONAL)
   *
   * These don't directly control Claude (CLI doesn't expose these params),
   * but they're useful for documentation and future API integration.
   */
  maxTokens: 200,      // Suggested max response length
  temperature: 0.7,    // Suggested creativity (0.0 = deterministic, 1.0 = creative)

  /**
   * Rate Limits (OPTIONAL - for Phase 1b with database)
   *
   * Define message limits per user tier.
   * Only used if rate limiting is enabled via Supabase.
   */
  rateLimits: {
    free: 10,      // Free users: 10 messages per day
    paid: 1000     // Paid users: 1000 messages per day
  },

  /**
   * Text-to-Speech Configuration (OPTIONAL)
   *
   * Enable voice responses for this bot. When enabled, bot responses
   * will be converted to audio and sent as voice messages on Telegram.
   *
   * Available voices (OpenAI TTS):
   * - alloy: Neutral and balanced
   * - echo: Male voice
   * - fable: Expressive and dramatic
   * - onyx: Deep male voice
   * - nova: Female voice (default)
   * - shimmer: Soft female voice
   */
  tts: {
    enabled: false,           // Set to true to enable voice responses
    voice: "nova",            // Voice to use (see options above)
    speed: 1.0,               // Speaking rate (0.25 to 4.0, default 1.0)
    sendTextToo: false        // Set to true to also send text alongside audio (default: audio only)
  }
};
