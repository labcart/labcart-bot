/**
 * Config Commands
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, setConfigValue, resetConfig, getConfigPath } from '../utils/config.js';
import { printError, printSuccess, formatAsJSON, useColors } from '../utils/output.js';
export function createConfigCommand() {
    const cmd = new Command('config');
    cmd.description('Manage CLI configuration');
    // config show
    cmd
        .command('show')
        .description('Show current configuration')
        .option('-f, --format <type>', 'Output format (table, json)', 'table')
        .action((options) => {
        try {
            const config = loadConfig();
            if (options.format === 'json') {
                console.log(formatAsJSON(config));
            }
            else {
                const colors = useColors();
                console.log('\nCurrent Configuration:\n');
                console.log(`  ${colors ? chalk.bold('Default Format:') : 'Default Format:'} ${config.defaultFormat}`);
                console.log(`  ${colors ? chalk.bold('Default Limit:') : 'Default Limit:'} ${config.defaultLimit}`);
                console.log(`  ${colors ? chalk.bold('Default Sort:') : 'Default Sort:'} ${config.defaultSort}`);
                console.log(`  ${colors ? chalk.bold('Use Colors:') : 'Use Colors:'} ${config.useColors}`);
                if (config.cursorDBPath) {
                    console.log(`  ${colors ? chalk.bold('Cursor DB Path:') : 'Cursor DB Path:'} ${config.cursorDBPath}`);
                }
                if (config.metadataDBPath) {
                    console.log(`  ${colors ? chalk.bold('Metadata DB Path:') : 'Metadata DB Path:'} ${config.metadataDBPath}`);
                }
                console.log(`\nConfig file: ${colors ? chalk.gray(getConfigPath()) : getConfigPath()}\n`);
            }
        }
        catch (error) {
            printError(error.message);
            process.exit(1);
        }
    });
    // config set
    cmd
        .command('set')
        .description('Set a configuration value')
        .argument('<key>', 'Configuration key')
        .argument('<value>', 'Configuration value')
        .action((key, value) => {
        try {
            setConfigValue(key, value);
            printSuccess(`Set ${key} = ${value}`);
        }
        catch (error) {
            printError(error.message);
            process.exit(1);
        }
    });
    // config reset
    cmd
        .command('reset')
        .description('Reset configuration to defaults')
        .action(() => {
        try {
            resetConfig();
            printSuccess('Configuration reset to defaults');
        }
        catch (error) {
            printError(error.message);
            process.exit(1);
        }
    });
    return cmd;
}
//# sourceMappingURL=config.js.map