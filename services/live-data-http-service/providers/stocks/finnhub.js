/**
 * Finnhub API Provider (Fallback)
 *
 * Supports dynamic API keys passed per-request, with ENV fallback.
 * Official API with free tier (60 req/min).
 *
 * Docs: https://finnhub.io/docs/api
 */

import fetch from 'node-fetch';

const BASE_URL = 'https://finnhub.io/api/v1';

export class FinnhubProvider {
  constructor(config = {}) {
    this.name = 'finnhub';
    this.apiKey = config.apiKey || process.env.FINNHUB_API_KEY;
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
      throw new Error('No API key provided. Pass api_keys.finnhub in request or set FINNHUB_API_KEY environment variable.');
    }
    return key;
  }

  /**
   * Get real-time quote for a symbol
   * @param {string} symbol - Stock symbol
   * @param {boolean} [includeHistory] - Include price history
   * @param {string} [apiKey] - Optional API key (falls back to ENV)
   */
  async getQuote(symbol, includeHistory = false, apiKey) {
    const key = this.getApiKey(apiKey);

    const upperSymbol = symbol.toUpperCase();

    console.log(`📊 [Finnhub] Fetching quote for: ${upperSymbol}`);

    // Get quote
    const quoteUrl = `${BASE_URL}/quote?symbol=${encodeURIComponent(upperSymbol)}&token=${key}`;

    const response = await fetch(quoteUrl);
    if (!response.ok) {
      throw new Error(`Finnhub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Finnhub returns empty object for invalid symbols
    if (!data.c && data.c !== 0) {
      throw new Error(`No data found for symbol: ${upperSymbol}`);
    }

    const result = {
      symbol: upperSymbol,
      name: upperSymbol, // Finnhub quote doesn't include name
      price: data.c, // Current price
      previous_close: data.pc, // Previous close
      change: parseFloat((data.c - data.pc).toFixed(2)),
      change_percent: parseFloat((((data.c - data.pc) / data.pc) * 100).toFixed(2)),
      day_high: data.h,
      day_low: data.l,
      day_open: data.o,
      updated_at: new Date(data.t * 1000).toISOString(),
    };

    // Include candle history if requested
    if (includeHistory) {
      try {
        const history = await this.getCandles(upperSymbol, 5, key);
        result.history = history;
      } catch (error) {
        console.warn(`[Finnhub] Could not fetch history: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Get historical candles
   * @param {string} symbol - Stock symbol
   * @param {number} [days] - Number of days of history
   * @param {string} [apiKey] - Optional API key (falls back to ENV)
   */
  async getCandles(symbol, days = 5, apiKey) {
    const key = this.getApiKey(apiKey);

    const now = Math.floor(Date.now() / 1000);
    const from = now - days * 24 * 60 * 60;

    const url = `${BASE_URL}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${key}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Finnhub candles error: ${response.status}`);
    }

    const data = await response.json();

    if (data.s === 'no_data') {
      return [];
    }

    return (data.t || []).map((timestamp, i) => ({
      date: new Date(timestamp * 1000).toISOString().split('T')[0],
      open: data.o?.[i],
      high: data.h?.[i],
      low: data.l?.[i],
      close: data.c?.[i],
      volume: data.v?.[i],
    }));
  }

  /**
   * Search for symbols
   * @param {string} query - Search query
   * @param {string} [apiKey] - Optional API key (falls back to ENV)
   */
  async searchSymbol(query, apiKey) {
    const key = this.getApiKey(apiKey);

    const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}&token=${key}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Finnhub search error: ${response.status}`);
    }

    const data = await response.json();

    return (data.result || []).slice(0, 5).map(r => ({
      symbol: r.symbol,
      name: r.description,
      type: r.type,
    }));
  }
}

export default FinnhubProvider;
