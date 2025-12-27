/**
 * Platform Detection
 *
 * Detects OS and returns appropriate Cursor database path.
 */
/**
 * Get Cursor global storage database path (legacy, contains old sessions)
 * @throws Error if platform is unsupported or DB doesn't exist
 */
export declare function getCursorDBPath(): string;
/**
 * Get all Cursor workspace database paths (new format, workspace-specific)
 * Returns array of paths to state.vscdb files in workspaceStorage
 */
export declare function getAllCursorWorkspaceDBPaths(): string[];
/**
 * Get all Cursor database paths (both global and workspace-specific)
 */
export declare function getAllCursorDBPaths(): string[];
/**
 * Check if Cursor database exists
 */
export declare function cursorDBExists(): boolean;
/**
 * Get metadata database path
 */
export declare function getMetadataDBPath(): string;
/**
 * Get platform information
 */
export declare function getPlatformInfo(): {
    platform: string;
    cursorDBPath: string;
    metadataDBPath: string;
    cursorDBExists: boolean;
};
//# sourceMappingURL=platform.d.ts.map