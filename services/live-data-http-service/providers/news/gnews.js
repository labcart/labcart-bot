/**
 * GNews API Provider (Fallback)
 *
 * Supports dynamic API keys passed per-request, with ENV fallback.
 * Official API with free tier (100 req/day).
 *
 * Docs: https://gnews.io/docs
 */

import fetch from 'node-fetch';

const BASE_URL = 'https://gnews.io/api/v4';

const VALID_CATEGORIES = ['general', 'world', 'nation', 'business', 'technology', 'entertainment', 'sports', 'science', 'health'];

// Map NewsAPI categories to GNews categories
const CATEGORY_MAP = {
  'general': 'general',
  'business': 'business',
  'technology': 'technology',
  'sports': 'sports',
  'entertainment': 'entertainment',
  'health': 'health',
  'science': 'science',
};

export class GNewsProvider {
  constructor(config = {}) {
    this.name = 'gnews';
    this.apiKey = config.apiKey || process.env.GNEWS_API_KEY;
    this.config = config;
  }

  /**
   * Check if provider is configured (has default API key)
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Get the API key to use (request key or instance key)
   * @param {string} [apiKey] - Optional API key from request
   * @returns {string} The API key to use
   */
  getApiKey(apiKey) {
    const key = apiKey || this.apiKey;
    if (!key) {
      throw new Error('No API key provided. Pass api_keys.gnews in request or set GNEWS_API_KEY environment variable.');
    }
    return key;
  }

  /**
   * Get top headlines
   * @param {Object} [options] - Query options
   * @param {string} [apiKey] - Optional API key (falls back to ENV)
   */
  async getHeadlines(options = {}, apiKey) {
    const key = this.getApiKey(apiKey);

    const {
      category = 'general',
      country = 'us',
      query = null,
      limit = 5,
    } = options;

    // Map category
    const gnewsCategory = CATEGORY_MAP[category?.toLowerCase()] || 'general';

    const url = new URL(`${BASE_URL}/top-headlines`);

    url.searchParams.set('token', key);
    url.searchParams.set('lang', 'en');
    url.searchParams.set('country', country);
    url.searchParams.set('max', Math.min(limit, 10).toString()); // GNews free tier max is 10

    if (query) {
      url.searchParams.set('q', query);
    } else if (VALID_CATEGORIES.includes(gnewsCategory)) {
      url.searchParams.set('category', gnewsCategory);
    }

    console.log(`📰 [GNews] Fetching headlines: category=${gnewsCategory}, country=${country}`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.errors?.[0] || `GNews error: ${response.status}`);
    }

    const data = await response.json();

    return this.parseArticles(data, category);
  }

  /**
   * Search news
   * @param {string} query - Search query
   * @param {Object} [options] - Query options
   * @param {string} [apiKey] - Optional API key (falls back to ENV)
   */
  async searchNews(query, options = {}, apiKey) {
    const key = this.getApiKey(apiKey);

    const { limit = 5 } = options;

    const url = new URL(`${BASE_URL}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('token', key);
    url.searchParams.set('lang', 'en');
    url.searchParams.set('max', Math.min(limit, 10).toString());

    console.log(`🔍 [GNews] Searching: "${query}"`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.errors?.[0] || `GNews error: ${response.status}`);
    }

    const data = await response.json();

    return this.parseArticles(data, 'search');
  }

  /**
   * Parse GNews response
   */
  parseArticles(data, category) {
    const articles = data.articles || [];

    return {
      category: category,
      total_results: data.totalArticles || articles.length,
      articles_count: articles.length,
      articles: articles.map(article => ({
        title: article.title,
        description: article.description,
        source: article.source?.name,
        url: article.url,
        image_url: article.image,
        published_at: article.publishedAt,
      })),
    };
  }
}

export default GNewsProvider;
