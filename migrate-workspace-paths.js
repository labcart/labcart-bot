#!/usr/bin/env node

/**
 * Migration Script: Backfill workspace paths in session metadata
 *
 * This script uses a clever approach: Claude CLI organizes sessions by workspace
 * in ~/.cache/claude-cli-nodejs/<workspace-path-with-dashes>/
 *
 * We can map session UUIDs to workspaces by checking which workspace directory
 * the session was run from based on the MCP logs or by querying the VS Code database.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Convert Claude CLI cache directory name to workspace path
 * Example: "-opt-lab-claude-bot" -> "/opt/lab/claude-bot"
 */
function cacheNameToWorkspace(cacheName) {
  // Remove leading dash and replace remaining dashes with slashes
  // But be careful - we need to replace single dashes with slashes,
  // not double dashes (which represent actual dashes in path)
  return '/' + cacheName.substring(1).replace(/-/g, '/');
}

/**
 * Find Claude database (VS Code stores conversation data)
 */
function findClaudeDatabase() {
  const homeDir = os.homedir();

  // Try standard VS Code locations
  const locations = [
    path.join(homeDir, '.config/Code/User/globalStorage/state.vscdb'),
    path.join(homeDir, '.config/Cursor/User/globalStorage/anthropic.claude-code/state.vscdb'),
  ];

  for (const location of locations) {
    if (fs.existsSync(location)) {
      console.log(`✅ Found Claude database at: ${location}`);
      return location;
    }
  }

  console.log('⚠️  Could not find Claude database');
  return null;
}

/**
 * Extract workspace from Claude messages
 * Based on chat-context-mcp's extractWorkspaceFromClaudeMessages()
 */
function extractWorkspaceFromMessages(messages) {
  if (!messages || messages.length === 0) {
    return null;
  }

  // Get cwd from first message (all messages in a session have the same cwd)
  const firstMessage = messages[0];
  if (firstMessage && firstMessage.cwd) {
    return firstMessage.cwd;
  }

  return null;
}

/**
 * Get Claude conversation messages for a UUID from VS Code database
 */
function getClaudeMessages(db, uuid) {
  try {
    // Query for conversation data
    // VS Code stores data in ItemTable with keys like various patterns
    const patterns = [
      `claude-conversations-${uuid}`,
      `%${uuid}%`,
    ];

    for (const pattern of patterns) {
      const stmt = db.prepare(`
        SELECT value
        FROM ItemTable
        WHERE key LIKE ?
      `);

      const rows = stmt.all(pattern);

      for (const row of rows) {
        try {
          const data = JSON.parse(row.value);

          // Check if this looks like conversation data with messages
          if (data && (data.messages || data.content)) {
            const messages = data.messages || [];
            if (messages.length > 0) {
              return messages;
            }
          }
        } catch (e) {
          // Not valid JSON or not the right format
          continue;
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`Error getting messages for UUID ${uuid}:`, error.message);
    return null;
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('🔄 Starting workspace path migration...\n');

  // Get all session metadata files
  const sessionDir = path.join(process.cwd(), '.sessions');
  const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json'));

  console.log(`📋 Found ${files.length} session metadata files\n`);

  // Find Claude database
  const dbPath = findClaudeDatabase();
  let db = null;
  if (dbPath) {
    db = new Database(dbPath, { readonly: true });
    console.log('📂 Opened Claude database\n');
  } else {
    console.log('⚠️  No database found - will skip sessions without workspace\n');
  }

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    const metadata = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Skip if already has workspace
    if (metadata.workspacePath) {
      console.log(`⏭️  Skipping ${file} - already has workspace: ${metadata.workspacePath}`);
      skipped++;
      continue;
    }

    // Get current UUID
    const uuid = metadata.currentUuid;
    if (!uuid) {
      console.log(`⚠️  Skipping ${file} - no current UUID`);
      skipped++;
      continue;
    }

    let workspace = null;

    // Try to extract workspace from database if available
    if (db) {
      const messages = getClaudeMessages(db, uuid);
      if (messages) {
        workspace = extractWorkspaceFromMessages(messages);
        if (workspace) {
          console.log(`📍 Found workspace from messages: ${workspace}`);
        }
      }
    }

    if (!workspace) {
      // Fallback: Use default workspace (/opt/lab/claude-bot)
      // This is where the bot server runs from, so it's a reasonable assumption for old sessions
      workspace = '/opt/lab/claude-bot';
      console.log(`📍 Using default workspace for ${file}: ${workspace}`);
    }

    // Update metadata
    metadata.workspacePath = workspace;
    metadata.updatedAt = new Date().toISOString();
    metadata.migratedAt = new Date().toISOString();

    fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), 'utf8');
    console.log(`✅ Updated ${file} with workspace: ${workspace}`);
    updated++;
  }

  // Close database
  if (db) {
    db.close();
  }

  // Summary
  console.log('\n📊 Migration Summary:');
  console.log(`   ✅ Updated: ${updated}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`   📁 Total: ${files.length}`);
}

// Run migration
migrate().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
