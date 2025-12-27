/**
 * Custom Error Types
 */
/**
 * Base error for Cursor Context operations
 */
export declare class CursorContextError extends Error {
    constructor(message: string);
}
/**
 * Error connecting to database
 */
export declare class DBConnectionError extends CursorContextError {
    readonly dbPath: string;
    constructor(message: string, dbPath: string);
}
/**
 * Database is locked (SQLITE_BUSY)
 */
export declare class DBLockedError extends CursorContextError {
    constructor(message?: string);
}
/**
 * Session not found
 */
export declare class SessionNotFoundError extends CursorContextError {
    constructor(sessionId: string);
}
/**
 * Invalid or corrupted data
 */
export declare class DataCorruptionError extends CursorContextError {
    constructor(message: string);
}
//# sourceMappingURL=errors.d.ts.map