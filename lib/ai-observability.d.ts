export type MetricType = 'count' | 'gauge' | 'histogram';

export function recordMetric(
  env: Record<string, string | undefined>,
  type: MetricType,
  name: string,
  value?: number,
  options?: { unit?: string; attributes?: Record<string, string | number | boolean> },
): void;

export function flushTelemetry(env: Record<string, string | undefined>): Promise<void>;

export function logEvent(
  env: Record<string, string | undefined>,
  level: 'info' | 'warn' | 'error',
  message: string,
  attributes?: Record<string, string | number | boolean>,
): void;
