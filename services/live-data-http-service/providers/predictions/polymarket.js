/**
 * Polymarket Prediction Markets Provider
 *
 * Uses Polymarket's public Gamma API to fetch prediction market data.
 * No authentication required for public endpoints.
 *
 * API: https://gamma-api.polymarket.com
 * Rate Limit: ~1000 requests/hour (free tier)
 */

import fetch from 'node-fetch';

const BASE_URL = 'https://gamma-api.polymarket.com';

// Category mappings for filtering
const CATEGORY_MAPPINGS = {
  'politics': 'Politics',
  'crypto': 'Crypto',
  'sports': 'Sports',
  'pop-culture': 'Pop Culture',
  'business': 'Business',
  'science': 'Science',
  'all': null,
};

export class PolymarketProvider {
  constructor(config = {}) {
    this.name = 'polymarket';
    this.config = config;
  }

  /**
   * Get active prediction markets
   *
   * @param {Object} options
   * @param {string} options.category - Filter by category (politics, crypto, sports, etc.)
   * @param {string} options.query - Search term
   * @param {number} options.limit - Max results (default: 10)
   * @param {string} options.sort - Sort order: 'volume', 'newest', 'ending_soon'
   * @returns {Promise<Object>} Markets data
   */
  async getMarkets({ category = 'all', query = null, limit = 10, sort = 'volume' } = {}) {
    const url = new URL(`${BASE_URL}/events`);

    // API params
    url.searchParams.set('limit', Math.min(limit, 50));
    url.searchParams.set('active', 'true');
    url.searchParams.set('closed', 'false');

    // Sort mapping
    const sortMap = {
      'volume': '-volume',
      'newest': '-startDate',
      'ending_soon': 'endDate',
    };
    if (sortMap[sort]) {
      url.searchParams.set('order', sortMap[sort]);
    }

    console.log(`🔮 [Polymarket] Fetching: ${url.toString()}`);

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LiveDataService/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`);
    }

    const events = await response.json();

    // Parse and filter results
    let markets = this.parseEvents(events);

    // Filter by category if specified
    if (category && category !== 'all') {
      const categoryName = CATEGORY_MAPPINGS[category.toLowerCase()] || category;
      markets = markets.filter(m =>
        m.category?.toLowerCase().includes(categoryName.toLowerCase())
      );
    }

    // Filter by query if specified
    if (query) {
      const queryLower = query.toLowerCase();
      markets = markets.filter(m =>
        m.title?.toLowerCase().includes(queryLower) ||
        m.question?.toLowerCase().includes(queryLower)
      );
    }

    return {
      source: 'polymarket',
      category: category,
      markets_count: markets.length,
      markets: markets.slice(0, limit),
    };
  }

  /**
   * Get a specific market by slug or ID
   *
   * @param {string} identifier - Market slug or condition ID
   * @returns {Promise<Object>} Market details
   */
  async getMarket(identifier) {
    // Try by slug first
    const url = new URL(`${BASE_URL}/events`);
    url.searchParams.set('slug', identifier);

    console.log(`🔮 [Polymarket] Fetching market: ${url.toString()}`);

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LiveDataService/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`);
    }

    const events = await response.json();

    if (!events || events.length === 0) {
      throw new Error(`Market not found: ${identifier}`);
    }

    const markets = this.parseEvents(events);
    return markets[0];
  }

  /**
   * Parse Polymarket events into clean format
   */
  parseEvents(events) {
    if (!Array.isArray(events)) {
      events = [events];
    }

    return events.map(event => {
      // Get markets (outcomes) for this event
      const markets = event.markets || [];

      // Parse outcome prices
      const outcomes = markets.map(market => {
        // outcomePrices is a JSON string like "[\"0.85\",\"0.15\"]"
        let prices = [];
        try {
          prices = JSON.parse(market.outcomePrices || '[]');
        } catch (e) {
          prices = [];
        }

        // outcomes is also a JSON string like "[\"Yes\",\"No\"]"
        let outcomeNames = [];
        try {
          outcomeNames = JSON.parse(market.outcomes || '[]');
        } catch (e) {
          outcomeNames = ['Yes', 'No'];
        }

        return {
          question: market.question,
          outcomes: outcomeNames.map((name, i) => ({
            name,
            price: prices[i] ? parseFloat(prices[i]) : null,
            probability: prices[i] ? `${(parseFloat(prices[i]) * 100).toFixed(1)}%` : null,
          })),
          volume: market.volume ? parseFloat(market.volume) : 0,
          liquidity: market.liquidityNum ? parseFloat(market.liquidityNum) : 0,
        };
      });

      // Calculate total volume across all markets
      const totalVolume = outcomes.reduce((sum, o) => sum + (o.volume || 0), 0);

      return {
        id: event.id,
        slug: event.slug,
        title: event.title,
        description: event.description,
        category: event.category,
        start_date: event.startDate,
        end_date: event.endDate,
        volume: event.volume ? parseFloat(event.volume) : totalVolume,
        volume_formatted: this.formatVolume(event.volume || totalVolume),
        liquidity: event.liquidity ? parseFloat(event.liquidity) : null,
        outcomes: outcomes.length === 1 ? outcomes[0].outcomes : outcomes,
        markets_count: markets.length,
        url: `https://polymarket.com/event/${event.slug}`,
      };
    }).filter(Boolean);
  }

  /**
   * Format volume for display
   */
  formatVolume(volume) {
    if (!volume) return '$0';
    const num = parseFloat(volume);
    if (num >= 1000000) {
      return `$${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `$${(num / 1000).toFixed(1)}K`;
    }
    return `$${num.toFixed(0)}`;
  }

  /**
   * Get trending/hot markets
   */
  async getTrending(limit = 5) {
    return this.getMarkets({ sort: 'volume', limit });
  }

  /**
   * Get markets ending soon
   */
  async getEndingSoon(limit = 5) {
    return this.getMarkets({ sort: 'ending_soon', limit });
  }
}

export default PolymarketProvider;
