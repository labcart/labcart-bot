/**
 * NewsAPI Provider
 *
 * Supports dynamic API keys passed per-request, with ENV fallback.
 * Free tier: 100 requests/day for development.
 *
 * Docs: https://newsapi.org/docs
 */

import fetch from 'node-fetch';

const BASE_URL = 'https://newsapi.org/v2';

const VALID_CATEGORIES = ['general', 'business', 'technology', 'sports', 'entertainment', 'health', 'science'];

export class NewsAPIProvider {
  constructor(config = {}) {
    this.name = 'newsapi';
    this.apiKey = config.apiKey || process.env.NEWSAPI_API_KEY;
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
      throw new Error('No API key provided. Pass api_keys.newsapi in request or set NEWSAPI_API_KEY environment variable.');
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

    // Validate category
    if (category && !VALID_CATEGORIES.includes(category.toLowerCase())) {
      console.warn(`[NewsAPI] Invalid category: ${category}, using 'general'`);
    }

    const url = new URL(`${BASE_URL}/top-headlines`);

    // Add parameters
    if (query) {
      url.searchParams.set('q', query);
    } else {
      // Country and category only work without 'q' for some endpoints
      url.searchParams.set('country', country);
      if (VALID_CATEGORIES.includes(category?.toLowerCase())) {
        url.searchParams.set('category', category.toLowerCase());
      }
    }

    url.searchParams.set('pageSize', Math.min(limit, 20).toString());
    url.searchParams.set('apiKey', key);

    console.log(`📰 [NewsAPI] Fetching headlines: category=${category}, country=${country}, query=${query || 'none'}`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `NewsAPI error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'error') {
      throw new Error(data.message || 'NewsAPI error');
    }

    return this.parseArticles(data, category);
  }

  /**
   * Search everything (more comprehensive)
   * @param {string} query - Search query
   * @param {Object} [options] - Query options
   * @param {string} [apiKey] - Optional API key (falls back to ENV)
   */
  async searchNews(query, options = {}, apiKey) {
    const key = this.getApiKey(apiKey);

    const { limit = 5, sortBy = 'publishedAt' } = options;

    const url = new URL(`${BASE_URL}/everything`);
    url.searchParams.set('q', query);
    url.searchParams.set('sortBy', sortBy);
    url.searchParams.set('pageSize', Math.min(limit, 20).toString());
    url.searchParams.set('apiKey', key);

    console.log(`🔍 [NewsAPI] Searching: "${query}"`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `NewsAPI error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'error') {
      throw new Error(data.message || 'NewsAPI error');
    }

    return this.parseArticles(data, 'search');
  }

  /**
   * Parse NewsAPI response
   */
  parseArticles(data, category) {
    const articles = data.articles || [];

    return {
      category: category,
      total_results: data.totalResults || articles.length,
      articles_count: articles.length,
      articles: articles.map(article => ({
        title: article.title,
        description: article.description,
        source: article.source?.name,
        author: article.author,
        url: article.url,
        image_url: article.urlToImage,
        published_at: article.publishedAt,
      })),
    };
  }
}

export default NewsAPIProvider;
