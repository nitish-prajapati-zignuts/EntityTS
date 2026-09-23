import { ValidationRegistry } from './ValidationDecorators';
import { EntityValidationException } from '../errors';

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string[]>;
}

export class ValidationEngine {
  /**
   * Validates an entity against all configured validation decorators.
   * Returns a ValidationResult with field-level error messages.
   */
  public static validate(
    entity: unknown,
    targetConstructor?: Function,
    options?: { partial?: boolean },
  ): ValidationResult {
    if (!entity || typeof entity !== 'object') {
      return { isValid: true, errors: {} };
    }

    const constructor = targetConstructor || (entity as any).constructor;
    const errors: Record<string, string[]> = {};

    // Collect rules walking prototype chain
    let currentProto = constructor;
    const allRuleMaps: Map<string, any[]>[] = [];

    while (currentProto && currentProto !== Object && currentProto !== Function) {
      const rules = ValidationRegistry.getInstance().getRules(currentProto);
      if (rules) {
        allRuleMaps.unshift(rules); // base classes first
      }
      currentProto = Object.getPrototypeOf(currentProto);
    }

    for (const ruleMap of allRuleMaps) {
      for (const [propName, rules] of ruleMap.entries()) {
        if (options?.partial && !(propName in (entity as any))) {
          continue;
        }
        const val = (entity as any)[propName];
        for (const rule of rules) {
          const result = rule.validate(val, entity);
          if (result === false || typeof result === 'string') {
            if (!errors[propName]) {
              errors[propName] = [];
            }
            const msg =
              typeof result === 'string'
                ? result
                : rule.customMessage || `${propName} ${rule.defaultMessage}`;
            errors[propName].push(msg);
          }
        }
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    };
  }

  /**
   * Validates an entity and throws an EntityValidationException if any rules fail.
   */
  public static validateOrThrow(
    entity: unknown,
    targetConstructor?: Function,
    entityName?: string,
    options?: { partial?: boolean },
  ): void {
    const result = this.validate(entity, targetConstructor, options);
    if (!result.isValid) {
      const name =
        entityName ||
        (targetConstructor ? targetConstructor.name : (entity as any)?.constructor?.name) ||
        'Entity';
      throw new EntityValidationException(name, result.errors);
    }
  }
}
