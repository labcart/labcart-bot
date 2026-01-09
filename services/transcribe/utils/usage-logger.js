/**
 * Usage Logger
 * Tracks transcription usage for debugging, cost analysis, and auditing
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Calculate cost estimate based on audio duration
 * Whisper pricing: $0.006 per minute
 */
function calculateCost(durationSeconds) {
  const minutes = durationSeconds / 60;
  const rate = 0.006; // $0.006 per minute
  return (rate * minutes).toFixed(6);
}

/**
 * Log a transcription usage event
 */
export async function logUsage(params) {
  const {
    tool,
    provider,
    durationSeconds,
    fileSizeMb,
    language,
    durationMs,
    success = true,
    error,
  } = params;

  const logEntry = {
    timestamp: new Date().toISOString(),
    tool,
    provider,
    audio_duration_seconds: durationSeconds,
    file_size_mb: fileSizeMb,
    cost_estimate_usd: durationSeconds ? calculateCost(durationSeconds) : null,
    language,
    processing_time_ms: durationMs || null,
    success,
    error: error || null,
    session_id: process.env.CLAUDE_SESSION_ID || null,
    project_path: process.env.CLAUDE_PROJECT_PATH || process.cwd(),
  };

  try {
    const logDir = path.resolve(__dirname, '../logs');
    await fs.mkdir(logDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `usage-${date}.jsonl`);

    await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');

    const costStr = logEntry.cost_estimate_usd ? `$${logEntry.cost_estimate_usd}` : 'N/A';
    const statusIcon = success ? '  ' : '  ';
    const durationStr = durationSeconds ? `${durationSeconds.toFixed(1)}s audio` : 'unknown duration';
    console.log(
      `${statusIcon} [${provider}] ${durationStr} | ${costStr} | ${language || 'auto'} | ${durationMs || '?'}ms`
    );
  } catch (err) {
    console.error('   Failed to write usage log:', err.message);
  }
}

export default { logUsage };
