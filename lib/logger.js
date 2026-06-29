/**
 * Lightweight structured logger for Vercel serverless.
 * Outputs JSON to stdout (captured by Vercel's log drain).
 * No file descriptors or persistent connections.
 */

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const threshold = LEVELS[LOG_LEVEL] ?? 1;

function log(level, msg, meta = {}) {
  if ((LEVELS[level] ?? 1) < threshold) return;

  const entry = {
    level: level.toUpperCase(),
    time: new Date().toISOString(),
    msg,
    ...meta
  };

  const output = JSON.stringify(entry);
  if (level === 'error') {
    console.error(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug: (msg, meta) => log('debug', msg, meta),
  info:  (msg, meta) => log('info', msg, meta),
  warn:  (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta)
};
