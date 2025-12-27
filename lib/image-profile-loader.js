const imageProfiles = require('./image-profiles');

/**
 * ImageProfileLoader
 *
 * Loads and validates image generation profiles.
 * Profiles define model parameters and prompt context for image generation.
 */
class ImageProfileLoader {
  /**
   * Load an image profile by name
   *
   * @param {string} profileName - Name of profile to load
   * @returns {Object} Profile configuration with model, size, quality, style, promptContext
   * @throws {Error} If profile doesn't exist
   */
  load(profileName) {
    const profile = imageProfiles[profileName];

    if (!profile) {
      const availableProfiles = Object.keys(imageProfiles).join(', ');
      throw new Error(
        `Image profile "${profileName}" not found. Available profiles: ${availableProfiles}`
      );
    }

    // Validate profile has required fields
    if (!profile.model) {
      throw new Error(`Image profile "${profileName}" is missing required field: model`);
    }

    return profile;
  }

  /**
   * Get list of available profile names
   *
   * @returns {Array<string>} Array of profile names
   */
  listProfiles() {
    return Object.keys(imageProfiles);
  }

  /**
   * Check if a profile exists
   *
   * @param {string} profileName - Name of profile to check
   * @returns {boolean} True if profile exists
   */
  exists(profileName) {
    return imageProfiles.hasOwnProperty(profileName);
  }
}

module.exports = ImageProfileLoader;
