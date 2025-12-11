/**
 * Orchestrator Parser
 *
 * Parses JSON output from the orchestrator brain.
 * Handles various formats (raw JSON, code blocks, etc.)
 * and validates command structure.
 */

/**
 * Valid command types that orchestrator can emit
 */
const VALID_COMMAND_TYPES = ['plan', 'delegate', 'complete', 'clarify', 'continue', 'discovery'];

/**
 * Valid step types within a plan
 */
const VALID_STEP_TYPES = ['create', 'delegate', 'action'];

/**
 * Required fields for each command type
 */
const REQUIRED_FIELDS = {
  plan: ['goal', 'steps', 'message'],
  delegate: ['step', 'agent', 'input', 'message'],
  complete: ['summary', 'message'],
  clarify: ['question', 'message'],
  continue: ['message'],
  discovery: ['questions', 'message']
};

/**
 * Parse orchestrator output and extract JSON command
 *
 * Handles:
 * - Raw JSON objects
 * - JSON in markdown code blocks (```json ... ```)
 * - JSON in generic code blocks (``` ... ```)
 * - JSON with surrounding text
 *
 * @param {string} output - Raw output from orchestrator
 * @returns {Object} { success: boolean, command?: Object, error?: string }
 */
function parseOrchestratorOutput(output) {
  if (!output || typeof output !== 'string') {
    return { success: false, error: 'Empty or invalid output' };
  }

  let jsonText = output.trim();

  // Try to extract JSON from code blocks first
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim();
  } else {
    // Try to find raw JSON object in the text
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }
  }

  // Attempt to parse JSON
  let command;
  try {
    command = JSON.parse(jsonText);
  } catch (parseError) {
    // Try to fix common JSON issues
    try {
      // Replace single quotes with double quotes
      const fixed = jsonText.replace(/'/g, '"');
      command = JSON.parse(fixed);
    } catch (fixError) {
      return {
        success: false,
        error: `Invalid JSON: ${parseError.message}`,
        rawText: output.substring(0, 500)
      };
    }
  }

  // Validate command structure
  const validation = validateCommand(command);
  if (!validation.valid) {
    return { success: false, error: validation.error, command };
  }

  return { success: true, command };
}

/**
 * Validate command structure
 *
 * @param {Object} command - Parsed command object
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateCommand(command) {
  if (!command || typeof command !== 'object') {
    return { valid: false, error: 'Command must be an object' };
  }

  if (!command.type) {
    return { valid: false, error: 'Command missing "type" field' };
  }

  if (!VALID_COMMAND_TYPES.includes(command.type)) {
    return {
      valid: false,
      error: `Invalid command type "${command.type}". Valid types: ${VALID_COMMAND_TYPES.join(', ')}`
    };
  }

  // Check required fields for this command type
  const required = REQUIRED_FIELDS[command.type] || [];
  const missing = required.filter(field => command[field] === undefined);

  if (missing.length > 0) {
    return {
      valid: false,
      error: `Command type "${command.type}" missing required fields: ${missing.join(', ')}`
    };
  }

  // Additional validation for specific command types
  if (command.type === 'plan') {
    if (!Array.isArray(command.steps)) {
      return { valid: false, error: 'Plan "steps" must be an array' };
    }

    for (let i = 0; i < command.steps.length; i++) {
      const step = command.steps[i];

      // Validate step_type first
      if (!step.step_type) {
        return {
          valid: false,
          error: `Step ${i + 1} missing required field "step_type" (must be "create", "delegate", or "action")`
        };
      }

      if (!VALID_STEP_TYPES.includes(step.step_type)) {
        return {
          valid: false,
          error: `Step ${i + 1} has invalid step_type "${step.step_type}". Must be: ${VALID_STEP_TYPES.join(', ')}`
        };
      }

      // Basic field "step" required for all steps
      if (!step.step) {
        return {
          valid: false,
          error: `Step ${i + 1} missing required "step" field`
        };
      }

      // For action steps, require "action" field (task is optional, action name is the task)
      if (step.step_type === 'action') {
        if (!step.action) {
          return {
            valid: false,
            error: `Step ${i + 1} is an "action" step but missing "action" field`
          };
        }
        // params is optional but should be an object if present
        if (step.params && typeof step.params !== 'object') {
          return {
            valid: false,
            error: `Step ${i + 1} "params" must be an object`
          };
        }
      } else {
        // For create and delegate steps, require "agent" and "task" fields
        if (!step.agent) {
          return {
            valid: false,
            error: `Step ${i + 1} is a "${step.step_type}" step but missing "agent" field`
          };
        }
        if (!step.task) {
          return {
            valid: false,
            error: `Step ${i + 1} is a "${step.step_type}" step but missing "task" field`
          };
        }
      }

      // For create steps, validate agent_config
      if (step.step_type === 'create') {
        if (!step.agent_config) {
          return {
            valid: false,
            error: `Step ${i + 1} is a "create" step but missing "agent_config"`
          };
        }

        const config = step.agent_config;
        if (!config.name || typeof config.name !== 'string') {
          return {
            valid: false,
            error: `Step ${i + 1} agent_config missing or invalid "name"`
          };
        }

        if (!config.system_prompt || typeof config.system_prompt !== 'string' || config.system_prompt.length < 10) {
          return {
            valid: false,
            error: `Step ${i + 1} agent_config missing or invalid "system_prompt" (must be at least 10 characters)`
          };
        }
      }
    }
  }

  if (command.type === 'delegate') {
    if (typeof command.step !== 'number') {
      return { valid: false, error: 'Delegate "step" must be a number' };
    }

    if (typeof command.agent !== 'string') {
      return { valid: false, error: 'Delegate "agent" must be a string' };
    }
  }

  return { valid: true };
}

/**
 * Format agent list for injection into orchestrator prompt
 *
 * @param {Array} agents - List of available agents
 * @returns {string} Formatted agent list text
 */
