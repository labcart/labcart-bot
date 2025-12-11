import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Google Imagen Provider (Nano Banana)
 *
 * Supports:
 * - imagen-4.0-generate-001 (Imagen 4 - best quality)
 * - imagen-4.0-fast-generate-001 (Imagen 4 Fast - fastest, cheapest)
 * - imagen-4.0-ultra-generate-001 (Imagen 4 Ultra - highest prompt alignment)
 *
 * Requires GOOGLE_AI_API_KEY environment variable
 */
export class GoogleImagenProvider {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  /**
   * Initialize the Google AI client
   */
  async initialize() {
    try {
      const apiKey = process.env.GOOGLE_AI_API_KEY;

      if (!apiKey) {
        throw new Error('GOOGLE_AI_API_KEY environment variable not set');
      }

      this.client = new GoogleGenAI({ apiKey });

      console.log('✅ Google Imagen (Nano Banana) initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Google Imagen:', error.message);
      throw new Error(`Google Imagen initialization failed: ${error.message}`);
    }
  }

  /**
   * Generate image from text prompt using Imagen
   *
   * @param {Object} params
   * @param {string} params.prompt - Text description of the image
   * @param {string} [params.model] - Model to use (imagen-4.0-generate-001, etc)
   * @param {string} [params.size] - Image size (1K, 2K, 4K)
   * @param {number} [params.n] - Number of images (1-4)
   * @param {string} [params.filename] - Custom filename prefix
   * @returns {Promise<Object>} Image data and metadata
   */
  async generateImage({ prompt, model, size, n, filename }) {
    if (!this.client) {
      await this.initialize();
    }

    // Default to Imagen 4 Fast (good balance of speed and quality)
    const modelName = model || this.config.model || 'imagen-4.0-fast-generate-001';

    // Map size to Imagen size format (1K, 2K, 4K)
    let imageSize = '1K'; // default
    if (size) {
      if (size.includes('2048') || size.includes('2K')) {
        imageSize = '2K';
      } else if (size.includes('4096') || size.includes('4K')) {
        imageSize = '4K';
      }
    }

    let numImages = n || 1;
    if (numImages > 4) {
      console.warn(`⚠️  Imagen supports max 4 images. Generating 4 instead of ${numImages}`);
      numImages = 4;
    }

    try {
      // Build config for Imagen API
      const apiConfig = {
        numberOfImages: numImages,
      };

      // Only add imageSize for models that support it (not fast models)
      if (!modelName.includes('fast') && imageSize) {
        apiConfig.imageSize = imageSize;
      }

      // Generate images using Imagen API
      const response = await this.client.models.generateImages({
        model: modelName,
        prompt: prompt,
        config: apiConfig
      });

      if (!response.generatedImages || response.generatedImages.length === 0) {
        throw new Error('No images generated');
      }

      // Process all generated images
      const images = [];
      const outputDir = path.resolve(process.cwd(), this.config.output_dir || './image-output');
      await fs.mkdir(outputDir, { recursive: true });

      for (let i = 0; i < response.generatedImages.length; i++) {
        const generatedImage = response.generatedImages[i];

        // Imagen returns base64-encoded images in imageBytes field
        const base64Data = generatedImage.image?.imageBytes;
        if (!base64Data) {
          console.warn(`⚠️  Image ${i + 1} has no imageBytes data, skipping`);
          continue;
        }
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Generate filename
        const timestamp = Date.now();
        const format = this.config.output_format || 'png';

        let filePrefix = 'imagen';
        if (filename) {
          filePrefix = filename.replace(/[^a-zA-Z0-9_-]/g, '-');
        }

        const indexSuffix = numImages > 1 ? `-${i + 1}` : '';
        const generatedFilename = `${filePrefix}${indexSuffix}-${timestamp}.${format}`;
        const filePath = path.join(outputDir, generatedFilename);

        // Write image file
        await fs.writeFile(filePath, imageBuffer);

        images.push({
          image_path: filePath,
          image_base64: base64Data,
          format: format,
          file_size_bytes: imageBuffer.length,
        });

        // Small delay between processing
        if (i < response.generatedImages.length - 1) {
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
          provider: 'google-imagen',
          model_used: modelName,
          size: imageSize,
          file_size_bytes: images[0].file_size_bytes,
        };
      } else {
        return {
          success: true,
          count: images.length,
          images: images,
          prompt: prompt,
          provider: 'google-imagen',
          model_used: modelName,
          size: imageSize,
        };
      }

    } catch (error) {
      console.error('❌ Google Imagen generation failed:', error.message);
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }

  /**
   * Edit an existing image (if supported by Imagen)
   */
  async editImage({ image, prompt, mask, size, n, filename }) {
    throw new Error('Image editing not yet implemented for Google Imagen');
  }
}
