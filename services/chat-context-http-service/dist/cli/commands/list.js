/**
 * List Command
 */
import { Command } from 'commander';
import ora from 'ora';
import { CursorContext } from '../../core/index.js';
import { loadConfig } from '../utils/config.js';
import { formatAsTable, formatAsCompact, formatAsJSON, printError } from '../utils/output.js';
export function createListCommand() {
    const cmd = new Command('list');
    cmd
        .description('List sessions with optional filtering')
        .option('-p, --project <path>', 'Filter by project path')
        .option('-t, --tag <tag>', 'Filter by specific tag')
        .option('--tagged-only', 'Only show sessions with tags')
        .option('-s, --sort <type>', 'Sort order (newest, oldest, most_messages)')
        .option('-l, --limit <number>', 'Limit number of results')
        .option('-f, --format <type>', 'Output format (table, compact, json)')
        .option('--source <source>', 'Filter by source (cursor, claude, all)', 'all')
        .option('--no-color', 'Disable colors')
        .action(async (options) => {
        const spinner = ora('Loading sessions...').start();
        try {
            const config = loadConfig();
            const api = new CursorContext();
            // Merge config with options
            const limit = options.limit ? parseInt(options.limit.toString(), 10) : config.defaultLimit;
            const sort = options.sort || config.defaultSort;
            const format = options.format || config.defaultFormat;
            const source = (options.source || 'all');
            const sessions = await api.listSessions({
                projectPath: options.project,
                tag: options.tag,
                taggedOnly: options.taggedOnly,
                sortBy: sort,
                limit,
                source
            });
            spinner.stop();
            // Format and output
            switch (format) {
                case 'json':
                    console.log(formatAsJSON(sessions));
                    break;
                case 'compact':
                    console.log(formatAsCompact(sessions));
                    break;
                case 'table':
                default:
                    console.log(formatAsTable(sessions));
                    break;
            }
            api.close();
        }
        catch (error) {
            spinner.stop();
            printError(error.message);
            process.exit(1);
        }
    });
    return cmd;
}
//# sourceMappingURL=list.js.map