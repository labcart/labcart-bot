#!/usr/bin/env node

/**
 * REAL Migration Script: Extract workspace paths from Claude conversation files
 *
 * Claude CLI stores conversations in ~/.claude/projects/<workspace-path>/
 * Each conversation is a .jsonl file where messages contain a "cwd" field
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');

const homeDir = os.homedir();
const projectsDir = path.join(homeDir, '.claude', 'projects');
const sessionDir = path.join(process.cwd(), '.sessions');

/**
 * Convert Claude project directory name to workspace path
 * Example: "-opt-lab-claude-bot" -> "/opt/lab/claude-bot"
 */
function dirNameToWorkspace(dirName) {
  return '/' + dirName.substring(1).replace(/-/g, '/');
}

/**
 * Extract cwd from a conversation .jsonl file
 */
async function extractCwdFromConversation(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const data = JSON.parse(line);
      if (data.cwd) {
        rl.close();
        fileStream.close();
        return data.cwd;
      }
    } catch (e) {
      // Skip malformed lines
      continue;
    }
  }

  return null;
}

/**
 * Build a map of UUID -> workspace path by scanning all conversation files
 */
async function buildUuidWorkspaceMap() {
  const map = {};

  if (!fs.existsSync(projectsDir)) {
    console.log('⚠️  Projects directory not found:', projectsDir);
    return map;
  }

  const workspaceDirs = fs.readdirSync(projectsDir)
    .filter(name => name.startsWith('-'))
    .filter(name => {
      const fullPath = path.join(projectsDir, name);
      return fs.statSync(fullPath).isDirectory();
    });

  console.log(`📂 Found ${workspaceDirs.length} workspace directories\n`);

  for (const dirName of workspaceDirs) {
    const workspace = dirNameToWorkspace(dirName);
    const workspaceDir = path.join(projectsDir, dirName);

    const conversationFiles = fs.readdirSync(workspaceDir)
      .filter(f => f.endsWith('.jsonl'));

    console.log(`  📁 ${dirName} (${workspace}): ${conversationFiles.length} conversations`);

    for (const file of conversationFiles) {
      const uuid = path.basename(file, '.jsonl');
      const filePath = path.join(workspaceDir, file);

      // Extract cwd from the conversation
      const cwd = await extractCwdFromConversation(filePath);

      if (cwd) {
        map[uuid] = cwd;
      }
    }
  }

  console.log(`\n✅ Built map of ${Object.keys(map).length} UUIDs\n`);
  return map;
}

/**
 * Main migration
 */
async function migrate() {
  console.log('🔄 Starting REAL workspace path migration...\n');

  // Build UUID -> workspace map from actual conversation files
  const uuidMap = await buildUuidWorkspaceMap();

  // Load all session metadata files
  const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json'));
  console.log(`📋 Found ${files.length} session metadata files\n`);

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    const metadata = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Skip if already has workspace from a previous migration
    if (metadata.workspacePath && !metadata.migratedAt) {
      console.log(`⏭️  ${file}: already has workspace (${metadata.workspacePath})`);
      skipped++;
      continue;
    }

    // Get current UUID
    const uuid = metadata.currentUuid;
    if (!uuid) {
      console.log(`⚠️  ${file}: no current UUID`);
      skipped++;
      continue;
    }

    // Look up workspace from map
    const workspace = uuidMap[uuid];

    if (workspace) {
      metadata.workspacePath = workspace;
      metadata.updatedAt = new Date().toISOString();
      metadata.migratedAt = new Date().toISOString();

      fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), 'utf8');
      console.log(`✅ ${file}: ${workspace}`);
      updated++;
    } else {
      console.log(`❌ ${file}: UUID ${uuid} not found in conversations`);
      notFound++;
    }
  }

  // Summary
  console.log('\n📊 Migration Summary:');
  console.log(`   ✅ Updated: ${updated}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Not Found: ${notFound}`);
  console.log(`   📁 Total: ${files.length}`);
}

// Run migration
migrate().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
