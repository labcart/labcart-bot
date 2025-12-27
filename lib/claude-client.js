const { spawn, execSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { trackRequest } = require('./restart-recovery');

/**
 * Generate MCP router config and return the config file path
 *
 * @param {string} profile - MCP profile: 'no-image-tools' or 'with-image-tools'
 * @returns {string} Path to the generated MCP config file
 */
function generateMcpConfig(profile = 'with-image-tools', options = {}) {
  const mcpConfigPath = path.join('/tmp', `mcp-router-${profile}-${Date.now()}.json`);

  // Get MCP Router path from environment or default location
  const mcpRouterPath = process.env.MCP_ROUTER_PATH || path.join(process.env.HOME, 'mcp-router', 'index.js');

  // R2 config - passed to MCP router for file uploads
  const r2UploadUrl = process.env.R2_UPLOAD_URL || 'http://localhost:8080/assets/upload';
  const userId = options.userId || 'anonymous';
  const workflowId = options.workflowId || 'general';

  // Base env vars for R2 storage (always included)
  const baseEnv = {
    R2_UPLOAD_URL: r2UploadUrl,
    CURRENT_USER_ID: userId,
    CURRENT_WORKFLOW_ID: workflowId
  };

  let mcpConfig;

  if (profile === 'no-image-tools') {
    // Router WITHOUT image generation tools (for Turn 1 text generation)
    mcpConfig = {
      mcpServers: {
        router: {
          command: 'node',
          args: [mcpRouterPath],
          env: {
            ...baseEnv,
            DISABLE_IMAGE_TOOLS: 'true'  // Signal to router to exclude image tools
          }
        }
      }
    };
  } else {
    // Router WITH all tools including image generation (for Turn 2 or normal operation)
    mcpConfig = {
      mcpServers: {
        router: {
          command: 'node',
          args: [mcpRouterPath],
          env: baseEnv
        }
      }
    };
  }

  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
  return mcpConfigPath;
}

/**
 * Kill all MCP server child processes spawned by a Claude CLI process
 * This prevents zombie MCP servers from accumulating after conversations
 *
 * @param {number} claudePid - The PID of the Claude CLI parent process
 */
function killMcpChildren(claudePid) {
  if (!claudePid) return;

  try {
    // Find all child processes of the Claude process
    const children = execSync(`pgrep -P ${claudePid}`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(pid => pid);

    if (children.length === 0) return;

    console.log(`🧹 Cleaning up ${children.length} MCP child process(es) from Claude PID ${claudePid}`);

    // Kill each child process
    for (const childPid of children) {
      try {
        process.kill(parseInt(childPid), 'SIGTERM');
      } catch (err) {
        // Process might already be dead, ignore
      }
    }
  } catch (err) {
    // pgrep returns exit code 1 if no processes found, which is fine
    if (err.status !== 1) {
      console.error(`⚠️  Error cleaning up MCP children for PID ${claudePid}:`, err.message);
    }
  }
}

/**
 * Send a message to Claude using the streaming JSON protocol
 * Supports two modes:
 * 1. Simple mode (no permissions): echo message | claude --print
 * 2. Interactive mode (with permissions): JSON stdin/stdout with control protocol
 */
async function sendToClaudeSession(options) {
  const {
    message,
    sessionId,
    claudeCmd = 'claude',
    onStream = null,
    onPermissionRequest = null,
    workspacePath = null
  } = options;

  if (onPermissionRequest) {
    // Use interactive JSON mode for permission handling
    return sendWithPermissions(options);
  } else {
    // Use simple pipe mode (faster, no permission handling)
    return sendSimple(options);
  }
}

/**
 * Simple mode: pipe message to Claude (no permission handling)
 */
async function sendSimple(options) {
  const { message, sessionId, claudeCmd, onStream, messageContent, onToolResult, timeout = 120000, workspacePath, mcpProfile = 'no-image-tools', userId, workflowId } = options;

  return new Promise((resolve, reject) => {
    let timeoutId = null;
    // Use specified MCP profile (defaults to no-image-tools for regular text conversations)
    // Can be overridden to 'with-image-tools' for bots that need image generation
    const mcpConfigPath = generateMcpConfig(mcpProfile, { userId, workflowId });

    const args = [
      '--ide',
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      // Disable filesystem tools - agents should only use MCP tools (image gen, TTS, etc.)
      '--disallowedTools', 'Read,Write,Edit,Bash,Glob,Grep,NotebookEdit,Task',
      // POC: Use lightweight MCP Router instead of loading all MCPs
      '--strict-mcp-config',
      '--mcp-config', mcpConfigPath
    ];

    // Only add --resume if we have a valid session ID
    if (sessionId) {
      args.splice(1, 0, '--resume', sessionId);
    }

    // If we have structured content (e.g., images), we need to use input-format stream-json
    const hasStructuredContent = messageContent && typeof messageContent !== 'string';
    if (hasStructuredContent) {
      args.splice(1, 0, '--input-format', 'stream-json');
    }

    console.log(`🚀 Spawning (simple): ${claudeCmd} ${args.join(' ')}`);

    const spawnOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: {
        ...process.env,
        // Pass context for R2 upload scoping in MCP router
        CURRENT_USER_ID: options.userId || 'anonymous',
        CURRENT_WORKFLOW_ID: options.workflowId || 'general'
      }
    };

    // Set working directory to user's workspace if provided
    if (workspacePath) {
      spawnOptions.cwd = workspacePath;
      console.log(`📂 Setting Claude working directory to: ${workspacePath}`);
    }

    const child = spawn(claudeCmd, args, spawnOptions);

    // Track the Claude process PID for cleanup
    const claudePid = child.pid;

    // Track request for restart recovery (if we have the necessary data)
    if (options.botId && options.telegramUserId && options.chatId && options.statusMsgId) {
      trackRequest(options.botId, options.telegramUserId, {
        chatId: options.chatId,
        statusMsgId: options.statusMsgId,
        claudePid,
        mode: 'text',
        sessionId
      }).catch(err => {
        console.warn('⚠️  Failed to track request:', err.message);
      });
    }

    if (hasStructuredContent) {
      // Send as structured JSON message
      const jsonMsg = {
        type: 'user',
        message: {
          role: 'user',
          content: messageContent
        }
      };
      child.stdin.write(JSON.stringify(jsonMsg) + '\n');
    } else {
      // Send as plain text (backward compatible)
      child.stdin.write(message + '\n');
    }
    child.stdin.end();

    let fullResponse = '';
    let sessionInfo = null;
    let audioData = null; // Store TTS audio data
    let completed = false;

    // Inactivity timeout - only kill if NO activity for this long
    // This is much smarter than a hard timeout - we reset whenever Claude sends ANY output
    const resetInactivityTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);

      timeoutId = setTimeout(() => {
        if (!completed) {
          console.error(`⏱️  Inactivity timeout after ${timeout}ms - no output from Claude process ${claudePid}`);
          try {
            child.kill('SIGTERM');
            killMcpChildren(claudePid);
          } catch (err) {
            console.error(`⚠️  Error killing timed-out process:`, err.message);
          }
          reject({ success: false, error: `No response after ${timeout / 1000} seconds`, timeout: true });
        }
      }, timeout);
    };

    // Start initial timeout
    resetInactivityTimeout();

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;

      try {
        const data = JSON.parse(line);

        switch (data.type) {
          case 'system':
            resetInactivityTimeout(); // Activity detected - reset timer
            sessionInfo = {
              sessionId: data.session_id,
              model: data.model,
              tools: data.tools?.length || 0
            };
            console.log(`📋 Session initialized: ${data.model}`);
            break;

          case 'assistant':
            resetInactivityTimeout(); // Activity detected - reset timer
            if (data.message?.content) {
              const textContent = data.message.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');

              if (textContent) {
                fullResponse += textContent;
                if (onStream) {
                  onStream(textContent);
                }
              }
            }
            break;

          case 'tool_result':
            resetInactivityTimeout(); // Activity detected - reset timer
            // Notify callback about tool results
            if (onToolResult && data.tool_name && data.result) {
              try {
                onToolResult(data.tool_name, data.result);
              } catch (e) {
                console.error('⚠️  Error in onToolResult callback:', e.message);
              }
            }

            // Check if this is a TTS tool result (legacy support)
            if (data.tool_name === 'mcp__tts__text_to_speech' && data.result) {
              try {
                const ttsResult = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
                if (ttsResult.audioBase64) {
                  audioData = Buffer.from(ttsResult.audioBase64, 'base64');
                  console.log(`🎤 TTS audio received (${audioData.length} bytes)`);
                }
              } catch (e) {
                console.error('⚠️  Failed to parse TTS result:', e.message);
              }
            }
            break;

          case 'result':
            completed = true;
            if (timeoutId) clearTimeout(timeoutId);
            console.log(`✅ Completed in ${data.duration_ms}ms`);
            if (data.is_error) {
              reject({ success: false, error: data.result || 'Unknown error' });
            } else {
              resolve({
                success: true,
                text: fullResponse || data.result,
                audio: audioData, // Include audio data in response
                metadata: { duration: data.duration_ms, sessionInfo }
              });
            }
            break;
        }
      } catch (err) {
        console.error(`⚠️  Failed to parse JSON:`, err.message);
      }
    });

    child.on('error', (error) => {
      completed = true;
      if (timeoutId) clearTimeout(timeoutId);
      reject({ success: false, error: `Failed to spawn: ${error.message}` });
    });

    child.on('close', (code) => {
      completed = true;
      if (timeoutId) clearTimeout(timeoutId);

      // Clean up any MCP server child processes
      killMcpChildren(claudePid);

      if (code !== 0 && code !== null) {
        reject({ success: false, error: `Exited with code ${code}` });
      }
    });
  });
}

