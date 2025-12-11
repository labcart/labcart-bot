/**
 * End-to-end test: Workflow that creates and uses a dynamic agent
 *
 * This test:
 * 1. Starts a workflow with a goal that requires a specialized agent
 * 2. Expects orchestrator to create that agent
 * 3. Expects orchestrator to delegate to the created agent
 * 4. Verifies the workflow completes with output from the dynamic agent
 */

require('dotenv').config();
const WorkflowHandler = require('./lib/workflow-handler');
const supabase = require('./lib/supabase-client');

const TEST_USER_ID = `e2e-test-${Date.now()}`;

async function runTest() {
  console.log('='.repeat(70));
  console.log('E2E TEST: Workflow creates and uses dynamic agent');
  console.log('='.repeat(70));

  const handler = new WorkflowHandler();
  let createdAgentSlug = null;

  // Track events
  const events = [];
  handler.on('step:complete', (data) => {
    events.push({ type: 'step:complete', data });
    console.log(`\n[EVENT] Step complete:`, data.step);
  });

  handler.on('agent:created', (data) => {
    events.push({ type: 'agent:created', data });
    createdAgentSlug = data.slug;
    console.log(`\n[EVENT] Agent created: ${data.slug} (${data.name})`);
  });

  // The goal: Ask for something that requires creating a specialized agent
  const goal = `Create a "pirate-translator" agent that translates text to pirate speak,
then use that agent to translate this phrase: "Hello, the weather is nice today"`;

  console.log('\n1. Starting workflow...');
  console.log(`   User ID: ${TEST_USER_ID}`);
  console.log(`   Goal: ${goal.substring(0, 80)}...`);

  try {
    const workflow = await handler.startWorkflow({
      userId: TEST_USER_ID,
      goal: goal,
      availableAgents: [
        {
          slug: 'claude',
          name: 'Claude (General AI)',
          description: 'General purpose AI assistant'
        }
      ]
    }, (event, data) => {
      console.log(`   [Progress] ${event}:`, JSON.stringify(data).substring(0, 100));
    });

    console.log('\n2. Workflow started');
    console.log(`   Workflow ID: ${workflow.id}`);
    console.log(`   Status: ${workflow.status}`);

    // The orchestrator should return a plan that includes create_agent
    if (workflow.plan) {
      console.log('\n   Plan:');
      console.log('   ' + JSON.stringify(workflow.plan, null, 2).replace(/\n/g, '\n   '));
    }

    // If we need to approve, do it (status can be 'planned' or 'pending_approval')
    if (workflow.status === 'planned' || workflow.status === 'pending_approval') {
      console.log('\n3. Approving workflow...');
      await handler.approveWorkflow(workflow);
      console.log(`   Status after approval: ${workflow.status}`);
    }

    // Wait for workflow to complete
    console.log('\n4. Waiting for workflow completion...');
    let attempts = 0;
    const maxAttempts = 30;

    while (workflow.status !== 'completed' && workflow.status !== 'failed' && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
      console.log(`   [${attempts}] Status: ${workflow.status}, Current step: ${workflow.currentStep || 'N/A'}`);
    }

    // Results
    console.log('\n' + '='.repeat(70));
    console.log('RESULTS');
    console.log('='.repeat(70));

    console.log(`\nWorkflow Status: ${workflow.status}`);
    console.log(`Steps Completed: ${workflow.completedSteps?.length || 0}`);

    if (createdAgentSlug) {
      console.log(`\n✅ Dynamic agent was created: ${createdAgentSlug}`);

      // Verify it exists in DB
      const { data: agent } = await supabase
        .from('marketplace_agents')
        .select('slug, name, brain_config')
        .eq('slug', createdAgentSlug)
        .single();

      if (agent) {
        console.log(`   Agent exists in DB: ✅`);
        console.log(`   Has brain_config: ${agent.brain_config ? '✅' : '❌'}`);
        console.log(`   Has systemPrompt: ${agent.brain_config?.systemPrompt ? '✅' : '❌'}`);
      }
    } else {
      console.log(`\n❌ No dynamic agent was created`);
    }

    // Check step results
    if (workflow.stepResults) {
      console.log('\nStep Results:');
      for (const [step, result] of Object.entries(workflow.stepResults)) {
        console.log(`   Step ${step}: ${JSON.stringify(result).substring(0, 100)}...`);
      }
    }

    // Final output
    if (workflow.result?.outputs) {
      console.log('\nFinal Output:');
      console.log(JSON.stringify(workflow.result.outputs, null, 2));
    }

    // SUCCESS CRITERIA
    console.log('\n' + '='.repeat(70));
    console.log('SUCCESS CRITERIA');
    console.log('='.repeat(70));

    const criteria = {
      'Workflow completed': workflow.status === 'completed',
      'Agent was created': !!createdAgentSlug,
      'Agent used in step': events.some(e =>
        e.type === 'step:complete' &&
        e.data?.agent?.includes(createdAgentSlug)
      )
    };

    let allPassed = true;
    for (const [name, passed] of Object.entries(criteria)) {
      console.log(`${passed ? '✅' : '❌'} ${name}`);
      if (!passed) allPassed = false;
    }

    // Cleanup
    if (createdAgentSlug) {
      console.log('\n[Cleanup] Removing test agent...');
      await supabase.from('marketplace_agents').delete().eq('slug', createdAgentSlug);
    }

    if (allPassed) {
      console.log('\n' + '='.repeat(70));
      console.log('✅ E2E TEST PASSED: Dynamic agent workflow works!');
      console.log('='.repeat(70));
      process.exit(0);
    } else {
      console.log('\n' + '='.repeat(70));
      console.log('❌ E2E TEST FAILED: Some criteria not met');
      console.log('='.repeat(70));
      process.exit(1);
    }

  } catch (err) {
    console.error('\n❌ Test failed with error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runTest();
