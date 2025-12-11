/**
 * Test: Will the orchestrator autonomously create agents on its own?
 *
 * This test gives a goal that DOESN'T explicitly ask for agent creation
 * but would benefit from a specialized "harsh investor" persona.
 */

require('dotenv').config();
const WorkflowHandler = require('./lib/workflow-handler');

async function test() {
  const handler = new WorkflowHandler();

  // Goal that DOESN'T mention creating agents - just asks for a complex task
  // that would benefit from a specialized agent
  const goal = `Write a product pitch for a smart water bottle,
then have it critiqued by a harsh skeptical investor persona,
then revise based on the feedback`;

  console.log('='.repeat(60));
  console.log('TEST: Will orchestrator autonomously create agents?');
  console.log('='.repeat(60));
  console.log('\nGoal (does NOT mention creating agents):');
  console.log(goal);
  console.log('\nAvailable agents: Only "claude" (general AI)');
  console.log('---');

  const workflow = await handler.startWorkflow({
    userId: 'autonomous-test',
    goal: goal,
    availableAgents: [
      { slug: 'claude', name: 'Claude', description: 'General purpose AI assistant' }
    ]
  });

  console.log('\nWorkflow Status:', workflow.status);
  console.log('\nPlan returned by orchestrator:');
  console.log(JSON.stringify(workflow.plan, null, 2));

  // Check if plan includes create_agent
  const steps = workflow.plan?.steps || [];
  const createAgentSteps = steps.filter(s =>
    s.agent === 'create_agent' ||
    s.task?.toLowerCase().includes('create') && s.task?.toLowerCase().includes('agent')
  );

  console.log('\n' + '='.repeat(60));
  console.log('ANALYSIS');
  console.log('='.repeat(60));
  console.log('\nTotal steps:', steps.length);
  console.log('Steps with create_agent:', createAgentSteps.length);

  if (createAgentSteps.length > 0) {
    console.log('\n✅ YES - Orchestrator AUTONOMOUSLY decided to create agents:');
    createAgentSteps.forEach(s => {
      console.log(`   Step ${s.step}: ${s.task}`);
    });
  } else {
    console.log('\n❌ NO - Orchestrator did NOT autonomously create agents');
    console.log('\nSteps planned:');
    steps.forEach(s => {
      console.log(`   Step ${s.step} [${s.agent}]: ${s.task}`);
    });
  }
}

test().catch(err => {
  console.error('Test error:', err.message);
  process.exit(1);
});
