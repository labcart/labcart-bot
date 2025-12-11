#!/usr/bin/env node

/**
 * Bot Initialization Script
 *
 * Creates a single agent instance for the user during install.
 * Uses the default "claude" agent profile - a vanilla Claude with
 * security wrapper, no personality steering.
 *
 * Generates bots.json from the agent record.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabase = require('../lib/supabase-client');

const BOTS_JSON_PATH = path.join(__dirname, '..', 'bots.json');
const USER_ID = process.env.USER_ID;

if (!USER_ID) {
  console.error('❌ USER_ID not found in .env');
  console.error('   Please configure your .env file first');
  process.exit(1);
}

// Default agent slug to provision during install
// This is a vanilla Claude with security wrapper, no personality steering
const DEFAULT_AGENT_SLUG = 'claude';

/**
 * Fetch the default agent from marketplace_agents table
 * Only provisions the default agent, not all marketplace agents
 */
async function getDefaultAgent() {
  const { data, error } = await supabase
    .from('marketplace_agents')
    .select('*')
    .eq('slug', DEFAULT_AGENT_SLUG)
    .eq('is_active', true)
    .single();

  if (error) {
    throw new Error(`Failed to fetch default agent (${DEFAULT_AGENT_SLUG}): ${error.message}`);
  }

  return data;
}

/**
 * Fetch user's existing agent instances from my_agents table
 */
async function getMyAgents() {
  const { data, error } = await supabase
    .from('my_agents')
    .select('*')
    .eq('user_id', USER_ID);

  if (error) {
    throw new Error(`Failed to fetch user agents: ${error.message}`);
  }

  return data || [];
}

/**
 * Create an agent instance for the user in my_agents table
 */
async function createAgentInstance(agent) {
  const instanceData = {
    user_id: USER_ID,
    agent_id: agent.id,
    instance_name: agent.name,
    instance_slug: agent.slug,
    config_overrides: {},
    agent_type: agent.agent_type || 'personality',
    capabilities: agent.capabilities || []
  };

  const { data, error } = await supabase
    .from('my_agents')
    .insert(instanceData)
    .select()
    .single();

  if (error) {
    // Check if it's a duplicate key error
    if (error.code === '23505') {
      console.log(`   ⏭️  Skipped ${agent.name} (already exists)`);
      return null;
    }
    throw new Error(`Failed to create agent instance: ${error.message}`);
  }

  return data;
}

/**
 * Generate bots.json from agent records
 *
 * Maps marketplace agent format to the legacy bots.json format
 * for backward compatibility with the bot manager.
 */
function generateBotsJson(agents, instances) {
  // Create a map of instance_slug -> instance for quick lookup
  const instanceMap = new Map(instances.map(i => [i.instance_slug, i]));

  const botsConfig = agents
    .filter(agent => instanceMap.has(agent.slug))
    .map(agent => {
      const instance = instanceMap.get(agent.slug);
      const brainConfig = agent.brain_config || {};

      return {
        id: agent.slug,
        name: agent.name,
        systemPrompt: brainConfig.systemPrompt || '',
        workspace: process.cwd(),
        webOnly: true,
        active: true,
        // Include marketplace agent metadata
        agentId: agent.id,
        instanceId: instance.id,
        capabilities: agent.capabilities || [],
        agentType: agent.agent_type || 'personality'
      };
    });

  fs.writeFileSync(BOTS_JSON_PATH, JSON.stringify(botsConfig, null, 2));
  console.log(`✅ Generated bots.json with ${botsConfig.length} bots`);
}

/**
 * Main initialization
 * Creates only ONE agent instance (the default Claude agent)
 */
async function init() {
  console.log('🚀 Initializing bot for user:', USER_ID);
  console.log('');

  // 1. Fetch the default agent
  console.log('📂 Fetching default agent...');
  const defaultAgent = await getDefaultAgent();
  console.log(`   Found: ${defaultAgent.name} (${defaultAgent.slug})`);
  console.log('');

  // 2. Check if instance already exists
  console.log('🔍 Checking existing agent instances...');
  const existingInstances = await getMyAgents();
  const existingSlugs = new Set(existingInstances.map(i => i.instance_slug));
  console.log(`   Found ${existingInstances.length} existing instances`);
  console.log('');

  // 3. Create instance for default agent if it doesn't exist
  console.log('📦 Creating agent instance...');
  let created = 0;
  let skipped = 0;
  let instances = [...existingInstances];

  if (existingSlugs.has(defaultAgent.slug)) {
    console.log(`   ⏭️  Skipped ${defaultAgent.name} (already exists)`);
    skipped++;
  } else {
    try {
      const instance = await createAgentInstance(defaultAgent);
      if (instance) {
        console.log(`   ✅ Created ${defaultAgent.name} (${defaultAgent.slug})`);
        instances.push(instance);
        created++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`   ❌ Failed to create ${defaultAgent.name}:`, err.message);
    }
  }

  console.log('');
  console.log(`📊 Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Total instances: ${instances.length}`);
  console.log('');

  // 4. Generate bots.json with just the default agent
  console.log('📝 Generating bots.json...');
  generateBotsJson([defaultAgent], instances);
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
