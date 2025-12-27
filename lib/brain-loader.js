const securityProfiles = require('./security-profiles');
const supabase = require('./supabase-client');

/**
 * BrainLoader
 *
 * Loads agent configurations from Supabase (marketplace_agents table).
 * Supabase is the single source of truth for all agent definitions.
 * Local brain files in /brains are for development reference only.
 */
class BrainLoader {
  constructor() {
    this.cache = new Map(); // Brain slug → brain config
  }

  /**
   * Load an agent brain by slug or UUID from Supabase
   *
   * @param {string} slugOrId - Agent slug or UUID
   * @returns {Promise<Object>} Brain configuration object
   * @throws {Error} If agent not found or missing systemPrompt
   */
  async load(slugOrId) {
    // Return cached brain if already loaded
    if (this.cache.has(slugOrId)) {
      return this.cache.get(slugOrId);
    }

    // Load from Supabase - the single source of truth
    const brain = await this.loadFromSupabase(slugOrId);

    if (!brain) {
      throw new Error(`Agent '${slugOrId}' not found in database. Add it to marketplace_agents table.`);
    }

    if (!brain.systemPrompt) {
      throw new Error(`Agent '${slugOrId}' has no systemPrompt in brain_config. Update the agent in Supabase.`);
    }

    this.cache.set(slugOrId, brain);
    console.log(`✅ Loaded agent from Supabase: ${brain.name}`);
    return brain;
  }

  /**
   * Load brain from Supabase database (marketplace_agents table)
   *
   * @param {string} slugOrId - Agent slug or UUID
   * @returns {Promise<Object|null>} Brain configuration or null if not found
   */
  async loadFromSupabase(slugOrId) {
    if (!supabase) {
      throw new Error('Supabase client not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    }

    // Try both slug and id
    let query = supabase
      .from('marketplace_agents')
      .select('*');

    // Check if it's a UUID
    if (slugOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      query = query.eq('id', slugOrId);
    } else {
      query = query.eq('slug', slugOrId);
    }

    const { data, error } = await query.single();

    if (error || !data) {
      return null;
    }

    // Marketplace agents store full brain config in brain_config JSONB
    const brainConfig = data.brain_config || {};

    const brain = {
      ...brainConfig,
      name: data.name,
      description: data.short_description,
      slug: data.slug,
      id: data.id,
      tags: data.tags,
      iconEmoji: data.icon_emoji,
      capability_profile: data.capability_profile
    };

    return brain;
  }

  /**
   * Build full system prompt for Claude
   *
   * Combines brain's systemPrompt with optional contextPrefix.
   * Wraps everything in security layer (if enabled) to prevent leaks.
   *
   * @param {string} brainName - Name of brain to use
   * @param {Object} user - Telegram user object
   * @param {number} user.id - Telegram user ID
   * @param {string} [user.username] - Telegram username
   * @param {string} [user.first_name] - User's first name
   * @returns {Promise<string>} Complete system prompt to inject into conversation
   */
  async buildSystemPrompt(brainName, user) {
    const brain = await this.load(brainName);

    let prompt = '';

    // SECURITY WRAPPER - Load from profile or disable
    // Brain can specify: security: "default" | "strict" | "minimal" | false
    const securitySetting = brain.security !== undefined ? brain.security : 'default';

    if (securitySetting !== false) {
      // Load security profile
      const profile = securityProfiles[securitySetting];

      if (!profile) {
        console.error(`⚠️  Unknown security profile "${securitySetting}" for brain ${brainName}, using default`);
        const defaultProfile = securityProfiles.default;
        prompt += defaultProfile.wrapper;
      } else {
        prompt += profile.wrapper;
      }
    }

    // Add context prefix if brain defines one
    if (brain.contextPrefix && typeof brain.contextPrefix === 'function') {
      try {
        const context = brain.contextPrefix(user);
        if (context) {
          prompt += `${context}\n\n`;
        }
      } catch (err) {
        console.error(`⚠️  Error generating context prefix for brain ${brainName}:`, err.message);
        // Continue without context prefix
      }
    }

    // Add brain's system prompt
    prompt += brain.systemPrompt;

    return prompt;
  }

  /**
   * Get security reminder text for a brain
   *
   * Returns the security reminder to inject with each message.
   * Returns null if security is disabled or profile has no reminder.
   *
   * @param {string} brainName - Name of brain to use
   * @returns {Promise<string|null>} Security reminder text or null
   */
  async getSecurityReminder(brainName) {
    const brain = await this.load(brainName);

    // Check if security is disabled
    const securitySetting = brain.security !== undefined ? brain.security : 'default';
    if (securitySetting === false) {
      return null; // No security, no reminder
    }

    // Load security profile
    const profile = securityProfiles[securitySetting] || securityProfiles.default;

    if (!profile.reminder) {
      return null; // Profile has no reminder
    }

    // Generate reminder (pass bot name if it's a function)
    const botName = brain.name || 'the character defined in your system prompt';
    return typeof profile.reminder === 'function'
      ? profile.reminder(botName)
      : profile.reminder;
  }

  /**
   * Get list of available agents from Supabase
   *
   * @returns {Promise<Array<Object>>} Array of agent objects with slug and name
   */
  async listAgents() {
    if (!supabase) {
      return [];
    }

    const { data, error } = await supabase
      .from('marketplace_agents')
      .select('slug, name, icon_emoji')
      .order('name');

    if (error) {
      console.error('Failed to list agents:', error.message);
      return [];
    }

    return data || [];
  }

  /**
   * Clear cached agent (forces reload from Supabase on next load)
   *
   * @param {string} slugOrId - Agent slug or UUID to clear from cache
   */
  clearCache(slugOrId) {
    this.cache.delete(slugOrId);
    console.log(`🔄 Cleared cache for agent: ${slugOrId}`);
  }
}

module.exports = BrainLoader;
