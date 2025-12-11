/**
 * Platform Detection
 *
 * Detects OS and returns appropriate Cursor database path.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
/**
 * Get Cursor database path for current platform
 * @throws Error if platform is unsupported or DB doesn't exist
 */
export function getCursorDBPath() {
    const home = os.homedir();
    const platform = process.platform;
    let dbPath;
    switch (platform) {
        case 'darwin': // macOS
            dbPath = path.join(home, 'Library/Application Support/Cursor/User/globalStorage/state.vscdb');
            break;
        case 'win32': // Windows
            dbPath = path.join(home, 'AppData/Roaming/Cursor/User/globalStorage/state.vscdb');
            break;
        case 'linux': // Linux
            dbPath = path.join(home, '.config/Cursor/User/globalStorage/state.vscdb');
            break;
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
    return dbPath;
}
/**
 * Check if Cursor database exists
 */
export function cursorDBExists() {
    try {
        const dbPath = getCursorDBPath();
        return fs.existsSync(dbPath);
    }
    catch {
        return false;
    }
}
/**
 * Get metadata database path
 */
export function getMetadataDBPath() {
    const home = os.homedir();
    const metadataDir = path.join(home, '.cursor-context');
    // Create directory if it doesn't exist
    if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
    }
    return path.join(metadataDir, 'metadata.db');
}
/**
 * Get platform information
 */
export function getPlatformInfo() {
    return {
        platform: process.platform,
        cursorDBPath: getCursorDBPath(),
        metadataDBPath: getMetadataDBPath(),
        cursorDBExists: cursorDBExists()
    };
}
//# sourceMappingURL=platform.js.map