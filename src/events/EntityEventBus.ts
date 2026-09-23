export type EventHandler<T = any> = (payload: T) => Promise<void> | void;

interface EventRegistration {
  pattern: string;
  handler: EventHandler;
  once: boolean;
  regex: RegExp;
}

/**
 * High-performance, zero-dependency async event bus for entity domain and lifecycle events.
 *
 * Supports exact event names (`'Account:created'`), table-level events (`'accounts:created'`),
 * wildcard patterns (`'*:created'`, `'Account:*'`, `'*'`), and domain event types (`'EntityCreated'`).
 *
 * @example
 * ```ts
 * db.on('Account:created', async (entity) => {
 *   await eventBus.publish(new AccountCreatedEvent(entity));
 * });
 * ```
 */
export class EntityEventBus {
  private _listeners: EventRegistration[] = [];

  /**
   * Converts a pattern string (with optional '*' wildcards) into a RegExp.
   */
  private compilePattern(pattern: string): RegExp {
    if (pattern === '*') {
      return /^.*$/;
    }
    const escaped = pattern
      .split('*')
      .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${escaped}$`);
  }

  /**
   * Registers a persistent event listener for matching events.
   *
   * @param event - The event name or pattern (e.g. `'Account:created'`, `'*:deleted'`, `'EntityCreated'`).
   * @param handler - The asynchronous or synchronous callback function.
   * @returns `this` instance for chaining.
   */
  public on<T = any>(event: string, handler: EventHandler<T>): this {
    this._listeners.push({
      pattern: event,
      handler: handler as EventHandler,
      once: false,
      regex: this.compilePattern(event),
    });
    return this;
  }

  /**
   * Registers a one-time event listener that auto-unregisters after its first invocation.
   *
   * @param event - The event name or pattern.
   * @param handler - The callback function.
   * @returns `this` instance for chaining.
   */
  public once<T = any>(event: string, handler: EventHandler<T>): this {
    this._listeners.push({
      pattern: event,
      handler: handler as EventHandler,
      once: true,
      regex: this.compilePattern(event),
    });
    return this;
  }

  /**
   * Unregisters an event listener. If `handler` is omitted, all listeners for `event` are removed.
   *
   * @param event - The event name or pattern.
   * @param handler - The specific callback function to remove.
   * @returns `this` instance for chaining.
   */
  public off(event: string, handler?: EventHandler): this {
    if (!handler) {
      this._listeners = this._listeners.filter(l => l.pattern !== event);
    } else {
      this._listeners = this._listeners.filter(
        l => !(l.pattern === event && l.handler === handler),
      );
    }
    return this;
  }

  /**
   * Emits an event with the given payload, invoking all matching listeners.
   *
   * @param event - The concrete event name being emitted (e.g. `'Account:created'`).
   * @param payload - The entity or event object to pass to handlers.
   * @param alias - Optional alias event name (e.g. table name `'accounts:created'`).
   */
  public async emit(event: string, payload: any, alias?: string): Promise<void> {
    const toExecute: Array<() => Promise<void> | void> = [];
    const remaining: EventRegistration[] = [];

    for (const reg of this._listeners) {
      const matches = reg.regex.test(event) || (alias !== undefined && reg.regex.test(alias));
      if (matches) {
        toExecute.push(() => reg.handler(payload));
        if (!reg.once) {
          remaining.push(reg);
        }
      } else {
        remaining.push(reg);
      }
    }

    this._listeners = remaining;

    for (const exec of toExecute) {
      await exec();
    }
  }

  /**
   * Returns the count of listeners registered for a specific pattern or in total.
   */
  public listenerCount(event?: string): number {
    if (!event) return this._listeners.length;
    return this._listeners.filter(l => l.pattern === event).length;
  }

  /**
   * Removes all registered event listeners, or all listeners for a given pattern.
   */
  public removeAllListeners(event?: string): this {
    if (!event) {
      this._listeners = [];
    } else {
      this._listeners = this._listeners.filter(l => l.pattern !== event);
    }
    return this;
  }
}
