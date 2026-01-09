/**
 * Simple in-memory cache with TTL support
 */

const cache = new Map();

// TTL values in milliseconds (loaded from config)
let TTL = {
  LIVE_GAME: 60 * 1000,
  FINAL_SCORE: 60 * 60 * 1000,
  STOCK_QUOTE: 30 * 1000,
  NEWS: 5 * 60 * 1000,
};

/**
 * Initialize cache TTLs from config
 */
export function initCache(config) {
  if (config?.cache) {
    TTL.LIVE_GAME = (config.cache.live_game_ttl_seconds || 60) * 1000;
    TTL.FINAL_SCORE = (config.cache.final_score_ttl_seconds || 3600) * 1000;
    TTL.STOCK_QUOTE = (config.cache.stock_quote_ttl_seconds || 30) * 1000;
    TTL.NEWS = (config.cache.news_ttl_seconds || 300) * 1000;
  }
  console.log('📦 Cache initialized with TTLs:', {
    LIVE_GAME: `${TTL.LIVE_GAME / 1000}s`,
    FINAL_SCORE: `${TTL.FINAL_SCORE / 1000}s`,
    STOCK_QUOTE: `${TTL.STOCK_QUOTE / 1000}s`,
    NEWS: `${TTL.NEWS / 1000}s`,
  });
}

/**
 * Get TTL in seconds for a given type
 */
export function getTTLSeconds(ttlType) {
  return (TTL[ttlType] || TTL.NEWS) / 1000;
}

/**
 * Get cached value if not expired
 */
export function getCached(key, ttlType) {
  const entry = cache.get(key);
  if (!entry) return null;

  const ttl = TTL[ttlType] || TTL.NEWS;
  if (Date.now() - entry.timestamp > ttl) {
    cache.delete(key);
    return null;
  }

  return {
    data: entry.data,
    cached: true,
    fetched_at: new Date(entry.timestamp).toISOString(),
    cache_ttl_seconds: ttl / 1000,
  };
}

/**
 * Set cache value
 */
export function setCache(key, data) {
  cache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

/**
 * Clear entire cache
 */
export function clearCache() {
  cache.clear();
}

/**
 * Get cache stats
 */
export function getCacheStats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}

export default {
  initCache,
  getCached,
  setCache,
  clearCache,
  getCacheStats,
  getTTLSeconds,
};
