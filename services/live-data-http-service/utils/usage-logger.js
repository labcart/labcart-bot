/**
 * Usage logging utility
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.join(__dirname, '..', 'logs');

/**
 * Log API usage
 */
export async function logUsage(entry) {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      ...entry,
    };

    // Ensure logs directory exists
    await fs.mkdir(LOG_DIR, { recursive: true });

    // Daily log file
    const date = timestamp.split('T')[0];
    const logFile = path.join(LOG_DIR, `usage-${date}.jsonl`);

    // Append to log file (JSONL format)
    await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');

    // Console log for visibility
    const preview = entry.query?.substring(0, 30) || entry.symbol || entry.sport || 'unknown';
    console.log(`📈 [${entry.tool}] ${entry.provider} - "${preview}${preview.length >= 30 ? '...' : ''}" (${entry.durationMs}ms, ${entry.cached ? 'cached' : 'fresh'})`);

  } catch (error) {
    // Don't fail on logging errors
    console.error('⚠️  Failed to log usage:', error.message);
  }
}

/**
 * Get usage stats for a date range
 */
export async function getUsageStats(startDate, endDate) {
  try {
    const files = await fs.readdir(LOG_DIR);
    const logFiles = files.filter(f => f.startsWith('usage-') && f.endsWith('.jsonl'));

    const stats = {
      total_requests: 0,
      by_tool: {},
      by_provider: {},
      cached_hits: 0,
      errors: 0,
    };

    for (const file of logFiles) {
      const content = await fs.readFile(path.join(LOG_DIR, file), 'utf-8');
      const lines = content.trim().split('\n').filter(l => l);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          stats.total_requests++;

          stats.by_tool[entry.tool] = (stats.by_tool[entry.tool] || 0) + 1;
          stats.by_provider[entry.provider] = (stats.by_provider[entry.provider] || 0) + 1;

          if (entry.cached) stats.cached_hits++;
          if (entry.error) stats.errors++;
        } catch {
          // Skip malformed lines
        }
      }
    }

    return stats;
  } catch (error) {
    return { error: error.message };
  }
}

export default {
  logUsage,
  getUsageStats,
};
