/**
 * Add AVAILABLE TOOLS section to all marketplace agents
 *
 * Run: node scripts/add-tools-to-agents.js
 */

const supabase = require('../lib/supabase-client');

const TOOLS_SECTION = `

AVAILABLE TOOLS:
You have access to powerful tools: web search, file operations (read/write/edit), bash commands, and code execution. Use these when appropriate to help the user accomplish their goals.`;

async function addToolsToAgents() {
  console.log('Fetching marketplace agents...\n');

  const { data: agents, error } = await supabase
    .from('marketplace_agents')
    .select('id, slug, name, brain_config')
    .order('name');

  if (error) {
    console.error('Error fetching agents:', error);
    process.exit(1);
  }

  console.log(`Found ${agents.length} agents\n`);

  let updated = 0;
  let skipped = 0;

  for (const agent of agents) {
    const currentPrompt = agent.brain_config?.systemPrompt || '';

    // Skip if already has tools section
    if (currentPrompt.includes('AVAILABLE TOOLS')) {
      console.log(`⏭️  ${agent.name}: Already has tools section, skipping`);
      skipped++;
      continue;
    }

    // Add tools section to end of systemPrompt
    const newPrompt = currentPrompt.trim() + TOOLS_SECTION;

    // Update brain_config with new systemPrompt
    const newBrainConfig = {
      ...agent.brain_config,
      systemPrompt: newPrompt
    };

    const { error: updateError } = await supabase
      .from('marketplace_agents')
      .update({ brain_config: newBrainConfig })
      .eq('id', agent.id);

    if (updateError) {
      console.error(`❌ ${agent.name}: Failed to update -`, updateError.message);
    } else {
      console.log(`✅ ${agent.name}: Added tools section`);
      updated++;
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total: ${agents.length}`);
}

addToolsToAgents().catch(console.error);
