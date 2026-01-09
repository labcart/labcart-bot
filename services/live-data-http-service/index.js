#!/usr/bin/env node

/**
 * Live Data HTTP Service (Standalone)
 *
 * Self-contained HTTP server that provides live data functionality:
 * - Sports scores (ESPN, TheSportsDB)
 * - Stock quotes (Yahoo Finance, Finnhub)
 * - News headlines (NewsAPI, GNews)
 *
 * Runs once globally and serves all MCP Router instances.
 * Can also be called directly via HTTP for panels/custom code.
 *
 * Port: 3004 (default)
 */

import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Import providers
import { ESPNProvider } from './providers/sports/espn.js';
import { TheSportsDBProvider } from './providers/sports/thesportsdb.js';
import { YahooFinanceProvider } from './providers/stocks/yahoo-finance.js';
import { FinnhubProvider } from './providers/stocks/finnhub.js';
import { NewsAPIProvider } from './providers/news/newsapi.js';
import { GNewsProvider } from './providers/news/gnews.js';
import { PolymarketProvider } from './providers/predictions/polymarket.js';
import { TapjotProvider } from './providers/tapjot/tapjot.js';

// Import utilities
import { initCache, getCached, setCache, getTTLSeconds } from './utils/cache.js';
import { parseDate, getCurrentDate } from './utils/date-parser.js';
import { sportsQueue, stocksQueue, newsQueue, initQueues } from './utils/request-queue.js';
import { logUsage } from './utils/usage-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Load configuration
let config;
try {
  const configPath = path.join(__dirname, 'config.json');
  const configData = await fs.readFile(configPath, 'utf-8');
  config = JSON.parse(configData);
} catch (error) {
  console.error('❌ Failed to load config.json:', error.message);
  process.exit(1);
}

// Initialize utilities
initCache(config);
initQueues(config);

// Initialize providers
const providers = {
  sports: {
    espn: new ESPNProvider(config.espn),
    thesportsdb: new TheSportsDBProvider(config.thesportsdb),
  },
  stocks: {
    yahoo: new YahooFinanceProvider(config.yahoo),
    finnhub: new FinnhubProvider(config.finnhub),
  },
  news: {
    newsapi: new NewsAPIProvider(config.newsapi),
    gnews: new GNewsProvider(config.gnews),
  },
  predictions: {
    polymarket: new PolymarketProvider(config.polymarket),
  },
  tapjot: {
    client: new TapjotProvider({ apiKey: process.env.TAPJOT_API_KEY }),
  },
};

console.log('📡 Live Data HTTP Service starting...');
console.log(`   Sports: ESPN (primary), TheSportsDB (fallback)`);
console.log(`   Stocks: Yahoo Finance (primary), Finnhub (fallback)`);
console.log(`   News: NewsAPI (${providers.news.newsapi.isConfigured() ? 'configured' : 'NOT configured'}), GNews (${providers.news.gnews.isConfigured() ? 'configured' : 'NOT configured'})`);
console.log(`   Predictions: Polymarket (no auth required)`);
console.log(`   Tapjot: ${providers.tapjot.client.isConfigured() ? 'configured' : 'NOT configured'}`);

// Create Express app
const app = express();
app.use(express.json({ limit: '1mb' }));

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'live-data-http-service',
    providers: {
      sports: ['espn', 'thesportsdb'],
      stocks: ['yahoo', 'finnhub'],
      news: [
        providers.news.newsapi.isConfigured() ? 'newsapi' : null,
        providers.news.gnews.isConfigured() ? 'gnews' : null,
      ].filter(Boolean),
    },
  });
});

// ============================================================================
// SCHEMA ENDPOINT (for MCP Router)
// ============================================================================