/**
 * Interactive mode: JSON stdin/stdout with permission protocol
 */
async function sendWithPermissions(options) {
  const { message, sessionId, claudeCmd, onStream, onPermissionRequest, workspacePath } = options;
  
  return new Promise((resolve, reject) => {
    const args = [
      '--ide',
      '--resume', sessionId,
      '--input-format', 'stream-json',  // CRITICAL: Required for permission handling
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-prompt-tool', 'stdio',
      // Disable filesystem tools - agents should only use MCP tools (image gen, TTS, etc.)
      '--disallowedTools', 'Read,Write,Edit,Bash,Glob,Grep,NotebookEdit,Task'
    ];

    console.log(`🚀 Spawning (interactive): ${claudeCmd} ${args.join(' ')}`);

    const spawnOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: {
        ...process.env,
        // Pass context for R2 upload scoping in MCP router
        CURRENT_USER_ID: options.userId || 'anonymous',
        CURRENT_WORKFLOW_ID: options.workflowId || 'general'
      }
    };

    // Set working directory to user's workspace if provided
    if (workspacePath) {
      spawnOptions.cwd = workspacePath;
      console.log(`📂 Setting Claude working directory to: ${workspacePath}`);
    }

    const child = spawn(claudeCmd, args, spawnOptions);

    // Track the Claude process PID for cleanup
    const claudePid = child.pid;

    let fullResponse = '';
    let sessionInfo = null;

    // Send messages as JSON in stream-json format
    const sendJsonMessage = (msg) => {
      const jsonMsg = { 
        type: 'user', 
        message: {
          role: 'user',
          content: msg
        }
      };
      child.stdin.write(JSON.stringify(jsonMsg) + '\n');
    };

    // Send initial message
    sendJsonMessage(message);

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });

    rl.on('line', async (line) => {
      if (!line.trim()) return;

      try {
        const data = JSON.parse(line);

        switch (data.type) {
          case 'system':
            sessionInfo = {
              sessionId: data.session_id,
              model: data.model,
              tools: data.tools?.length || 0
            };
            console.log(`📋 Session initialized: ${data.model}`);
            break;

          case 'assistant':
            if (data.message?.content) {
              const textContent = data.message.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');
              
              if (textContent) {
                fullResponse += textContent;
                if (onStream) {
                  onStream(textContent);
                }
              }
            }
            break;

          case 'control_request':
            // Permission request from Claude
            if (data.request?.subtype === 'can_use_tool') {
              await handlePermissionRequest(child.stdin, data, onPermissionRequest);
            }
            break;

          case 'result':
            console.log(`✅ Completed in ${data.duration_ms}ms`);
            child.stdin.end(); // Close stdin after completion
            
            if (data.is_error) {
              reject({ success: false, error: data.result || 'Unknown error' });
            } else {
              resolve({
                success: true,
                text: fullResponse || data.result,
                metadata: { duration: data.duration_ms, sessionInfo }
              });
            }
            break;
        }
      } catch (err) {
        console.error(`⚠️  Failed to parse JSON:`, err.message);
      }
    });

    child.on('error', (error) => {
      reject({ success: false, error: `Failed to spawn: ${error.message}` });
    });

    child.on('close', (code) => {
      // Clean up any MCP server child processes
      killMcpChildren(claudePid);

      if (code !== 0 && code !== null) {
        reject({ success: false, error: `Exited with code ${code}` });
      }
    });
  });
}

