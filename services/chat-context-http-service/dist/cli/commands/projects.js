/**
 * Projects Command
 */
import { Command } from 'commander';
import ora from 'ora';
import { CursorContext } from '../../core/index.js';
import { printError, formatProjectsTable, formatAsJSON } from '../utils/output.js';
export function createProjectsCommand() {
    const cmd = new Command('projects');
    cmd
        .description('List all projects')
        .option('-f, --format <type>', 'Output format (table, json)', 'table')
        .action(async (options) => {
        const spinner = ora('Loading projects...').start();
        try {
            const api = new CursorContext();
            const projects = api.getProjects();
            spinner.stop();
            if (options.format === 'json') {
                console.log(formatAsJSON(projects));
            }
            else {
                console.log(formatProjectsTable(projects));
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
//# sourceMappingURL=projects.js.map