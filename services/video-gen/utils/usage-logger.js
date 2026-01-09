import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, '..', 'usage.log');

export async function logUsage(entry) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    ...entry
  };

  const line = JSON.stringify(logEntry) + '\n';

  try {
    await fs.appendFile(LOG_FILE, line);
  } catch (err) {
    console.error('Failed to log usage:', err.message);
  }
}

export async function getUsageSummary(days = 7) {
  try {
    const content = await fs.readFile(LOG_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries = lines.map(l => JSON.parse(l));

    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const recent = entries.filter(e => new Date(e.timestamp).getTime() > cutoff);

    const byProvider = {};
    let totalCost = 0;

    for (const entry of recent) {
      const provider = entry.provider || 'unknown';
      if (!byProvider[provider]) {
        byProvider[provider] = { count: 0, cost: 0, duration_seconds: 0 };
      }
      byProvider[provider].count++;
      byProvider[provider].cost += entry.estimated_cost || 0;
      byProvider[provider].duration_seconds += entry.duration_seconds || 0;
      totalCost += entry.estimated_cost || 0;
    }

    return {
      period_days: days,
      total_jobs: recent.length,
      total_cost: totalCost,
      by_provider: byProvider
    };
  } catch (err) {
    return { error: err.message };
  }
}
