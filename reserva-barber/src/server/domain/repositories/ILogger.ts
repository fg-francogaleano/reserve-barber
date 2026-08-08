/**
 * Outbound port for structured logging. Application services depend on this
 * interface, never on the infrastructure logger — see `project-scaffold` spec,
 * "Layered DDD folder structure".
 */
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
