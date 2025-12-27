/**
 * Output Formatters
 */
import chalk from 'chalk';
import Table from 'cli-table3';
import { formatSessionMarkdown, formatSessionJSON, formatSessionPreview } from '../../core/index.js';
import { loadConfig } from './config.js';
/**
 * Check if colors should be used
 */
export function useColors() {
    const config = loadConfig();
    return config.useColors && process.stdout.isTTY;
}
/**
 * Format session list as table
 */
export function formatAsTable(sessions) {
    if (sessions.length === 0) {
        return chalk.yellow('No sessions found.');
    }
    const colors = useColors();
    const table = new Table({
        head: [
            colors ? chalk.bold('Nickname/ID') : 'Nickname/ID',
            colors ? chalk.bold('Project') : 'Project',
            colors ? chalk.bold('Messages') : 'Messages',
            colors ? chalk.bold('Tags') : 'Tags',
            colors ? chalk.bold('Created') : 'Created'
        ],
        colWidths: [25, 20, 10, 20, 15]
    });
    for (const session of sessions) {
        const id = session.nickname || session.session_id.substring(0, 8) + '...';
        const project = session.project_name || '-';
        const messages = session.message_count?.toString() || '0';
        const tags = session.tags?.slice(0, 2).join(', ') || '-';
        const created = session.created_at
            ? formatRelativeDate(session.created_at)
            : '-';
        table.push([
            colors ? chalk.cyan(id) : id,
            colors ? chalk.gray(project) : project,
            colors ? chalk.green(messages) : messages,
            colors ? chalk.magenta(tags) : tags,
            colors ? chalk.gray(created) : created
        ]);
    }
    return table.toString();
}
/**
 * Format session list as compact
 */
export function formatAsCompact(sessions) {
    if (sessions.length === 0) {
        return chalk.yellow('No sessions found.');
    }
    const colors = useColors();
    const lines = sessions.map((session, i) => {
        const num = `${i + 1}.`;
        const id = session.nickname || session.session_id.substring(0, 8);
        const project = session.project_name ? `[${session.project_name}]` : '';
        const msgCount = `${session.message_count || 0} msgs`;
        const tags = session.tags && session.tags.length > 0
            ? `{${session.tags.slice(0, 2).join(', ')}}`
            : '';
        if (colors) {
            return `${chalk.gray(num)} ${chalk.cyan(id)} ${chalk.yellow(project)} ${chalk.green(msgCount)} ${chalk.magenta(tags)}`.trim();
        }
        else {
            return `${num} ${id} ${project} ${msgCount} ${tags}`.trim();
        }
    });
    return lines.join('\n');
}
/**
 * Format session list as JSON
 */
export function formatAsJSON(data) {
    return JSON.stringify(data, null, 2);
}
/**
 * Format a single session based on format
 */
export function formatSession(session, format) {
    switch (format) {
        case 'json':
            return formatSessionJSON(session);
        case 'markdown':
            return formatSessionMarkdown(session);
        case 'table':
            return formatSessionMetadataTable(session.metadata);
        case 'compact':
            return formatSessionPreview(session.metadata);
    }
}
/**
 * Format session metadata as table
 */
function formatSessionMetadataTable(metadata) {
    const colors = useColors();
    const table = new Table({
        colWidths: [20, 50]
    });
    const addRow = (label, value) => {
        table.push([
            colors ? chalk.bold(label) : label,
            value
        ]);
    };
    addRow('Session ID', metadata.session_id);
    if (metadata.nickname) {
        addRow('Nickname', colors ? chalk.cyan(metadata.nickname) : metadata.nickname);
    }
    if (metadata.project_name) {
        addRow('Project', colors ? chalk.yellow(metadata.project_name) : metadata.project_name);
        addRow('Path', metadata.project_path || '-');
    }
    if (metadata.tags && metadata.tags.length > 0) {
        addRow('Tags', colors ? chalk.magenta(metadata.tags.join(', ')) : metadata.tags.join(', '));
    }
    addRow('Messages', (metadata.message_count || 0).toString());
    if (metadata.created_at) {
        const date = new Date(metadata.created_at);
        addRow('Created', date.toLocaleString());
    }
    if (metadata.first_message_preview) {
        const preview = metadata.first_message_preview.substring(0, 100);
        addRow('Preview', colors ? chalk.gray(preview) : preview);
    }
    return table.toString();
}
/**
 * Format relative date
 */
