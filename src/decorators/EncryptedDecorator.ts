import { ModelMetadataRegistry } from '../model/EntityMetadata';
import { EncryptionOptions } from '../security/Encryption';
import { SqlType } from '../procedure/SqlType';

/**
 * Property decorator marking a class property for transparent AES-256-GCM field-level encryption.
 * Automatically encrypts plaintext values before database persistence (INSERT / UPDATE)
 * and decrypts values upon entity hydration during queries.
 *
 * @param options - Encryption options (custom key, algorithm).
 * @example
 * ```ts
 * @Encrypted()
 * ssn!: string;
 *
 * @Encrypted()
 * creditCardNumber!: string;
 * ```
 */
export function Encrypted(options?: EncryptionOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const entityConstructor = target.constructor;
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(entityConstructor);

    const existing = metadata.columns.get(propName) || {
      propertyName: propName,
      columnName: propName,
    };

    metadata.columns.set(propName, {
      ...existing,
      sqlType: existing.sqlType || SqlType.Text,
      isEncrypted: true,
      encryptionOptions: options,
    });
  };
}