/**
 * Handle permission request from Claude
 */
async function handlePermissionRequest(stdin, requestData, callback) {
  const { request_id, request } = requestData;
  const { tool_name, input } = request;

  console.log(`🔐 Permission requested: ${tool_name}`);

  let allow = false;
  if (callback) {
    try {
      allow = await callback(tool_name, input);
    } catch (err) {
      console.error(`❌ Permission callback error: ${err.message}`);
    }
  }

  // Send permission response using control_response protocol  
  // Format for allow: behavior + updatedInput
  // Format for deny: behavior + message (per chatcode implementation)
  const responsePayload = allow 
    ? {
        behavior: "allow",
        updatedInput: input  // Pass through the original input unchanged
      }
    : {
        behavior: "deny",
        message: "Permission denied by user"
      };
  
  const response = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: request_id,
      response: responsePayload
    }
  };

  if (stdin && !stdin.destroyed) {
    stdin.write(JSON.stringify(response) + '\n');
    console.log(`${allow ? '✅' : '❌'} Permission ${allow ? 'granted' : 'denied'} for ${tool_name}`);
  } else {
    console.error(`⚠️  Cannot send permission response - stdin closed`);
  }
}

/**
 * Send message to Claude and then request TTS generation in same session
 * This is a 2-turn conversation:
 * Turn 1: User message → Claude responds with text
 * Turn 2: Request TTS tool call → Extract audio
 *
 * @param {Object} options - Same as sendToClaudeSession plus TTS params
 * @returns {Promise<Object>} { success, text, audio, metadata }
 */
