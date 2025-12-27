/**
 * Search Command
 */
import { Command } from 'commander';
import ora from 'ora';
import { CursorContext } from '../../core/index.js';
import { loadConfig } from '../utils/config.js';
import { formatAsTable, formatAsCompact, formatAsJSON, printError, printInfo } from '../utils/output.js';
export function createSearchCommand() {
    const cmd = new Command('search');
    cmd
        .description('Search sessions by content')
        .argument('<query>', 'Search query')
        .option('-p, --project <path>', 'Limit to specific project')
        .option('--tagged-only', 'Only search tagged sessions')
        .option('--case-sensitive', 'Case sensitive search')
        .option('-l, --limit <number>', 'Limit number of results')
        .option('-f, --format <type>', 'Output format (table, compact, json)')
        .option('--no-color', 'Disable colors')
        .action(async (query, options) => {
        const spinner = ora(`Searching for "${query}"...`).start();
        try {
            const config = loadConfig();
            const api = new CursorContext();
            const limit = options.limit ? parseInt(options.limit.toString(), 10) : config.defaultLimit;
            const format = options.format || config.defaultFormat;
            const results = await api.searchSessions({
                query,
                projectPath: options.project,
                taggedOnly: options.taggedOnly,
                caseSensitive: options.caseSensitive,
                limit
            });
            spinner.stop();
            if (results.length === 0) {
                printInfo(`No sessions found matching "${query}"`);
            }
            else {
                printInfo(`Found ${results.length} matching session(s)\n`);
                // Format and output
                switch (format) {
                    case 'json':
                        console.log(formatAsJSON(results));
                        break;
                    case 'compact':
                        console.log(formatAsCompact(results));
                        break;
                    case 'table':
                    default:
                        console.log(formatAsTable(results));
                        break;
                }
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
//# sourceMappingURL=search.js.map