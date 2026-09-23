export interface ValidationRule {
  type: string;
  validate: (val: unknown, entity: unknown) => boolean | string;
  defaultMessage: string;
  customMessage?: string;
}

export class ValidationRegistry {
  private static instance: ValidationRegistry;
  private readonly rules = new Map<Function, Map<string, ValidationRule[]>>();

  public static getInstance(): ValidationRegistry {
    if (!this.instance) {
      this.instance = new ValidationRegistry();
    }
    return this.instance;
  }

  public addRule(target: Function, propertyName: string, rule: ValidationRule): void {
    let propMap = this.rules.get(target);
    if (!propMap) {
      propMap = new Map();
      this.rules.set(target, propMap);
    }
    let ruleList = propMap.get(propertyName);
    if (!ruleList) {
      ruleList = [];
      propMap.set(propertyName, ruleList);
    }
    ruleList.push(rule);
  }

  public getRules(target: Function): Map<string, ValidationRule[]> | undefined {
    return this.rules.get(target);
  }
}

function registerDecorator(rule: ValidationRule): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    ValidationRegistry.getInstance().addRule(target.constructor, String(propertyKey), rule);
  };
}

export type ValidationOptions = string | { message?: string };

function resolveMessage(options?: ValidationOptions): string | undefined {
  if (typeof options === 'string') return options;
  return options?.message;
}

/**
 * Validates that the property value is a valid email address string.
 */
export function IsEmail(options?: ValidationOptions): PropertyDecorator {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return registerDecorator({
    type: 'isEmail',
    validate: (val: unknown) => {
      if (val === null || val === undefined) return true;
      return typeof val === 'string' && emailRegex.test(val);
    },
    defaultMessage: 'must be a valid email address',
    customMessage: resolveMessage(options),
  });
}

/**
 * Validates that a string's length is between min and max inclusive.
 */
export function Length(min: number, max?: number, options?: ValidationOptions): PropertyDecorator {
  return registerDecorator({
    type: 'length',
    validate: (val: unknown) => {
      if (val === null || val === undefined) return true;
      if (typeof val !== 'string') return false;
      if (val.length < min) return false;
      if (max !== undefined && val.length > max) return false;
      return true;
    },
    defaultMessage: max !== undefined ? `length must be between ${min} and ${max}` : `length must be at least ${min}`,
    customMessage: resolveMessage(options),
  });
}

/**
 * Validates that a number is greater than or equal to a minimum value.
 */
export function Min(min: number, options?: ValidationOptions): PropertyDecorator {
  return registerDecorator({
    type: 'min',
    validate: (val: unknown) => {
      if (val === null || val === undefined) return true;
      return typeof val === 'number' && !isNaN(val) && val >= min;
    },
    defaultMessage: `must be at least ${min}`,
    customMessage: resolveMessage(options),
  });
}

/**
 * Validates that a number is less than or equal to a maximum value.
 */
export function Max(max: number, options?: ValidationOptions): PropertyDecorator {
  return registerDecorator({
    type: 'max',
    validate: (val: unknown) => {
      if (val === null || val === undefined) return true;
      return typeof val === 'number' && !isNaN(val) && val <= max;
    },
    defaultMessage: `must not exceed ${max}`,
    customMessage: resolveMessage(options),
  });
}

/**
 * Validates that a value is neither null, undefined, nor empty string/array.
 */
export function IsNotEmpty(options?: ValidationOptions): PropertyDecorator {
  return registerDecorator({
    type: 'isNotEmpty',
    validate: (val: unknown) => {
      if (val === null || val === undefined) return false;
      if (typeof val === 'string') return val.trim().length > 0;
      if (Array.isArray(val)) return val.length > 0;
      return true;
    },
    defaultMessage: 'cannot be empty',
    customMessage: resolveMessage(options),
  });
}

/**
 * Validates that a string matches a specified Regular Expression pattern.
 */
export function Matches(pattern: RegExp, options?: ValidationOptions): PropertyDecorator {
  return registerDecorator({
    type: 'matches',
    validate: (val: unknown) => {
      if (val === null || val === undefined) return true;
      return typeof val === 'string' && pattern.test(val);
    },
    defaultMessage: `must match pattern ${pattern.toString()}`,
    customMessage: resolveMessage(options),
  });
}

/**
 * Validates that a string is a well-formed HTTP/HTTPS URL.
 */
export function IsUrl(options?: ValidationOptions): PropertyDecorator {
  return registerDecorator({
    type: 'isUrl',
    validate: (val: unknown) => {
      if (val === null || val === undefined) return true;
      if (typeof val !== 'string') return false;
      try {
        const url = new URL(val);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },
    defaultMessage: 'must be a valid HTTP/HTTPS URL',
    customMessage: resolveMessage(options),
  });
}

/**
 * Validates property using a custom validation function.
 */
export function CustomValidator(
  validatorFn: (value: any, entity: any) => boolean | string,
  options?: ValidationOptions
): PropertyDecorator {
  return registerDecorator({
    type: 'custom',
    validate: (val: unknown, entity: unknown) => {
      if (val === null || val === undefined) return true;
      return validatorFn(val, entity);
    },
    defaultMessage: 'failed custom validation',
    customMessage: resolveMessage(options),
  });
}