async function sendToClaudeWithTTS(options) {
  const {
    message,
    sessionId,
    claudeCmd = 'claude',
    ttsVoice = 'nova',
    ttsSpeed = 1.0,
    ttsProvider = null,  // Optional: TTS provider (openai, elevenlabs, google)
    botId,
    telegramUserId,
    onTurn2Start = null,  // Callback when TTS generation starts
    messageContent = null,  // Optional structured content (for images)
    workspacePath = null,  // Optional workspace directory for Claude
    timeout = 120000  // Inactivity timeout (default 120s)
  } = options;

  // Step 1: Get text response from Claude (simple mode, no TTS tools needed)
  const textResult = await sendToClaudeSession({
    message,
    sessionId,
    claudeCmd,
    messageContent,
    workspacePath,
    timeout,
    botId,
    telegramUserId,
    chatId: options.chatId,
    statusMsgId: options.statusMsgId
  });

  if (!textResult.success) {
    return textResult;
  }

  const textResponse = textResult.text;
  console.log(`✅ Text response received (${textResponse.length} chars)`);
  console.log(`🎤 Requesting TTS generation via HTTP...`);

  // Notify that TTS generation is starting
  if (onTurn2Start) {
    try {
      onTurn2Start();
    } catch (err) {
      console.error('Error in onTurn2Start callback:', err);
    }
  }

  // Step 2: Generate audio via direct HTTP call to TTS service
  const audioFilename = `bot-${botId}-user-${telegramUserId}-${Date.now()}`;
  const audioOutputDir = path.join(process.cwd(), 'audio-output');

  // Create organized directory structure: audio-output/bot-X/user-Y/
  const organizedDir = path.join(audioOutputDir, `bot-${botId}`, `user-${telegramUserId}`);
  fs.mkdirSync(organizedDir, { recursive: true });

  const ttsPayload = {
    text: textResponse,
    voice: ttsVoice,
    speed: ttsSpeed,
    filename: audioFilename,
    output_dir: organizedDir,
    include_base64: false
  };

  if (ttsProvider) {
    ttsPayload.provider = ttsProvider;
  }

  try {
    // Call TTS HTTP service directly
    const ttsResponse = await fetch('http://localhost:3001/text_to_speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ttsPayload)
    });

    if (!ttsResponse.ok) {
      const errorText = await ttsResponse.text();
      console.error(`❌ TTS service error: ${ttsResponse.status} - ${errorText}`);
      return {
        success: true,
        text: textResponse,
        audioPath: null,
        metadata: textResult.metadata
      };
    }

    const ttsResult = await ttsResponse.json();

    if (ttsResult.audio_path && fs.existsSync(ttsResult.audio_path)) {
      console.log(`🎵 Audio file created: ${ttsResult.audio_path}`);
      return {
        success: true,
        text: textResponse,
        audioPath: ttsResult.audio_path,
        metadata: textResult.metadata
      };
    } else {
      console.error(`⚠️  Audio file not created`);
      return {
        success: true,
        text: textResponse,
        audioPath: null,
        metadata: textResult.metadata
      };
    }
  } catch (error) {
    console.error(`❌ TTS error:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 2-Turn Image Generation Flow (identical to TTS, but generates images instead of audio)
 */
async function sendToClaudeWithImage(options) {
  const { message, messageContent, userText, sessionId, claudeCmd, botId, telegramUserId, imageModel, imageSize, imageQuality, imageStyle, imagePromptContext, onTurn2Start, userId, workflowId } = options;

  return new Promise((resolve, reject) => {
    let turn = 1;
    let fullResponse = '';
    let imageData = null;
    let sessionInfo = null;
    let imageFilename = null;
    let resolved = false; // Track if Promise already resolved

    // Build command with appropriate MCP config
    let mcpConfigPath;
    let cmd = claudeCmd;

    // Disable filesystem tools - agents should only use MCP tools
    const disallowedTools = 'Read,Write,Edit,Bash,Glob,Grep,NotebookEdit,Task';

    if (sessionId) {
      // Turn 2 - resuming session, needs image tools available
      mcpConfigPath = generateMcpConfig('with-image-tools', { userId, workflowId });
      cmd = `${claudeCmd} --ide --resume ${sessionId} --input-format stream-json --output-format stream-json --verbose --dangerously-skip-permissions --disallowedTools "${disallowedTools}" --strict-mcp-config --mcp-config ${mcpConfigPath}`;
      console.log(`🚀 Spawning (Image mode Turn 2 - with image tools): ${claudeCmd} --ide --resume ${sessionId}`);
      turn = 2; // Set turn to 2 for resumed session
    } else {
      // Turn 1 - new session, NO image tools to prevent accidental calls
      mcpConfigPath = generateMcpConfig('no-image-tools', { userId, workflowId });
      cmd = `${claudeCmd} --input-format stream-json --output-format stream-json --verbose --dangerously-skip-permissions --disallowedTools "${disallowedTools}" --strict-mcp-config --mcp-config ${mcpConfigPath}`;
      console.log(`🚀 Spawning (Image mode Turn 1 - no image tools): ${claudeCmd}`);
    }

    const child = spawn('bash', ['-c', cmd], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // If this is Turn 2 (sessionId provided), send image generation request immediately
    if (sessionId) {
      // Generate structured filename for image file
      imageFilename = `bot-${botId}-user-${telegramUserId}-${Date.now()}`;

      // Send turn 2: Request image generation tool call
      const styleContextSection = imagePromptContext
        ? `\n\nSTYLE CONTEXT:\n${imagePromptContext}\n\nYou MUST follow the style context above when creating the prompt.\n`
        : '';

      const userRequest = userText || 'Generate an image';
      const imagePrompt = imagePromptContext
        ? `${userRequest}. Style: ${imagePromptContext}`
        : userRequest;

      const imageRequestText = `CRITICAL INSTRUCTION: Call the mcp__image-gen__generate_image tool NOW with the EXACT parameters below.${styleContextSection}

DO NOT modify, interpret, or change any of these parameters. Use them EXACTLY as specified:

REQUIRED TOOL CALL:
Tool: mcp__image-gen__generate_image

EXACT PARAMETERS (DO NOT CHANGE):
{
  "prompt": "${imagePrompt.replace(/"/g, '\\"')}",
  "model": "${imageModel || 'dall-e-2'}",
  "size": "${imageSize || '256x256'}",
  "quality": "${imageQuality || 'standard'}",
  "style": "${imageStyle || 'vivid'}",
  "filename": "${imageFilename}",
  "include_base64": false
}

