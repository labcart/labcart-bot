#!/usr/bin/env node
/**
 * End-to-End Workflow Test
 *
 * Tests the full workflow orchestration loop with local brain files.
 * Does NOT require the server to be running or Supabase connection.
 *
 * What this tests:
 * 1. WorkflowHandler initialization
 * 2. Getting available agents (local brains)
 * 3. Starting a workflow with a goal
 * 4. Orchestrator brain prompt generation
 * 5. Agent list injection
 *
 * Note: Full Claude integration test would require server running.
 */

require('dotenv').config();

const WorkflowHandler = require('./lib/workflow-handler');
const BrainLoader = require('./lib/brain-loader');
const { formatAgentList, parseOrchestratorOutput } = require('./lib/orchestrator-parser');

console.log('=== Workflow E2E Test ===\n');

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${err.message}`);
      if (err.stack) {
        console.log(`   Stack: ${err.stack.split('\n').slice(1, 3).join('\n')}`);
      }
      failed++;
    }
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  // ========== Brain Loading Tests ==========

  console.log('--- Brain Loading Tests ---\n');

  const brainLoader = new BrainLoader();

  await test('Load orchestrator brain', async () => {
    const brain = brainLoader.loadFromFile('orchestrator');
    assert(brain.name === 'Workflow Orchestrator', 'Should have correct name');
    assert(brain.security === false, 'Should have security disabled');
    assert(brain.systemPrompt.includes('{{AVAILABLE_AGENTS}}'), 'Should have placeholder');
  });

  await test('Load echo-agent brain', async () => {
    const brain = brainLoader.loadFromFile('echo-agent');
    assert(brain.name === 'Echo Agent', 'Should have correct name');
    assert(brain.security === false, 'Should be utility agent');
  });

  await test('Load summarizer-agent brain', async () => {
    const brain = brainLoader.loadFromFile('summarizer-agent');
    assert(brain.name === 'Summarizer Agent', 'Should have correct name');
  });

  await test('List all local brains', async () => {
    const brains = brainLoader.listBrains();
    console.log(`   Found brains: ${brains.join(', ')}`);
    assert(brains.includes('orchestrator'), 'Should include orchestrator');
    assert(brains.includes('echo-agent'), 'Should include echo-agent');
  });

  // ========== Workflow Handler Tests ==========

  console.log('\n--- Workflow Handler Tests ---\n');

  const workflowHandler = new WorkflowHandler();

  await test('Get available agents (local mode)', async () => {
    // This will use local brains since no Supabase in test env
    const agents = await workflowHandler.getAvailableAgents('test-user-123');
    console.log(`   Found ${agents.length} agents`);

    // Should have at least our test agents
    assert(agents.length >= 2, 'Should have at least 2 agents');

    const slugs = agents.map(a => a.slug);
    console.log(`   Slugs: ${slugs.join(', ')}`);
    assert(slugs.includes('echo-agent'), 'Should include echo-agent');
    assert(!slugs.includes('orchestrator'), 'Should NOT include orchestrator itself');
  });

  await test('Format agent list for orchestrator', async () => {
    const agents = await workflowHandler.getAvailableAgents('test-user');
    const formatted = formatAgentList(agents);

    console.log(`   Formatted list preview: ${formatted.substring(0, 100)}...`);
    assert(formatted.includes('echo-agent'), 'Should include agent slug');
    assert(formatted.includes('Echo Agent'), 'Should include agent name');
  });

  await test('Build orchestrator prompt with agents', async () => {
    const agents = await workflowHandler.getAvailableAgents('test-user');
    const agentListText = formatAgentList(agents);

    const orchestratorBrain = brainLoader.loadFromFile('orchestrator');
    const injectedPrompt = orchestratorBrain.systemPrompt.replace(
      '{{AVAILABLE_AGENTS}}',
      agentListText
    );

    assert(!injectedPrompt.includes('{{AVAILABLE_AGENTS}}'), 'Placeholder should be replaced');
    assert(injectedPrompt.includes('echo-agent'), 'Should contain agent slug');
    assert(injectedPrompt.includes('You are a Workflow Orchestrator'), 'Should have orchestrator instructions');
  });

  // ========== Mock Orchestrator Response Tests ==========

  console.log('\n--- Mock Response Parsing Tests ---\n');

  await test('Parse mock plan response', async () => {
    // Simulate what the orchestrator would return
    const mockPlanResponse = `{
      "type": "plan",
      "goal": "Summarize a topic and echo the result",
      "steps": [
        {"step": 1, "agent": "summarizer-agent", "task": "Summarize the topic", "depends_on": []},
        {"step": 2, "agent": "echo-agent", "task": "Echo the summary back", "depends_on": [1]}
      ],
      "message": "I'll help you with that. Here's my plan:\\n\\n1. Use Summarizer Agent to create a summary\\n2. Use Echo Agent to confirm the result\\n\\nShall I proceed?"
    }`;

    const parsed = parseOrchestratorOutput(mockPlanResponse);
    assert(parsed.success, 'Should parse successfully');
    assert(parsed.command.type === 'plan', 'Should be plan type');
    assert(parsed.command.steps.length === 2, 'Should have 2 steps');
    assert(parsed.command.steps[0].agent === 'summarizer-agent', 'First step should use summarizer');
    assert(parsed.command.steps[1].depends_on[0] === 1, 'Second step should depend on first');
  });

  await test('Parse mock delegate response', async () => {
    const mockDelegateResponse = `\`\`\`json
{
  "type": "delegate",
  "step": 1,
  "agent": "summarizer-agent",
  "input": {
    "task": "Summarize the concept of renewable energy",
    "format": "structured JSON with key points"
  },
  "message": "Starting step 1: Summarizing the topic..."
}
\`\`\``;

    const parsed = parseOrchestratorOutput(mockDelegateResponse);
    assert(parsed.success, 'Should parse from code block');
    assert(parsed.command.type === 'delegate', 'Should be delegate type');
    assert(parsed.command.agent === 'summarizer-agent', 'Should target summarizer');
    assert(parsed.command.input.task.includes('renewable energy'), 'Should have task');
  });

  await test('Parse mock complete response', async () => {
    const mockCompleteResponse = `{
      "type": "complete",
      "summary": "Successfully summarized the topic and echoed the result",
      "outputs": {
        "summary": "Renewable energy includes solar, wind, and hydro power...",
        "confirmation": "Echo Agent confirmed the summary"
      },
      "message": "Workflow complete! Here's what was accomplished:\\n\\n- Created a summary of renewable energy\\n- Confirmed the output via Echo Agent"
    }`;

    const parsed = parseOrchestratorOutput(mockCompleteResponse);
    assert(parsed.success, 'Should parse successfully');
    assert(parsed.command.type === 'complete', 'Should be complete type');
    assert(parsed.command.outputs.summary.includes('solar'), 'Should have output data');
  });

  // ========== WorkflowHandler Lifecycle Tests ==========

  console.log('\n--- Workflow Lifecycle Tests ---\n');

  await test('Create workflow state', async () => {
    // Test that workflow handler properly initializes
    assert(workflowHandler.activeWorkflows instanceof Map, 'Should have activeWorkflows map');
    assert(typeof workflowHandler.startWorkflow === 'function', 'Should have startWorkflow');
    assert(typeof workflowHandler.executeWorkflow === 'function', 'Should have executeWorkflow');
  });

  await test('Event emitter functionality', async () => {
    let eventFired = false;

    workflowHandler.on('test-event', () => {
      eventFired = true;
    });

    workflowHandler.emit('test-event');
    assert(eventFired, 'Should fire events');
  });

  await test('Format worker task', async () => {
    const input = {
      task: 'Summarize this topic',
      context: 'Previous step found: key data points',
      format: 'JSON'
    };

    const formatted = workflowHandler.formatWorkerTask(input);
    assert(formatted.includes('Summarize this topic'), 'Should include task');
    assert(formatted.includes('Previous step found'), 'Should include context');
    assert(formatted.includes('JSON'), 'Should include format');
  });

  await test('Format worker result', async () => {
    const result = workflowHandler.formatWorkerResult(1, 'echo-agent', 'Test output');
    assert(result.includes('Step 1'), 'Should include step number');
    assert(result.includes('echo-agent'), 'Should include agent name');
    assert(result.includes('Test output'), 'Should include result');
    assert(result.includes('next action'), 'Should prompt for next action');
  });

  // ========== Summary ==========

  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  if (failed > 0) {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All E2E tests passed!');
    console.log('\nNote: To test with real Claude calls, start the server and use:');
    console.log('  curl -X POST http://localhost:3010/workflow/start \\');
    console.log('    -H "Content-Type: application/json" \\');
    console.log('    -d \'{"userId": "test-user", "goal": "Summarize AI trends"}\'');
  }
}

runTests().catch(err => {
  console.error('❌ Test runner failed:', err);
  process.exit(1);
});
