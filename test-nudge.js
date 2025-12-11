#!/usr/bin/env node

/**
 * Test Script for Nudge System
 *
 * Usage:
 *   node test-nudge.js <botId> <userId> <hoursAgo>
 *
 * Example:
 *   node test-nudge.js mattyatlas 7764813487 25
 *
 * This sets the last message time to 25 hours ago to trigger a 24h nudge
 */

const SessionManager = require('./lib/session-manager');
const path = require('path');

const args = process.argv.slice(2);

if (args.length < 3) {
  console.error('Usage: node test-nudge.js <botId> <userId> <hoursAgo>');
  console.error('Example: node test-nudge.js mattyatlas 7764813487 25');
  process.exit(1);
}

const [botId, userIdStr, hoursAgoStr] = args;
const userId = parseInt(userIdStr);
const hoursAgo = parseInt(hoursAgoStr);

if (isNaN(userId) || isNaN(hoursAgo)) {
  console.error('Error: userId and hoursAgo must be numbers');
  process.exit(1);
}

const sessionManager = new SessionManager();

// Load metadata
const metadata = sessionManager.loadSessionMetadata(botId, userId);

if (!metadata) {
  console.error(`❌ No session found for ${botId}/${userId}`);
  console.error('   Create a session first by messaging the bot in Telegram');
  process.exit(1);
}

// Set last message time to X hours ago
const hoursAgoMs = hoursAgo * 60 * 60 * 1000;
const lastMessageTime = Date.now() - hoursAgoMs;

metadata.lastMessageTime = lastMessageTime;

// Save
sessionManager.saveSessionMetadata(botId, userId, metadata);

console.log(`✅ Set lastMessageTime for ${botId}/${userId} to ${hoursAgo} hours ago`);
console.log(`📅 Timestamp: ${new Date(lastMessageTime).toISOString()}`);
console.log(`\nNext nudge check will happen within the next hour.`);
console.log(`Or trigger manually by restarting the server.\n`);
