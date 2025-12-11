/**
 * Platform Detection
 *
 * Detects OS and returns appropriate Cursor database path.
 */
/**
 * Get Cursor database path for current platform
 * @throws Error if platform is unsupported or DB doesn't exist
 */
export declare function getCursorDBPath(): string;
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