app.get('/schema', (req, res) => {
  const sportEnum = ['nba', 'nfl', 'mlb', 'nhl', 'ncaaf', 'ncaab', 'wnba', 'mls', 'soccer', 'epl', 'laliga', 'bundesliga', 'seriea', 'ligue1'];

  res.json([
    {
      name: 'get_live_scores',
      description: 'Get live/recent sports scores with betting odds. Supports NBA, NFL, MLB, NHL, college football, college basketball, soccer.',
      inputSchema: {
        type: 'object',
        properties: {
          sport: { type: 'string', enum: sportEnum, description: 'Sport/league to get scores for' },
          team: { type: 'string', description: 'Filter by team name (optional)' },
          date: { type: 'string', description: 'Date (optional) - "today", "yesterday", "2024-12-30", "last sunday"' },
          league: { type: 'string', description: 'For soccer, league code (optional) - "eng.1", "usa.1", "esp.1"' },
        },
        required: ['sport'],
      },
    },
    {
      name: 'get_injuries',
      description: 'Get injury reports for a sport or specific team.',
      inputSchema: {
        type: 'object',
        properties: {
          sport: { type: 'string', enum: sportEnum, description: 'Sport/league' },
          team: { type: 'string', description: 'Filter by team name (optional)' },
        },
        required: ['sport'],
      },
    },
    {
      name: 'get_standings',
      description: 'Get league standings with W-L records, streak, games back.',
      inputSchema: {
        type: 'object',
        properties: {
          sport: { type: 'string', enum: sportEnum, description: 'Sport/league' },
          conference: { type: 'string', description: 'Filter by conference (optional) - "east", "west", "afc", "nfc"' },
        },
        required: ['sport'],
      },
    },
    {
      name: 'get_sports_news',
      description: 'Get ESPN sports news/headlines for a league.',
      inputSchema: {
        type: 'object',
        properties: {
          sport: { type: 'string', enum: sportEnum, description: 'Sport/league' },
          team: { type: 'string', description: 'Filter by team (optional)' },
          limit: { type: 'number', description: 'Number of articles (default: 5)' },
        },
        required: ['sport'],
      },
    },
    {
      name: 'get_stock_quote',
      description: 'Get real-time stock or cryptocurrency price. Supports stocks (AAPL), ETFs (SPY), crypto (BTC-USD).',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Ticker symbol - "AAPL", "GOOGL", "BTC-USD"' },
          include_history: { type: 'boolean', description: 'Include 5-day price history (default: false)' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'get_news_headlines',
      description: 'Get breaking news headlines by category or search query.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['general', 'business', 'technology', 'sports', 'entertainment', 'health', 'science'], description: 'News category' },
          query: { type: 'string', description: 'Search term (optional)' },
          country: { type: 'string', description: '2-letter country code (default: us)' },
          limit: { type: 'number', description: 'Number of headlines (default: 5, max: 20)' },
        },
      },
    },
    {
      name: 'get_prediction_markets',
      description: 'Get prediction market odds from Polymarket. Shows current probabilities for events like elections, crypto, sports outcomes.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['all', 'politics', 'crypto', 'sports', 'pop-culture', 'business', 'science'], description: 'Market category (default: all)' },
          query: { type: 'string', description: 'Search term to filter markets (optional)' },
          limit: { type: 'number', description: 'Number of markets to return (default: 5, max: 20)' },
          sort: { type: 'string', enum: ['volume', 'newest', 'ending_soon'], description: 'Sort order (default: volume)' },
        },
      },
    },
    // Tapjot - Snippets
    {
      name: 'tapjot_list_snippets',
      description: 'List snippets (notes) from Tapjot. Filter by project, view, or tag.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Filter by project ID' },
          view_id: { type: 'string', description: 'Filter by view ID' },
          tag: { type: 'string', description: 'Filter by tag' },
          limit: { type: 'number', description: 'Max results (default: 50)' },
        },
      },
    },
    {
      name: 'tapjot_create_snippet',
      description: 'Create a new snippet (note) in Tapjot.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The note content (required)' },
          project_id: { type: 'string', description: 'Project ID to add to (required)' },
          title: { type: 'string', description: 'Optional title' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags array' },
          view_id: { type: 'string', description: 'Optional view ID' },
        },
        required: ['content', 'project_id'],
      },
    },
    {
      name: 'tapjot_update_snippet',
      description: 'Update an existing snippet in Tapjot.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Snippet ID (required)' },
          content: { type: 'string', description: 'New content' },
          title: { type: 'string', description: 'New title' },
          tags: { type: 'array', items: { type: 'string' }, description: 'New tags' },
        },
        required: ['id'],
      },
    },
    {
      name: 'tapjot_delete_snippet',
      description: 'Delete a snippet from Tapjot.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Snippet ID to delete (required)' },
        },
        required: ['id'],
      },
    },
    // Tapjot - Projects
    {
      name: 'tapjot_list_projects',
      description: 'List all projects in Tapjot.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'tapjot_create_project',
      description: 'Create a new project in Tapjot.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project name (required)' },
          description: { type: 'string', description: 'Optional description' },
          visibility: { type: 'string', enum: ['private', 'public'], description: 'Visibility (default: private)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'tapjot_update_project',
      description: 'Update a project in Tapjot.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Project ID (required)' },
          name: { type: 'string', description: 'New name' },
          description: { type: 'string', description: 'New description' },
        },
        required: ['id'],
      },
    },
    {
      name: 'tapjot_delete_project',
      description: 'Delete a project from Tapjot.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Project ID to delete (required)' },
        },
        required: ['id'],
      },
    },
    // Tapjot - Views
    {
      name: 'tapjot_list_views',
      description: 'List views (tabs) within a Tapjot project.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Filter by project ID' },
        },
      },
    },
    {
      name: 'tapjot_create_view',
      description: 'Create a new view (tab) in a Tapjot project.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'View name (required)' },
          project_id: { type: 'string', description: 'Project ID (required)' },
        },
        required: ['name', 'project_id'],
      },
    },
    {
      name: 'tapjot_delete_view',
      description: 'Delete a view from Tapjot.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'View ID to delete (required)' },
        },
        required: ['id'],
      },
    },
  ]);
});

