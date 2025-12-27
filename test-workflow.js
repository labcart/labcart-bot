#!/usr/bin/env node
/**
 * Test script for workflow orchestration
 *
 * Tests:
 * 1. Orchestrator parser (JSON parsing)
 * 2. Workflow handler initialization
 * 3. Agent list formatting
 */

const {
  parseOrchestratorOutput,
  validateCommand,
  formatAgentList,
  formatPlanForDisplay
} = require('./lib/orchestrator-parser');

console.log('=== Workflow System Tests ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ========== Parser Tests ==========

console.log('\n--- Orchestrator Parser Tests ---\n');

test('Parse raw JSON plan command', () => {
  const input = `{
    "type": "plan",
    "goal": "Write an article",
    "steps": [
      {"step": 1, "agent": "writer", "task": "Write draft", "depends_on": []}
    ],
    "message": "Here's my plan"
  }`;

  const result = parseOrchestratorOutput(input);
  assert(result.success, 'Should parse successfully');
  assert(result.command.type === 'plan', 'Type should be plan');
  assert(result.command.steps.length === 1, 'Should have 1 step');
});

test('Parse JSON in code block', () => {
  const input = `Here's my plan:
\`\`\`json
{
  "type": "plan",
  "goal": "Test goal",
  "steps": [{"step": 1, "agent": "test", "task": "Do something", "depends_on": []}],
  "message": "Testing"
}
\`\`\``;

  const result = parseOrchestratorOutput(input);
  assert(result.success, 'Should parse JSON from code block');
  assert(result.command.type === 'plan', 'Type should be plan');
});

test('Parse delegate command', () => {
  const input = `{
    "type": "delegate",
    "step": 1,
    "agent": "research-agent",
    "input": {"task": "Research AI trends"},
    "message": "Starting research..."
  }`;

  const result = parseOrchestratorOutput(input);
  assert(result.success, 'Should parse delegate');
  assert(result.command.type === 'delegate', 'Type should be delegate');
  assert(result.command.agent === 'research-agent', 'Agent should match');
});

test('Parse complete command', () => {
  const input = `{
    "type": "complete",
    "summary": "Article written successfully",
    "outputs": {"article": "Content here..."},
    "message": "Done!"
  }`;

  const result = parseOrchestratorOutput(input);
  assert(result.success, 'Should parse complete');
  assert(result.command.type === 'complete', 'Type should be complete');
});

test('Parse clarify command', () => {
  const input = `{
    "type": "clarify",
    "question": "What tone do you want?",
    "message": "I need more info"
  }`;

  const result = parseOrchestratorOutput(input);
  assert(result.success, 'Should parse clarify');
  assert(result.command.question === 'What tone do you want?', 'Question should match');
});

test('Reject invalid JSON', () => {
  const input = 'This is not JSON at all';
  const result = parseOrchestratorOutput(input);
  assert(!result.success, 'Should fail on invalid JSON');
});

test('Reject missing required fields', () => {
  const input = `{"type": "plan", "goal": "Test"}`;  // missing steps and message
  const result = parseOrchestratorOutput(input);
  assert(!result.success, 'Should fail on missing fields');
});

test('Reject invalid command type', () => {
  const input = `{"type": "invalid_type", "message": "Test"}`;
  const result = parseOrchestratorOutput(input);
  assert(!result.success, 'Should fail on invalid type');
});

// ========== Format Tests ==========

console.log('\n--- Formatting Tests ---\n');

test('Format agent list', () => {
  const agents = [
    { slug: 'writer', name: 'Writer Agent', description: 'Writes content', tags: ['writing'] },
    { slug: 'researcher', name: 'Research Agent', description: 'Does research' }
  ];

  const formatted = formatAgentList(agents);
  assert(formatted.includes('**writer**'), 'Should include writer slug');
  assert(formatted.includes('Writer Agent'), 'Should include writer name');
  assert(formatted.includes('writing'), 'Should include tags');
});

test('Format empty agent list', () => {
  const formatted = formatAgentList([]);
  assert(formatted === 'No agents available.', 'Should handle empty list');
});

test('Format plan for display', () => {
  const plan = {
    goal: 'Write article',
    steps: [
      { step: 1, agent: 'research', task: 'Research topic', depends_on: [] },
      { step: 2, agent: 'writer', task: 'Write draft', depends_on: [1] }
    ],
    message: 'Plan ready'
  };

  const formatted = formatPlanForDisplay(plan);
  assert(formatted.includes('Write article'), 'Should include goal');
  assert(formatted.includes('research'), 'Should include agent names');
  assert(formatted.includes('depends on: 1'), 'Should show dependencies');
});

// ========== Workflow Handler Tests ==========

console.log('\n--- Workflow Handler Tests ---\n');

test('WorkflowHandler can be imported', () => {
  const WorkflowHandler = require('./lib/workflow-handler');
  assert(typeof WorkflowHandler === 'function', 'Should be a class');
});

test('WorkflowHandler can be instantiated', () => {
  const WorkflowHandler = require('./lib/workflow-handler');
  const handler = new WorkflowHandler();
  assert(handler !== null, 'Should create instance');
  assert(typeof handler.startWorkflow === 'function', 'Should have startWorkflow method');
  assert(typeof handler.executeWorkflow === 'function', 'Should have executeWorkflow method');
});

test('WorkflowHandler is an EventEmitter', () => {
  const WorkflowHandler = require('./lib/workflow-handler');
  const handler = new WorkflowHandler();
  assert(typeof handler.on === 'function', 'Should have on method');
  assert(typeof handler.emit === 'function', 'Should have emit method');
});

// ========== Summary ==========

console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!\n');
}
