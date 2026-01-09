/**
 * Yahoo Finance Provider
 *
 * Uses Yahoo Finance's publicly accessible API endpoints.
 * No authentication required (unofficial).
 *
 * Based on the patterns used by yfinance library.
 */

import fetch from 'node-fetch';

const BASE_URL = 'https://query1.finance.yahoo.com';

export class YahooFinanceProvider {
  constructor(config = {}) {
    this.name = 'yahoo';
    this.config = config;
  }

  /**
   * Get real-time quote for a symbol
   */
  async getQuote(symbol, includeHistory = false) {
    const upperSymbol = symbol.toUpperCase();

    console.log(`📈 [Yahoo] Fetching quote for: ${upperSymbol}`);

    // Get quote data
    const quoteUrl = `${BASE_URL}/v8/finance/chart/${encodeURIComponent(upperSymbol)}?interval=1d&range=5d`;

    const response = await fetch(quoteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LiveDataService/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.chart?.error) {
      throw new Error(data.chart.error.description || 'Yahoo Finance error');
    }

    return this.parseQuote(data, upperSymbol, includeHistory);
  }

  /**
   * Parse Yahoo Finance response
   */
  parseQuote(data, symbol, includeHistory) {
    const result = data.chart?.result?.[0];
    if (!result) {
      throw new Error(`No data found for symbol: ${symbol}`);
    }

    const meta = result.meta || {};
    const quote = result.indicators?.quote?.[0] || {};
    const timestamps = result.timestamp || [];

    // Get the most recent data point
    const lastIndex = timestamps.length - 1;
    const currentPrice = meta.regularMarketPrice || quote.close?.[lastIndex];
    const previousClose = meta.chartPreviousClose || meta.previousClose;

    // Calculate change
    const change = currentPrice && previousClose ? currentPrice - previousClose : null;
    const changePercent = change && previousClose ? (change / previousClose) * 100 : null;

    const response = {
      symbol: symbol,
      name: meta.shortName || meta.longName || symbol,
      exchange: meta.exchangeName,
      currency: meta.currency,
      price: currentPrice ? parseFloat(currentPrice.toFixed(2)) : null,
      previous_close: previousClose ? parseFloat(previousClose.toFixed(2)) : null,
      change: change ? parseFloat(change.toFixed(2)) : null,
      change_percent: changePercent ? parseFloat(changePercent.toFixed(2)) : null,
      day_high: meta.regularMarketDayHigh ? parseFloat(meta.regularMarketDayHigh.toFixed(2)) : null,
      day_low: meta.regularMarketDayLow ? parseFloat(meta.regularMarketDayLow.toFixed(2)) : null,
      volume: meta.regularMarketVolume || null,
      market_cap: meta.marketCap || null,
      market_state: meta.marketState, // 'REGULAR', 'PRE', 'POST', 'CLOSED'
      updated_at: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString(),
    };

    // Include 5-day history if requested
    if (includeHistory && timestamps.length > 0) {
      response.history = timestamps.map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        open: quote.open?.[i] ? parseFloat(quote.open[i].toFixed(2)) : null,
        high: quote.high?.[i] ? parseFloat(quote.high[i].toFixed(2)) : null,
        low: quote.low?.[i] ? parseFloat(quote.low[i].toFixed(2)) : null,
        close: quote.close?.[i] ? parseFloat(quote.close[i].toFixed(2)) : null,
        volume: quote.volume?.[i] || null,
      })).filter(h => h.close !== null);
    }

    return response;
  }

  /**
   * Search for symbols
   */
  async searchSymbol(query) {
    const url = `${BASE_URL}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LiveDataService/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance search error: ${response.status}`);
    }

    const data = await response.json();

    return (data.quotes || []).map(q => ({
      symbol: q.symbol,
      name: q.shortname || q.longname,
      type: q.quoteType,
      exchange: q.exchange,
    }));
  }
}

export default YahooFinanceProvider;
