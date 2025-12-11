/**
 * Send a test message to the Claude Relay bot
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');

async function sendMessage(text) {
  const savedSession = JSON.parse(fs.readFileSync('telegram-session.json', 'utf8'));
  const session = new StringSession(savedSession.session);
  
  const client = new TelegramClient(session, savedSession.api_id, savedSession.api_hash, {
    connectionRetries: 5,
  });

  await client.connect();

  // Find the MattyAtlas bot
  const dialogs = await client.getDialogs({ limit: 20 });
  const botDialog = dialogs.find(d => (d.title || d.name || '').includes('Matty'));

  if (!botDialog) {
    console.error('❌ MattyAtlas bot not found');
    process.exit(1);
  }

  console.log(`📤 Sending to ${botDialog.title}: "${text}"`);
  await client.sendMessage(botDialog.id, { message: text });
  console.log('✅ Message sent!');

  await client.disconnect();
  process.exit(0);
}

const message = process.argv.slice(2).join(' ') || 'Say hello in one sentence';
sendMessage(message).catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