function formatRelativeDate(timestamp) {
    const daysAgo = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    if (daysAgo === 0)
        return 'today';
    if (daysAgo === 1)
        return 'yesterday';
    if (daysAgo < 7)
        return `${daysAgo}d ago`;
    if (daysAgo < 30)
        return `${Math.floor(daysAgo / 7)}w ago`;
    if (daysAgo < 365)
        return `${Math.floor(daysAgo / 30)}mo ago`;
    return `${Math.floor(daysAgo / 365)}y ago`;
}
/**
 * Print error message
 */
export function printError(message) {
    if (useColors()) {
        console.error(chalk.red('✗'), chalk.red(message));
    }
    else {
        console.error('Error:', message);
    }
}
/**
 * Print success message
 */
export function printSuccess(message) {
    if (useColors()) {
        console.log(chalk.green('✓'), message);
    }
    else {
        console.log('Success:', message);
    }
}
/**
 * Print info message
 */
export function printInfo(message) {
    if (useColors()) {
        console.log(chalk.blue('ℹ'), message);
    }
    else {
        console.log('Info:', message);
    }
}
/**
 * Print warning message
 */
export function printWarning(message) {
    if (useColors()) {
        console.log(chalk.yellow('⚠'), message);
    }
    else {
        console.log('Warning:', message);
    }
}
/**
 * Format statistics as table
 */
export function formatStatsTable(stats) {
    const colors = useColors();
    const table = new Table({
        colWidths: [35, 15]
    });
    const addRow = (label, value) => {
        table.push([
            colors ? chalk.bold(label) : label,
            colors ? chalk.cyan(value.toString()) : value.toString()
        ]);
    };
    addRow('Total sessions in Cursor', stats.totalSessionsInCursor);
    addRow('Synced to metadata DB', stats.totalSessionsWithMetadata);
    addRow('Sessions with nicknames', stats.sessionsWithNicknames);
    addRow('Sessions with tags', stats.sessionsWithTags);
    addRow('Sessions with projects', stats.sessionsWithProjects);
    addRow('Total projects', stats.totalProjects);
    addRow('Total tags', stats.totalTags);
    return table.toString();
}
/**
 * Format projects as table
 */
export function formatProjectsTable(projects) {
    if (projects.length === 0) {
        return chalk.yellow('No projects found.');
    }
    const colors = useColors();
    const table = new Table({
        head: [
            colors ? chalk.bold('Project') : 'Project',
            colors ? chalk.bold('Sessions') : 'Sessions',
            colors ? chalk.bold('Path') : 'Path'
        ],
        colWidths: [25, 12, 50]
    });
    for (const project of projects) {
        table.push([
            colors ? chalk.cyan(project.name || 'unknown') : project.name || 'unknown',
            colors ? chalk.green(project.session_count.toString()) : project.session_count.toString(),
            colors ? chalk.gray(project.path) : project.path
        ]);
    }
    return table.toString();
}
/**
 * Format tags as table
 */
export function formatTagsTable(tags) {
    if (tags.length === 0) {
        return chalk.yellow('No tags found.');
    }
    const colors = useColors();
    const table = new Table({
        head: [
            colors ? chalk.bold('Tag') : 'Tag',
            colors ? chalk.bold('Count') : 'Count'
        ],
        colWidths: [40, 12]
    });
    for (const tag of tags) {
        table.push([
            colors ? chalk.magenta(tag.tag) : tag.tag,
            colors ? chalk.cyan(tag.count.toString()) : tag.count.toString()
        ]);
    }
    return table.toString();
}
//# sourceMappingURL=output.js.map