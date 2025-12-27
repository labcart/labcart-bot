/**
 * Nickname Command
 */
import { Command } from 'commander';
import ora from 'ora';
import { CursorContext } from '../../core/index.js';
import { printError, printSuccess } from '../utils/output.js';
export function createNicknameCommand() {
    const cmd = new Command('nickname');
    cmd
        .description('Set a nickname for a session')
        .argument('<session-id>', 'Session ID')
        .argument('<nickname>', 'Nickname to set')
        .action(async (sessionId, nickname) => {
        const spinner = ora(`Setting nickname "${nickname}"...`).start();
        try {
            const api = new CursorContext();
            await api.setNickname(sessionId, nickname);
            spinner.stop();
            printSuccess(`Nickname "${nickname}" set for session ${sessionId.substring(0, 8)}...`);
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
//# sourceMappingURL=nickname.js.map