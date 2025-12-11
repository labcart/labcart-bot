/**
 * Sync Command
 */
import { Command } from 'commander';
import ora from 'ora';
import { CursorContext } from '../../core/index.js';
import { printError, printSuccess } from '../utils/output.js';
export function createSyncCommand() {
    const cmd = new Command('sync');
    cmd
        .description('Sync sessions from Cursor and/or Claude Code databases')
        .option('-l, --limit <number>', 'Maximum number of sessions to sync', '50')
        .option('-s, --source <source>', 'Source to sync (cursor, claude, all)', 'all')
        .action(async (options) => {
        const source = (options.source || 'all');
        const sourceLabel = source === 'all'
            ? 'Cursor and Claude Code'
            : source === 'cursor'
                ? 'Cursor'
                : 'Claude Code';
        const spinner = ora(`Syncing sessions from ${sourceLabel}...`).start();
        try {
            const api = new CursorContext();
            const limit = options.limit ? parseInt(options.limit.toString(), 10) : 50;
            const synced = await api.syncSessions(limit, source);
            spinner.stop();
            if (synced === 0) {
                printSuccess('No new sessions to sync (all up to date)');
            }
            else {
                printSuccess(`Synced ${synced} new session(s) from ${sourceLabel}`);
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
//# sourceMappingURL=sync.js.map