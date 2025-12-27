/**
 * Configuration Management
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
const CONFIG_DIR = path.join(os.homedir(), '.cursor-context');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_CONFIG = {
    defaultFormat: 'table',
    defaultLimit: 20,
    defaultSort: 'newest',
    useColors: true
};
/**
 * Load configuration from file
 */
export function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return { ...DEFAULT_CONFIG };
        }
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const config = JSON.parse(data);
        // Merge with defaults to handle new config keys
        return { ...DEFAULT_CONFIG, ...config };
    }
    catch (error) {
        console.error('Failed to load config, using defaults');
        return { ...DEFAULT_CONFIG };
    }
}
/**
 * Save configuration to file
 */
export function saveConfig(config) {
    try {
        // Ensure config directory exists
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    }
    catch (error) {
        throw new Error(`Failed to save config: ${error}`);
    }
}
/**
 * Get a specific config value
 */
export function getConfigValue(key) {
    const config = loadConfig();
    return config[key];
}
/**
 * Set a specific config value
 */
export function setConfigValue(key, value) {
    const config = loadConfig();
    // Validate the value based on key
    switch (key) {
        case 'defaultFormat':
            if (!['json', 'markdown', 'table', 'compact'].includes(value)) {
                throw new Error('defaultFormat must be: json, markdown, table, or compact');
            }
            break;
        case 'defaultLimit':
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1) {
                throw new Error('defaultLimit must be a positive number');
            }
            value = num;
            break;
        case 'defaultSort':
            if (!['newest', 'oldest', 'most_messages'].includes(value)) {
                throw new Error('defaultSort must be: newest, oldest, or most_messages');
            }
            break;
        case 'useColors':
            value = value === 'true' || value === true;
            break;
    }
    config[key] = value;
    saveConfig(config);
}
/**
 * Reset configuration to defaults
 */
export function resetConfig() {
    saveConfig(DEFAULT_CONFIG);
}
/**
 * Get configuration file path
 */
export function getConfigPath() {
    return CONFIG_FILE;
}
//# sourceMappingURL=config.js.map