/**
 * Usage Logger
 * Tracks TTS tool usage for debugging, cost analysis, and auditing
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Calculate cost estimate based on provider and character count
 */
function calculateCost(provider, characterCount) {
  const costs = {
    openai: 0.015 / 1000,  // $15 per 1M chars = $0.015 per 1K chars
    google: 0.004 / 1000,  // $4 per 1M chars = $0.004 per 1K chars
  };

  const rate = costs[provider] || 0;
  return (rate * characterCount).toFixed(6);
}

/**
 * Log a TTS usage event
 *
 * @param {Object} params
 * @param {string} params.tool - Tool name (e.g., 'text_to_speech')
 * @param {string} params.provider - TTS provider (openai, google)
 * @param {number} params.characterCount - Number of characters processed
 * @param {string} [params.voice] - Voice used
 * @param {string} [params.filename] - Custom filename if provided
 * @param {number} [params.durationMs] - Processing time in milliseconds
 * @param {boolean} [params.success] - Whether the request succeeded
 * @param {string} [params.error] - Error message if failed
 */
export async function logUsage(params) {
  const {
    tool,
    provider,
    characterCount,
    voice,
    filename,
    durationMs,
    success = true,
    error,
  } = params;

  // Create log entry
  const logEntry = {
    timestamp: new Date().toISOString(),
    tool,
    provider,
    character_count: characterCount,
    cost_estimate_usd: calculateCost(provider, characterCount),
    voice,
    custom_filename: filename || null,
    duration_ms: durationMs || null,
    success,
    error: error || null,
    // Try to get session/project info from environment
    session_id: process.env.CLAUDE_SESSION_ID || null,
    project_path: process.env.CLAUDE_PROJECT_PATH || process.cwd(),
  };

  try {
    // Log file path
    const logDir = path.resolve(__dirname, '../logs');
    await fs.mkdir(logDir, { recursive: true });

    // Daily log file (one file per day)
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(logDir, `usage-${date}.jsonl`);

    // Append as JSON Lines format (one JSON object per line)
    await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');

    // Also log to console for real-time visibility
    const costStr = `$${logEntry.cost_estimate_usd}`;
    const statusIcon = success ? '✅' : '❌';
    console.log(
      `${statusIcon} [${provider}] ${characterCount} chars | ${costStr} | ${voice || 'default'} | ${durationMs || '?'}ms`
    );
  } catch (err) {
    // Don't fail the request if logging fails
    console.error('⚠️  Failed to write usage log:', err.message);
  }
}

/**
 * Get usage statistics for a date range
 *
 * @param {string} [startDate] - Start date (YYYY-MM-DD), defaults to today
 * @param {string} [endDate] - End date (YYYY-MM-DD), defaults to today
 * @returns {Promise<Object>} Usage statistics
 */
export async function getUsageStats(startDate, endDate) {
  const logDir = path.resolve(__dirname, '../logs');

  try {
    const files = await fs.readdir(logDir);
    const logFiles = files.filter(f => f.startsWith('usage-') && f.endsWith('.jsonl'));

    let totalCost = 0;
    let totalChars = 0;
    let totalRequests = 0;
    let successfulRequests = 0;
    const providerStats = {};

    for (const file of logFiles) {
      const content = await fs.readFile(path.join(logDir, file), 'utf-8');
      const lines = content.trim().split('\n');

      for (const line of lines) {
        if (!line) continue;

        const entry = JSON.parse(line);
        totalRequests++;

        if (entry.success) {
          successfulRequests++;
          totalCost += parseFloat(entry.cost_estimate_usd);
          totalChars += entry.character_count;

          if (!providerStats[entry.provider]) {
            providerStats[entry.provider] = { count: 0, cost: 0, chars: 0 };
          }
          providerStats[entry.provider].count++;
          providerStats[entry.provider].cost += parseFloat(entry.cost_estimate_usd);
          providerStats[entry.provider].chars += entry.character_count;
        }
      }
    }

    return {
      total_requests: totalRequests,
      successful_requests: successfulRequests,
      total_cost_usd: totalCost.toFixed(4),
      total_characters: totalChars,
      by_provider: providerStats,
    };
  } catch (err) {
    console.error('Failed to read usage stats:', err.message);
    return null;
  }
}

export default { logUsage, getUsageStats };
