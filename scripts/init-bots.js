#!/usr/bin/env node

/**
 * Bot Initialization Script
 *
 * Scans the /brains folder for available brain files and creates
 * bot instances in the database for the current user.
 * Generates bots.json from the database records.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const BRAINS_DIR = path.join(__dirname, '..', 'brains');
const BOTS_JSON_PATH = path.join(__dirname, '..', 'bots.json');
const COORDINATION_URL = process.env.COORDINATION_URL?.replace('/api/servers/register', '/api') || 'https://labcart.io/api';
const USER_ID = process.env.USER_ID;
const SERVER_ID = process.env.SERVER_ID;

if (!USER_ID) {
  console.error('❌ USER_ID not found in .env');
  console.error('   Please configure your .env file first');
  process.exit(1);
}

/**
 * Scan brains directory and return list of brain files
 */
function scanBrainFiles() {
  if (!fs.existsSync(BRAINS_DIR)) {
    console.error(`❌ Brains directory not found: ${BRAINS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(BRAINS_DIR)
    .filter(file => file.endsWith('.js') && !file.startsWith('_'))
    .map(file => file.replace('.js', ''));

  return files;
}

/**
 * Load a brain file and extract metadata
 */
function loadBrainMetadata(brainName) {
  const brainPath = path.join(BRAINS_DIR, `${brainName}.js`);

  try {
    const brain = require(brainPath);

    return {
      brainFile: brainName,
      name: brain.name || brainName,
      description: brain.description || '',
      systemPrompt: {
        prompt: brain.systemPrompt || '',
        private: brain.private !== undefined ? brain.private : true,
        version: brain.version || '1.0',
        security: brain.security !== undefined ? brain.security : 'default'
      },
      version: brain.version || '1.0'
    };
  } catch (err) {
    console.error(`⚠️  Failed to load brain ${brainName}:`, err.message);
    return null;
  }
}

/**
 * Create a bot in the database
 */
async function createBot(metadata) {
  const botData = {
    userId: USER_ID,
    name: metadata.name,
    description: metadata.description,
    systemPrompt: metadata.systemPrompt,
    serverId: SERVER_ID,
    workspace: process.cwd(),
    webOnly: true,
    active: true
  };

  const response = await fetch(`${COORDINATION_URL}/bots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(botData)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create bot: ${error}`);
  }

  const result = await response.json();
  return result.bot;
}

/**
 * Check if bots already exist for this user
 */
async function getBots() {
  const url = `${COORDINATION_URL}/bots?userId=${USER_ID}`;
  console.log(`   Fetching from: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch existing bots (${response.status}): ${error}`);
  }

  const result = await response.json();
  return result.bots || [];
}

/**
 * Generate bots.json from bot records
 *
 * NOTE: This is ONLY needed for Telegram bot mode (not Web UI).
 * For Web UI, bots are fetched directly from Supabase on server startup.
 * This function is kept for backwards compatibility but may be removed.
 */
function generateBotsJson(bots) {
  const botsConfig = bots.map(bot => ({
    id: bot.id,
    brain: bot.id, // Use bot UUID - BrainLoader will load from database
    workspace: bot.workspace || process.cwd(),
    webOnly: bot.web_only,
    active: bot.active
  }));

  fs.writeFileSync(BOTS_JSON_PATH, JSON.stringify(botsConfig, null, 2));
  console.log(`✅ Generated bots.json with ${botsConfig.length} bots`);
  console.log(`ℹ️  Note: Web UI fetches bots from Supabase. This file is for Telegram mode only.`);
}

/**
 * Main initialization
 */
async function init() {
  console.log('🚀 Initializing bots for user:', USER_ID);
  console.log('');

  // 1. Scan brain files
  console.log('📂 Scanning brain files...');
  const brainFiles = scanBrainFiles();
  console.log(`   Found ${brainFiles.length} brain files`);
  console.log('');

  // 2. Check existing bots in database
  console.log('🔍 Checking existing bots in database...');
  const existingBots = await getBots();
  const existingBotNames = new Set(existingBots.map(b => b.name));
  console.log(`   Found ${existingBots.length} existing bots`);
  console.log('');

  // 3. Create bots for any brain files that don't exist yet
  console.log('📦 Creating bot instances...');
  let created = 0;
  let skipped = 0;

  for (const brainFile of brainFiles) {
    const metadata = loadBrainMetadata(brainFile);

    if (!metadata) {
      console.log(`   ⚠️  Skipped ${brainFile} (failed to load)`);
      skipped++;
      continue;
    }

    if (existingBotNames.has(metadata.name)) {
      console.log(`   ⏭️  Skipped ${metadata.name} (already exists)`);
      skipped++;
      continue;
    }

    try {
      const bot = await createBot(metadata);
      console.log(`   ✅ Created ${metadata.name} (${bot.id})`);
      existingBots.push(bot);
      created++;
    } catch (err) {
      console.error(`   ❌ Failed to create ${metadata.name}:`, err.message);
    }
  }

  console.log('');
  console.log(`📊 Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Total: ${existingBots.length}`);
  console.log('');

  // 4. Generate bots.json
  console.log('📝 Generating bots.json...');
  generateBotsJson(existingBots);
  console.log('');

  console.log('✨ Initialization complete!');
  console.log('');
  console.log('Next steps:');
  console.log('   1. Review bots.json to verify configuration');
  console.log('   2. Start the bot server: npm start');
  console.log('');
}

// Run initialization
init().catch(err => {
  console.error('');
  console.error('❌ Initialization failed:', err.message);
  console.error('Stack trace:', err.stack);
  console.error('');
  process.exit(1);
});
