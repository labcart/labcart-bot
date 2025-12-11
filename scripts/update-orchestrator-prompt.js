#!/usr/bin/env node
/**
 * Update orchestrator brain_config in Supabase with the local prompt
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Load the orchestrator brain from local file
  const orchestratorBrain = require('../brains/orchestrator');

  console.log('📝 Updating orchestrator brain_config in Supabase...');
  console.log('   Name:', orchestratorBrain.name);
  console.log('   Prompt length:', orchestratorBrain.systemPrompt.length, 'chars');

  // Update the brain_config
  const { data, error } = await supabase
    .from('marketplace_agents')
    .update({
      brain_config: {
        systemPrompt: orchestratorBrain.systemPrompt,
        name: orchestratorBrain.name,
        version: orchestratorBrain.version,
        security: orchestratorBrain.security,
        maxTokens: orchestratorBrain.maxTokens
      }
    })
    .eq('slug', 'orchestrator')
    .select();

  if (error) {
    console.error('❌ Failed to update:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.error('❌ Orchestrator agent not found in marketplace_agents table');
    console.log('   Creating it...');

    const { data: newAgent, error: insertError } = await supabase
      .from('marketplace_agents')
      .insert({
        slug: 'orchestrator',
        name: orchestratorBrain.name,
        short_description: 'Workflow orchestrator that coordinates multi-agent tasks',
        agent_type: 'system',
        is_active: true,
        brain_config: {
          systemPrompt: orchestratorBrain.systemPrompt,
          name: orchestratorBrain.name,
          version: orchestratorBrain.version,
          security: orchestratorBrain.security,
          maxTokens: orchestratorBrain.maxTokens
        }
      })
      .select();

    if (insertError) {
      console.error('❌ Failed to create:', insertError.message);
      process.exit(1);
    }

    console.log('✅ Created orchestrator agent:', newAgent[0].id);
    return;
  }

  console.log('✅ Updated orchestrator:', data[0].id);
  console.log('   brain_config.systemPrompt length:', data[0].brain_config?.systemPrompt?.length || 0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
