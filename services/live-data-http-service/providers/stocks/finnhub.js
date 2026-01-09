/**
 * Finnhub API Provider (Fallback)
 *
 * Official API with free tier (60 req/min).
 * Requires API key.
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
   * Check if provider is configured
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Get real-time quote for a symbol
   */
  async getQuote(symbol, includeHistory = false) {
    if (!this.apiKey) {
      throw new Error('Finnhub API key not configured');
    }

    const upperSymbol = symbol.toUpperCase();

    console.log(`📊 [Finnhub] Fetching quote for: ${upperSymbol}`);

    // Get quote
    const quoteUrl = `${BASE_URL}/quote?symbol=${encodeURIComponent(upperSymbol)}&token=${this.apiKey}`;

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
        const history = await this.getCandles(upperSymbol, 5);
        result.history = history;
      } catch (error) {
        console.warn(`[Finnhub] Could not fetch history: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Get historical candles
   */
  async getCandles(symbol, days = 5) {
    if (!this.apiKey) {
      throw new Error('Finnhub API key not configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const from = now - days * 24 * 60 * 60;

    const url = `${BASE_URL}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${this.apiKey}`;

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
   */
  async searchSymbol(query) {
    if (!this.apiKey) {
      throw new Error('Finnhub API key not configured');
    }

    const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}&token=${this.apiKey}`;

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