CRITICAL: Use the filename parameter EXACTLY as provided: "${imageFilename}"
DO NOT create a custom filename. DO NOT modify the filename parameter.

Call the tool now with these exact parameters. No additional response needed.`;

      const turn2Message = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: imageRequestText
        }
      });

      console.log('📤 Turn 2 image generation request sent');
      child.stdin.write(turn2Message + '\n');
    }

    // Track the Claude process PID for cleanup
    const claudePid = child.pid;

    // Track request for restart recovery
    if (botId && telegramUserId && options.chatId && options.statusMsgId) {
      trackRequest(botId, telegramUserId, {
        chatId: options.chatId,
        statusMsgId: options.statusMsgId,
        claudePid,
        mode: 'image',
        sessionId
      }).catch(err => {
        console.warn('⚠️  Failed to track image request:', err.message);
      });
    }

    child.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(line => line.trim());

      lines.forEach(line => {
        try {
          const data = JSON.parse(line);
          console.log(`🔍 [Turn ${turn}] type=${data.type}`);

          // DEBUG: Log full data for Turn 2 to diagnose
          if (turn === 2) {
            console.log(`🔧 FULL Turn 2 event:`, JSON.stringify(data).substring(0, 500));
          }

          switch (data.type) {
            case 'system':
              sessionInfo = {
                sessionId: data.session_id,
                model: data.model,
                tools: data.tools?.length || 0
              };
              console.log(`📋 Session initialized: ${data.model || 'unknown'}, sessionId: ${data.session_id}`);
              break;

            case 'content_block_delta':
              if (turn === 1 && data.delta?.text) {
                fullResponse += data.delta.text;
              }
              break;

            case 'user':
              // In Turn 2, capture tool results that come as type:"user" messages
              if (turn === 2 && data.message?.content) {
                const content = Array.isArray(data.message.content) ? data.message.content : [data.message.content];

                // Look for tool_result in the content array
                for (const item of content) {
                  if (item.type === 'tool_result' && item.content) {
                    console.log(`🔧 DEBUG: Found tool_result in user message`);
                    try {
                      // Content can be array or string
                      let resultText = '';
                      if (Array.isArray(item.content)) {
                        resultText = item.content.find(c => c.type === 'text')?.text || '';
                      } else if (typeof item.content === 'string') {
                        resultText = item.content;
                      }

                      if (resultText) {
                        console.log(`🔧 DEBUG: Tool result text:`, resultText.substring(0, 200));
                        const result = JSON.parse(resultText);
                        if (result.success && result.image_path) {
                          imageData = result.image_path;
                          console.log(`🖼️  Image captured from user event: ${imageData}`);
                        }
                      }
                    } catch (e) {
                      console.error('⚠️  Failed to parse tool result from user message:', e.message);
                    }
                  }
                }
              }
              break;

            case 'tool_result':
              // Capture image generation result (legacy path - may not fire with current CLI)
              console.log(`🔧 DEBUG: Got tool_result event, tool_name=${data.tool_name}`);
              if (data.tool_name === 'mcp__image-gen__generate_image' && data.result) {
                console.log(`🔧 DEBUG: Image tool result:`, JSON.stringify(data.result).substring(0, 200));
                try {
                  const result = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
                  console.log(`🔧 DEBUG: Parsed result, success=${result.success}, has image_path=${!!result.image_path}`);
                  if (result.success && result.image_path) {
                    imageData = result.image_path;
                    console.log(`🖼️  Image captured: ${imageData}`);
                  } else {
                    console.log(`⚠️  Result missing image_path or success=false`);
                  }
                } catch (e) {
                  console.error('⚠️  Failed to parse image result:', e.message);
                }
              }
              break;

            case 'result':
              if (turn === 1) {
                // Turn 1 complete - close this process and spawn Turn 2 with image tools
                console.log(`✅ Turn 1 complete (${data.duration_ms}ms) - text response received`);
                console.log(`🔄 Closing Turn 1 process and spawning Turn 2 with image tools...`);

                // Notify that Turn 2 (image generation) is starting
                if (onTurn2Start) {
                  try {
                    onTurn2Start();
                  } catch (err) {
                    console.error('Error in onTurn2Start callback:', err);
                  }
                }

                // Close stdin and let the process end
                child.stdin.end();

                // Clean up MCP children for this process
                killMcpChildren(claudePid);

                // Now spawn Turn 2 with the sessionId (will have image tools available)
                // Recursively call sendToClaudeWithImage with sessionId to trigger Turn 2
                sendToClaudeWithImage({
                  ...options,
                  sessionId: sessionInfo.sessionId,  // Pass the session ID from Turn 1
                  message: null,  // Turn 2 doesn't need the original message
                  messageContent: null
                }).then(turn2Result => {
                  // Merge Turn 1 text with Turn 2 image result
                  resolve({
                    success: true,
                    text: fullResponse,  // Text from Turn 1
                    imagePath: turn2Result.imagePath,  // Image from Turn 2
                    metadata: { sessionInfo }
                  });
                }).catch(err => {
                  reject(err);
                });

              } else if (turn === 2) {
                // Turn 2 complete - use the image path from tool result
                console.log(`✅ Turn 2 complete (${data.duration_ms}ms)`);

                try {
                  // Use the image path we captured from the tool result
                  if (imageData && fs.existsSync(imageData)) {
                    const imageOutputDir = path.join(process.cwd(), 'image-output');

                    // Create organized directory structure: image-output/bot-X/user-Y/
                    const organizedDir = path.join(imageOutputDir, `bot-${botId}`, `user-${telegramUserId}`);
                    fs.mkdirSync(organizedDir, { recursive: true });

                    // Move file to organized location
                    const filename = path.basename(imageData);
                    const newPath = path.join(organizedDir, filename);
                    fs.renameSync(imageData, newPath);

                    console.log(`🖼️  Image file organized: ${newPath}`);

                    resolved = true;
                    child.stdin.end(); // Close stdin to signal we're done
                    resolve({
                      success: true,
                      text: fullResponse,
                      imagePath: newPath,
                      metadata: { sessionInfo }
                    });
                  } else {
                    console.error(`⚠️  Image file not found at path: ${imageData}`);
                    child.stdin.end(); // Close stdin even on error
                    resolve({
                      success: true,
                      text: fullResponse,
                      imagePath: null,
                      metadata: { sessionInfo }
                    });
                  }
                } catch (err) {
                  console.error(`⚠️  Error organizing image file:`, err.message);
                  child.stdin.end(); // Close stdin on error
                  resolve({
                    success: true,
                    text: fullResponse,
                    imagePath: null,
                    metadata: { sessionInfo }
                  });
                }
              }
              break;
          }
        } catch (err) {
          console.error(`⚠️  Failed to parse JSON:`, err.message);
        }
      });
    });

    child.stderr.on('data', (data) => {
      // Suppress verbose stderr unless it's an error
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('Failed')) {
        console.error('Claude stderr:', msg);
      }
    });

    child.on('error', (error) => {
      reject({ success: false, error: `Failed to spawn: ${error.message}` });
    });

    child.on('close', (code) => {
      // Clean up any MCP server child processes
      killMcpChildren(claudePid);

      if (!resolved && code !== 0 && !imageData) {
        reject({ success: false, error: `Process exited with code ${code}` });
      }
    });

    // Send turn 1: User message in JSON format (only if NOT resuming for Turn 2)
    if (!sessionId) {
      const turn1Message = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: messageContent || message
        }
      });
      child.stdin.write(turn1Message + '\n');
    }
  });
}

module.exports = { sendToClaudeSession, sendToClaudeWithTTS, sendToClaudeWithImage };

