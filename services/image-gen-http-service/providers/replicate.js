import Replicate from 'replicate';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Replicate Image Generation Provider
 *
 * Supports Stable Diffusion models via Replicate API
 * Requires REPLICATE_API_TOKEN environment variable
 */
export class ReplicateProvider {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  /**
   * Initialize the Replicate client
   */
  async initialize() {
    try {
      const apiToken = process.env.REPLICATE_API_TOKEN;

      if (!apiToken) {
        throw new Error('REPLICATE_API_TOKEN environment variable not set');
      }

      this.client = new Replicate({ auth: apiToken });

      console.log('✅ Replicate initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Replicate:', error.message);
      throw new Error(`Replicate initialization failed: ${error.message}`);
    }
  }

  /**
   * Download image from URL to buffer
   */
  async downloadImage(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Generate image from text prompt using Stable Diffusion
   *
   * @param {Object} params
   * @param {string} params.prompt - Text description
   * @param {string} [params.model] - Model version (sdxl, sd-1.5, etc.)
   * @param {string} [params.size] - Image size (not directly supported, uses width/height)
   * @param {number} [params.seed] - Random seed for deterministic generation
   * @param {number} [params.num_inference_steps] - Number of denoising steps (default: 30)
   * @param {number} [params.guidance_scale] - Prompt adherence (default: 7.5)
   * @param {string} [params.filename] - Custom filename prefix
   * @returns {Promise<Object>} Image data and metadata
   */
  async generateImage({ prompt, model, size, seed, num_inference_steps, guidance_scale, filename }) {
    if (!this.client) {
      await this.initialize();
    }

    // Parse size (e.g., "1024x1024" → width: 1024, height: 1024)
    const imageSize = size || '1024x1024';
    const [width, height] = imageSize.split('x').map(Number);

    // Map shorthand model names to full Replicate references
    const modelMap = {
      'sdxl': 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
      'sd-1.5': 'stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf',
      'sd3': 'stability-ai/stable-diffusion-3'
    };

    // Use full model reference (either from map or use as-is if already full reference)
    const modelVersion = modelMap[model] || model || 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b';

    try {
      console.log(`🎨 Generating image with Replicate ${modelVersion}...`);

      const output = await this.client.run(
        modelVersion,
        {
          input: {
            prompt,
            width,
            height,
            num_inference_steps: num_inference_steps || 30,
            guidance_scale: guidance_scale || 7.5,
            seed: seed || Math.floor(Math.random() * 1000000)
          }
        }
      );

      // Replicate returns array of image URLs
      const imageUrl = Array.isArray(output) ? output[0] : output;

      // Download image
      const imageBuffer = await this.downloadImage(imageUrl);

      // Generate filename
      const timestamp = Date.now();
      const finalFilename = filename ? `${filename}.png` : `replicate-${timestamp}.png`;

      return {
        success: true,
        image_data: imageBuffer,
        image_url: imageUrl,
        filename: finalFilename,
        model_used: modelVersion,
        seed: seed,
        width,
        height
      };

    } catch (error) {
      console.error('❌ Replicate image generation failed:', error.message);
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }

  /**
   * Edit image using img2img (photo → cartoon transformation)
   *
   * @param {Object} params
   * @param {string} params.image - Base64 data URI or URL of input image
   * @param {string} params.prompt - Text description of desired output
   * @param {string} [params.negative_prompt] - What to avoid in the output
   * @param {string} [params.model] - Model version to use
   * @param {string} [params.size] - Output image size
   * @param {number} [params.strength] - How much to transform (0.0-1.0, default: 0.5)
   * @param {number} [params.seed] - Random seed for reproducibility
   * @param {number} [params.num_inference_steps] - Denoising steps (default: 25)
   * @param {number} [params.guidance_scale] - Prompt adherence (default: 8)
   * @param {string} [params.filename] - Custom filename prefix
   * @returns {Promise<Object>} Edited image data and metadata
   */
  async editImage({ image, prompt, negative_prompt, model, size, strength, seed, num_inference_steps, guidance_scale, filename }) {
    if (!this.client) {
      await this.initialize();
    }

    // Parse size
    const imageSize = size || '1024x1024';
    const [width, height] = imageSize.split('x').map(Number);

    // Map shorthand model names to full Replicate references
    const modelMap = {
      'editorial-cartoon': 'roblester/editorial-cartoon',
      'sdxl': 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
      'sd-1.5': 'stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf',
      'sd3': 'stability-ai/stable-diffusion-3'
    };

    // Use full model reference (either from map or use as-is if already full reference)
    const modelVersion = modelMap[model] || model || 'roblester/editorial-cartoon';

    try {
      console.log(`✏️  Editing image with Replicate ${modelVersion}...`);
      console.log(`📝 Prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
      console.log(`🎲 Strength: ${strength || 0.5}, Seed: ${seed || 'random'}`);
      console.log(`📷 Image type: ${typeof image}, starts with: ${image.substring(0, 50)}`);

      const runInput = {
        prompt,
        image, // Data URI or URL
        prompt_strength: strength || 0.5,
        num_inference_steps: num_inference_steps || 25,
        guidance_scale: guidance_scale || 8,
        seed: seed || Math.floor(Math.random() * 1000000),
        width,
        height
      };

      // Add negative_prompt if provided
      if (negative_prompt) {
        runInput.negative_prompt = negative_prompt;
      }

      const output = await this.client.run(
        modelVersion,
        {
          input: runInput
        }
      );

      // Replicate returns array of image URLs
      const imageUrl = Array.isArray(output) ? output[0] : output;

      // Download image
      const imageBuffer = await this.downloadImage(imageUrl);

      // Generate filename and save to disk
      const timestamp = Date.now();
      const format = 'png';
      const outputDir = this.config.output_dir || './image-output';

      let filePrefix = 'replicate-img2img';
      if (filename) {
        filePrefix = filename.replace(/[^a-zA-Z0-9_-]/g, '-');
      }

      const generatedFilename = `${filePrefix}-${timestamp}.${format}`;
      const filePath = path.join(outputDir, generatedFilename);

      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });

      // Write image file
      await fs.writeFile(filePath, imageBuffer);

      // Convert to base64 for optional embedding
      const base64Image = imageBuffer.toString('base64');

      return {
        success: true,
        image_path: filePath,
        image_base64: base64Image,
        image_data: imageBuffer,
        image_url: imageUrl,
        filename: generatedFilename,
        format: format,
        file_size_bytes: imageBuffer.length,
        model_used: modelVersion,
        strength,
        seed,
        size: `${width}x${height}`,
        width,
        height
      };

    } catch (error) {
      console.error('❌ Replicate image editing failed:', error.message);
      console.error('Full error:', error);
      throw new Error(`Image editing failed: ${error.message}`);
    }
  }
}
