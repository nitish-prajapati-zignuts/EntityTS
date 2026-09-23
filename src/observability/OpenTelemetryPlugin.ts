import { QueryHooks } from '../hooks/QueryHook';

export interface OpenTelemetryTracerLike {
  startActiveSpan<T>(name: string, fn: (span: any) => Promise<T> | T): Promise<T>;
}

export function createOpenTelemetryHooks(tracer?: any): QueryHooks {
  // Graceful no-op if tracer is not provided or OTel not installed
  if (!tracer) {
    try {
      // Dynamic require if installed
      const otel = require('@opentelemetry/api');
      tracer = otel.trace.getTracer('entityts');
    } catch {
      return {};
    }
  }

  let activeSpan: any = null;

  return {
    onBeforeQuery: (sql: string, params?: unknown[]) => {
      try {
        if (tracer && typeof tracer.startSpan === 'function') {
          activeSpan = tracer.startSpan('db.query', {
            attributes: {
              'db.statement': sql,
            },
          });
        }
      } catch {
        // Ignore OTel start error
      }
    },
    onAfterQuery: (sql: string, params?: unknown[], durationMs?: number) => {
      try {
        if (activeSpan) {
          activeSpan.setAttribute('db.duration_ms', durationMs);
          activeSpan.end();
          activeSpan = null;
        }
      } catch {
        // Ignore OTel end error
      }
    },
    onError: (err: Error, sql: string) => {
      try {
        if (activeSpan) {
          activeSpan.recordException(err);
          activeSpan.setStatus({ code: 2, message: err.message });
          activeSpan.end();
          activeSpan = null;
        }
      } catch {
        // Ignore OTel error
      }
    },
  };
}
