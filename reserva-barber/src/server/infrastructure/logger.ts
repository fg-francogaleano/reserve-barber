type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

/** Centralized structured JSON logger — no scattered console.log. */
function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  const entry = JSON.stringify({ level, message, ...context, timestamp: new Date().toISOString() });
  if (level === 'error') {
    console.error(entry);
  } else if (level === 'warn') {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext): void => emit('debug', message, context),
  info: (message: string, context?: LogContext): void => emit('info', message, context),
  warn: (message: string, context?: LogContext): void => emit('warn', message, context),
  error: (message: string, context?: LogContext): void => emit('error', message, context),
};

const REQUIRED_ENV_VARS = ['DATABASE_URL'] as const;

/** Fail-fast environment validation — names the missing variable in English. */
export function validateEnv(): void {
  for (const name of REQUIRED_ENV_VARS) {
    if (!process.env[name]) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }
}
