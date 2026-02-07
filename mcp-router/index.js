#!/usr/bin/env node

/**
 * MCP Router
 *
 * Lightweight MCP server that routes tool calls to shared HTTP services.
 * One instance per Claude CLI session (runs via stdio).
 * Routes to globally shared HTTP services to avoid process explosion.
 *
 * Architecture:
 *   Claude CLI → MCP Router (stdio) → HTTP Services (shared)
 *
 * Benefits:
 *   - Each conversation spawns: 1 Claude CLI + 1 Router = 2 processes
 *   - HTTP services run once globally (shared across all conversations)
 *   - 100 users = 200 processes + 5 services = 205 total (vs 800 with stdio MCPs)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';

// Self-contained API key loading — no external dependencies
// API_KEYS_PATH env var points to the project's api-keys.json
const API_KEYS_PATH = process.env.API_KEYS_PATH;
let _keys = null;

function loadKeys() {
  if (!_keys) {
    if (!API_KEYS_PATH) {
      _keys = {};
      return _keys;
    }
    try {
      _keys = JSON.parse(readFileSync(API_KEYS_PATH, 'utf-8'));
    } catch (e) {
      console.error(`⚠️  Failed to load API keys from ${API_KEYS_PATH}: ${e.message}`);
      _keys = {};
    }
  }
  return _keys;
}

function getKeysForService(service) {
  const allKeys = loadKeys();
  const prefix = service + '_';
  const result = {};
  for (const [key, value] of Object.entries(allKeys)) {
    if (key.startsWith(prefix)) {
      result[key.slice(prefix.length)] = value;
    }
  }
  return result;
}

// R2 configuration from environment (passed from claude-client.js)
const R2_UPLOAD_URL = process.env.R2_UPLOAD_URL || 'http://localhost:8080/assets/upload';
const CURRENT_USER_ID = process.env.CURRENT_USER_ID || 'anonymous';
const CURRENT_WORKFLOW_ID = process.env.CURRENT_WORKFLOW_ID || 'general';

// Built-in tool: download_url_to_r2
// This is handled directly by the router (no HTTP service needed)
const BUILTIN_TOOLS = {
  'download_url_to_r2': {
    name: 'download_url_to_r2',
    description: 'Download content from a URL and save it to R2 storage. Useful for saving web images, files, or any URL content to permanent storage. Returns a public URL that never expires.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to download content from'
        },
        filename: {
          type: 'string',
          description: 'Optional filename for the saved file. If not provided, will be extracted from URL or generated.'
        }
      },
      required: ['url']
    }
  }
};

// HTTP Service endpoints
const IMAGE_TOOLS = {
  'generate_image': {
    url: 'http://localhost:3002/generate_image',
    schemaUrl: 'http://localhost:3002/schema'
  },
  'edit_image': {
    url: 'http://localhost:3002/edit_image',
    schemaUrl: 'http://localhost:3002/schema'
  },
  'list_image_models': {
    url: 'http://localhost:3002/list_image_models',
    schemaUrl: 'http://localhost:3002/schema'
  }
};

const BASE_SERVICES = {
  // TTS Service
  'text_to_speech': {
    url: 'http://localhost:3001/text_to_speech',
    schemaUrl: 'http://localhost:3001/schema'
  },
  'list_tts_voices': {
    url: 'http://localhost:3001/list_tts_voices',
    schemaUrl: 'http://localhost:3001/schema'
  },

  // Chat Context Service
  'list_sessions': {
    url: 'http://localhost:3003/list_sessions',
    schemaUrl: 'http://localhost:3003/schema'
  },
  'search_sessions': {
    url: 'http://localhost:3003/search_sessions',
    schemaUrl: 'http://localhost:3003/schema'
  },
  'get_session': {
    url: 'http://localhost:3003/get_session',
    schemaUrl: 'http://localhost:3003/schema'
  },
  'nickname_current_session': {
    url: 'http://localhost:3003/nickname_current_session',
    schemaUrl: 'http://localhost:3003/schema'
  },
  'add_tag': {
    url: 'http://localhost:3003/add_tag',
    schemaUrl: 'http://localhost:3003/schema'
  },
  'remove_tag': {
    url: 'http://localhost:3003/remove_tag',
    schemaUrl: 'http://localhost:3003/schema'
  },
  'list_tags': {
    url: 'http://localhost:3003/list_tags',
    schemaUrl: 'http://localhost:3003/schema'
  },
  'list_projects': {
    url: 'http://localhost:3003/list_projects',
    schemaUrl: 'http://localhost:3003/schema'
  },
  'sync_sessions': {
    url: 'http://localhost:3003/sync_sessions',
    schemaUrl: 'http://localhost:3003/schema'
  },

  // Live Data Service (sports scores, stock quotes, news headlines)
  'get_live_scores': {
    url: 'http://localhost:3004/get_live_scores',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'get_injuries': {
    url: 'http://localhost:3004/get_injuries',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'get_standings': {
    url: 'http://localhost:3004/get_standings',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'get_sports_news': {
    url: 'http://localhost:3004/get_sports_news',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'get_stock_quote': {
    url: 'http://localhost:3004/get_stock_quote',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'get_news_headlines': {
    url: 'http://localhost:3004/get_news_headlines',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'get_prediction_markets': {
    url: 'http://localhost:3004/get_prediction_markets',
    schemaUrl: 'http://localhost:3004/schema'
  },
  // Tapjot - Snippets
  'tapjot_list_snippets': {
    url: 'http://localhost:3004/tapjot_list_snippets',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'tapjot_create_snippet': {
    url: 'http://localhost:3004/tapjot_create_snippet',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'tapjot_update_snippet': {
    url: 'http://localhost:3004/tapjot_update_snippet',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'tapjot_delete_snippet': {
    url: 'http://localhost:3004/tapjot_delete_snippet',
    schemaUrl: 'http://localhost:3004/schema'
  },
  // Tapjot - Projects
  'tapjot_list_projects': {
    url: 'http://localhost:3004/tapjot_list_projects',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'tapjot_create_project': {
    url: 'http://localhost:3004/tapjot_create_project',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'tapjot_update_project': {
    url: 'http://localhost:3004/tapjot_update_project',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'tapjot_delete_project': {
    url: 'http://localhost:3004/tapjot_delete_project',
    schemaUrl: 'http://localhost:3004/schema'
  },
  // Tapjot - Views
  'tapjot_list_views': {
    url: 'http://localhost:3004/tapjot_list_views',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'tapjot_create_view': {
    url: 'http://localhost:3004/tapjot_create_view',
    schemaUrl: 'http://localhost:3004/schema'
  },
  'tapjot_delete_view': {
    url: 'http://localhost:3004/tapjot_delete_view',
    schemaUrl: 'http://localhost:3004/schema'
  }
};

// All tools always available — LLM decides when to call image tools based on system prompt
const HTTP_SERVICES = { ...BASE_SERVICES, ...IMAGE_TOOLS };

console.log(`🔀 MCP Router starting...`);
console.log(`   Routing to ${Object.keys(HTTP_SERVICES).length} HTTP services`);

// Create MCP server
const server = new Server(
  {
    name: 'mcp-router',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Cache for tool schemas (fetched from HTTP services on startup)
let cachedTools = [];
let schemasFetched = false;

/**
 * Handle download_url_to_r2 built-in tool
 */
