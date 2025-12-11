#!/usr/bin/env node
/**
 * Cursor Context CLI
 *
 * Command-line interface for managing Cursor chat sessions
 */
import { Command } from 'commander';
import { createListCommand } from './commands/list.js';
import { createGetCommand } from './commands/get.js';
import { createSearchCommand } from './commands/search.js';
import { createNicknameCommand } from './commands/nickname.js';
import { createTagCommand } from './commands/tag.js';
import { createSyncCommand } from './commands/sync.js';
import { createStatsCommand } from './commands/stats.js';
import { createProjectsCommand } from './commands/projects.js';
import { createConfigCommand } from './commands/config.js';
const program = new Command();
program
    .name('cursor-context')
    .description('Manage and retrieve Cursor chat session history')
    .version('0.1.0');
// Add all commands
program.addCommand(createListCommand());
program.addCommand(createGetCommand());
program.addCommand(createSearchCommand());
program.addCommand(createNicknameCommand());
program.addCommand(createTagCommand());
program.addCommand(createSyncCommand());
program.addCommand(createStatsCommand());
program.addCommand(createProjectsCommand());
program.addCommand(createConfigCommand());
// Parse arguments
program.parse();
//# sourceMappingURL=index.js.map