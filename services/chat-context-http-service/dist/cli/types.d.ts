/**
 * CLI-specific types
 */
export interface CLIConfig {
    defaultFormat: 'json' | 'markdown' | 'table' | 'compact';
    defaultLimit: number;
    defaultSort: 'newest' | 'oldest' | 'most_messages';
    useColors: boolean;
    cursorDBPath?: string;
    metadataDBPath?: string;
}
export interface GlobalOptions {
    format?: 'json' | 'markdown' | 'table' | 'compact';
    noColor?: boolean;
    limit?: number;
}
export interface ListOptions extends GlobalOptions {
    project?: string;
    tag?: string;
    taggedOnly?: boolean;
    sort?: 'newest' | 'oldest' | 'most_messages';
    source?: 'cursor' | 'claude' | 'all';
}
export interface SearchOptions extends GlobalOptions {
    project?: string;
    taggedOnly?: boolean;
    caseSensitive?: boolean;
}
export interface GetOptions extends GlobalOptions {
    messagesOnly?: boolean;
    maxMessages?: number;
    noTools?: boolean;
}
export interface SyncOptions {
    limit?: number;
    source?: 'cursor' | 'claude' | 'all';
}
//# sourceMappingURL=types.d.ts.map