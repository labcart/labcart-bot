#!/usr/bin/env node

/**
 * Manually trigger a nudge check (normally runs hourly)
 */

require('dotenv').config();
const BotManager = require('./lib/bot-manager');
const NudgeManager = require('./lib/nudge-manager');
const fs = require('fs');
const path = require('path');

console.log('🔍 Manually triggering nudge check...\n');

// Load bot configurations
const botsConfigPath = path.join(__dirname, 'bots.json');
const bots = JSON.parse(fs.readFileSync(botsConfigPath, 'utf8'));

// Create bot manager (but don't start bots - we just need the structure)
const manager = new BotManager({
  claudeCmd: process.env.CLAUDE_CMD || 'claude'
});

// Add each bot
for (const bot of bots) {
  try {
    manager.addBot(bot);
  } catch (error) {
    console.error(`❌ Failed to load bot ${bot.id}:`, error.message);
  }
}

// Create nudge manager (but don't start cron - we'll call manually)
const nudgeManager = new NudgeManager(
  manager,
  manager.sessionManager,
  process.env.CLAUDE_CMD || 'claude'
);

// Stop the cron job (we don't want it running)
nudgeManager.stop();

// Manually trigger check
(async () => {
  try {
    console.log('Starting nudge check for all bots...\n');
    await nudgeManager.checkNudges();
    console.log('\n✅ Nudge check complete!');

    // Give some time for async operations to complete
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  } catch (err) {
    console.error('\n❌ Error:', err);
    console.error(err.stack);
    process.exit(1);
  }
})();
