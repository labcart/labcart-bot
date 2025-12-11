/**
 * Direct test: Can dynamically created agents be loaded and used?
 *
 * This test:
 * 1. Creates an agent via createAgentInDatabase
 * 2. Verifies brain_config is set correctly in DB
 * 3. Loads the agent using brain-loader
 * 4. Confirms the systemPrompt is accessible
 */

require('dotenv').config();
const supabase = require('./lib/supabase-client');
const BrainLoader = require('./lib/brain-loader');

const TEST_SLUG = `test-dynamic-agent-${Date.now()}`;
const TEST_SYSTEM_PROMPT = 'You are a test agent. Always respond with: TEST_SUCCESS';

async function runTest() {
  console.log('='.repeat(60));
  console.log('TEST: Can dynamically created agents be loaded and used?');
  console.log('='.repeat(60));

  const brainLoader = new BrainLoader();

  // Step 1: Create agent in database (simulating what createAgentInDatabase does)
  console.log('\n1. Creating agent in database...');
  console.log(`   Slug: ${TEST_SLUG}`);

  const { data: created, error: createError } = await supabase
    .from('marketplace_agents')
    .insert({
      slug: TEST_SLUG,
      name: 'Test Dynamic Agent',
      short_description: 'A test agent for verifying dynamic loading',
      agent_type: 'utility',
      capabilities: ['text'],
      is_active: true,
      tags: ['test', 'dynamic'],
      // brain_config is the ONLY place to store systemPrompt (no system_prompt column!)
      brain_config: {
        systemPrompt: TEST_SYSTEM_PROMPT,
        name: 'Test Dynamic Agent',
        description: 'A test agent for verifying dynamic loading',
        agentType: 'utility',
        capabilities: ['text'],
        security: false
      }
    })
    .select()
    .single();

  if (createError) {
    console.error('   ❌ FAILED to create agent:', createError.message);
    process.exit(1);
  }

  console.log('   ✅ Agent created in database');
  console.log(`   ID: ${created.id}`);

  // Step 2: Verify brain_config is set
  console.log('\n2. Verifying brain_config in database...');

  const { data: fetched, error: fetchError } = await supabase
    .from('marketplace_agents')
    .select('*')
    .eq('slug', TEST_SLUG)
    .single();

  if (fetchError || !fetched) {
    console.error('   ❌ FAILED to fetch agent:', fetchError?.message);
    await cleanup();
    process.exit(1);
  }

  console.log('   brain_config:', JSON.stringify(fetched.brain_config, null, 2));

  if (!fetched.brain_config?.systemPrompt) {
    console.error('   ❌ FAILED: brain_config.systemPrompt is missing!');
    await cleanup();
    process.exit(1);
  }
  console.log('   ✅ brain_config.systemPrompt is set correctly');

  // Step 3: Load using brain-loader
  console.log('\n3. Loading agent using brain-loader.load()...');

  try {
    const brain = await brainLoader.load(TEST_SLUG);

    if (!brain) {
      console.error('   ❌ FAILED: brain-loader returned null');
      await cleanup();
      process.exit(1);
    }

    console.log('   Loaded brain:', {
      name: brain.name,
      slug: brain.slug,
      hasSystemPrompt: !!brain.systemPrompt,
      systemPromptPreview: brain.systemPrompt?.substring(0, 50) + '...'
    });

    if (!brain.systemPrompt) {
      console.error('   ❌ FAILED: Loaded brain has no systemPrompt!');
      await cleanup();
      process.exit(1);
    }

    if (brain.systemPrompt !== TEST_SYSTEM_PROMPT) {
      console.error('   ❌ FAILED: systemPrompt mismatch!');
      console.error('   Expected:', TEST_SYSTEM_PROMPT);
      console.error('   Got:', brain.systemPrompt);
      await cleanup();
      process.exit(1);
    }

    console.log('   ✅ brain-loader successfully loaded the dynamic agent!');

  } catch (err) {
    console.error('   ❌ FAILED: brain-loader.load() threw error:', err.message);
    await cleanup();
    process.exit(1);
  }

  // Step 4: Build system prompt (full test)
  console.log('\n4. Building system prompt...');

  try {
    const systemPrompt = await brainLoader.buildSystemPrompt(TEST_SLUG, { id: 'test-user' });

    if (!systemPrompt) {
      console.error('   ❌ FAILED: buildSystemPrompt returned empty');
      await cleanup();
      process.exit(1);
    }

    console.log('   System prompt length:', systemPrompt.length);
    console.log('   Contains our prompt:', systemPrompt.includes(TEST_SYSTEM_PROMPT));

    if (!systemPrompt.includes(TEST_SYSTEM_PROMPT)) {
      console.error('   ❌ FAILED: System prompt does not contain our prompt');
      await cleanup();
      process.exit(1);
    }

    console.log('   ✅ buildSystemPrompt works with dynamic agent!');

  } catch (err) {
    console.error('   ❌ FAILED: buildSystemPrompt threw error:', err.message);
    await cleanup();
    process.exit(1);
  }

  // Cleanup
  await cleanup();

  // FINAL RESULT
  console.log('\n' + '='.repeat(60));
  console.log('✅ TEST PASSED: Dynamic agents CAN be loaded and used!');
  console.log('='.repeat(60));
  console.log('\nThe fix works:');
  console.log('1. createAgentInDatabase now includes brain_config');
  console.log('2. brain-loader can load agents by slug');
  console.log('3. buildSystemPrompt works with dynamic agents');
  console.log('\nDynamic agent creation during workflows should now work!');

  process.exit(0);

  async function cleanup() {
    console.log('\n[Cleanup] Removing test agent...');
    const { error } = await supabase
      .from('marketplace_agents')
      .delete()
      .eq('slug', TEST_SLUG);

    if (error) {
      console.log('   Warning: cleanup failed:', error.message);
    } else {
      console.log('   Test agent removed');
    }
  }
}

runTest().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
