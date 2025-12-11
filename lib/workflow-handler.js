const { sendToClaudeSession } = require('./claude-client');
const BrainLoader = require('./brain-loader');
const SessionManager = require('./session-manager');
const { parseOrchestratorOutput, formatAgentList } = require('./orchestrator-parser');
const supabase = require('./supabase-client');
const EventEmitter = require('events');

/**
 * WorkflowHandler
 *
 * Orchestrates multi-agent workflows using the orchestrator brain.
 * Node is the runtime - it invokes, parses, and spawns workers.
 * The orchestrator session is the brain - it decides what to do.
 *
 * Flow:
 * 1. User sends goal to workflow
 * 2. Orchestrator creates a plan
 * 3. Node parses plan and asks orchestrator to start
 * 4. Orchestrator delegates to worker agents
 * 5. Node spawns workers, collects results
 * 6. Node injects results back into orchestrator
 * 7. Orchestrator decides next steps
 * 8. Loop until complete
 */
class WorkflowHandler extends EventEmitter {
  constructor() {
    super();
    this.brainLoader = new BrainLoader();
    this.sessionManager = new SessionManager();
    this.activeWorkflows = new Map(); // workflowId -> workflow state
  }

  // ==========================================================================
  // Database Persistence Methods
  // ==========================================================================

