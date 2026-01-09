/**
 * NewsAPI Provider
 *
 * Official API for news headlines.
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
   * Check if provider is configured
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Get top headlines
   */
  async getHeadlines(options = {}) {
    if (!this.apiKey) {
      throw new Error('NewsAPI API key not configured');
    }

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
    url.searchParams.set('apiKey', this.apiKey);

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
   */
  async searchNews(query, options = {}) {
    if (!this.apiKey) {
      throw new Error('NewsAPI API key not configured');
    }

    const { limit = 5, sortBy = 'publishedAt' } = options;

    const url = new URL(`${BASE_URL}/everything`);
    url.searchParams.set('q', query);
    url.searchParams.set('sortBy', sortBy);
    url.searchParams.set('pageSize', Math.min(limit, 20).toString());
    url.searchParams.set('apiKey', this.apiKey);

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
