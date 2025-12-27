/**
 * Telegram Message Reader
 * 
 * Reads recent messages from your Telegram bot chat for debugging.
 * Run this after authenticating with telegram-auth.js
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');

async function readMessages() {
  // Load saved session
  if (!fs.existsSync('telegram-session.json')) {
    console.error('❌ No session found. Please run: node telegram-auth.js first');
    process.exit(1);
  }

  const savedSession = JSON.parse(fs.readFileSync('telegram-session.json', 'utf8'));
  const session = new StringSession(savedSession.session);
  
  const client = new TelegramClient(session, savedSession.api_id, savedSession.api_hash, {
    connectionRetries: 5,
  });

  console.log('📱 Connecting to Telegram...');
  await client.connect();

  // Get the bot chat (should be "Saved Messages" or a specific chat)
  const dialogs = await client.getDialogs({ limit: 20 });
  
  console.log('\n📋 Recent chats:');
  console.log('================\n');
  
  for (let i = 0; i < dialogs.length; i++) {
    const dialog = dialogs[i];
    const name = dialog.title || dialog.name || 'Unknown';
    console.log(`${i + 1}. ${name}`);
  }

  // Find the "SmartBuddyBot" bot chat
  const botDialog = dialogs.find(d => (d.title || d.name || '').includes('Smart'));
  const targetDialog = botDialog || dialogs[0];
  
  console.log(`\n📬 Reading messages from: ${targetDialog.title || targetDialog.name}`);
  console.log('=====================================\n');

  const messages = await client.getMessages(targetDialog.id, { limit: 15 });
  
  for (const msg of messages.reverse()) {
    if (msg.message) {
      const time = new Date(msg.date * 1000).toLocaleTimeString();
      const from = msg.out ? 'You' : (targetDialog.title || 'Bot');
      console.log(`[${time}] ${from}: ${msg.message}`);
    }
  }

  await client.disconnect();
  console.log('\n✅ Done');
  process.exit(0);
}

readMessages().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});

