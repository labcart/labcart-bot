/**
 * Basic rate limiting without database
 *
 * Tracks message counts in memory per user/bot/day
 */

const logger = require('./logger');

class RateLimiter {
  constructor() {
    // Map: "botId:userId:date" -> count
    this.counts = new Map();

    // Clear old entries daily
    setInterval(() => this.cleanup(), 24 * 60 * 60 * 1000);
  }

  /**
   * Get rate limit key for today
   */
  getKey(botId, userId) {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `${botId}:${userId}:${today}`;
  }

  /**
   * Check if user is within rate limit
   *
   * @param {string} botId - Bot identifier
   * @param {number} userId - Telegram user ID
   * @param {Object} brain - Bot brain config
   * @returns {Object} { allowed: boolean, remaining: number, limit: number }
   */
  checkLimit(botId, userId, brain) {
    const key = this.getKey(botId, userId);
    const count = this.counts.get(key) || 0;

    // Get limit from brain config (default: 50 per day)
    const limit = brain.rateLimits?.free || 50;

    const allowed = count < limit;
    const remaining = Math.max(0, limit - count);

    return {
      allowed,
      remaining,
      limit,
      current: count
    };
  }

  /**
   * Increment message count for user
   *
   * @param {string} botId - Bot identifier
   * @param {number} userId - Telegram user ID
   */
  increment(botId, userId) {
    const key = this.getKey(botId, userId);
    const count = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, count);

    logger.user(botId, userId, 'debug', 'Rate limit incremented', {
      count,
      key
    });
  }

  /**
   * Clean up old entries (from previous days)
   */
  cleanup() {
    const today = new Date().toISOString().split('T')[0];
    let cleaned = 0;

    for (const key of this.counts.keys()) {
      const date = key.split(':')[2]; // Extract date from key
      if (date !== today) {
        this.counts.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Rate limiter cleanup', { entriesRemoved: cleaned });
    }
  }

  /**
   * Get current count for user
   */
  getCount(botId, userId) {
    const key = this.getKey(botId, userId);
    return this.counts.get(key) || 0;
  }

  /**
   * Reset count for user (admin override)
   */
  reset(botId, userId) {
    const key = this.getKey(botId, userId);
    this.counts.delete(key);
    logger.user(botId, userId, 'info', 'Rate limit reset');
  }
}

module.exports = RateLimiter;