async function handleDownloadUrlToR2(args) {
  const { url, filename } = args;

  console.log(`📥 Downloading from URL: ${url}`);

  try {
    // Fetch the content from the URL
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: HTTP ${response.status}`);
    }

    // Get content type from response
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    // Determine filename
    let finalFilename = filename;
    if (!finalFilename) {
      // Try to extract from URL
      const urlPath = new URL(url).pathname;
      const urlFilename = urlPath.split('/').pop();
      if (urlFilename && urlFilename.includes('.')) {
        finalFilename = urlFilename;
      } else {
        // Generate based on content type
        const ext = contentType.split('/')[1]?.split(';')[0] || 'bin';
        finalFilename = `download-${Date.now()}.${ext}`;
      }
    }

    // Get content as buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`   📦 Downloaded ${buffer.length} bytes (${contentType})`);

    // Build upload URL with query params (server expects workflowId, filename, contentType as query params)
    const uploadUrl = new URL(R2_UPLOAD_URL);
    uploadUrl.searchParams.set('workflowId', `users/${CURRENT_USER_ID}/workflows/${CURRENT_WORKFLOW_ID}`);
    uploadUrl.searchParams.set('filename', finalFilename);
    uploadUrl.searchParams.set('contentType', contentType);

    console.log(`   ☁️  Uploading to: ${uploadUrl.toString()}`);

    // Upload to R2 via the upload endpoint (raw body, not form data)
    const uploadResponse = await fetch(uploadUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': contentType
      },
      body: buffer
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`R2 upload failed: ${errorText}`);
    }

    const uploadResult = await uploadResponse.json();

    console.log(`   ☁️  Uploaded to R2: ${uploadResult.key}`);

    return {
      success: true,
      r2_url: uploadResult.signedUrl, // This is now the public URL
      r2_key: uploadResult.key,
      source_url: url,
      filename: finalFilename,
      content_type: contentType,
      size_bytes: buffer.length
    };

  } catch (error) {
    console.error(`❌ download_url_to_r2 failed:`, error.message);
    throw error;
  }
}

/**
 * Fetch tool schemas from all HTTP services
 */
async function fetchToolSchemas() {
  if (schemasFetched) return cachedTools;

  console.log('📋 Fetching tool schemas from HTTP services...');
  const tools = [];

  // Add built-in tools first
  for (const tool of Object.values(BUILTIN_TOOLS)) {
    tools.push(tool);
    console.log(`   ✓ Registered built-in tool: ${tool.name}`);
  }

  const uniqueSchemaUrls = [...new Set(
    Object.values(HTTP_SERVICES).map(s => s.schemaUrl)
  )];

  for (const schemaUrl of uniqueSchemaUrls) {
    try {
      const response = await fetch(schemaUrl);
      if (!response.ok) {
        console.error(`⚠️  Failed to fetch schema from ${schemaUrl}: ${response.status}`);
        continue;
      }
      const schemas = await response.json();
      tools.push(...schemas);
      console.log(`   ✓ Loaded ${schemas.length} tool(s) from ${schemaUrl}`);
    } catch (error) {
      console.error(`⚠️  Error fetching schema from ${schemaUrl}:`, error.message);
    }
  }

  cachedTools = tools;
  schemasFetched = true;
  console.log(`✅ Registered ${tools.length} total tools (${Object.keys(BUILTIN_TOOLS).length} built-in)`);
  return tools;
}

// Register tool listing handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await fetchToolSchemas();
  return { tools };
});

// Register tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  console.log(`🔀 Routing tool call: ${name}`);

  // Check for built-in tools first
  if (BUILTIN_TOOLS[name]) {
    try {
      let result;
      if (name === 'download_url_to_r2') {
        result = await handleDownloadUrlToR2(args);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error(`❌ Built-in tool ${name} failed:`, error.message);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: error.message, tool: name }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }

  // Find the HTTP service for this tool
  const service = HTTP_SERVICES[name];

  if (!service) {
    const allTools = [...Object.keys(BUILTIN_TOOLS), ...Object.keys(HTTP_SERVICES)];
    const error = `Tool "${name}" not found in router configuration. Available tools: ${allTools.join(', ')}`;
    console.error(`❌ ${error}`);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error }, null, 2),
        },
      ],
      isError: true,
    };
  }

  try {
    // Forward request to HTTP service
    console.log(`   → Forwarding to ${service.url}`);

    // Build request body with R2 config for media generation tools
    const requestBody = { ...args };

    // For TTS and image tools, pass R2 config so services upload directly
    if (name === 'text_to_speech' || name === 'generate_image' || name === 'edit_image') {
      requestBody.r2_config = {
        upload_url: R2_UPLOAD_URL,
        user_id: CURRENT_USER_ID,
        workflow_id: CURRENT_WORKFLOW_ID
      };
      console.log(`   ☁️  R2 config: user=${CURRENT_USER_ID}, workflow=${CURRENT_WORKFLOW_ID}`);
    }

    // Add api_keys based on which service the tool belongs to
    if (name === 'text_to_speech' || name === 'list_tts_voices') {
      requestBody.api_keys = getKeysForService('tts');
    } else if (name === 'generate_image' || name === 'edit_image' || name === 'list_image_models') {
      requestBody.api_keys = getKeysForService('image_gen');
    } else if (name.startsWith('tapjot_') || name === 'get_stock_quote' || name === 'get_news_headlines') {
      requestBody.api_keys = getKeysForService('live_data');
    }

    const response = await fetch(service.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    console.log(`   ✓ Success (${JSON.stringify(result).length} bytes)`);

    // Return result in MCP format
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };

  } catch (error) {
    console.error(`❌ Error routing ${name}:`, error.message);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.message,
            tool: name,
            service: service.url
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Connect to Claude CLI via stdio
const transport = new StdioServerTransport();
await server.connect(transport);

console.log('✅ MCP Router connected and ready');
