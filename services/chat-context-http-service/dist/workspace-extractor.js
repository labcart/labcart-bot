/**
 * Workspace Path Extractor
 *
 * Extracts workspace/project paths from Cursor session data.
 */
/**
 * Extract workspace path from tool result in bubble
 */
export function parseToolResult(bubble) {
    // Check if bubble has tool data
    if (!bubble.toolFormerData || !bubble.toolFormerData.result) {
        return null;
    }
    try {
        const resultStr = bubble.toolFormerData.result;
        // Try to parse result as JSON
        const result = JSON.parse(resultStr);
        // Check for workspaceResults in success object
        if (result.success && result.success.workspaceResults) {
            const workspaceResults = result.success.workspaceResults;
            const paths = Object.keys(workspaceResults);
            if (paths.length > 0) {
                return {
                    path: paths[0], // Return first workspace path
                    source: 'tool_result'
                };
            }
        }
        // Also check for path in tool params (some tools include it there)
        if (result.success && result.success.path && typeof result.success.path === 'string') {
            // This is likely a relative path, but let's check if it looks absolute
            if (result.success.path.startsWith('/') || result.success.path.match(/^[A-Z]:\\/)) {
                return {
                    path: result.success.path,
                    source: 'tool_result'
                };
            }
        }
    }
    catch (error) {
        // Failed to parse JSON, ignore this bubble
        return null;
    }
    return null;
}
/**
 * Extract workspace path from a session's bubbles
 * Returns the first workspace found
 */
export function extractWorkspacePath(bubbles) {
    for (const bubble of bubbles) {
        const result = parseToolResult(bubble);
        if (result) {
            return result.path;
        }
    }
    return null;
}
/**
 * Extract all unique workspace paths from a session
 * Useful for detecting multi-workspace sessions
 */
export function extractAllWorkspacePaths(bubbles) {
    const paths = new Set();
    for (const bubble of bubbles) {
        const result = parseToolResult(bubble);
        if (result) {
            paths.add(result.path);
        }
    }
    return Array.from(paths);
}
/**
 * Derive project name from workspace path
 * Example: /Users/me/projects/my-app -> my-app
 */
export function getProjectName(workspacePath) {
    if (!workspacePath) {
        return 'unknown';
    }
    // Remove all trailing slashes
    const cleaned = workspacePath.replace(/[\/\\]+$/, '');
    if (!cleaned) {
        return 'unknown';
    }
    // Handle Windows paths
    const separator = cleaned.includes('\\') ? '\\' : '/';
    // Split and get last part
    const parts = cleaned.split(separator);
    const lastPart = parts[parts.length - 1];
    // Return last part or 'unknown' if empty
    return lastPart || 'unknown';
}
/**
 * Check if a session has a project (workspace path)
 */
export function hasProject(bubbles) {
    return extractWorkspacePath(bubbles) !== null;
}
/**
 * Detect if session spans multiple workspaces
 */
export function isMultiWorkspace(bubbles) {
    const paths = extractAllWorkspacePaths(bubbles);
    return paths.length > 1;
}
export function getWorkspaceInfo(bubbles) {
    const allPaths = extractAllWorkspacePaths(bubbles);
    const primaryPath = allPaths[0] || null;
    return {
        primaryPath,
        projectName: primaryPath ? getProjectName(primaryPath) : null,
        allPaths,
        hasProject: allPaths.length > 0,
        isMultiWorkspace: allPaths.length > 1
    };
}
//# sourceMappingURL=workspace-extractor.js.map