// ============================================================================
// GET_LIVE_SCORES
// ============================================================================

app.post('/get_live_scores', async (req, res) => {
  const startTime = Date.now();

  try {
    const { sport, team, date: rawDate, league } = req.body;

    if (!sport) {
      return res.status(400).json({ error: 'sport parameter is required' });
    }

    // Parse date
    const dateStr = parseDate(rawDate || 'today');

    // Build cache key
    const cacheKey = `scores:${sport}:${league || ''}:${dateStr}:${team || ''}`;

    // Check cache first
    const cached = getCached(cacheKey, 'LIVE_GAME');
    if (cached) {
      const durationMs = Date.now() - startTime;
      await logUsage({
        tool: 'get_live_scores',
        provider: 'cache',
        sport,
        team,
        date: dateStr,
        durationMs,
        cached: true,
        success: true,
      });

      return res.json({
        success: true,
        data: cached.data,
        meta: {
          source: 'cache',
          cached: true,
          fetched_at: cached.fetched_at,
          cache_ttl_seconds: cached.cache_ttl_seconds,
        },
      });
    }

    // Fetch from provider (with fallback)
    let result;
    let source = 'espn';

    try {
      result = await sportsQueue.add(async () => {
        return await providers.sports.espn.getScores(sport, dateStr, team, league);
      });
    } catch (espnError) {
      console.warn(`⚠️  ESPN failed: ${espnError.message}, trying TheSportsDB...`);
      source = 'thesportsdb';

      result = await sportsQueue.add(async () => {
        return await providers.sports.thesportsdb.getScores(sport, dateStr, team);
      });
    }

    // Cache the result
    setCache(cacheKey, result);

    const durationMs = Date.now() - startTime;

    await logUsage({
      tool: 'get_live_scores',
      provider: source,
      sport,
      team,
      date: dateStr,
      durationMs,
      cached: false,
      success: true,
    });

    res.json({
      success: true,
      data: result,
      meta: {
        source,
        cached: false,
        fetched_at: new Date().toISOString(),
        cache_ttl_seconds: getTTLSeconds('LIVE_GAME'),
      },
    });

  } catch (error) {
    console.error('❌ [get_live_scores] Error:', error.message);

    await logUsage({
      tool: 'get_live_scores',
      provider: 'error',
      error: error.message,
      durationMs: Date.now() - startTime,
      cached: false,
      success: false,
    });

    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET_STOCK_QUOTE
// ============================================================================

app.post('/get_stock_quote', async (req, res) => {
  const startTime = Date.now();

  try {
    const { symbol, include_history = false } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: 'symbol parameter is required' });
    }

    const upperSymbol = symbol.toUpperCase();

    // Build cache key
    const cacheKey = `stock:${upperSymbol}:${include_history}`;

    // Check cache first
    const cached = getCached(cacheKey, 'STOCK_QUOTE');
    if (cached) {
      const durationMs = Date.now() - startTime;
      await logUsage({
        tool: 'get_stock_quote',
        provider: 'cache',
        symbol: upperSymbol,
        durationMs,
        cached: true,
        success: true,
      });

      return res.json({
        success: true,
        data: cached.data,
        meta: {
          source: 'cache',
          cached: true,
          fetched_at: cached.fetched_at,
          cache_ttl_seconds: cached.cache_ttl_seconds,
        },
      });
    }

    // Fetch from provider (with fallback)
    let result;
    let source = 'yahoo';

    try {
      result = await stocksQueue.add(async () => {
        return await providers.stocks.yahoo.getQuote(upperSymbol, include_history);
      });
    } catch (yahooError) {
      console.warn(`⚠️  Yahoo Finance failed: ${yahooError.message}, trying Finnhub...`);

      if (!providers.stocks.finnhub.isConfigured()) {
        throw new Error(`Yahoo Finance failed and Finnhub not configured: ${yahooError.message}`);
      }

      source = 'finnhub';
      result = await stocksQueue.add(async () => {
        return await providers.stocks.finnhub.getQuote(upperSymbol, include_history);
      });
    }

    // Cache the result
    setCache(cacheKey, result);

    const durationMs = Date.now() - startTime;

    await logUsage({
      tool: 'get_stock_quote',
      provider: source,
      symbol: upperSymbol,
      durationMs,
      cached: false,
      success: true,
    });

    res.json({
      success: true,
      data: result,
      meta: {
        source,
        cached: false,
        fetched_at: new Date().toISOString(),
        cache_ttl_seconds: getTTLSeconds('STOCK_QUOTE'),
      },
    });

  } catch (error) {
    console.error('❌ [get_stock_quote] Error:', error.message);

    await logUsage({
      tool: 'get_stock_quote',
      provider: 'error',
      error: error.message,
      durationMs: Date.now() - startTime,
      cached: false,
      success: false,
    });

    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET_NEWS_HEADLINES
// ============================================================================

app.post('/get_news_headlines', async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      category = config.defaults?.news_category || 'general',
      query = null,
      country = config.defaults?.news_country || 'us',
      limit = config.defaults?.news_limit || 5,
    } = req.body;

    // Build cache key
    const cacheKey = `news:${category}:${country}:${query || ''}:${limit}`;

    // Check cache first
    const cached = getCached(cacheKey, 'NEWS');
    if (cached) {
      const durationMs = Date.now() - startTime;
      await logUsage({
        tool: 'get_news_headlines',
        provider: 'cache',
        category,
        query,
        durationMs,
        cached: true,
        success: true,
      });

      return res.json({
        success: true,
        data: cached.data,
        meta: {
          source: 'cache',
          cached: true,
          fetched_at: cached.fetched_at,
          cache_ttl_seconds: cached.cache_ttl_seconds,
        },
      });
    }

    // Fetch from provider (with fallback)
    let result;
    let source = 'newsapi';

    // Try NewsAPI first if configured
    if (providers.news.newsapi.isConfigured()) {
      try {
        result = await newsQueue.add(async () => {
          if (query) {
            return await providers.news.newsapi.searchNews(query, { limit });
          }
          return await providers.news.newsapi.getHeadlines({ category, country, limit });
        });
      } catch (newsapiError) {
        console.warn(`⚠️  NewsAPI failed: ${newsapiError.message}, trying GNews...`);

        if (!providers.news.gnews.isConfigured()) {
          throw new Error(`NewsAPI failed and GNews not configured: ${newsapiError.message}`);
        }

        source = 'gnews';
        result = await newsQueue.add(async () => {
          if (query) {
            return await providers.news.gnews.searchNews(query, { limit });
          }
          return await providers.news.gnews.getHeadlines({ category, country, limit });
        });
      }
    } else if (providers.news.gnews.isConfigured()) {
      // Fall back to GNews if NewsAPI not configured
      source = 'gnews';
      result = await newsQueue.add(async () => {
        if (query) {
          return await providers.news.gnews.searchNews(query, { limit });
        }
        return await providers.news.gnews.getHeadlines({ category, country, limit });
      });
    } else {
      throw new Error('No news provider configured. Please set NEWSAPI_API_KEY or GNEWS_API_KEY in .env');
    }

    // Cache the result
    setCache(cacheKey, result);

    const durationMs = Date.now() - startTime;

    await logUsage({
      tool: 'get_news_headlines',
      provider: source,
      category,
      query,
      durationMs,
      cached: false,
      success: true,
    });

    res.json({
      success: true,
      data: result,
      meta: {
        source,
        cached: false,
        fetched_at: new Date().toISOString(),
        cache_ttl_seconds: getTTLSeconds('NEWS'),
      },
    });

  } catch (error) {
    console.error('❌ [get_news_headlines] Error:', error.message);

    await logUsage({
      tool: 'get_news_headlines',
      provider: 'error',
      error: error.message,
      durationMs: Date.now() - startTime,
      cached: false,
      success: false,
    });

    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET_INJURIES
// ============================================================================

app.post('/get_injuries', async (req, res) => {
  const startTime = Date.now();

  try {
    const { sport, team } = req.body;

    if (!sport) {
      return res.status(400).json({ error: 'sport parameter is required' });
    }

    // Build cache key
    const cacheKey = `injuries:${sport}:${team || 'all'}`;

    // Check cache first
    const cached = getCached(cacheKey, 'NEWS'); // Use NEWS TTL (5 min)
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        meta: {
          source: 'cache',
          cached: true,
          fetched_at: cached.fetched_at,
        },
      });
    }

    // Fetch from ESPN
    const result = await sportsQueue.add(async () => {
      return await providers.sports.espn.getInjuries(sport, team);
    });

    // Cache the result
    setCache(cacheKey, result);

    res.json({
      success: true,
      data: result,
      meta: {
        source: 'espn',
        cached: false,
        fetched_at: new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error('❌ [get_injuries] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET_STANDINGS
// ============================================================================

app.post('/get_standings', async (req, res) => {
  const startTime = Date.now();

  try {
    const { sport, conference } = req.body;

    if (!sport) {
      return res.status(400).json({ error: 'sport parameter is required' });
    }

    // Build cache key
    const cacheKey = `standings:${sport}:${conference || 'all'}`;

    // Check cache first - use longer TTL for standings (1 hour)
    const cached = getCached(cacheKey, 'FINAL_SCORE');
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        meta: {
          source: 'cache',
          cached: true,
          fetched_at: cached.fetched_at,
        },
      });
    }

    // Fetch from ESPN
    const result = await sportsQueue.add(async () => {
      return await providers.sports.espn.getStandings(sport, conference);
    });

    // Cache the result
    setCache(cacheKey, result);

    res.json({
      success: true,
      data: result,
      meta: {
        source: 'espn',
        cached: false,
        fetched_at: new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error('❌ [get_standings] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET_SPORTS_NEWS
// ============================================================================

app.post('/get_sports_news', async (req, res) => {
  const startTime = Date.now();

  try {
    const { sport, team, limit = 5 } = req.body;

    if (!sport) {
      return res.status(400).json({ error: 'sport parameter is required' });
    }

    // Build cache key
    const cacheKey = `sports_news:${sport}:${team || 'all'}:${limit}`;

    // Check cache first
    const cached = getCached(cacheKey, 'NEWS');
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        meta: {
          source: 'cache',
          cached: true,
          fetched_at: cached.fetched_at,
        },
      });
    }

    // Fetch from ESPN
    const result = await sportsQueue.add(async () => {
      return await providers.sports.espn.getNews(sport, team, limit);
    });

    // Cache the result
    setCache(cacheKey, result);

    res.json({
      success: true,
      data: result,
      meta: {
        source: 'espn',
        cached: false,
        fetched_at: new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error('❌ [get_sports_news] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET_PREDICTION_MARKETS
// ============================================================================

app.post('/get_prediction_markets', async (req, res) => {
  const startTime = Date.now();

  try {
    const { category = 'all', query = null, limit = 5, sort = 'volume' } = req.body;

    // Build cache key
    const cacheKey = `predictions:${category}:${query || ''}:${limit}:${sort}`;

    // Check cache first (5 min TTL like news)
    const cached = getCached(cacheKey, 'NEWS');
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        meta: {
          source: 'cache',
          cached: true,
          fetched_at: cached.fetched_at,
        },
      });
    }

    // Fetch from Polymarket
    const result = await providers.predictions.polymarket.getMarkets({
      category,
      query,
      limit: Math.min(limit, 20),
      sort,
    });

    // Cache the result
    setCache(cacheKey, result);

    const durationMs = Date.now() - startTime;

    await logUsage({
      tool: 'get_prediction_markets',
      provider: 'polymarket',
      category,
      query,
      durationMs,
      cached: false,
      success: true,
    });

    res.json({
      success: true,
      data: result,
      meta: {
        source: 'polymarket',
        cached: false,
        fetched_at: new Date().toISOString(),
        cache_ttl_seconds: getTTLSeconds('NEWS'),
      },
    });

  } catch (error) {
    console.error('❌ [get_prediction_markets] Error:', error.message);

    await logUsage({
      tool: 'get_prediction_markets',
      provider: 'error',
      error: error.message,
      durationMs: Date.now() - startTime,
      cached: false,
      success: false,
    });

    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TAPJOT - SNIPPETS
// ============================================================================

app.post('/tapjot_list_snippets', async (req, res) => {
  try {
    const result = await providers.tapjot.client.listSnippets(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ [tapjot_list_snippets] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/tapjot_create_snippet', async (req, res) => {
  try {
    const result = await providers.tapjot.client.createSnippet(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ [tapjot_create_snippet] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/tapjot_update_snippet', async (req, res) => {
  try {
    const { id, ...updates } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const result = await providers.tapjot.client.updateSnippet(id, updates);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ [tapjot_update_snippet] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/tapjot_delete_snippet', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const result = await providers.tapjot.client.deleteSnippet(id);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ [tapjot_delete_snippet] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TAPJOT - PROJECTS
// ============================================================================

app.post('/tapjot_list_projects', async (req, res) => {
  try {
    const result = await providers.tapjot.client.listProjects();
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ [tapjot_list_projects] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/tapjot_create_project', async (req, res) => {
  try {
    const result = await providers.tapjot.client.createProject(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ [tapjot_create_project] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/tapjot_update_project', async (req, res) => {
  try {
    const { id, ...updates } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const result = await providers.tapjot.client.updateProject(id, updates);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ [tapjot_update_project] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/tapjot_delete_project', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const result = await providers.tapjot.client.deleteProject(id);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ [tapjot_delete_project] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TAPJOT - VIEWS
// ============================================================================

app.post('/tapjot_list_views', async (req, res) => {
  try {
    const result = await providers.tapjot.client.listViews(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ [tapjot_list_views] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/tapjot_create_view', async (req, res) => {
  try {
    const result = await providers.tapjot.client.createView(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ [tapjot_create_view] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/tapjot_delete_view', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const result = await providers.tapjot.client.deleteView(id);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ [tapjot_delete_view] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.LIVE_DATA_HTTP_PORT || 3004;

app.listen(PORT, () => {
  console.log(`\n🚀 Live Data HTTP Service running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Schema: http://localhost:${PORT}/schema`);
  console.log(`\n📦 This is a SHARED service - one instance serves all bots/panels\n`);
});
