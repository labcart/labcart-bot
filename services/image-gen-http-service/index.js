#!/usr/bin/env node

/**
 * Image Generation HTTP Service (Standalone)
 *
 * Self-contained HTTP server that provides image generation functionality.
 * Runs once globally and serves all MCP Router instances.
 *
 * No MCP dependencies - just Express + OpenAI DALL-E provider
 */

import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Upload a file to R2 storage via HTTP endpoint
 * @param {string} localPath - Path to the local file
 * @param {object} r2Config - R2 configuration { upload_url, user_id, workflow_id }
 * @returns {Promise<{r2_url: string, r2_key: string} | null>} R2 result or null on failure
 */
async function uploadToR2(localPath, r2Config) {
  if (!r2Config || !r2Config.upload_url) {
    return null;
  }

  try {
    const fileContent = fsSync.readFileSync(localPath);
    const filename = path.basename(localPath);
    const ext = path.extname(localPath).slice(1);

    // Determine content type
    const contentTypes = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'webp': 'image/webp',
      'gif': 'image/gif'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    // Build R2 path
    const r2Path = r2Config.workflow_id && r2Config.workflow_id !== 'general'
      ? `users/${r2Config.user_id}/workflows/${r2Config.workflow_id}`
      : `users/${r2Config.user_id}/files`;

    const uploadUrl = `${r2Config.upload_url}?workflowId=${encodeURIComponent(r2Path)}&filename=${encodeURIComponent(filename)}&contentType=${encodeURIComponent(contentType)}`;

    console.log(`   ☁️  Uploading to R2: ${filename}`);

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: fileContent
    });

    if (response.ok) {
      const result = await response.json();
      // Delete local file after successful upload
      fsSync.unlinkSync(localPath);
      console.log(`   ✓ Uploaded to R2: ${result.key}`);
      return { r2_url: result.signedUrl, r2_key: result.key };
    } else {
      console.warn(`   ⚠️  R2 upload failed: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.warn(`   ⚠️  R2 upload error: ${error.message}`);
    return null;
  }
}

// Import providers from local directory
import { OpenAIDALLEProvider } from './providers/openai-dalle.js';
import { ReplicateProvider } from './providers/replicate.js';
import { GoogleImagenProvider } from './providers/google-imagen.js';
import { requestQueue } from './utils/request-queue.js';
import { logUsage } from './utils/usage-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Load configuration
let config;
try {
  const configPath = path.join(__dirname, 'config.json');
  const configData = await fs.readFile(configPath, 'utf-8');
  config = JSON.parse(configData);
} catch (error) {
  console.error('❌ Failed to load config.json:', error.message);
  process.exit(1);
}

// Initialize providers
const providerName = config.provider || 'openai';
let imageProvider;

// Initialize all providers
const openaiProvider = new OpenAIDALLEProvider(config.openai);
openaiProvider.config.output_dir = config.output_dir;
openaiProvider.config.output_format = config.output_format;

const replicateProvider = new ReplicateProvider(config.replicate || {});
replicateProvider.config.output_dir = config.output_dir;
replicateProvider.config.output_format = config.output_format;

const imagenProvider = new GoogleImagenProvider(config.imagen || config.gemini || {});
imagenProvider.config.output_dir = config.output_dir;
imagenProvider.config.output_format = config.output_format;

// Default provider based on config
if (providerName === 'openai') {
  imageProvider = openaiProvider;
} else if (providerName === 'replicate') {
  imageProvider = replicateProvider;
} else if (providerName === 'gemini' || providerName === 'google') {
  imageProvider = imagenProvider;
} else {
  console.error(`❌ Unknown provider: ${providerName}`);
  process.exit(1);
}

// Helper function to get provider based on model parameter
function getProviderForModel(model) {
  if (!model) return imageProvider; // Use default

  // Route based on model prefix
  if (model.startsWith('sdxl') || model.startsWith('sd-') || model.startsWith('stability-ai/')) {
    return replicateProvider;
  } else if (model.startsWith('dall-e') || model.startsWith('gpt-image')) {
    return openaiProvider;
  } else if (model.startsWith('imagen') || model.startsWith('gemini') || model.includes('nano-banana')) {
    return imagenProvider;
  } else if (model.includes('/') && model.includes(':')) {
    // Replicate models have format: username/model:version
    // e.g., "aolshaun/tooner-style-v1:48982e09..."
    return replicateProvider;
  } else if (model.includes('/')) {
    // Other models with "/" are likely also Replicate
    return replicateProvider;
  }

  return imageProvider; // Fallback to default
}

console.log(`🎨 Image Generation HTTP Service starting with provider: ${providerName}`);

// Create Express app
const app = express();
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    provider: providerName
  });
});

// Get tool schema (for MCP Router to register)
app.get('/schema', (req, res) => {
  res.json([
    {
      name: 'generate_image',
      description: `Generate images from text prompts using ${providerName}. Returns an image file path and base64-encoded image data. Perfect for creating visual content, illustrations, or creative assets for Telegram bots and other applications.`,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text description of the image to generate. Be specific and detailed for best results.',
          },
          model: {
            type: 'string',
            description: 'Model to use: dall-e-2, dall-e-3, gpt-image-1 (OpenAI), imagen-4.0-fast-generate-001 (Imagen Fast - fastest, $0.02), imagen-4.0-generate-001 (Imagen 4 - best quality, $0.04), imagen-4.0-ultra-generate-001 (Imagen Ultra - highest prompt alignment)',
          },
          size: {
            type: 'string',
            description: 'Image size: 1024x1024, 1792x1024, 1024x1792 (DALL-E 3) or 256x256, 512x512, 1024x1024 (DALL-E 2)',
          },
          quality: {
            type: 'string',
            description: 'Image quality: standard, hd (DALL-E 3 only, default: standard)',
          },
          style: {
            type: 'string',
            description: 'Image style: vivid, natural (DALL-E 3 only, default: vivid)',
          },
          n: {
            type: 'number',
            description: 'Number of images to generate (1-10 for DALL-E 2, only 1 for DALL-E 3, default: 1). Useful for generating variations.',
          },
          include_base64: {
            type: 'boolean',
            description: 'Include base64-encoded image in response (default: false). Set to true only if needed, as it significantly increases response size.',
          },
          filename: {
            type: 'string',
            description: 'Custom filename prefix (optional). Timestamp will be automatically appended. Example: "portrait" becomes "portrait-1234567890.png"',
          },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'edit_image',
      description: `Edit or modify an existing image using AI. Accepts image input (file path or base64) and applies transformations based on text prompts. Perfect for image-to-image transformations, style changes, and modifications.`,
      inputSchema: {
        type: 'object',
        properties: {
          image: {
            type: 'string',
            description: 'Image to edit - provide either a file path (e.g., "/path/to/image.jpg") or base64-encoded image data',
          },
          prompt: {
            type: 'string',
            description: 'Text description of the desired edit or transformation (e.g., "convert to cartoon style", "make it look like an oil painting")',
          },
          mask: {
            type: 'string',
            description: 'Optional mask image (file path or base64) for inpainting - only edits the masked area',
          },
          size: {
            type: 'string',
            description: 'Output image size: 256x256, 512x512, 1024x1024 (default: 1024x1024)',
          },
          n: {
            type: 'number',
            description: 'Number of variations to generate (1-10, default: 1)',
          },
          include_base64: {
            type: 'boolean',
            description: 'Include base64-encoded image in response (default: false)',
          },
          filename: {
            type: 'string',
            description: 'Custom filename prefix (optional)',
          },
        },
        required: ['image', 'prompt'],
      },
    },
    {
      name: 'list_image_models',
      description: `List available image generation models for the ${providerName} provider`,
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ]);
});

// Execute generate_image tool
app.post('/generate_image', async (req, res) => {
  try {
    const { prompt, model, size, quality, style, n, include_base64 = false, filename, output_dir, r2_config } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt parameter is required' });
    }

    // Guard rail: prevent excessive prompt length
    // DALL-E 3 has no documented limit, but let's cap at 10000 to be safe
    if (prompt.length > 10000) {
      return res.status(400).json({
        error: `Prompt too long (${prompt.length} characters). Maximum: 10000 characters.`
      });
    }

    // Select provider based on model
    const provider = getProviderForModel(model);

    console.log(`🎨 [HTTP] Generating image with ${provider === openaiProvider ? 'OpenAI' : 'Replicate'}: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`);
    console.log(`📝 [HTTP] FULL PROMPT:\n${prompt}`);

    const startTime = Date.now();

    // Override output directory if provided in request (allows multi-bot usage)
    if (output_dir) {
      console.log(`📂 [HTTP] Using custom output directory: ${output_dir}`);
      provider.config.output_dir = output_dir;
    }

    // Use queue to prevent concurrent API calls
    const result = await requestQueue.add(async () => {
      return await provider.generateImage({
        prompt,
        model,
        size,
        quality,
        style,
        seed: req.body.seed, // Replicate-specific
        num_inference_steps: req.body.num_inference_steps, // Replicate-specific
        guidance_scale: req.body.guidance_scale, // Replicate-specific
        n,
        filename,
      });
    });

    const durationMs = Date.now() - startTime;

    if (result.count > 1) {
      console.log(`✅ [HTTP] ${result.count} images generated (${durationMs}ms)`);
    } else {
      console.log(`✅ [HTTP] Image generated: ${result.image_path} (${durationMs}ms)`);
    }

    // Log usage
    await logUsage({
      tool: 'generate_image',
      provider: result.provider,
      prompt: prompt,
      model: result.model_used,
      size: result.size,
      filename: filename,
      durationMs: durationMs,
      success: true,
    });

    // Build response
    let response;

    if (result.count > 1) {
      // Batch response - upload each image to R2 if configured
      const images = [];
      for (const img of result.images) {
        const imgData = {
          format: img.format,
          revised_prompt: img.revised_prompt,
          file_size_bytes: img.file_size_bytes,
          ...(include_base64 && { image_base64: img.image_base64 })
        };

        // Upload to R2 if configured
        if (r2_config && img.image_path) {
          const r2Result = await uploadToR2(img.image_path, r2_config);
          if (r2Result) {
            imgData.r2_url = r2Result.r2_url;
            imgData.r2_key = r2Result.r2_key;
          } else {
            imgData.image_path = img.image_path;
          }
        } else {
          imgData.image_path = img.image_path;
          imgData.image_url = img.image_url;
        }
        images.push(imgData);
      }

      response = {
        success: result.success,
        count: result.count,
        images,
        prompt: result.prompt,
        provider: result.provider,
        model_used: result.model_used,
        size: result.size,
        quality: result.quality,
        style: result.style,
      };
    } else {
      // Single image response
      response = {
        success: result.success,
        format: result.format,
        prompt: result.prompt,
        revised_prompt: result.revised_prompt,
        provider: result.provider,
        model_used: result.model_used,
        size: result.size,
        quality: result.quality,
        style: result.style,
        file_size_bytes: result.file_size_bytes,
      };

      // Upload to R2 if configured
      if (r2_config && result.image_path) {
        const r2Result = await uploadToR2(result.image_path, r2_config);
        if (r2Result) {
          response.r2_url = r2Result.r2_url;
          response.r2_key = r2Result.r2_key;
        } else {
          response.image_path = result.image_path;
        }
      } else {
        response.image_path = result.image_path;
        response.image_url = result.image_url;
      }

      // Only include base64 if requested
      if (include_base64) {
        response.image_base64 = result.image_base64;
      }
    }

    res.json(response);

  } catch (error) {
    console.error('❌ [HTTP] Image generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute edit_image tool
app.post('/edit_image', async (req, res) => {
  try {
    const { image, prompt, negative_prompt, mask, model, size, quality, input_fidelity, n, include_base64 = false, filename, output_dir, r2_config } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'image parameter is required' });
    }

    if (!prompt) {
      return res.status(400).json({ error: 'prompt parameter is required' });
    }

    console.log(`✏️  [HTTP] Editing image with ${model || 'dall-e-2'}: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`);
    if (model === 'gpt-image-1') {
      console.log(`📝 [HTTP] GPT-Image-1 params: quality=${quality || 'default'}, input_fidelity=${input_fidelity || 'default'}`);
    }
    console.log(`📝 [HTTP] FULL PROMPT:\n${prompt}`);

    const startTime = Date.now();

    // Select provider based on model
    const provider = getProviderForModel(model);

    // Override output directory if provided in request (allows multi-bot usage)
    if (output_dir) {
      console.log(`📂 [HTTP] Using custom output directory: ${output_dir}`);
      provider.config.output_dir = output_dir;
    }

    // Use queue to prevent concurrent API calls
    const result = await requestQueue.add(async () => {
      return await provider.editImage({
        image,
        prompt,
        negative_prompt,
        mask,
        model,
        size,
        quality,
        input_fidelity,
        strength: req.body.strength, // Replicate-specific
        seed: req.body.seed, // Replicate-specific
        num_inference_steps: req.body.num_inference_steps, // Replicate-specific
        guidance_scale: req.body.guidance_scale, // Replicate-specific
        n,
        filename,
      });
    });

    const durationMs = Date.now() - startTime;

    if (result.count > 1) {
      console.log(`✅ [HTTP] ${result.count} edited images generated (${durationMs}ms)`);
    } else {
      console.log(`✅ [HTTP] Image edited: ${result.image_path} (${durationMs}ms)`);
    }

    // Log usage
    await logUsage({
      tool: 'edit_image',
      provider: result.provider,
      prompt: prompt,
      model: result.model_used,
      size: result.size,
      filename: filename,
      durationMs: durationMs,
      success: true,
    });

    // Build response
    let response;

    if (result.count > 1) {
      // Batch response - upload each image to R2 if configured
      const images = [];
      for (const img of result.images) {
        const imgData = {
          format: img.format,
          file_size_bytes: img.file_size_bytes,
          ...(include_base64 && { image_base64: img.image_base64 })
        };

        if (r2_config && img.image_path) {
          const r2Result = await uploadToR2(img.image_path, r2_config);
          if (r2Result) {
            imgData.r2_url = r2Result.r2_url;
            imgData.r2_key = r2Result.r2_key;
          } else {
            imgData.image_path = img.image_path;
          }
        } else {
          imgData.image_path = img.image_path;
          imgData.image_url = img.image_url;
        }
        images.push(imgData);
      }

      response = {
        success: result.success,
        count: result.count,
        images,
        prompt: result.prompt,
        provider: result.provider,
        model_used: result.model_used,
        size: result.size,
      };
    } else {
      response = {
        success: result.success,
        format: result.format,
        prompt: result.prompt,
        provider: result.provider,
        model_used: result.model_used,
        size: result.size,
        file_size_bytes: result.file_size_bytes,
      };

      // Upload to R2 if configured
      if (r2_config && result.image_path) {
        const r2Result = await uploadToR2(result.image_path, r2_config);
        if (r2Result) {
          response.r2_url = r2Result.r2_url;
          response.r2_key = r2Result.r2_key;
        } else {
          response.image_path = result.image_path;
        }
      } else {
        response.image_path = result.image_path;
        response.image_url = result.image_url;
      }

      if (include_base64) {
        response.image_base64 = result.image_base64;
      }
    }

    res.json(response);

  } catch (error) {
    console.error('❌ [HTTP] Image edit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute list_image_models tool
app.post('/list_image_models', async (req, res) => {
  try {
    console.log(`📋 [HTTP] Listing available models...`);

    const models = await imageProvider.listModels();

    res.json(models);

  } catch (error) {
    console.error('❌ [HTTP] List models error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Initialize and start server
async function main() {
  try {
    // Initialize the image provider
    await imageProvider.initialize();

    const PORT = process.env.IMAGE_HTTP_PORT || config.port || 3002;
    app.listen(PORT, () => {
      console.log(`\n🚀 Image Generation HTTP Service running on http://localhost:${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/health`);
      console.log(`   Schema: http://localhost:${PORT}/schema`);
      console.log(`\n📦 This is a SHARED service - one instance serves all bots\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

main();
