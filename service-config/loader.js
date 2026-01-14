/**
 * Service Config Loader
 *
 * Loads API keys from api-keys.json and formats them for HTTP service requests.
 * Keys use per-service naming (tts_openai, image_gen_openai, etc.) for flexibility.
 *
 * Usage:
 *   const { getKeysForService } = require('./service-config/loader');
 *
 *   fetch('http://localhost:3001/text_to_speech', {
 *     body: JSON.stringify({ text, api_keys: getKeysForService('tts') })
 *   });
 */

const fs = require('fs');
const path = require('path');

const KEYS_PATH = path.join(__dirname, 'api-keys.json');

let _keys = null;

function loadKeys() {
  if (!_keys) {
    try {
      _keys = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf-8'));
    } catch (e) {
      _keys = {};
    }
  }
  return _keys;
}

/**
 * Reload keys from disk (if updated)
 */
function reloadKeys() {
  _keys = null;
  return loadKeys();
}

/**
 * Get keys for a specific service
 * @param {string} service - 'tts', 'image_gen', 'video_gen', 'live_data'
 * @returns {object} - Keys formatted for that service's api_keys param
 *
 * Example: getKeysForService('tts') returns { openai: "sk-xxx", elevenlabs: "sk-xxx" }
 */
function getKeysForService(service) {
  const allKeys = loadKeys();
  const prefix = service + '_';
  const result = {};

  for (const [key, value] of Object.entries(allKeys)) {
    if (key.startsWith(prefix)) {
      // Strip prefix: "tts_openai" -> "openai"
      const providerName = key.slice(prefix.length);
      result[providerName] = value;
    }
  }

  return result;
}

/**
 * Check if a specific key exists
 * @param {string} keyName - Full key name like "tts_openai"
 */
function hasKey(keyName) {
  return !!loadKeys()[keyName];
}

module.exports = {
  loadKeys,
  reloadKeys,
  getKeysForService,
  hasKey,
  KEYS_PATH
};