  /**
   * Save workflow to database
   */
  async persistWorkflow(workflow) {
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('workflows')
        .upsert({
          id: workflow.id,
          user_id: workflow.userId,
          goal: workflow.goal,
          status: workflow.status,
          plan: workflow.plan,
          current_step: workflow.currentStep,
          orchestrator_session_id: workflow.orchestratorSessionId,
          discovery_answers: workflow.discoveryAnswers,
          error: workflow.error,
          completed_at: workflow.completedAt
        }, { onConflict: 'id' });

      if (error) {
        console.error('Failed to persist workflow:', error.message);
      }
    } catch (err) {
      console.error('Error persisting workflow:', err.message);
    }
  }

  /**
   * Save workflow step to database
   */
  async persistStep(workflow, stepData) {
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('workflow_steps')
        .upsert({
          workflow_id: workflow.id,
          step_num: stepData.stepNum,
          agent_slug: stepData.agentSlug || stepData.action || 'action',  // Default for action steps
          task: stepData.task,
          status: stepData.status,
          input: stepData.input,
          output: stepData.output,
          agent_session_id: stepData.sessionId,
          started_at: stepData.startedAt,
          completed_at: stepData.completedAt,
          error: stepData.error
        }, { onConflict: 'workflow_id,step_num' });

      if (error) {
        console.error('Failed to persist step:', error.message);
      }
    } catch (err) {
      console.error('Error persisting step:', err.message);
    }
  }

  /**
   * Load interrupted workflows from database on startup
   * Only loads workflows that were actively executing when server stopped.
   * 'planned' status = waiting for user approval (not interrupted)
   */
  async loadInterruptedWorkflows() {
    if (!supabase) return [];

    try {
      // Only 'executing' workflows were truly interrupted
      // 'planned' workflows are just waiting for approval - leave them alone
      // 'discovery' workflows are waiting for user input - leave them alone
      const { data, error } = await supabase
        .from('workflows')
        .select('*')
        .eq('status', 'executing');

      if (error) {
        console.error('Failed to load interrupted workflows:', error.message);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('Error loading interrupted workflows:', err.message);
      return [];
    }
  }

  /**
   * Load steps for a workflow
   */
  async loadWorkflowSteps(workflowId) {
    if (!supabase) return [];

    try {
      const { data, error } = await supabase
        .from('workflow_steps')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('step_num', { ascending: true });

      if (error) {
        console.error('Failed to load workflow steps:', error.message);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('Error loading workflow steps:', err.message);
      return [];
    }
  }

  /**
   * Recover interrupted workflows on startup
   *
   * This method should be called when the server starts to resume
   * any workflows that were interrupted by a crash or restart.
   *
   * Note: For now, we mark them as failed. Full resume would require
   * reconstructing the orchestrator session context.
   */
  async recoverInterruptedWorkflows() {
    const interrupted = await this.loadInterruptedWorkflows();

    if (interrupted.length === 0) {
      console.log('No interrupted workflows to recover');
      return;
    }

    console.log(`Found ${interrupted.length} interrupted workflow(s)`);

    for (const wf of interrupted) {
      console.log(`  - ${wf.id}: status=${wf.status}, step=${wf.current_step}`);

      // For now, mark as failed with recovery note
      // Full resume would require:
      // 1. Loading orchestrator session from Claude session file
      // 2. Reconstructing workflow state
      // 3. Resuming execution loop
      await supabase
        .from('workflows')
        .update({
          status: 'failed',
          error: 'Workflow interrupted by server restart. Manual restart required.',
          updated_at: new Date().toISOString()
        })
        .eq('id', wf.id);

      this.emit('workflow:recovered', {
        workflowId: wf.id,
        previousStatus: wf.status,
        newStatus: 'failed'
      });
    }

    console.log('Interrupted workflows marked for manual review');
  }

  /**
   * Start a new workflow with a user goal
   *
   * @param {Object} options - Workflow options
   * @param {string} options.userId - User ID (Telegram or anonymous)
   * @param {string} options.goal - User's goal/request
   * @param {Function} options.onProgress - Progress callback (type, data)
   * @returns {Promise<Object>} Workflow result
   */
  async startWorkflow(options) {
    const { userId, goal, onProgress } = options;

    const workflowId = `workflow-${userId}-${Date.now()}`;
    const workflow = {
      id: workflowId,
      userId,
      goal,
      status: 'starting',
      orchestratorSessionId: null,
      plan: null,
      currentStep: 0,
      workerSessions: new Map(), // step -> { sessionId, agentSlug, result }
      startedAt: new Date().toISOString()
    };

    this.activeWorkflows.set(workflowId, workflow);

    // Persist initial workflow state
    await this.persistWorkflow(workflow);

    try {
      // Step 1: Get available agents for this user
      const availableAgents = await this.getAvailableAgents(userId);

      if (availableAgents.length === 0) {
        throw new Error('No agents available for workflow. Add some agents first.');
      }

      // Step 2: Build orchestrator system prompt with agent list AND actions
      const agentListText = formatAgentList(availableAgents);
      const actionsText = this.getAvailableActionsText();
      const orchestratorBrain = await this.brainLoader.load('orchestrator');

      // brain-loader throws if missing - this is a defensive check
      if (!orchestratorBrain.systemPrompt) {
        throw new Error('Orchestrator agent missing systemPrompt. Update brain_config in marketplace_agents table.');
      }

      // Inject both agents AND actions documentation
      const systemPrompt = orchestratorBrain.systemPrompt.replace(
        '{{AVAILABLE_AGENTS}}',
        agentListText + '\n\n' + actionsText
      );

      // Step 3: Create orchestrator session
      workflow.status = 'planning';
      this.emit('workflow:status', { workflowId, status: 'planning' });

      if (onProgress) {
        onProgress('status', { phase: 'planning', message: 'Creating workflow plan...' });
      }

      // Send goal to orchestrator
      const planResponse = await this.sendToOrchestrator({
        message: goal,
        systemPrompt,
        workflow
      });

      // Step 4: Parse orchestrator response (with retry on JSON errors)
      const parsed = await this.parseWithRetry(planResponse, workflow);
      const command = parsed.command;

      // Handle initial response (should be 'plan', 'discovery', 'clarify', or 'complete' for trivial tasks)

      // Discovery response - orchestrator needs multiple inputs for complex tasks
      if (command.type === 'discovery') {
        workflow.status = 'discovery';
        workflow.pendingQuestions = command.questions;
        await this.persistWorkflow(workflow);
        return {
          workflowId,
          status: 'needs_discovery',
          questions: command.questions,
          message: command.message
        };
      }

      // Clarify response - orchestrator needs a single piece of info
      if (command.type === 'clarify') {
        workflow.status = 'waiting_for_input';
        await this.persistWorkflow(workflow);
        return {
          workflowId,
          status: 'needs_clarification',
          question: command.question,
          message: command.message
        };
      }

      // Handle immediate completion (trivial tasks that don't need agents)
      if (command.type === 'complete') {
        workflow.status = 'completed';
        workflow.result = command;
        workflow.completedAt = new Date().toISOString();
        await this.persistWorkflow(workflow);

        this.emit('workflow:complete', {
          workflowId,
          result: command
        });

        return {
          workflowId,
          status: 'completed',
          result: command.result || command.summary,
          message: command.message
        };
      }

      // Handle immediate agent creation (orchestrator wants to create an agent first)
      if (command.type === 'create_agent') {
        workflow.status = 'executing';
        workflow.plan = {
          type: 'plan',
          goal: goal,
          steps: [{ step: 1, agent: 'create_agent', task: 'Create dynamic agent' }],
          message: 'Auto-executing agent creation workflow'
        };

        // Create the agent
        await this.handleCreateAgent(workflow, command, onProgress);

        // Continue execution loop to let orchestrator decide next steps
        return await this.executionLoop(workflow, onProgress);
      }

      // Handle immediate delegation (orchestrator wants to delegate directly)
      if (command.type === 'delegate') {
        workflow.status = 'executing';
        workflow.plan = {
          type: 'plan',
          goal: goal,
          steps: [{ step: 1, agent: command.agent, task: command.input?.task || 'Execute task' }],
          message: 'Auto-executing single-step workflow'
        };

        // Execute the delegation
        await this.handleDelegate(workflow, command, onProgress);

        // Continue execution loop
        return await this.executionLoop(workflow, onProgress);
      }

      if (command.type !== 'plan') {
        throw new Error(`Expected 'plan' response from orchestrator, got '${command.type}'`);
      }

      // Store the plan
      workflow.plan = command;
      workflow.status = 'planned';
      await this.persistWorkflow(workflow);

      if (onProgress) {
        onProgress('plan', {
          goal: command.goal,
          steps: command.steps,
          message: command.message
        });
      }

      // Return plan for user approval (include sessionId for history tracking)
      return {
        workflowId,
        status: 'planned',
        plan: command,
        message: command.message,
        sessionId: workflow.orchestratorSessionId
      };

    } catch (error) {
      workflow.status = 'failed';
      workflow.error = error.message;
      await this.persistWorkflow(workflow);
      this.emit('workflow:error', { workflowId, error: error.message });
      throw error;
    }
  }

  /**
   * Load a workflow from the database and reconstruct its in-memory state
   *
   * @param {string} workflowId - Workflow ID to load
   * @returns {Promise<Object|null>} Workflow state or null if not found
   */
  async loadWorkflowFromDatabase(workflowId) {
    if (!supabase) return null;

    try {
      const { data, error } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', workflowId)
        .single();

      if (error || !data) {
        return null;
      }

      // Reconstruct workflow state from database
      const workflow = {
        id: data.id,
        userId: data.user_id,
        goal: data.goal,
        status: data.status,
        orchestratorSessionId: data.orchestrator_session_id,
        plan: data.plan,
        currentStep: data.current_step || 0,
        discoveryAnswers: data.discovery_answers,
        error: data.error,
        workerSessions: new Map(),
        startedAt: data.created_at,
        completedAt: data.completed_at
      };

      return workflow;
    } catch (err) {
      console.error('Error loading workflow from database:', err.message);
      return null;
    }
  }

  /**
   * Execute an approved workflow plan
   *
   * NODE drives execution deterministically based on step_type in the plan.
   * No more asking orchestrator for "next command" - NODE reads the plan and executes.
   *
   * @param {string} workflowId - Workflow ID to execute
   * @param {Function} onProgress - Progress callback
   * @param {Object} options - Execution options
   * @param {Array} options.stepConfigs - Optional user-specified configs for action steps
   * @returns {Promise<Object>} Workflow result
   */
  async executeWorkflow(workflowId, onProgress, options = {}) {
    const { stepConfigs } = options;
    let workflow = this.activeWorkflows.get(workflowId);

    // If not in memory, try to load from database
    if (!workflow) {
      workflow = await this.loadWorkflowFromDatabase(workflowId);
      if (workflow) {
        this.activeWorkflows.set(workflowId, workflow);
        console.log(`📂 Loaded workflow from database: ${workflowId}`);
      }
    }

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (!workflow.plan) {
      throw new Error('Workflow has no plan to execute');
    }

    workflow.status = 'executing';

    // Store user-specified step configs for action steps
    if (stepConfigs && Array.isArray(stepConfigs)) {
      workflow.stepConfigs = new Map();
      for (const config of stepConfigs) {
        workflow.stepConfigs.set(config.stepNumber, config);
      }
      console.log(`📋 [Workflow] Received configs for ${stepConfigs.length} action step(s)`);
    }

    await this.persistWorkflow(workflow);
    this.emit('workflow:status', { workflowId, status: 'executing' });

    try {
      // NODE drives execution deterministically based on step_type
      return await this.executePlanDeterministically(workflow, onProgress);

    } catch (error) {
      workflow.status = 'failed';
      workflow.error = error.message;
      await this.persistWorkflow(workflow);
      this.emit('workflow:error', { workflowId, error: error.message });
      throw error;
    }
  }

  /**
   * Execute plan steps deterministically based on step_type
   *
   * NODE reads the plan and executes each step:
   * - step_type="create": Create agent from agent_config
   * - step_type="delegate": Delegate task to agent
   *
   * @param {Object} workflow - Workflow state
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Final result
   */
  async executePlanDeterministically(workflow, onProgress) {
    const plan = workflow.plan;
    const steps = plan.steps || [];

    if (steps.length === 0) {
      throw new Error('Plan has no steps to execute');
    }

    if (onProgress) {
      onProgress('execution_start', {
        goal: plan.goal,
        totalSteps: steps.length,
        message: `Executing ${steps.length} step(s)...`
      });
    }

    // Track results from each step for context passing
    const stepResults = new Map();

    // Execute steps in order (respecting depends_on)
    for (const step of steps) {
      const stepNum = step.step;
      const stepType = step.step_type || 'delegate'; // Default to delegate for backwards compat
      const agent = step.agent;
      const task = step.task;
      const action = step.action;

      workflow.currentStep = stepNum;

      // Check dependencies
      if (step.depends_on && step.depends_on.length > 0) {
        const missingDeps = step.depends_on.filter(dep => !stepResults.has(dep));
        if (missingDeps.length > 0) {
          throw new Error(`Step ${stepNum} depends on steps [${missingDeps.join(', ')}] which haven't completed`);
        }
      }

      if (onProgress) {
        let progressMessage;
        if (stepType === 'action') {
          progressMessage = `Executing action: ${action}...`;
        } else if (stepType === 'create') {
          progressMessage = `Creating agent "${agent}"...`;
        } else {
          progressMessage = `Delegating to ${agent}...`;
        }

        onProgress('step_start', {
          step: stepNum,
          stepType,
          agent: agent || action,
          task: task || action,
          message: progressMessage
        });
      }

      try {
        let result;

        if (stepType === 'create') {
          // NODE creates agent directly from agent_config
          result = await this.executeCreateStep(workflow, step, onProgress);
        } else if (stepType === 'action') {
          // NODE executes deterministic action directly (no LLM needed)
          // Actions like download_url_to_r2, generate_image, text_to_speech
          result = await this.executeActionStep(workflow, step, stepResults, onProgress);
        } else if (stepType === 'delegate') {
          // NODE delegates to agent
          // Build context from dependent steps
          let context = '';
          if (step.depends_on && step.depends_on.length > 0) {
            for (const depStep of step.depends_on) {
              const depResult = stepResults.get(depStep);
              if (depResult && depResult.output) {
                context += `\n--- Result from Step ${depStep} ---\n${depResult.output}\n`;
              }
            }
          }

          // Pass stepResults so delegate can access action step outputs (e.g., images)
          result = await this.executeDelegateStep(workflow, step, context, stepResults, onProgress);
        } else {
          throw new Error(`Unknown step_type "${stepType}" at step ${stepNum}`);
        }

        stepResults.set(stepNum, result);

        if (onProgress) {
          onProgress('step_complete', {
            step: stepNum,
            stepType,
            agent,
            success: result.success,
            outputPreview: result.output?.substring(0, 200) + '...'
          });
        }

      } catch (error) {
        // Persist step failure
        await this.persistStep(workflow, {
          stepNum,
          agentSlug: agent,
          task,
          status: 'failed',
          error: error.message,
          completedAt: new Date().toISOString()
        });

        throw new Error(`Step ${stepNum} (${agent}) failed: ${error.message}`);
      }
    }

    // All steps complete - mark workflow done
    workflow.status = 'completed';
    workflow.completedAt = new Date().toISOString();
    await this.persistWorkflow(workflow);

    // Build summary from results
    const outputs = {};
    stepResults.forEach((result, stepNum) => {
      outputs[`step_${stepNum}`] = result.output;
    });

    const lastResult = stepResults.get(steps[steps.length - 1].step);

    this.emit('workflow:complete', {
      workflowId: workflow.id,
      result: { outputs, lastResult }
    });

    return {
      workflowId: workflow.id,
      status: 'completed',
      summary: `Completed ${steps.length} step(s) for: ${plan.goal}`,
      outputs,
      message: lastResult?.output || 'Workflow completed successfully.'
    };
  }

  /**
   * Execute a "create" step - create agent from agent_config
   */
  async executeCreateStep(workflow, step, onProgress) {
    const { step: stepNum, agent, agent_config, task } = step;

    if (!agent_config) {
      throw new Error(`Step ${stepNum} is a "create" step but missing agent_config`);
    }

    const { name, description, system_prompt } = agent_config;
    const timestamp = Date.now();

    // Use agent slug from step, generate if needed
    const marketplaceSlug = agent || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const instanceSlug = `${marketplaceSlug}-${timestamp}`;

    const stepStartedAt = new Date().toISOString();

    // Auto-detect judge/evaluator agents and ensure they have structured output requirement
    let finalSystemPrompt = system_prompt;
    const isJudgeAgent = this.isJudgeOrEvaluatorAgent(name, description, system_prompt);

    if (isJudgeAgent && !system_prompt.includes('RESULT:')) {
      console.log(`⚖️  Detected judge agent "${name}" - appending RESULT requirement`);
      finalSystemPrompt = `${system_prompt}

IMPORTANT: After your analysis, you MUST end your response with a structured result in this EXACT format:

RESULT:
{
  "winner": "step_X",
  "winner_asset_url": "<copy the full URL of the winning asset here>",
  "ranking": ["step_X", "step_Y"],
  "reasoning_summary": "One sentence explaining why this won"
}

The RESULT block is MANDATORY - do not skip it.`;
    }

    // Persist step as running
    await this.persistStep(workflow, {
      stepNum,
      agentSlug: marketplaceSlug,
      task,
      status: 'running',
      input: { agent_config },
      startedAt: stepStartedAt
    });

    // Create the agent in database
    const newAgent = await this.createAgentInDatabase({
      userId: workflow.userId,
      workflowId: workflow.id,
      stepNum,
      marketplaceSlug,
      instanceSlug,
      name,
      description: description || `Dynamic agent: ${name}`,
      systemPrompt: finalSystemPrompt,
      agentType: agent_config.agent_type || 'utility',
      capabilities: agent_config.capabilities || ['text']
    });

    // Track in workflow
    if (!workflow.createdAgents) {
      workflow.createdAgents = [];
    }
    workflow.createdAgents.push(newAgent);

    // Persist step as completed
    await this.persistStep(workflow, {
      stepNum,
      agentSlug: marketplaceSlug,
      task,
      status: 'completed',
      input: { agent_config },
      output: `Agent "${name}" created with slug "${marketplaceSlug}"`,
      startedAt: stepStartedAt,
      completedAt: new Date().toISOString()
    });

    this.emit('agent:created', {
      workflowId: workflow.id,
      agent: newAgent
    });

    if (onProgress) {
      onProgress('agent_created', {
        slug: marketplaceSlug,
        instanceSlug,
        name,
        id: newAgent.id,
        instanceId: newAgent.instanceId,
        workflowId: workflow.id
      });
    }

    return {
      success: true,
      type: 'create',
      agent: newAgent,
      output: `Agent "${name}" (${marketplaceSlug}) created and ready for use.`
    };
  }

  /**
   * Execute an "action" step - deterministic operation, Node handles directly
   *
   * No LLM needed - these are predefined operations with explicit parameters.
   * Supported actions:
   *   - download_url_to_r2: Download a URL to R2 storage
   *   - generate_image: Generate an image with DALL-E/etc
   *   - text_to_speech: Convert text to audio
   *
   * @param {Object} workflow - Workflow state
   * @param {Object} step - Step configuration with action and params
   * @param {Map} stepResults - Results from previous steps (for param substitution)
   * @param {Function} onProgress - Progress callback
   */
  async executeActionStep(workflow, step, stepResults, onProgress) {
    const { step: stepNum, action, params, task } = step;
    const stepStartedAt = new Date().toISOString();

    if (!action) {
      throw new Error(`Step ${stepNum} is type "action" but missing "action" field`);
    }

    if (onProgress) {
      onProgress('action_start', {
        step: stepNum,
        action,
        message: `Executing ${action}...`
      });
    }

    // Persist step as running
    await this.persistStep(workflow, {
      stepNum,
      agentSlug: `action:${action}`,
      task: task || action,
      status: 'running',
      input: params,
      startedAt: stepStartedAt
    });

    // Process params - substitute {{step_N.field}} with actual values from previous steps
    const processedParams = this.substituteStepReferences(params || {}, stepResults);

    // Get user-specified config for this step if available
    const userConfig = workflow.stepConfigs?.get(stepNum);
    if (userConfig) {
      console.log(`   ⚙️ Using user config for step ${stepNum}:`, userConfig.config);
    }

    try {
      let result;

      switch (action) {
        case 'download_url_to_r2':
          result = await this.executeDownloadAction(workflow, processedParams);
          break;

        case 'generate_image':
          // DISABLED: Orchestrator should create image-generation agents, not call this action directly
          throw new Error(
            `Action "generate_image" is not available. ` +
            `Create a specialized image-generation agent with MCP image tools instead. ` +
            `Use step_type: "create" with an agent that has image generation capabilities, ` +
            `then step_type: "delegate" to have that agent generate the image.`
          );

        case 'text_to_speech':
          // DISABLED: Orchestrator should create TTS agents, not call this action directly
          throw new Error(
            `Action "text_to_speech" is not available. ` +
            `Create a specialized audio-generation agent with MCP TTS tools instead. ` +
            `Use step_type: "create" with an agent that has TTS capabilities, ` +
            `then step_type: "delegate" to have that agent generate the audio.`
          );

        default:
          throw new Error(`Unknown action "${action}". Only "download_url_to_r2" is supported. For creative work (images, audio), create specialized agents instead.`);
      }

      // Persist step as completed
      await this.persistStep(workflow, {
        stepNum,
        agentSlug: `action:${action}`,
        task: task || action,
        status: 'completed',
        input: params,
        output: JSON.stringify(result),
        startedAt: stepStartedAt,
        completedAt: new Date().toISOString()
      });

      if (onProgress) {
        onProgress('action_complete', {
          step: stepNum,
          action,
          success: result.success,
          result
        });
      }

      return {
        success: true,
        type: 'action',
        action,
        output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        data: result
      };

    } catch (error) {
      // Persist step as failed
      await this.persistStep(workflow, {
        stepNum,
        agentSlug: `action:${action}`,
        task: task || action,
        status: 'failed',
        input: params,
        error: error.message,
        startedAt: stepStartedAt,
        completedAt: new Date().toISOString()
      });

      throw error;
    }
  }

  /**
   * Detect if an agent is a judge/evaluator type based on name, description, and prompt
   * Used to auto-append structured RESULT output requirement
   *
   * @param {string} name - Agent name
   * @param {string} description - Agent description
   * @param {string} systemPrompt - Agent system prompt
   * @returns {boolean} True if this appears to be a judge/evaluator agent
   */
  isJudgeOrEvaluatorAgent(name, description, systemPrompt) {
    const judgeKeywords = [
      'judge', 'evaluator', 'critic', 'compare', 'comparison',
      'pick the best', 'pick the winner', 'pick a winner', 'choose the best',
      'rate', 'rating', 'rank', 'ranking', 'score', 'scoring',
      'evaluate', 'evaluation', 'assess', 'assessment'
    ];

    const textToCheck = `${name} ${description} ${systemPrompt}`.toLowerCase();

    // Check if any keyword appears
    return judgeKeywords.some(keyword => textToCheck.includes(keyword));
  }

  /**
   * Parse structured result from judge/evaluation agent output
   *
   * Looks for the RESULT: block that judge agents output with winner info.
   * Format expected:
   * RESULT:
   * {
   *   "winner": "step_X",
   *   "winner_asset_url": "https://...",
   *   "ranking": ["step_X", "step_Y"],
   *   "reasoning_summary": "..."
   * }
   *
   * @param {string} output - Agent output text
   * @returns {Object|null} Parsed result object or null if not found
   */
  parseJudgeResult(output) {
    try {
      // Look for RESULT: followed by JSON
      const resultMatch = output.match(/RESULT:\s*\n?\s*(\{[\s\S]*?\})\s*$/);
      if (!resultMatch) {
        return null;
      }

      const jsonStr = resultMatch[1];
      const parsed = JSON.parse(jsonStr);

      // Validate it has expected judge fields
      if (parsed.winner || parsed.ranking || parsed.winner_asset_url) {
        console.log(`🎯 Parsed judge result: winner=${parsed.winner}, has_url=${!!parsed.winner_asset_url}`);
        return parsed;
      }

      return null;
    } catch (err) {
      // Not valid JSON or not a judge result format
      return null;
    }
  }

  /**
   * Substitute {{step_N.field}} references in params with actual values
   */
  substituteStepReferences(params, stepResults) {
    const processed = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        // Replace {{step_N.field}} or {{step_N}} patterns
        let processedValue = value.replace(/\{\{step_(\d+)(?:\.(\w+))?\}\}/g, (match, stepNum, field) => {
          const stepResult = stepResults.get(parseInt(stepNum));
          if (!stepResult) {
            console.warn(`⚠️ Reference to step ${stepNum} not found`);
            return match;
          }

          // Check parsed judge result first for fields like winner, winner_asset_url
          if (field && stepResult.judgeResult) {
            const judgeValue = stepResult.judgeResult[field];
            if (judgeValue !== undefined) {
              console.log(`   📋 Resolved {{step_${stepNum}.${field}}} from judge result: ${String(judgeValue).substring(0, 50)}...`);
              return typeof judgeValue === 'string' ? judgeValue : JSON.stringify(judgeValue);
            }
          }

          // Then check action step data
          if (field && stepResult.data) {
            const dataValue = stepResult.data[field];
            if (dataValue !== undefined) {
              return typeof dataValue === 'string' ? dataValue : JSON.stringify(dataValue);
            }
          }

          // Fall back to output
          if (field) {
            // Try to parse output as JSON to get field
            try {
              const parsed = JSON.parse(stepResult.output);
              if (parsed[field] !== undefined) {
                return typeof parsed[field] === 'string' ? parsed[field] : JSON.stringify(parsed[field]);
              }
            } catch {
              // Not JSON
            }

            // Field was requested but not found - don't return full output!
            // For URL fields, try to extract a URL from the output as last resort
            if (field.endsWith('_url') || field === 'url') {
              const urlMatch = stepResult.output?.match(/https?:\/\/[^\s"'<>\]]+/);
              if (urlMatch) {
                console.log(`   🔗 Extracted URL from step ${stepNum} output: ${urlMatch[0].substring(0, 80)}...`);
                return urlMatch[0];
              }
            }

            // Return match unchanged - let caller handle missing field
            console.warn(`⚠️ Field "${field}" not found in step ${stepNum} result, keeping placeholder`);
            return match;
          }

          // Only return full output for {{step_N}} without field specifier
          return stepResult.output || match;
        });

        // Also handle {{winner_url}} by looking at the most recent judge result
        // This allows orchestrator to use simpler syntax for downloading winning assets
        processedValue = processedValue.replace(/\{\{winner_url\}\}/g, (match) => {
          // Find the most recent judge result with winner_asset_url
          for (const [stepNum, result] of [...stepResults.entries()].reverse()) {
            if (result.judgeResult && result.judgeResult.winner_asset_url) {
              console.log(`   🏆 Resolved {{winner_url}} from step ${stepNum} judge result: ${result.judgeResult.winner_asset_url.substring(0, 80)}...`);
              return result.judgeResult.winner_asset_url;
            }
          }
          console.warn(`⚠️ {{winner_url}} used but no judge result with winner_asset_url found`);
          return match;
        });

        processed[key] = processedValue;
      } else {
        processed[key] = value;
      }
    }

    return processed;
  }

  /**
   * Action: Download URL to R2 storage
   */
  async executeDownloadAction(workflow, params) {
    const { url, filename } = params;

    if (!url) {
      throw new Error('download_url_to_r2 action requires "url" parameter');
    }

    console.log(`📥 [Action] Downloading ${url} to R2...`);

    // Get R2 config from environment
    const R2_UPLOAD_URL = process.env.R2_UPLOAD_URL || 'http://localhost:8080/assets/upload';

    // Fetch the content
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine filename
    let finalFilename = filename;
    if (!finalFilename) {
      const urlPath = new URL(url).pathname;
      const urlFilename = urlPath.split('/').pop();
      if (urlFilename && urlFilename.includes('.')) {
        finalFilename = urlFilename;
      } else {
        const ext = contentType.split('/')[1]?.split(';')[0] || 'bin';
        finalFilename = `download-${Date.now()}.${ext}`;
      }
    }

    // Upload to R2
    const uploadUrl = new URL(R2_UPLOAD_URL);
    uploadUrl.searchParams.set('workflowId', `users/${workflow.userId}/workflows/${workflow.id}`);
    uploadUrl.searchParams.set('filename', finalFilename);
    uploadUrl.searchParams.set('contentType', contentType);

    const uploadResponse = await fetch(uploadUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: buffer
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`R2 upload failed: ${errorText}`);
    }

    const uploadResult = await uploadResponse.json();

    console.log(`   ✅ Uploaded to R2: ${uploadResult.key}`);

    return {
      success: true,
      r2_url: uploadResult.signedUrl,
      r2_key: uploadResult.key,
      source_url: url,
      filename: finalFilename,
      content_type: contentType,
      size_bytes: buffer.length
    };
  }

  /**
   * Action: Generate image via HTTP service
   *
   * @param {Object} workflow - Workflow state
   * @param {Object} params - Image generation parameters
   * @param {string} params.prompt - Image prompt (required)
   * @param {string} params.model - Model: 'dall-e-3' (default), 'flux-schnell', 'stable-diffusion-xl'
   * @param {string} params.size - Size: '1024x1024' (default), '1024x1792', '1792x1024'
   * @param {string} params.quality - Quality: 'standard' (default), 'hd'
   * @param {string} params.style - Style: 'vivid' (default), 'natural'
   */
  async executeGenerateImageAction(workflow, params) {
    // Use DALL-E 3 valid defaults
    const { prompt, model = 'dall-e-3', size = '1024x1024', quality = 'standard', style = 'vivid' } = params;

    if (!prompt) {
      throw new Error('generate_image action requires "prompt" parameter');
    }

    console.log(`🎨 [Action] Generating image: "${prompt.substring(0, 50)}..."`);

    // Get R2 config
    const R2_UPLOAD_URL = process.env.R2_UPLOAD_URL || 'http://localhost:8080/assets/upload';

    const response = await fetch('http://localhost:3002/generate_image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        model,
        size,
        quality,
        style,
        r2_config: {
          upload_url: R2_UPLOAD_URL,
          user_id: workflow.userId,
          workflow_id: workflow.id
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Image generation failed: ${errorText}`);
    }

    const result = await response.json();
    console.log(`   ✅ Image generated: ${result.r2_url || result.image_path}`);

    return result;
  }

  /**
   * Action: Text to speech via HTTP service
   *
   * @param {Object} workflow - Workflow state
   * @param {Object} params - TTS parameters
   * @param {string} params.text - Text to convert (required)
   * @param {string} params.voice - Voice: 'alloy', 'echo', 'fable', 'onyx', 'nova' (default), 'shimmer'
   * @param {string} params.model - Model: 'tts-1' (default), 'tts-1-hd'
   * @param {number} params.speed - Speed: 0.25 to 4.0 (default: 1.0)
   */
  async executeTextToSpeechAction(workflow, params) {
    const { text, voice = 'nova', model = 'tts-1', speed = 1.0 } = params;

    if (!text) {
      throw new Error('text_to_speech action requires "text" parameter');
    }

    console.log(`🔊 [Action] Converting text to speech (${text.length} chars)...`);

    // Get R2 config
    const R2_UPLOAD_URL = process.env.R2_UPLOAD_URL || 'http://localhost:8080/assets/upload';

    const response = await fetch('http://localhost:3001/text_to_speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice,
        model,
        speed,
        r2_config: {
          upload_url: R2_UPLOAD_URL,
          user_id: workflow.userId,
          workflow_id: workflow.id
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TTS failed: ${errorText}`);
    }

    const result = await response.json();
    console.log(`   ✅ Audio generated: ${result.r2_url || result.audio_path}`);

    return result;
  }

  /**
   * Prepare an asset for passing to an agent
   *
   * This is ASSET-AGNOSTIC: handles different asset types appropriately:
   * - Images: Fetch and convert to base64 for Claude vision
   * - Audio: Pass URL with metadata (Claude can't hear, but agent can reference)
   * - Files: Pass URL with metadata
   * - Future types: Extend as needed
   *
   * @param {string} actionType - The action that produced this asset
   * @param {string} url - Asset URL
   * @param {number} stepNum - Step number that produced this asset
   * @param {Object} data - Full result data from the action step
   * @returns {Promise<Object|null>} Asset info object or null if failed
   */
  async prepareAssetForAgent(actionType, url, stepNum, data) {
    switch (actionType) {
      case 'generate_image': {
        // Images: fetch and pass as base64 for Claude vision
        const imageBlock = await this.fetchImageAsBase64(url);
        if (imageBlock) {
          return {
            type: 'image',
            stepNum,
            label: `Image from Step ${stepNum}`,
            imageBlock,
            url,
            assetType: 'image',
            metadata: {
              model: data.model,
              prompt: data.prompt?.substring(0, 100),
              size: data.size
            }
          };
        }
        return null;
      }

      case 'text_to_speech': {
        // Audio: Claude can't hear, so pass as URL with metadata
        // The agent can reference the audio exists and describe it
        return {
          type: 'audio',
          stepNum,
          label: `Audio from Step ${stepNum}`,
          url,
          assetType: 'audio/mp3',
          metadata: {
            voice: data.voice,
            model: data.model,
            speed: data.speed,
            duration: data.duration,
            textLength: data.text?.length
          }
        };
      }

      case 'download_url_to_r2': {
        // Downloaded files: pass as URL with metadata
        // Try to determine if it's an image we can show
        const contentType = data.content_type || '';
        if (contentType.startsWith('image/')) {
          // It's an image - fetch and pass for vision
          const imageBlock = await this.fetchImageAsBase64(url);
          if (imageBlock) {
            return {
              type: 'image',
              stepNum,
              label: `Downloaded Image from Step ${stepNum}`,
              imageBlock,
              url,
              assetType: contentType,
              metadata: {
                sourceUrl: data.source_url,
                filename: data.filename,
                size: data.size_bytes
              }
            };
          }
        }

        // Not an image or image fetch failed - pass as file reference
        return {
          type: 'file',
          stepNum,
          label: `File from Step ${stepNum}`,
          url,
          assetType: contentType || 'application/octet-stream',
          metadata: {
            sourceUrl: data.source_url,
            filename: data.filename,
            size: data.size_bytes
          }
        };
      }

      default: {
        // Unknown action type - pass as generic file reference
        console.log(`⚠️  Unknown action type "${actionType}" - passing as file reference`);
        return {
          type: 'file',
          stepNum,
          label: `Asset from Step ${stepNum} (${actionType})`,
          url,
          assetType: 'unknown',
          metadata: data
        };
      }
    }
  }

  /**
   * Fetch an image from URL and convert to base64 for Claude structured content
   *
   * @param {string} url - Image URL to fetch
   * @returns {Promise<Object|null>} Base64 image block or null if failed
   */
  async fetchImageAsBase64(url) {
    try {
      console.log(`📥 Fetching image for vision: ${url.substring(0, 60)}...`);
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`⚠️  Failed to fetch image: HTTP ${response.status}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      // Determine media type
      let mediaType = 'image/png';
      if (contentType.includes('jpeg') || contentType.includes('jpg')) {
        mediaType = 'image/jpeg';
      } else if (contentType.includes('gif')) {
        mediaType = 'image/gif';
      } else if (contentType.includes('webp')) {
        mediaType = 'image/webp';
      }

      console.log(`   ✅ Image fetched (${Math.round(base64.length / 1024)}KB, ${mediaType})`);

      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64
        }
      };
    } catch (err) {
      console.error(`⚠️  Error fetching image: ${err.message}`);
      return null;
    }
  }

  /**
   * Execute a "delegate" step - run task on agent
   *
   * Now supports passing images from previous action steps to enable
   * vision-based evaluation (e.g., judge agents comparing images).
   *
   * @param {Object} workflow - Workflow state
   * @param {Object} step - Step configuration
   * @param {string} context - Text context from dependent steps
   * @param {Map} stepResults - Results from all completed steps (for image access)
   * @param {Function} onProgress - Progress callback
   */
  async executeDelegateStep(workflow, step, context, stepResults, onProgress) {
    const { step: stepNum, agent, task, depends_on } = step;
    const stepStartedAt = new Date().toISOString();

    // Persist step as running
    await this.persistStep(workflow, {
      stepNum,
      agentSlug: agent,
      task,
      status: 'running',
      input: { task, context },
      startedAt: stepStartedAt
    });

    // Build task message with FULL context (original goal + previous steps)
    // CRITICAL: Always include original goal so workers have complete context
    let taskMessage = `=== ORIGINAL USER REQUEST ===\n${workflow.goal}\n\n`;

    if (context) {
      taskMessage += `=== CONTEXT FROM PREVIOUS STEPS ===\n${context}\n\n`;
    }

    taskMessage += `=== YOUR SPECIFIC TASK ===\n${task}`;

    // For judge/evaluator agents, append RESULT requirement to ensure structured output
    // This is CRITICAL for downstream steps that need to reference winner_asset_url etc.
    const isJudgeTask = this.isJudgeOrEvaluatorAgent('', '', task);
    if (isJudgeTask) {
      console.log(`⚖️  [Delegate] Detected judge task - appending RESULT requirement`);
      taskMessage += `

=== REQUIRED OUTPUT FORMAT ===
IMPORTANT: After your analysis, you MUST end your response with a structured result in this EXACT format:

RESULT:
{
  "winner": "Entry 1" or "Entry 2" etc,
  "winner_asset_url": "<copy the EXACT full https:// URL of the winning asset here>",
  "ranking": ["Entry 1", "Entry 2", ...],
  "reasoning_summary": "One sentence explaining why this won"
}

The RESULT block with winner_asset_url is MANDATORY - do not skip it. Copy the winning URL exactly from the task context.`;
    }

    // Check if agent exists
    try {
      await this.brainLoader.load(agent);
    } catch (e) {
      throw new Error(`Agent '${agent}' not found. It may need to be created in an earlier step.`);
    }

    // Check if any dependent steps produced assets that we should pass to this agent
    // This is ASSET-AGNOSTIC: handles images, audio, files, etc.
    let messageContent = null;
    const assetBlocks = [];

    if (depends_on && depends_on.length > 0 && stepResults) {
      // Look at step results to find asset outputs from action steps
      for (const depStepNum of depends_on) {
        const depResult = stepResults.get(depStepNum);

        // Check if this was an action step that produced an asset
        if (depResult && depResult.type === 'action' && depResult.data) {
          const data = depResult.data;
          const actionType = depResult.action;
          const assetUrl = data.r2_url || data.image_url || data.audio_url || data.url;

          if (assetUrl) {
            console.log(`🔍 Found ${actionType} asset from step ${depStepNum}: ${assetUrl.substring(0, 60)}...`);

            // Determine how to pass this asset based on type
            const assetInfo = await this.prepareAssetForAgent(actionType, assetUrl, depStepNum, data);
            if (assetInfo) {
              assetBlocks.push(assetInfo);
            }
          }
        }
      }
    }

    // If we have assets, build structured content
    if (assetBlocks.length > 0) {
      const imageCount = assetBlocks.filter(a => a.type === 'image').length;
      const otherCount = assetBlocks.length - imageCount;
      console.log(`📦 Passing ${assetBlocks.length} asset(s) to ${agent} (${imageCount} images, ${otherCount} other)`);

      messageContent = [
        { type: 'text', text: taskMessage }
      ];

      // Add each asset appropriately
      for (const asset of assetBlocks) {
        if (asset.type === 'image' && asset.imageBlock) {
          // Images: pass as vision blocks (Claude can see these)
          messageContent.push({ type: 'text', text: `\n\n--- ${asset.label} ---` });
          messageContent.push(asset.imageBlock);
        } else if (asset.type === 'audio' || asset.type === 'file') {
          // Audio/Files: pass as text description with URL (Claude can't hear/view these directly)
          messageContent.push({
            type: 'text',
            text: `\n\n--- ${asset.label} ---\nAsset Type: ${asset.assetType}\nURL: ${asset.url}\n${asset.metadata ? `Metadata: ${JSON.stringify(asset.metadata)}` : ''}`
          });
        }
      }
    }

    // Spawn worker session - pass structured content if we have images
    const workerResult = await sendToClaudeSession({
      message: taskMessage,
      messageContent: messageContent,  // Will use structured content if images present
      claudeCmd: 'claude',
      mcpProfile: 'with-image-tools',
      userId: workflow.userId,
      workflowId: workflow.id,
    });

    if (!workerResult.success) {
      throw new Error(`Worker agent '${agent}' failed: ${workerResult.error}`);
    }

    // Store worker result
    const sessionId = workerResult.metadata?.sessionInfo?.sessionId;
    workflow.workerSessions.set(stepNum, {
      agent,
      sessionId,
      result: workerResult.text
    });

    // Track session in sessionManager (same as manual chats)
    // This allows the user to "Continue chat" with this agent later
    if (sessionId) {
      // Find the instance slug for this agent - try multiple matching strategies
      let instanceSlug = null;

      // Strategy 1: Match by marketplace slug (most common for workflow-created agents)
      const bySlug = workflow.createdAgents?.find(a => a.slug === agent);
      if (bySlug?.instanceSlug) {
        instanceSlug = bySlug.instanceSlug;
        console.log(`💾 [Workflow] Found instance by slug: ${agent} -> ${instanceSlug}`);
      }

      // Strategy 2: Match by instance slug (if plan uses full instance slugs)
      if (!instanceSlug) {
        const byInstanceSlug = workflow.createdAgents?.find(a => a.instanceSlug === agent);
        if (byInstanceSlug?.instanceSlug) {
          instanceSlug = byInstanceSlug.instanceSlug;
          console.log(`💾 [Workflow] Found instance by instanceSlug match: ${agent}`);
        }
      }

      // Strategy 3: The agent reference itself might BE the instance slug
      // (This happens when brain-loader uses instance slugs directly)
      if (!instanceSlug && agent.match(/-\d{13}$/)) {
        instanceSlug = agent;
        console.log(`💾 [Workflow] Using agent as instance slug directly: ${agent}`);
      }

      if (instanceSlug) {
        this.sessionManager.setCurrentUuid(instanceSlug, workflow.userId, sessionId);
        this.sessionManager.incrementMessageCount(instanceSlug, workflow.userId, sessionId);
        this.sessionManager.incrementMessageCount(instanceSlug, workflow.userId, sessionId);
        console.log(`💾 [Workflow] Tracked session ${sessionId.substring(0, 8)}... for ${instanceSlug}`);
      } else {
        console.warn(`⚠️  [Workflow] Could not find instance slug for agent: ${agent}`);
        console.warn(`    Available createdAgents:`, workflow.createdAgents?.map(a => ({ slug: a.slug, instanceSlug: a.instanceSlug })));
      }
    }

    // Persist step as completed
    await this.persistStep(workflow, {
      stepNum,
      agentSlug: agent,
      task,
      status: 'completed',
      input: { task, context },
      output: workerResult.text,
      sessionId,
      startedAt: stepStartedAt,
      completedAt: new Date().toISOString()
    });

    if (onProgress) {
      onProgress('worker_complete', {
        step: stepNum,
        agent,
        resultPreview: workerResult.text.substring(0, 200) + '...'
      });
    }

    // Parse judge/evaluation result if present
    // This extracts structured data (winner, ranking, etc.) that downstream steps can reference
    const judgeResult = this.parseJudgeResult(workerResult.text);

    return {
      success: true,
      type: 'delegate',
      agent,
      output: workerResult.text,
      judgeResult  // Will be null for non-judge steps, structured data for judges
    };
  }

  /**
   * Main execution loop - processes orchestrator commands until complete
   *
   * @param {Object} workflow - Workflow state
   * @param {Function} onProgress - Progress callback
   * @param {Object} initialResponse - Initial response from orchestrator (optional)
   * @returns {Promise<Object>} Final result
   */
  async executionLoop(workflow, onProgress, initialResponse = null) {
    let iterations = 0;
    const maxIterations = 50; // Safety limit
    let pendingResponse = initialResponse; // Use initial response for first iteration

    while (iterations < maxIterations) {
      iterations++;

      // Get next command from orchestrator (use pending response if available)
      const response = pendingResponse || await this.getOrchestratorResponse(workflow);
      pendingResponse = null; // Clear pending response after using

      // Parse with retry on JSON errors
      const parsed = await this.parseWithRetry(response, workflow);

      const command = parsed.command;

      if (onProgress) {
        onProgress('command', { type: command.type, message: command.message });
      }

      switch (command.type) {
        case 'delegate':
          // Spawn worker agent and collect result
          // Handler returns the orchestrator's next response
          pendingResponse = await this.handleDelegate(workflow, command, onProgress);
          break;

        case 'continue':
          // Orchestrator is processing, loop continues
          workflow.currentStep = command.completed_step || workflow.currentStep;
          break;

        case 'complete':
          // Workflow finished
          workflow.status = 'completed';
          workflow.result = command;
          workflow.completedAt = new Date().toISOString();
          await this.persistWorkflow(workflow);

          this.emit('workflow:complete', {
            workflowId: workflow.id,
            result: command
          });

          return {
            workflowId: workflow.id,
            status: 'completed',
            summary: command.summary,
            outputs: command.outputs,
            message: command.message
          };

        case 'discovery':
          // Orchestrator needs multiple inputs (discovery phase)
          workflow.status = 'discovery';
          workflow.pendingQuestions = command.questions;
          await this.persistWorkflow(workflow);

          return {
            workflowId: workflow.id,
            status: 'needs_discovery',
            questions: command.questions,
            message: command.message
          };

        case 'clarify':
          // Orchestrator needs user input mid-workflow
          workflow.status = 'waiting_for_input';
          workflow.pendingQuestion = command;
          await this.persistWorkflow(workflow);

          return {
            workflowId: workflow.id,
            status: 'needs_input',
            question: command.question,
            message: command.message
          };

        case 'plan':
          // Orchestrator is replanning (shouldn't happen often)
          workflow.plan = command;
          break;

        case 'create_agent':
          // Orchestrator wants to create a new agent dynamically
          // Handler returns the orchestrator's next response (should be 'delegate')
          pendingResponse = await this.handleCreateAgent(workflow, command, onProgress);
          break;

        case 'parallel':
          // Orchestrator wants to run multiple commands in parallel
          // Handler returns the orchestrator's next response after all complete
          pendingResponse = await this.handleParallel(workflow, command, onProgress);
          break;

        default:
          console.warn(`Unknown command type from orchestrator: ${command.type}`);
      }
    }

    throw new Error('Workflow exceeded maximum iterations');
  }

  /**
   * Handle delegate command - spawn worker agent
   *
   * @param {Object} workflow - Workflow state
   * @param {Object} command - Delegate command from orchestrator
   * @param {Function} onProgress - Progress callback
   */
  async handleDelegate(workflow, command, onProgress) {
    const { step, agent, input } = command;

    // Special case: if agent is "create_agent", convert to create_agent command
    // This handles when orchestrator puts create_agent in plan steps as an "agent"
    if (agent === 'create_agent') {
      // Extract agent creation info from the input
      const createCommand = {
        type: 'create_agent',
        agent_slug: input.slug || input.agent_slug || `dynamic-agent-${Date.now()}`,
        agent_name: input.name || input.agent_name || 'Dynamic Agent',
        description: input.description || input.task,
        system_prompt: input.system_prompt || input.systemPrompt || `You are a specialized agent. ${input.task}`,
        agent_type: input.agent_type || 'utility',
        capabilities: input.capabilities || ['text'],
        message: command.message || 'Creating dynamic agent...'
      };
      return this.handleCreateAgent(workflow, createCommand, onProgress);
    }

    if (onProgress) {
      onProgress('delegate', {
        step,
        agent,
        task: input.task,
        message: command.message
      });
    }

    workflow.currentStep = step;
    const stepStartedAt = new Date().toISOString();

    // Persist step as running
    await this.persistStep(workflow, {
      stepNum: step,
      agentSlug: agent,
      task: input.task || JSON.stringify(input),
      status: 'running',
      input: input,
      startedAt: stepStartedAt
    });
    await this.persistWorkflow(workflow);

    try {
      // Load the worker agent's brain
      const workerBrain = await this.brainLoader.load(agent);

      // Build worker's system prompt
      const workerSystemPrompt = await this.brainLoader.buildSystemPrompt(agent, {
        id: workflow.userId,
        username: 'workflow_user'
      });

      // Create task message for worker (include original goal for full context)
      const taskMessage = this.formatWorkerTask(input, workflow.goal);

      // Spawn worker session
      const workerResult = await sendToClaudeSession({
        message: taskMessage,
        claudeCmd: 'claude',
        mcpProfile: 'with-image-tools',
        userId: workflow.userId,
        workflowId: workflow.id,
        // Workers get fresh sessions (no resume) for isolation
        // Could optimize later to resume if same agent used multiple times
      });

      if (!workerResult.success) {
        throw new Error(`Worker agent '${agent}' failed: ${workerResult.error}`);
      }

      // Store worker result
      const sessionId = workerResult.metadata?.sessionInfo?.sessionId;
      workflow.workerSessions.set(step, {
        agent,
        sessionId,
        result: workerResult.text
      });

      // Persist step as completed
      await this.persistStep(workflow, {
        stepNum: step,
        agentSlug: agent,
        task: input.task || JSON.stringify(input),
        status: 'completed',
        input: input,
        output: workerResult.text,
        sessionId,
        startedAt: stepStartedAt,
        completedAt: new Date().toISOString()
      });

      // Inject result back into orchestrator and capture the response
      const resultMessage = this.formatWorkerResult(step, agent, workerResult.text);

      const orchestratorResponse = await this.sendToOrchestrator({
        message: resultMessage,
        workflow
      });

      if (onProgress) {
        onProgress('worker_complete', {
          step,
          agent,
          resultPreview: workerResult.text.substring(0, 200) + '...'
        });
      }

      // Return orchestrator's response so the execution loop can use it
      return orchestratorResponse;

    } catch (error) {
      // Persist step as failed
      await this.persistStep(workflow, {
        stepNum: step,
        agentSlug: agent,
        task: input.task || JSON.stringify(input),
        status: 'failed',
        input: input,
        error: error.message,
        startedAt: stepStartedAt,
        completedAt: new Date().toISOString()
      });

      // Report failure to orchestrator and capture response
      const errorMessage = `Worker agent '${agent}' failed for step ${step}: ${error.message}`;

      const orchestratorResponse = await this.sendToOrchestrator({
        message: `WORKER ERROR:\n${errorMessage}\n\nPlease decide how to proceed.`,
        workflow
      });

      if (onProgress) {
        onProgress('worker_error', { step, agent, error: error.message });
      }

      // Return orchestrator's response so the execution loop can use it
      return orchestratorResponse;
    }
  }

  /**
   * Handle create_agent command - dynamically create a new agent
   *
   * Node controls: slug generation, workflow tracking
   * Claude provides: name, description, system_prompt, capabilities (semantic content)
   *
   * @param {Object} workflow - Workflow state
   * @param {Object} command - Create agent command from orchestrator
   * @param {Function} onProgress - Progress callback
   */
  async handleCreateAgent(workflow, command, onProgress) {
    // Claude provides semantic content including the slug
    const {
      agent_slug,
      agent_name,
      name,           // Alternative field name
      description,
      system_prompt,
      agent_type = 'utility',
      capabilities = ['text']
    } = command;

    const agentName = agent_name || name || 'Workflow Agent';

    // Use orchestrator-provided slug (clean, human-readable like "shakespearean-bard")
    // Fallback to generating from name if not provided
    const marketplaceSlug = agent_slug || agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // Instance slug follows same pattern as manual creation: {slug}-{timestamp}
    const timestamp = Date.now();
    const instanceSlug = `${marketplaceSlug}-${timestamp}`;

    const stepNum = workflow.currentStep || (workflow.createdAgents?.length || 0) + 1;

    if (onProgress) {
      onProgress('create_agent', {
        slug: marketplaceSlug,
        instanceSlug: instanceSlug,
        name: agentName,
        message: command.message
      });
    }

    try {
      // Create the agent in the database
      // marketplace_agents gets the clean slug, my_agents gets instance slug with timestamp
      const newAgent = await this.createAgentInDatabase({
        userId: workflow.userId,
        workflowId: workflow.id,
        stepNum: stepNum,
        marketplaceSlug: marketplaceSlug,  // Clean slug for marketplace_agents
        instanceSlug: instanceSlug,         // {slug}-{timestamp} for my_agents
        name: agentName,
        description: description || `Dynamic agent: ${agentName}`,
        systemPrompt: system_prompt,
        agentType: agent_type,
        capabilities: capabilities
      });

      // Track created agents in workflow
      if (!workflow.createdAgents) {
        workflow.createdAgents = [];
      }
      workflow.createdAgents.push(newAgent);

      // Notify orchestrator with the marketplace slug (what it will use to delegate)
      const orchestratorResponse = await this.sendToOrchestrator({
        message: `AGENT CREATED: "${marketplaceSlug}" (${agentName}) is now available for use in this workflow.\n\nYou can now delegate tasks to this agent using: { "type": "delegate", "agent": "${marketplaceSlug}", ... }`,
        workflow
      });

      if (onProgress) {
        onProgress('agent_created', {
          slug: marketplaceSlug,
          instanceSlug: instanceSlug,
          name: agentName,
          id: newAgent.id,
          instanceId: newAgent.instanceId,
          workflowId: workflow.id
        });
      }

      this.emit('agent:created', {
        workflowId: workflow.id,
        agent: newAgent
      });

      // Return orchestrator's response so the execution loop can use it
      return orchestratorResponse;

    } catch (error) {
      // Report failure to orchestrator
      await this.sendToOrchestrator({
        message: `AGENT CREATION ERROR: Failed to create agent "${agentName}": ${error.message}\n\nPlease proceed without this agent or try a different approach.`,
        workflow
      });

      if (onProgress) {
        onProgress('agent_create_error', { slug: marketplaceSlug, name: agentName, error: error.message });
      }
    }
  }

  /**
   * Handle parallel command - run multiple commands concurrently
   *
   * Supports parallel agent creation and parallel delegation.
   * For mixed commands, creates agents first (in parallel), then delegates (in parallel).
   *
   * @param {Object} workflow - Workflow state
   * @param {Object} command - Parallel command with commands array
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Orchestrator's response after all complete
   */
  async handleParallel(workflow, command, onProgress) {
    const { commands, message } = command;

    if (!commands || !Array.isArray(commands) || commands.length === 0) {
      throw new Error('Parallel command requires a non-empty commands array');
    }

    if (onProgress) {
      onProgress('parallel_start', {
        count: commands.length,
        message: message || `Running ${commands.length} commands in parallel...`
      });
    }

    // Separate commands by type for proper ordering
    // Agent creation must happen before delegation to those agents
    const createAgentCommands = commands.filter(c => c.type === 'create_agent');
    const delegateCommands = commands.filter(c => c.type === 'delegate');
    const otherCommands = commands.filter(c => c.type !== 'create_agent' && c.type !== 'delegate');

    const results = {
      created: [],
      delegated: [],
      errors: []
    };

    // Phase 1: Create all agents in parallel (they need unique slugs, Node controls this)
    if (createAgentCommands.length > 0) {
      if (onProgress) {
        onProgress('parallel_phase', { phase: 'create_agents', count: createAgentCommands.length });
      }

      const createPromises = createAgentCommands.map(async (cmd, index) => {
        try {
          const agentName = cmd.agent_name || cmd.name || `Agent ${index + 1}`;
          const stepNum = (workflow.createdAgents?.length || 0) + index + 1;
          const timestamp = Date.now() + index; // Ensure unique timestamps

          // Use orchestrator-provided slug or generate from name
          const marketplaceSlug = cmd.agent_slug || agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const instanceSlug = `${marketplaceSlug}-${timestamp}`;

          // Create the agent (but don't send to orchestrator yet)
          const newAgent = await this.createAgentInDatabase({
            userId: workflow.userId,
            workflowId: workflow.id,
            stepNum: stepNum,
            marketplaceSlug: marketplaceSlug,
            instanceSlug: instanceSlug,
            name: agentName,
            description: cmd.description || `Dynamic agent: ${agentName}`,
            systemPrompt: cmd.system_prompt,
            agentType: cmd.agent_type || 'utility',
            capabilities: cmd.capabilities || ['text']
          });

          // Track in workflow
          if (!workflow.createdAgents) {
            workflow.createdAgents = [];
          }
          workflow.createdAgents.push(newAgent);

          // Emit for real-time sidebar updates
          this.emit('agent:created', {
            workflowId: workflow.id,
            agent: newAgent
          });

          if (onProgress) {
            onProgress('agent_created', {
              slug: marketplaceSlug,
              instanceSlug: instanceSlug,
              name: agentName,
              id: newAgent.id,
              instanceId: newAgent.instanceId,
              workflowId: workflow.id
            });
          }

          return { success: true, agent: newAgent, slug: marketplaceSlug };
        } catch (error) {
          if (onProgress) {
            onProgress('agent_create_error', { name: cmd.agent_name, error: error.message });
          }
          return { success: false, error: error.message, name: cmd.agent_name };
        }
      });

      const createResults = await Promise.all(createPromises);
      results.created = createResults.filter(r => r.success).map(r => r.agent);
      results.errors.push(...createResults.filter(r => !r.success));
    }

    // Phase 2: Delegate to all agents in parallel
    if (delegateCommands.length > 0) {
      if (onProgress) {
        onProgress('parallel_phase', { phase: 'delegate', count: delegateCommands.length });
      }

      const delegatePromises = delegateCommands.map(async (cmd) => {
        const stepStartedAt = new Date().toISOString();
        try {
          const { step, agent, input } = cmd;

          // Persist step as running
          await this.persistStep(workflow, {
            stepNum: step,
            agentSlug: agent,
            task: input.task || JSON.stringify(input),
            status: 'running',
            input: input,
            startedAt: stepStartedAt
          });

          // Load the worker agent's brain
          const workerBrain = await this.brainLoader.load(agent);

          // Build worker's system prompt
          const workerSystemPrompt = await this.brainLoader.buildSystemPrompt(agent, {
            id: workflow.userId,
            username: 'workflow_user'
          });

          // Create task message for worker (include original goal for full context)
          const taskMessage = this.formatWorkerTask(input, workflow.goal);

          // Spawn worker session
          const { sendToClaudeSession } = require('./claude-client');
          const workerResult = await sendToClaudeSession({
            message: taskMessage,
            claudeCmd: 'claude',
            mcpProfile: 'with-image-tools',
            userId: workflow.userId,
            workflowId: workflow.id,
          });

          if (!workerResult.success) {
            throw new Error(`Worker agent '${agent}' failed: ${workerResult.error}`);
          }

          const sessionId = workerResult.metadata?.sessionInfo?.sessionId;

          // Store worker result
          workflow.workerSessions.set(step, {
            agent,
            sessionId,
            result: workerResult.text
          });

          // Persist step as completed
          await this.persistStep(workflow, {
            stepNum: step,
            agentSlug: agent,
            task: input.task || JSON.stringify(input),
            status: 'completed',
            input: input,
            output: workerResult.text,
            sessionId,
            startedAt: stepStartedAt,
            completedAt: new Date().toISOString()
          });

          if (onProgress) {
            onProgress('worker_complete', {
              step,
              agent,
              resultPreview: workerResult.text.substring(0, 200) + '...'
            });
          }

          return { success: true, step, agent, result: workerResult.text };
        } catch (error) {
          // Persist step as failed
          await this.persistStep(workflow, {
            stepNum: cmd.step,
            agentSlug: cmd.agent,
            task: cmd.input?.task || JSON.stringify(cmd.input),
            status: 'failed',
            input: cmd.input,
            error: error.message,
            startedAt: stepStartedAt,
            completedAt: new Date().toISOString()
          });

          if (onProgress) {
            onProgress('worker_error', { step: cmd.step, agent: cmd.agent, error: error.message });
          }
          return { success: false, step: cmd.step, agent: cmd.agent, error: error.message };
        }
      });

      const delegateResults = await Promise.all(delegatePromises);
      results.delegated = delegateResults.filter(r => r.success);
      results.errors.push(...delegateResults.filter(r => !r.success));
    }

    // Phase 3: Handle any other command types (shouldn't happen often)
    for (const cmd of otherCommands) {
      console.warn(`Unsupported command type in parallel batch: ${cmd.type}`);
    }

    if (onProgress) {
      onProgress('parallel_complete', {
        created: results.created.length,
        delegated: results.delegated.length,
        errors: results.errors.length
      });
    }

    // Build combined result message for orchestrator
    let resultMessage = 'PARALLEL EXECUTION COMPLETE:\n\n';

    if (results.created.length > 0) {
      resultMessage += `Agents created (${results.created.length}):\n`;
      results.created.forEach(agent => {
        resultMessage += `  - "${agent.slug}" (${agent.name})\n`;
      });
      resultMessage += '\n';
    }

    if (results.delegated.length > 0) {
      resultMessage += `Delegations completed (${results.delegated.length}):\n`;
      results.delegated.forEach(d => {
        resultMessage += `\n--- Step ${d.step} (${d.agent}) ---\n`;
        resultMessage += d.result.substring(0, 500) + (d.result.length > 500 ? '...' : '');
        resultMessage += '\n';
      });
    }

    if (results.errors.length > 0) {
      resultMessage += `\nErrors (${results.errors.length}):\n`;
      results.errors.forEach(e => {
        resultMessage += `  - ${e.name || e.agent || 'Unknown'}: ${e.error}\n`;
      });
    }

    resultMessage += '\nPlease proceed with the next steps.';

    // Send combined results to orchestrator
    const orchestratorResponse = await this.sendToOrchestrator({
      message: resultMessage,
      workflow
    });

    return orchestratorResponse;
  }

  /**
   * Create an agent in the database
   *
   * Node controls: slug (passed in), workflow tracking
   * This follows the same pattern as create-instance/route.ts
   *
   * @param {Object} options - Agent options
   * @returns {Promise<Object>} Created agent record
   */
  async createAgentInDatabase(options) {
    const {
      userId,
      workflowId,
      stepNum,
      marketplaceSlug,  // Clean slug for marketplace_agents (e.g., "shakespearean-bard")
      instanceSlug,     // Instance slug with timestamp (e.g., "shakespearean-bard-1764630468229")
      name,
      description,
      systemPrompt,
      agentType = 'utility',
      capabilities = ['text'],
      inputSchema = null,
      outputSchema = null
    } = options;

    if (!supabase) {
      // Fallback: create local brain file
      return this.createLocalAgent(options);
    }

    // First, create a marketplace_agents entry (or find existing)
    // This serves as the "template" for the dynamic agent
    const { data: existingAgent } = await supabase
      .from('marketplace_agents')
      .select('id')
      .eq('slug', marketplaceSlug)
      .single();

    let marketplaceAgentId;

    if (existingAgent) {
      marketplaceAgentId = existingAgent.id;
    } else {
      // Create new marketplace agent as template
      // NOTE: system_prompt column doesn't exist - all config goes in brain_config JSONB
      const { data: newMarketplace, error: marketplaceError } = await supabase
        .from('marketplace_agents')
        .insert({
          slug: marketplaceSlug,
          name: name,
          short_description: description,
          agent_type: agentType,
          capabilities: capabilities,
          input_schema: inputSchema,
          output_schema: outputSchema,
          is_active: true,
          // Mark as dynamic/workflow-created
          tags: ['dynamic', 'workflow-created'],
          // CRITICAL: brain_config is what brain-loader.js uses to load the agent
          // This is the ONLY place to store systemPrompt
          brain_config: {
            systemPrompt: systemPrompt,
            name: name,
            description: description,
            agentType: agentType,
            capabilities: capabilities,
            security: agentType === 'utility' ? false : 'default'
          }
        })
        .select()
        .single();

      if (marketplaceError) {
        throw new Error(`Failed to create marketplace agent: ${marketplaceError.message}`);
      }

      marketplaceAgentId = newMarketplace.id;
    }

    // Now create the user's instance (my_agents)
    // Following same pattern as create-instance/route.ts: {slug}-{timestamp}
    // Store workflow tracking in config_overrides
    const { data: instance, error: instanceError } = await supabase
      .from('my_agents')
      .insert({
        user_id: userId,
        agent_id: marketplaceAgentId,
        instance_name: name,
        instance_slug: instanceSlug,  // Same pattern as manual: {slug}-{timestamp}
        agent_type: agentType,
        capabilities: capabilities,
        input_schema: inputSchema,
        output_schema: outputSchema,
        // Track workflow source for later filtering/management
        config_overrides: {
          source: 'workflow',
          workflowId: workflowId,
          stepNum: stepNum,
          createdAt: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (instanceError) {
      throw new Error(`Failed to create agent instance: ${instanceError.message}`);
    }

    return {
      id: instance.id,
      slug: marketplaceSlug,      // Clean marketplace slug
      instanceSlug: instanceSlug, // Instance slug with timestamp
      name: name,
      description: description,
      systemPrompt: systemPrompt,
      agentType: agentType,
      capabilities: capabilities,
      instanceId: instance.id,
      marketplaceAgentId: marketplaceAgentId,
      workflowId: workflowId,
      stepNum: stepNum
    };
  }

  /**
   * Create a local brain file (fallback when Supabase unavailable)
   *
   * @param {Object} options - Agent options
   * @returns {Object} Created agent info
   */
  createLocalAgent(options) {
    const { slug, name, description, systemPrompt, agentType, capabilities } = options;
    const fs = require('fs');
    const path = require('path');

    const brainContent = `/**
 * ${name}
 * Dynamically created agent
 * Type: ${agentType}
 */

module.exports = {
  name: '${name}',
  description: '${description}',
  agentType: '${agentType}',
  capabilities: ${JSON.stringify(capabilities)},
  systemPrompt: \`${systemPrompt.replace(/`/g, '\\`')}\`
};
`;

    const brainPath = path.join(__dirname, '..', 'brains', `${slug}.js`);
    fs.writeFileSync(brainPath, brainContent);

    // Clear require cache so new brain is available
    delete require.cache[brainPath];

    return {
      id: slug,
      slug: slug,
      name: name,
      description: description,
      systemPrompt: systemPrompt,
      agentType: agentType,
      capabilities: capabilities,
      local: true
    };
  }

  /**
   * Parse orchestrator response with retry-on-error
   *
   * If JSON parsing fails, sends the error back to the orchestrator in the same
   * session, asking it to output valid JSON again. This follows LangChain's
   * RetryWithErrorOutputParser pattern.
   *
   * @param {Object} response - Claude response object
   * @param {Object} workflow - Workflow object (for session continuity)
   * @param {number} maxRetries - Maximum retry attempts (default: 2)
   * @returns {Promise<Object>} Parsed command object
   * @throws {Error} If parsing fails after all retries
   */
  async parseWithRetry(response, workflow, maxRetries = 2) {
    let lastError = null;
    let currentResponse = response;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const parsed = parseOrchestratorOutput(currentResponse.text);

      if (parsed.success) {
        if (attempt > 0) {
          console.log(`✅ Parse succeeded on retry attempt ${attempt}`);
        }
        return parsed;
      }

      lastError = parsed.error;

      // If we have retries left, send error back to orchestrator
      if (attempt < maxRetries) {
        console.log(`⚠️ Parse failed (attempt ${attempt + 1}/${maxRetries + 1}): ${parsed.error}`);
        console.log(`📤 Sending error back to orchestrator for self-correction...`);

        // Send the error back in the same session for self-correction
        const retryMessage = `Your previous response had malformed JSON. The parse error was:

"${parsed.error}"

Please output the COMPLETE valid JSON response again. Remember:
- Must be valid JSON with proper escaping
- Do not truncate or abbreviate
- Ensure all strings are properly closed
- Use the exact same command structure you intended`;

        currentResponse = await this.sendToOrchestrator({
          message: retryMessage,
          workflow // Same session - orchestrator has full context
        });
      }
    }

    // All retries exhausted
    console.error(`❌ Orchestrator parse failed after ${maxRetries + 1} attempts. Last error: ${lastError}`);
    console.error(`📝 Last response length: ${(currentResponse.text || '').length} chars`);
    throw new Error(`Orchestrator returned invalid JSON after ${maxRetries + 1} attempts: ${lastError}`);
  }

  /**
   * Send message to orchestrator session
   *
   * @param {Object} options - Send options
   * @returns {Promise<Object>} Claude response
   */
  async sendToOrchestrator(options) {
    const { message, systemPrompt, workflow } = options;

    // Build message with system prompt injection for new sessions
    let fullMessage = message;
    if (systemPrompt && !workflow.orchestratorSessionId) {
      // First message - inject system prompt
      fullMessage = `${systemPrompt}\n\n---\n\nUser goal: ${message}`;
    } else if (workflow.orchestratorSessionId) {
      // Follow-up message - add JSON reminder to prevent plain text responses
      fullMessage = `${message}\n\nREMINDER: You MUST respond with valid JSON only. No plain text.`;
    }

    const response = await sendToClaudeSession({
      message: fullMessage,
      sessionId: workflow.orchestratorSessionId,
      claudeCmd: 'claude',
      userId: workflow.userId,
      workflowId: workflow.id,
      // Orchestrator needs more time for complex planning
      timeout: 180000
    });

    // Store session ID for subsequent messages
    if (response.success && response.metadata?.sessionInfo?.sessionId) {
      workflow.orchestratorSessionId = response.metadata.sessionInfo.sessionId;
    }

    return response;
  }

  /**
   * Get response from orchestrator (used in execution loop)
   */
  async getOrchestratorResponse(workflow) {
    // The orchestrator should have already responded from the previous interaction
    // This method is for when we need to prompt the orchestrator again
    return await this.sendToOrchestrator({
      message: 'Continue with the workflow.',
      workflow
    });
  }

  /**
   * Get available agents for a user
   *
   * Returns the user's customized agents (my_agents) from Supabase.
   * Falls back to marketplace agents if user has none.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Array>} List of available agents
   */
  async getAvailableAgents(userId) {
    if (!supabase) {
      // Fallback to local brain files
      const brainNames = this.brainLoader.listBrains();
      return brainNames
        .filter(name => name !== 'orchestrator') // Exclude orchestrator itself
        .map(name => ({
          slug: name,
          name: name,
          description: `Local brain: ${name}`
        }));
    }

    try {
      // First try to get user's customized agents
      const { data: userAgents, error: userError } = await supabase
        .from('my_agents')
        .select(`
          id,
          custom_name,
          custom_description,
          marketplace_agents (
            id,
            slug,
            name,
            short_description,
            tags
          )
        `)
        .eq('user_id', userId)
        .eq('is_active', true);

      if (!userError && userAgents && userAgents.length > 0) {
        return userAgents.map(ua => ({
          slug: ua.marketplace_agents.slug,
          name: ua.custom_name || ua.marketplace_agents.name,
          description: ua.custom_description || ua.marketplace_agents.short_description,
          instanceId: ua.id,
          tags: ua.marketplace_agents.tags
        }));
      }

      // Fallback to all marketplace agents
      const { data: agents, error } = await supabase
        .from('marketplace_agents')
        .select('slug, name, short_description, tags')
        .eq('is_active', true);

      if (error) {
        throw error;
      }

      return (agents || []).map(a => ({
        slug: a.slug,
        name: a.name,
        description: a.short_description,
        tags: a.tags
      }));

    } catch (error) {
      console.error('Error fetching agents from Supabase:', error.message);
      // Fallback to local brain files on error
      console.log('Falling back to local brain files...');
      const brainNames = this.brainLoader.listBrains();
      return brainNames
        .filter(name => name !== 'orchestrator' && !name.startsWith('_'))
        .map(name => {
          try {
            const brain = this.brainLoader.loadFromFile(name);
            return {
              slug: name,
              name: brain.name || name,
              description: brain.description || `Local agent: ${name}`
            };
          } catch (e) {
            return {
              slug: name,
              name: name,
              description: `Local brain: ${name}`
            };
          }
        });
    }
  }

  /**
   * Format task for worker agent
   * CRITICAL: Always include original goal so workers have complete context
   */
  formatWorkerTask(input, originalGoal = null) {
    let task = input.task || input;
    let message = '';

    // Always include original goal if available
    if (originalGoal) {
      message += `=== ORIGINAL USER REQUEST ===\n${originalGoal}\n\n`;
    }

    if (input.context) {
      message += `=== CONTEXT FROM PREVIOUS STEPS ===\n${input.context}\n\n`;
    }

    message += `=== YOUR SPECIFIC TASK ===\n${task}`;

    if (input.format) {
      message += `\n\nExpected output format: ${input.format}`;
    }

    return message;
  }

  /**
   * Format worker result for orchestrator
   */
  formatWorkerResult(step, agent, result) {
    return `WORKER RESULT for Step ${step} (${agent}):

${result}

---

Evaluate this result and decide the next action.`;
  }

  /**
   * Get available actions documentation for orchestrator prompt injection
   *
   * These are deterministic operations Node executes directly without LLM reasoning.
   */
  getAvailableActionsText() {
    // NOTE: generate_image and text_to_speech removed intentionally.
    // Orchestrator should create specialized agents for creative work,
    // not call these actions directly. This is constraint-based architecture.
    return `## Available Actions (Deterministic Operations)

These are built-in actions that execute directly without LLM reasoning. Use step_type: "action" for these:

**1. download_url_to_r2** - Download any URL to permanent R2 storage
   - Params: \`url\` (required), \`filename\` (optional)
   - Returns: r2_url, r2_key, content_type, size_bytes
   - Example: \`{"step_type": "action", "action": "download_url_to_r2", "params": {"url": "https://example.com/image.jpg"}}\`

**IMPORTANT**: Use \`step_type: "action"\` only for downloading URLs. For creative work (image generation, audio, writing), ALWAYS use \`step_type: "delegate"\` to create a specialized agent.

Params can reference previous step outputs using \`{{step_N.field}}\` syntax, e.g., \`"url": "{{step_1.image_url}}"\``;
  }

  /**
   * Resume a paused workflow with user input
   *
   * Handles both single clarification responses and discovery answers.
   *
   * @param {string} workflowId - Workflow ID
   * @param {string|Object} userInput - User's response (string for clarify, object for discovery)
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Workflow result
   */
  async resumeWorkflow(workflowId, userInput, onProgress) {
    let workflow = this.activeWorkflows.get(workflowId);

    // If not in memory, try to load from database
    if (!workflow) {
      workflow = await this.loadWorkflowFromDatabase(workflowId);
      if (workflow) {
        this.activeWorkflows.set(workflowId, workflow);
        console.log(`📂 Loaded workflow from database for resume: ${workflowId}`);
      }
    }

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const validStatuses = ['waiting_for_input', 'discovery'];
    if (!validStatuses.includes(workflow.status)) {
      throw new Error(`Workflow is not waiting for input (status: ${workflow.status})`);
    }

    // Format message based on input type
    let message;
    if (workflow.status === 'discovery' && typeof userInput === 'object') {
      // Format discovery answers as structured response
      message = 'USER ANSWERS:\n\n';
      for (const [key, value] of Object.entries(userInput)) {
        message += `${key}: ${value}\n`;
      }
      message += '\nPlease create a plan based on these requirements.';
    } else {
      message = userInput;
    }

    workflow.status = 'executing';

    // Send user's response to orchestrator and capture the response
    const response = await this.sendToOrchestrator({
      message,
      workflow
    });

    // Continue execution loop with the response
    return await this.executionLoop(workflow, onProgress, response);
  }

  /**
   * Cancel an active workflow
   *
   * @param {string} workflowId - Workflow ID to cancel
   */
  cancelWorkflow(workflowId) {
    const workflow = this.activeWorkflows.get(workflowId);

    if (workflow) {
      workflow.status = 'cancelled';
      workflow.cancelledAt = new Date().toISOString();
      this.emit('workflow:cancelled', { workflowId });
    }
  }

  /**
   * Get workflow status
   *
   * @param {string} workflowId - Workflow ID
   * @returns {Object|null} Workflow state or null
   */
  getWorkflowStatus(workflowId) {
    const workflow = this.activeWorkflows.get(workflowId);

    if (!workflow) {
      return null;
    }

    return {
      id: workflow.id,
      userId: workflow.userId,
      goal: workflow.goal,
      status: workflow.status,
      plan: workflow.plan,
      currentStep: workflow.currentStep,
      error: workflow.error,
      startedAt: workflow.startedAt,
      completedAt: workflow.completedAt
    };
  }
}

module.exports = WorkflowHandler;
