const pty = require('node-pty');
const os = require('os');

/**
 * TerminalManager
 *
 * Manages multiple pty terminal instances for the IDE.
 * Each terminal has a unique ID and can be associated with a bot.
 */
class TerminalManager {
  constructor() {
    this.terminals = new Map(); // terminalId -> { ptyProcess, metadata }
  }

  /**
   * Create a new terminal instance
   *
   * @param {string} terminalId - Unique identifier for this terminal
   * @param {Object} options - Terminal options
   * @param {string} options.cwd - Working directory (default: process.cwd())
   * @param {number} options.cols - Terminal columns (default: 80)
   * @param {number} options.rows - Terminal rows (default: 30)
   * @param {string} options.botId - Optional bot ID this terminal belongs to
   * @returns {Object} Terminal instance info
   */
  create(terminalId, options = {}) {
    if (this.terminals.has(terminalId)) {
      throw new Error(`Terminal ${terminalId} already exists`);
    }

    const {
      cwd = process.cwd(),
      cols = 80,
      rows = 30,
      botId = null,
    } = options;

    // Determine shell based on platform
    const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';

    console.log(`🖥️  Creating terminal ${terminalId}:`, {
      shell,
      cwd,
      cols,
      rows,
      botId
    });

    // Spawn pty process
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      }
    });

    // Store terminal with metadata
    this.terminals.set(terminalId, {
      ptyProcess,
      metadata: {
        id: terminalId,
        cwd,
        cols,
        rows,
        botId,
        shell,
        createdAt: new Date().toISOString()
      }
    });

    console.log(`✅ Terminal ${terminalId} created successfully`);

    return {
      id: terminalId,
      cwd,
      cols,
      rows,
      botId,
      shell
    };
  }

  /**
   * Write data to terminal (user input)
   *
   * @param {string} terminalId - Terminal ID
   * @param {string} data - Data to write
   */
  write(terminalId, data) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal ${terminalId} not found`);
    }

    terminal.ptyProcess.write(data);
  }

  /**
   * Resize terminal
   *
   * @param {string} terminalId - Terminal ID
   * @param {number} cols - New column count
   * @param {number} rows - New row count
   */
  resize(terminalId, cols, rows) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal ${terminalId} not found`);
    }

    terminal.ptyProcess.resize(cols, rows);
    terminal.metadata.cols = cols;
    terminal.metadata.rows = rows;

    console.log(`📐 Resized terminal ${terminalId}: ${cols}x${rows}`);
  }

  /**
   * Kill a terminal
   *
   * @param {string} terminalId - Terminal ID
   */
  kill(terminalId) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return; // Already gone
    }

    try {
      terminal.ptyProcess.kill();
      this.terminals.delete(terminalId);
      console.log(`🗑️  Killed terminal ${terminalId}`);
    } catch (err) {
      console.error(`Error killing terminal ${terminalId}:`, err.message);
    }
  }

  /**
   * Get terminal instance (for attaching listeners)
   *
   * @param {string} terminalId - Terminal ID
   * @returns {Object|null} Terminal object or null
   */
  get(terminalId) {
    return this.terminals.get(terminalId);
  }

  /**
   * Get metadata for a terminal
   *
   * @param {string} terminalId - Terminal ID
   * @returns {Object|null} Metadata or null
   */
  getMetadata(terminalId) {
    const terminal = this.terminals.get(terminalId);
    return terminal ? terminal.metadata : null;
  }

  /**
   * List all active terminals
   *
   * @returns {Array} Array of terminal metadata
   */
  list() {
    return Array.from(this.terminals.values()).map(t => t.metadata);
  }

  /**
   * Kill all terminals
   */
  killAll() {
    const terminalIds = Array.from(this.terminals.keys());
    terminalIds.forEach(id => this.kill(id));
    console.log(`🗑️  Killed all ${terminalIds.length} terminals`);
  }
}

module.exports = TerminalManager;
