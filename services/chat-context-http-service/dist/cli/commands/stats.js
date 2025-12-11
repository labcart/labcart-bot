/**
 * Stats Command
 */
import { Command } from 'commander';
import ora from 'ora';
import { CursorContext } from '../../core/index.js';
import { printError, formatStatsTable, formatAsJSON } from '../utils/output.js';
export function createStatsCommand() {
    const cmd = new Command('stats');
    cmd
        .description('Show database statistics')
        .option('-f, --format <type>', 'Output format (table, json)', 'table')
        .action(async (options) => {
        const spinner = ora('Loading statistics...').start();
        try {
            const api = new CursorContext();
            const stats = api.getStats();
            spinner.stop();
            if (options.format === 'json') {
                console.log(formatAsJSON(stats));
            }
            else {
                console.log(formatStatsTable(stats));
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
//# sourceMappingURL=stats.js.map