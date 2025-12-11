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
    if (!bubble.toolFormerData) {
        return null;
    }
    // FIRST: Check params for relativeWorkspacePath (this is where write tool stores it)
    if (bubble.toolFormerData.params) {
        try {
            const params = typeof bubble.toolFormerData.params === 'string'
                ? JSON.parse(bubble.toolFormerData.params)
                : bubble.toolFormerData.params;
            // Check for relativeWorkspacePath (write/edit tools)
            if (params.relativeWorkspacePath && typeof params.relativeWorkspacePath === 'string') {
                const path = params.relativeWorkspacePath;
                // relativeWorkspacePath is actually an absolute path despite the name
                if (path.startsWith('/') || path.match(/^[A-Z]:\\/)) {
                    // Extract project directory from the full file path
                    const projectPath = extractProjectFromFilePath(path);
                    if (projectPath) {
                        return {
                            path: projectPath,
                            source: 'tool_result'
                        };
                    }
                }
            }
            // Check for project parameter (MCP tools and other tools)
            if (params.project && typeof params.project === 'string') {
                const path = params.project;
                if (path.startsWith('/') || path.match(/^[A-Z]:\\/)) {
                    return {
                        path: path,
                        source: 'tool_result'
                    };
                }
            }
            // Check nested params.tools array (MCP tool wrapper format)
            if (params.tools && Array.isArray(params.tools)) {
                for (const tool of params.tools) {
                    if (tool.parameters && typeof tool.parameters === 'string') {
                        try {
                            const nestedParams = JSON.parse(tool.parameters);
                            if (nestedParams.project && typeof nestedParams.project === 'string') {
                                const path = nestedParams.project;
                                if (path.startsWith('/') || path.match(/^[A-Z]:\\/)) {
                                    return {
                                        path: path,
                                        source: 'tool_result'
                                    };
                                }
                            }
                        }
                        catch (e) {
                            // Failed to parse nested parameters, continue
                        }
                    }
                }
            }
        }
        catch (error) {
            // Failed to parse params, continue to check result
        }
    }
    // SECOND: Check result for workspace paths (legacy/other tools)
    if (!bubble.toolFormerData.result) {
        return null;
    }
    try {
        const resultStr = bubble.toolFormerData.result;
        // Try to parse result as JSON
        const result = JSON.parse(resultStr);
        // Method 1: Check for relativeWorkspacePath (most common format)
        if (result.relativeWorkspacePath && typeof result.relativeWorkspacePath === 'string') {
            // relativeWorkspacePath is actually an absolute path despite the name
            if (result.relativeWorkspacePath.startsWith('/') || result.relativeWorkspacePath.match(/^[A-Z]:\\/)) {
                return {
                    path: result.relativeWorkspacePath,
                    source: 'tool_result'
                };
            }
        }
        // Method 2: Check for workspaceResults in success object (legacy format)
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
        // Method 3: Also check for path in tool params (some tools include it there)
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
 * Extract workspace/project directory from a file path
 * Heuristic: Find the project root by looking for common patterns
 */
function extractProjectFromFilePath(filePath) {
    // Common project root indicators
    const projectPatterns = [
        /\/([^\/]+--project\/[^\/]+)\//, // Matches "project--name/project/"
        /\/(play|Documents|projects)\/([^\/]+)\//, // Matches "/play/project/" or "/Documents/project/"
    ];
    for (const pattern of projectPatterns) {
        const match = filePath.match(pattern);
        if (match) {
            // Return everything up to and including the matched project directory
            const projectMatch = match[0];
            const projectEnd = filePath.indexOf(projectMatch) + projectMatch.length - 1;
            return filePath.substring(0, projectEnd);
        }
    }
    // Fallback: If path has multiple segments, take up to 2 levels after /play, /Documents, etc
    const parts = filePath.split('/');
    const rootIndex = parts.findIndex(p => p === 'play' || p === 'Documents' || p === 'projects');
    if (rootIndex >= 0 && parts.length > rootIndex + 1) {
        // Take root + 1 more level (e.g., /Users/macbook/play/project-name)
        return parts.slice(0, rootIndex + 2).join('/');
    }
    return null;
}
/**
 * Helper: Extract file path from URI object or string
 */
function extractPathFromUri(uri) {
    if (typeof uri === 'string') {
        if (uri.startsWith('file:///')) {
            return uri.replace('file://', '');
        }
        else if (uri.startsWith('/') || uri.match(/^[A-Z]:\\/)) {
            return uri;
        }
    }
    else if (uri && typeof uri === 'object') {
        // Check uri.path, uri.fsPath, uri.external
        const pathCandidates = [uri.path, uri.fsPath, uri.external];
        for (const path of pathCandidates) {
            if (typeof path === 'string') {
                if (path.startsWith('file:///')) {
                    return path.replace('file://', '');
                }
                else if (path.startsWith('/') || path.match(/^[A-Z]:\\/)) {
                    return path;
                }
            }
        }
    }
    return null;
}
/**
 * Helper: Recursively search for file paths in nested objects/arrays
 */
function findFilePathsInObject(obj, paths, depth = 0) {
    // Limit recursion depth to prevent infinite loops
    if (depth > 10 || !obj)
        return;
    if (typeof obj === 'string') {
        const extracted = extractPathFromUri(obj);
        if (extracted)
            paths.add(extracted);
    }
    else if (Array.isArray(obj)) {
        for (const item of obj) {
            findFilePathsInObject(item, paths, depth + 1);
        }
    }
    else if (typeof obj === 'object') {
        for (const value of Object.values(obj)) {
            findFilePathsInObject(value, paths, depth + 1);
        }
    }
}
/**
 * Extract workspace path from composerData fields
 * Comprehensive check of ALL anchor fields discovered through analysis
 */
export function extractWorkspaceFromComposerData(composerData) {
    const allPaths = new Set();
    // ANCHOR 1: allAttachedFileCodeChunksUris (most common - 157 sessions)
    if (composerData.allAttachedFileCodeChunksUris && Array.isArray(composerData.allAttachedFileCodeChunksUris)) {
        for (const uri of composerData.allAttachedFileCodeChunksUris) {
            const path = extractPathFromUri(uri);
            if (path)
                allPaths.add(path);
        }
    }
    // ANCHOR 2: subtitle (61 sessions)
    if (composerData.subtitle && typeof composerData.subtitle === 'string') {
        const path = extractPathFromUri(composerData.subtitle);
        if (path)
            allPaths.add(path);
    }
    // ANCHOR 3: context.fileSelections (58 sessions)
    if (composerData.context?.fileSelections) {
        if (Array.isArray(composerData.context.fileSelections)) {
            for (const selection of composerData.context.fileSelections) {
                const path = extractPathFromUri(selection?.uri);
                if (path)
                    allPaths.add(path);
            }
        }
        else if (typeof composerData.context.fileSelections === 'object') {
            // Sometimes it's an object with file URIs as keys
            for (const key of Object.keys(composerData.context.fileSelections)) {
                const path = extractPathFromUri(key);
                if (path)
                    allPaths.add(path);
            }
        }
    }
    // ANCHOR 4: context.mentions.fileSelections (from raw session analysis)
    if (composerData.context?.mentions?.fileSelections) {
        if (typeof composerData.context.mentions.fileSelections === 'object') {
            for (const key of Object.keys(composerData.context.mentions.fileSelections)) {
                const path = extractPathFromUri(key);
                if (path)
                    allPaths.add(path);
            }
        }
    }
    // ANCHOR 5: tabs[*].uri.* (20 sessions)
    if (composerData.tabs && Array.isArray(composerData.tabs)) {
        for (const tab of composerData.tabs) {
            const path = extractPathFromUri(tab?.uri);
            if (path)
                allPaths.add(path);
        }
    }
    // ANCHOR 6: newlyCreatedFiles[*].uri.* (14 sessions)
    if (composerData.newlyCreatedFiles && Array.isArray(composerData.newlyCreatedFiles)) {
        for (const file of composerData.newlyCreatedFiles) {
            const path = extractPathFromUri(file?.uri);
            if (path)
                allPaths.add(path);
        }
    }
    // ANCHOR 7: codeBlockData keys (existing logic)
    if (composerData.codeBlockData && typeof composerData.codeBlockData === 'object') {
        for (const key of Object.keys(composerData.codeBlockData)) {
            const path = extractPathFromUri(key);
            if (path)
                allPaths.add(path);
        }
    }
    // ANCHOR 8: originalFileStates keys (existing logic)
    if (composerData.originalFileStates && typeof composerData.originalFileStates === 'object') {
        for (const key of Object.keys(composerData.originalFileStates)) {
            const path = extractPathFromUri(key);
            if (path)
                allPaths.add(path);
        }
    }
    // ANCHOR 9: originalModelLines keys (13+ sessions)
    if (composerData.originalModelLines && typeof composerData.originalModelLines === 'object') {
        for (const key of Object.keys(composerData.originalModelLines)) {
            const path = extractPathFromUri(key);
            if (path)
                allPaths.add(path);
        }
    }
    // ANCHOR 10: conversation[*] fields (deep search for nested paths)
    if (composerData.conversation && Array.isArray(composerData.conversation)) {
        for (const conv of composerData.conversation) {
            // Check context.fileSelections
            if (conv?.context?.fileSelections) {
                findFilePathsInObject(conv.context.fileSelections, allPaths, 0);
            }
            // Check codeBlocks[*].uri
            if (conv?.codeBlocks && Array.isArray(conv.codeBlocks)) {
                for (const block of conv.codeBlocks) {
                    const path = extractPathFromUri(block?.uri);
                    if (path)
                        allPaths.add(path);
                }
            }
        }
    }
    // If we found any paths, extract project from the first one
    if (allPaths.size > 0) {
        // Find the deepest common ancestor of all paths (best project detection)
        const pathArray = Array.from(allPaths);
        // For now, use the first path (could be improved to find common ancestor)
        const firstPath = pathArray[0];
        if (firstPath) {
            return extractProjectFromFilePath(firstPath);
        }
    }
    return null;
}
/**
 * Check if a session is empty (has no messages)
 */
export function isEmptySession(composerData) {
    if (!composerData)
        return true;
    const messageCount = composerData.fullConversationHeadersOnly?.length || 0;
    return messageCount === 0;
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
/**
 * Extract nickname from nickname_current_session tool call
 */
export function extractNicknameFromBubbles(bubbles) {
    for (const bubble of bubbles) {
        if (!bubble.toolFormerData || !bubble.toolFormerData.name) {
            continue;
        }
        // Check if this is a nickname_current_session tool call
        const toolName = bubble.toolFormerData.name;
        if (toolName === 'mcp_cursor-context_nickname_current_session' ||
            toolName === 'nickname_current_session') {
            // Try to extract nickname from params
            if (bubble.toolFormerData.params) {
                try {
                    const params = typeof bubble.toolFormerData.params === 'string'
                        ? JSON.parse(bubble.toolFormerData.params)
                        : bubble.toolFormerData.params;
                    // Check direct params.nickname
                    if (params.nickname && typeof params.nickname === 'string') {
                        return params.nickname;
                    }
                    // Check nested params.tools[].parameters.nickname (MCP wrapper format)
                    if (params.tools && Array.isArray(params.tools)) {
                        for (const tool of params.tools) {
                            if (tool.parameters && typeof tool.parameters === 'string') {
                                try {
                                    const nestedParams = JSON.parse(tool.parameters);
                                    if (nestedParams.nickname && typeof nestedParams.nickname === 'string') {
                                        return nestedParams.nickname;
                                    }
                                }
                                catch (e) {
                                    // Failed to parse nested parameters, continue
                                }
                            }
                        }
                    }
                }
                catch (error) {
                    // Failed to parse params, continue
                }
            }
        }
    }
    return null;
}
export function getWorkspaceInfo(bubbles) {
    const allPaths = extractAllWorkspacePaths(bubbles);
    const primaryPath = allPaths[0] || null;
    const nickname = extractNicknameFromBubbles(bubbles);
    return {
        primaryPath,
        projectName: primaryPath ? getProjectName(primaryPath) : null,
        allPaths,
        hasProject: allPaths.length > 0,
        isMultiWorkspace: allPaths.length > 1,
        nickname
    };
}
//# sourceMappingURL=workspace-extractor.js.map