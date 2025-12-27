import OpenAI, { toFile } from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * OpenAI DALL-E Image Generation Provider
 *
 * Requires OPENAI_API_KEY environment variable
 */
export class OpenAIDALLEProvider {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  /**
   * Initialize the OpenAI client
   */
  async initialize() {
    try {
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable not set');
      }

      this.client = new OpenAI({ apiKey });

      console.log('✅ OpenAI DALL-E initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize OpenAI DALL-E:', error.message);
      throw new Error(`OpenAI DALL-E initialization failed: ${error.message}`);
    }
  }

  /**
   * Download image from URL to buffer
   */
  async downloadImage(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Generate image from text prompt
   *
   * @param {Object} params
   * @param {string} params.prompt - Text description of the image to generate
   * @param {string} [params.model] - Model to use (dall-e-2, dall-e-3)
   * @param {string} [params.size] - Image size (1024x1024, 1792x1024, 1024x1792 for dall-e-3)
   * @param {string} [params.quality] - Image quality (standard, hd) - dall-e-3 only
   * @param {string} [params.style] - Image style (vivid, natural) - dall-e-3 only
   * @param {number} [params.n] - Number of images to generate (1-10 for DALL-E 2, only 1 for DALL-E 3)
   * @param {string} [params.filename] - Custom filename prefix (timestamp will be appended)
   * @returns {Promise<Object>} Image data and metadata
   */
  async generateImage({ prompt, model, size, quality, style, n, filename }) {
    if (!this.client) {
      await this.initialize();
    }

    const modelName = model || this.config.model || 'dall-e-3';
    const imageSize = size || this.config.size || '1024x1024';
    const imageQuality = quality || this.config.quality || 'standard';
    const imageStyle = style || this.config.style || 'vivid';

    // Handle batch generation (n parameter)
    // DALL-E 3 only supports n=1, DALL-E 2 supports 1-10
    let numImages = n || 1;
    if (modelName === 'dall-e-3' && numImages > 1) {
      console.warn(`⚠️  DALL-E 3 only supports n=1. Generating 1 image instead of ${numImages}`);
      numImages = 1;
    }
    if (numImages > 10) {
      console.warn(`⚠️  Maximum n=10. Generating 10 images instead of ${numImages}`);
      numImages = 10;
    }

    try {
      // Build request parameters based on model
      const requestParams = {
        model: modelName,
        prompt: prompt,
        n: numImages,
        size: imageSize
      };

      // Add response_format for DALL-E models only (not supported by gpt-image-1)
      if (modelName.startsWith('dall-e')) {
        requestParams.response_format = 'url'; // Get URL first, then download
      }

      // Add DALL-E 3 specific parameters
      if (modelName === 'dall-e-3') {
        requestParams.quality = imageQuality;
        requestParams.style = imageStyle;
      }

      const response = await this.client.images.generate(requestParams);

      // Process all generated images
      const images = [];
      const outputDir = path.resolve(process.cwd(), this.config.output_dir || './image-output');
      await fs.mkdir(outputDir, { recursive: true });

      for (let i = 0; i < response.data.length; i++) {
        const imageData = response.data[i];
        const imageUrl = imageData.url;
        const revisedPrompt = imageData.revised_prompt || prompt;

        // Get image buffer - either from URL (DALL-E) or base64 (gpt-image-1)
        let imageBuffer;
        if (imageUrl) {
          imageBuffer = await this.downloadImage(imageUrl);
        } else if (imageData.b64_json) {
          imageBuffer = Buffer.from(imageData.b64_json, 'base64');
        } else {
          throw new Error('No image data returned from API');
        }

        // Generate filename with optional custom prefix
        const timestamp = Date.now();
        const format = this.config.output_format || 'png';

        // Sanitize custom filename if provided (remove dangerous characters)
        let filePrefix = 'dalle';
        if (filename) {
          filePrefix = filename.replace(/[^a-zA-Z0-9_-]/g, '-');
        }

        // Add index suffix if generating multiple images
        const indexSuffix = numImages > 1 ? `-${i + 1}` : '';
        const generatedFilename = `${filePrefix}${indexSuffix}-${timestamp}.${format}`;
        const filePath = path.join(outputDir, generatedFilename);

        // Write image file
        await fs.writeFile(filePath, imageBuffer);

        // Convert to base64 for optional embedding
        const base64Image = imageBuffer.toString('base64');

        // Add to images array
        images.push({
          image_path: filePath,
          image_base64: base64Image,
          format: format,
          revised_prompt: revisedPrompt,
          file_size_bytes: imageBuffer.length,
          image_url: imageUrl
        });

        // Small delay between downloads to avoid rate limits
        if (i < response.data.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Return result (single image or batch)
      if (numImages === 1) {
        // Backward compatible: return single image object
        return {
          success: true,
          image_path: images[0].image_path,
          image_base64: images[0].image_base64,
          format: images[0].format,
          prompt: prompt,
          revised_prompt: images[0].revised_prompt,
          provider: 'openai',
          model_used: modelName,
          size: imageSize,
          quality: imageQuality,
          style: modelName === 'dall-e-3' ? imageStyle : undefined,
          file_size_bytes: images[0].file_size_bytes,
          image_url: images[0].image_url
        };
      } else {
        // Batch: return array of images
        return {
          success: true,
          count: images.length,
          images: images,
          prompt: prompt,
          provider: 'openai',
          model_used: modelName,
          size: imageSize,
          quality: imageQuality,
          style: modelName === 'dall-e-3' ? imageStyle : undefined,
        };
      }
    } catch (error) {
      console.error('❌ OpenAI DALL-E generation failed:', error.message);
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }

  /**
   * Edit/modify an existing image
   *
   * @param {Object} params
   * @param {string} params.image - Image file path or base64 string
   * @param {string} params.prompt - Text description of desired edits
   * @param {string} [params.mask] - Mask image path or base64 (optional, for inpainting)
   * @param {string} [params.model] - Model to use (dall-e-2, gpt-image-1)
   * @param {string} [params.size] - Output size
   * @param {string} [params.quality] - Quality for gpt-image-1 (low, medium, high)
   * @param {string} [params.input_fidelity] - Input fidelity for gpt-image-1 (low, high)
   * @param {number} [params.n] - Number of variations (1-10)
   * @param {string} [params.filename] - Custom filename prefix
   * @returns {Promise<Object>} Edited image data and metadata
   */
  async editImage({ image, prompt, mask, model, size, quality, input_fidelity, n, filename }) {
    if (!this.client) {
      await this.initialize();
    }

    const modelName = model || 'dall-e-2';
    const imageSize = size || '1024x1024';
    const numImages = n || 1;

    try {
      // Handle image input (file path or base64)
      let imageBuffer;
      if (image.startsWith('data:image') || image.startsWith('iVBORw0')) {
        // Base64 string
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        // File path
        imageBuffer = await fs.readFile(image);
      }

      // Handle mask if provided
      let maskBuffer;
      if (mask) {
        if (mask.startsWith('data:image') || mask.startsWith('iVBORw0')) {
          const base64Data = mask.replace(/^data:image\/\w+;base64,/, '');
          maskBuffer = Buffer.from(base64Data, 'base64');
        } else {
          maskBuffer = await fs.readFile(mask);
        }
      }

      // Convert buffers to File objects for OpenAI API (required for gpt-image-1)
      const imageFile = await toFile(imageBuffer, 'image.png', { type: 'image/png' });
      const maskFile = maskBuffer ? await toFile(maskBuffer, 'mask.png', { type: 'image/png' }) : undefined;

      // Build request parameters
      const requestParams = {
        model: modelName,
        image: imageFile,
        prompt: prompt,
        n: numImages,
        size: imageSize
      };

      // gpt-image-1 doesn't support response_format, returns base64 by default
      // dall-e-2 supports URL format
      if (!modelName.startsWith('gpt-image')) {
        requestParams.response_format = 'url';
      }

      // gpt-image-1 specific parameters
      if (modelName.startsWith('gpt-image')) {
        if (quality) requestParams.quality = quality;
        if (input_fidelity) requestParams.input_fidelity = input_fidelity;
      }

      if (maskFile) {
        requestParams.mask = maskFile;
      }

      const response = await this.client.images.edit(requestParams);

      // Process all edited images
      const images = [];
      const outputDir = path.resolve(process.cwd(), this.config.output_dir || './image-output');
      await fs.mkdir(outputDir, { recursive: true });

      for (let i = 0; i < response.data.length; i++) {
        const imageData = response.data[i];
        const imageUrl = imageData.url;

        // Get image buffer - either from URL (DALL-E 2) or base64 (gpt-image-1)
        let imageBuffer;
        if (imageUrl) {
          imageBuffer = await this.downloadImage(imageUrl);
        } else if (imageData.b64_json) {
          imageBuffer = Buffer.from(imageData.b64_json, 'base64');
        } else {
          throw new Error('No image data returned from API');
        }

        // Generate filename
        const timestamp = Date.now();
        const format = this.config.output_format || 'png';

        let filePrefix = 'edited';
        if (filename) {
          filePrefix = filename.replace(/[^a-zA-Z0-9_-]/g, '-');
        }

        const indexSuffix = numImages > 1 ? `-${i + 1}` : '';
        const generatedFilename = `${filePrefix}${indexSuffix}-${timestamp}.${format}`;
        const filePath = path.join(outputDir, generatedFilename);

        // Write image file
        await fs.writeFile(filePath, imageBuffer);

        // Convert to base64
        const base64Image = imageBuffer.toString('base64');

        images.push({
          image_path: filePath,
          image_base64: base64Image,
          format: format,
          file_size_bytes: imageBuffer.length,
          image_url: imageUrl
        });

        // Small delay between downloads
        if (i < response.data.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Return result
      if (numImages === 1) {
        return {
          success: true,
          image_path: images[0].image_path,
          image_base64: images[0].image_base64,
          format: images[0].format,
          prompt: prompt,
          provider: 'openai',
          model_used: modelName,
          size: imageSize,
          quality: quality,
          input_fidelity: input_fidelity,
          file_size_bytes: images[0].file_size_bytes,
          image_url: images[0].image_url
        };
      } else {
        return {
          success: true,
          count: images.length,
          images: images,
          prompt: prompt,
          provider: 'openai',
          model_used: modelName,
          size: imageSize,
          quality: quality,
          input_fidelity: input_fidelity,
        };
      }
    } catch (error) {
      console.error('❌ OpenAI image editing failed:', error.message);
      throw new Error(`Image editing failed: ${error.message}`);
    }
  }

  /**
   * List available models
   */
  async listModels() {
    return [
      {
        name: 'dall-e-3',
        description: 'Latest DALL-E model with improved quality and prompt following',
        sizes: ['1024x1024', '1792x1024', '1024x1792'],
        quality_options: ['standard', 'hd'],
        style_options: ['vivid', 'natural']
      },
      {
        name: 'dall-e-2',
        description: 'Previous generation DALL-E model',
        sizes: ['256x256', '512x512', '1024x1024'],
        quality_options: ['standard'],
        style_options: []
      }
    ];
  }
}

export default OpenAIDALLEProvider;
