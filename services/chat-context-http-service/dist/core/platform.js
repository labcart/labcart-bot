/**
 * Platform Detection
 *
 * Detects OS and returns appropriate Cursor database path.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
/**
 * Get Cursor base directory for current platform
 */
function getCursorBaseDir() {
    const home = os.homedir();
    const platform = process.platform;
    switch (platform) {
        case 'darwin': // macOS
            return path.join(home, 'Library/Application Support/Cursor/User');
        case 'win32': // Windows
            return path.join(home, 'AppData/Roaming/Cursor/User');
        case 'linux': // Linux
            return path.join(home, '.config/Cursor/User');
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}
/**
 * Get Cursor global storage database path (legacy, contains old sessions)
 * @throws Error if platform is unsupported or DB doesn't exist
 */
export function getCursorDBPath() {
    return path.join(getCursorBaseDir(), 'globalStorage/state.vscdb');
}
/**
 * Get all Cursor workspace database paths (new format, workspace-specific)
 * Returns array of paths to state.vscdb files in workspaceStorage
 */
export function getAllCursorWorkspaceDBPaths() {
    const workspaceStorageDir = path.join(getCursorBaseDir(), 'workspaceStorage');
    if (!fs.existsSync(workspaceStorageDir)) {
        return [];
    }
    const workspaceDirs = fs.readdirSync(workspaceStorageDir);
    const dbPaths = [];
    for (const dir of workspaceDirs) {
        const dbPath = path.join(workspaceStorageDir, dir, 'state.vscdb');
        if (fs.existsSync(dbPath)) {
            dbPaths.push(dbPath);
        }
    }
    return dbPaths;
}
/**
 * Get all Cursor database paths (both global and workspace-specific)
 */
export function getAllCursorDBPaths() {
    const paths = [];
    // Add global storage if it exists
    const globalPath = getCursorDBPath();
    if (fs.existsSync(globalPath)) {
        paths.push(globalPath);
    }
    // Add all workspace storage paths
    paths.push(...getAllCursorWorkspaceDBPaths());
    return paths;
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