function formatAgentList(agents) {
  if (!agents || agents.length === 0) {
    return 'No agents available.';
  }

  const lines = agents.map(agent => {
    let line = `- **${agent.slug}** (${agent.name})`;

    if (agent.description) {
      line += `\n  ${agent.description}`;
    }

    if (agent.tags && agent.tags.length > 0) {
      line += `\n  Tags: ${agent.tags.join(', ')}`;
    }

    return line;
  });

  return lines.join('\n\n');
}

/**
 * Format workflow result for display
 *
 * @param {Object} result - Workflow result object
 * @returns {string} Human-readable result text
 */
function formatWorkflowResult(result) {
  if (!result) {
    return 'No result available.';
  }

  let text = '';

  if (result.summary) {
    text += `**Summary:** ${result.summary}\n\n`;
  }

  if (result.message) {
    text += result.message;
  }

  if (result.outputs && Object.keys(result.outputs).length > 0) {
    text += '\n\n**Outputs:**\n';
    for (const [key, value] of Object.entries(result.outputs)) {
      text += `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}\n`;
    }
  }

  return text;
}

/**
 * Format plan for display to user
 *
 * @param {Object} plan - Plan object from orchestrator
 * @returns {string} Human-readable plan text
 */
function formatPlanForDisplay(plan) {
  if (!plan || !plan.steps) {
    return 'No plan available.';
  }

  let text = `**Goal:** ${plan.goal}\n\n`;
  text += '**Steps:**\n';

  for (const step of plan.steps) {
    const deps = step.depends_on && step.depends_on.length > 0
      ? ` (depends on: ${step.depends_on.join(', ')})`
      : '';

    text += `${step.step}. **${step.agent}**: ${step.task}${deps}\n`;
  }

  if (plan.message) {
    text += `\n${plan.message}`;
  }

  return text;
}

/**
 * Extract text-only message from command
 * Used when we just want to show the human-readable part
 *
 * @param {Object} command - Parsed command
 * @returns {string} Human-readable message
 */
function extractMessage(command) {
  if (!command) {
    return '';
  }

  return command.message || '';
}

module.exports = {
  parseOrchestratorOutput,
  validateCommand,
  formatAgentList,
  formatWorkflowResult,
  formatPlanForDisplay,
  extractMessage,
  VALID_COMMAND_TYPES,
  VALID_STEP_TYPES,
  REQUIRED_FIELDS
};
