const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'youtube-auto-editor' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: config.logging.file }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

class ErrorHandler {
  static handle(error, context = '') {
    logger.error(`${context}: ${error.message}`, { 
      stack: error.stack,
      context 
    });
    
    if (error.code === 'ENOENT') {
      logger.error('File not found error - check file paths');
    } else if (error.code === 'EACCES') {
      logger.error('Permission denied - check file permissions');
    } else if (error.response && error.response.status) {
      logger.error(`HTTP Error ${error.response.status}: ${error.response.statusText}`);
    }
  }

  static async safeExecute(fn, context = '', fallback = null) {
    try {
      return await fn();
    } catch (error) {
      this.handle(error, context);
      return fallback;
    }
  }
}

module.exports = { logger, ErrorHandler };