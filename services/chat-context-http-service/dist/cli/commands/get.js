/**
 * Get Command
 */
import { Command } from 'commander';
import ora from 'ora';
import { CursorContext } from '../../core/index.js';
import { loadConfig } from '../utils/config.js';
import { formatSession, printError } from '../utils/output.js';
export function createGetCommand() {
    const cmd = new Command('get');
    cmd
        .description('Get session details by ID or nickname')
        .argument('<id-or-nickname>', 'Session ID or nickname')
        .option('-f, --format <type>', 'Output format (markdown, json, table, compact)')
        .option('--messages-only', 'Show only messages (no metadata)')
        .option('--max-messages <number>', 'Maximum number of messages to show')
        .option('--no-tools', 'Exclude tool calls from output')
        .option('--no-color', 'Disable colors')
        .action(async (idOrNickname, options) => {
        const spinner = ora('Loading session...').start();
        try {
            const config = loadConfig();
            const api = new CursorContext();
            const format = options.format || config.defaultFormat;
            const maxMessages = options.maxMessages ? parseInt(options.maxMessages.toString(), 10) : undefined;
            const session = await api.getSession(idOrNickname, {
                parseOptions: {
                    excludeTools: options.noTools,
                    maxContentLength: 100000
                }
            });
            spinner.stop();
            if (options.messagesOnly) {
                // Just show messages
                if (format === 'json') {
                    console.log(JSON.stringify(session.messages, null, 2));
                }
                else {
                    for (const msg of session.messages.slice(0, maxMessages)) {
                        console.log(`\n[${msg.role.toUpperCase()}]`);
                        if (msg.content) {
                            console.log(msg.content);
                        }
                    }
                }
            }
            else {
                // Show full session
                console.log(formatSession(session, format));
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
//# sourceMappingURL=get.js.map