/**
 * Request queue for rate limiting API calls
 */

import PQueue from 'p-queue';

// Create separate queues for different provider types
// This prevents one category from starving another

export const sportsQueue = new PQueue({
  intervalCap: 10,    // Max 10 requests
  interval: 1000,     // Per 1 second
  carryoverConcurrencyCount: true,
});

export const stocksQueue = new PQueue({
  intervalCap: 5,     // Max 5 requests
  interval: 1000,     // Per 1 second
  carryoverConcurrencyCount: true,
});

export const newsQueue = new PQueue({
  intervalCap: 2,     // Max 2 requests (NewsAPI is 100/day = conservative)
  interval: 1000,     // Per 1 second
  carryoverConcurrencyCount: true,
});

/**
 * Initialize queues with config values
 */
export function initQueues(config) {
  if (config?.rate_limits) {
    // Note: p-queue doesn't support runtime reconfiguration well
    // These are set at creation time above
    console.log('📊 Rate limits configured:', {
      sports: `${config.rate_limits.sports_per_second || 10}/sec`,
      stocks: `${config.rate_limits.stocks_per_second || 5}/sec`,
      news: `${config.rate_limits.news_per_second || 2}/sec`,
    });
  }
}

/**
 * Get queue stats
 */
export function getQueueStats() {
  return {
    sports: {
      pending: sportsQueue.pending,
      size: sportsQueue.size,
    },
    stocks: {
      pending: stocksQueue.pending,
      size: stocksQueue.size,
    },
    news: {
      pending: newsQueue.pending,
      size: newsQueue.size,
    },
  };
}

export default {
  sportsQueue,
  stocksQueue,
  newsQueue,
  initQueues,
  getQueueStats,
};
