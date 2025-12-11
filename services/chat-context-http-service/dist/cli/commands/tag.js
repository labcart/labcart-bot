/**
 * Tag Commands
 */
import { Command } from 'commander';
import ora from 'ora';
import { CursorContext } from '../../core/index.js';
import { printError, printSuccess, formatTagsTable } from '../utils/output.js';
export function createTagCommand() {
    const cmd = new Command('tag');
    cmd.description('Manage session tags');
    // tag add
    cmd
        .command('add')
        .description('Add tag(s) to a session')
        .argument('<session-id>', 'Session ID or nickname')
        .argument('<tags...>', 'Tag(s) to add')
        .action(async (sessionId, tags) => {
        const spinner = ora('Adding tags...').start();
        try {
            const api = new CursorContext();
            for (const tag of tags) {
                await api.addTag(sessionId, tag);
            }
            spinner.stop();
            printSuccess(`Added ${tags.length} tag(s) to session: ${tags.join(', ')}`);
            api.close();
        }
        catch (error) {
            spinner.stop();
            printError(error.message);
            process.exit(1);
        }
    });
    // tag remove
    cmd
        .command('remove')
        .description('Remove tag(s) from a session')
        .argument('<session-id>', 'Session ID or nickname')
        .argument('<tags...>', 'Tag(s) to remove')
        .action(async (sessionId, tags) => {
        const spinner = ora('Removing tags...').start();
        try {
            const api = new CursorContext();
            for (const tag of tags) {
                await api.removeTag(sessionId, tag);
            }
            spinner.stop();
            printSuccess(`Removed ${tags.length} tag(s) from session`);
            api.close();
        }
        catch (error) {
            spinner.stop();
            printError(error.message);
            process.exit(1);
        }
    });
    // tag list
    cmd
        .command('list')
        .description('List all tags')
        .action(async () => {
        const spinner = ora('Loading tags...').start();
        try {
            const api = new CursorContext();
            const tags = api.getTags();
            spinner.stop();
            console.log(formatTagsTable(tags));
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
//# sourceMappingURL=tag.js.map