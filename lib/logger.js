/**
 * Structured logging with Winston
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, botId, userId, ...meta }) => {
    let msg = `${timestamp} ${level}`;
    if (botId) msg += ` [${botId}]`;
    if (userId) msg += ` [user:${userId}]`;
    msg += `: ${message}`;

    // Add extra metadata if present
    const metaKeys = Object.keys(meta).filter(k => !['timestamp', 'level', 'message'].includes(k));
    if (metaKeys.length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }

    return msg;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Console output
    new winston.transports.Console({
      format: consoleFormat
    }),

    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),

    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Add bot-specific logging helper
logger.bot = (botId, level, message, meta = {}) => {
  logger.log(level, message, { botId, ...meta });
};

// Add user-specific logging helper
logger.user = (botId, userId, level, message, meta = {}) => {
  logger.log(level, message, { botId, userId, ...meta });
};

module.exports = logger;
