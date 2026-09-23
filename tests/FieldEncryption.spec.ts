import { EncryptionEngine } from '../src/security/Encryption';
import { Table, PrimaryKey, Column, Encrypted } from '../src/decorators';
import { DbSet } from '../src/set/DbSet';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';

@Table('patients')
class Patient {
  @PrimaryKey()
  id!: number;

  @Column()
  name!: string;

  @Encrypted()
  @Column()
  ssn!: string;

  @Encrypted()
  @Column()
  medicalNotes!: string;
}

describe('Field-Level Transparent Encryption (AES-256-GCM)', () => {
  describe('EncryptionEngine', () => {
    it('encrypts and decrypts text correctly using AES-256-GCM authenticated envelope', () => {
      const plaintext = '452-98-1234';
      const encrypted = EncryptionEngine.encrypt(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted?.startsWith('enc:v1:')).toBe(true);
      const parts = encrypted!.split(':');
      expect(parts).toHaveLength(5);

      const decrypted = EncryptionEngine.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('handles null and undefined gracefully', () => {
      expect(EncryptionEngine.encrypt(null)).toBeNull();
      expect(EncryptionEngine.encrypt(undefined)).toBeNull();
      expect(EncryptionEngine.decrypt(null)).toBeNull();
      expect(EncryptionEngine.decrypt(undefined)).toBeNull();
    });

    it('does not re-encrypt already encrypted payloads', () => {
      const payload = 'enc:v1:0123456789abcdef01234567:0123456789abcdef0123456789abcdef:c29tZXRoaW5n';
      expect(EncryptionEngine.encrypt(payload)).toBe(payload);
    });

    it('detects tampering and throws an authentication error', () => {
      const encrypted = EncryptionEngine.encrypt('confidential medical record')!;
      const parts = encrypted.split(':');
      // Tamper with the ciphertext base64
      parts[4] = 'YWJjZGVm' + parts[4].substring(8);
      const tampered = parts.join(':');

      expect(() => EncryptionEngine.decrypt(tampered)).toThrow();
    });

    it('works with custom 256-bit encryption keys', () => {
      const customKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const text = 'bank-secret-token';
      const encrypted = EncryptionEngine.encrypt(text, { key: customKey });
      expect(encrypted?.startsWith('enc:v1:')).toBe(true);

      const decrypted = EncryptionEngine.decrypt(encrypted, { key: customKey });
      expect(decrypted).toBe(text);

      // Decrypting with wrong key fails authentication
      const wrongKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      expect(() => EncryptionEngine.decrypt(encrypted, { key: wrongKey })).toThrow();
    });
  });

  describe('DbSet Transparent Integration', () => {
    let adapter: MockDbAdapter;
    let patientSet: DbSet<Patient>;

    beforeEach(() => {
      adapter = new MockDbAdapter({
        tables: {
          patients: [],
        },
      });
      patientSet = new DbSet<Patient>(adapter, Patient);
    });

    it('transparently encrypts @Encrypted fields on add and decrypts on find', async () => {
      const patient = await patientSet.add({
        id: 1,
        name: 'John Doe',
        ssn: '123-45-6789',
        medicalNotes: 'Diagnosis: Healthy',
      });

      expect(patient.id).toBe(1);
      expect(patient.name).toBe('John Doe');
      expect(patient.ssn).toBe('123-45-6789');
      expect(patient.medicalNotes).toBe('Diagnosis: Healthy');

      // Verify the raw stored row in the database is encrypted
      const rawRows = (adapter as any).tables.get('patients');
      expect(rawRows).toHaveLength(1);
      const storedRow = rawRows[0];
      expect(storedRow.name).toBe('John Doe');
      expect(storedRow.ssn).not.toBe('123-45-6789');
      expect(storedRow.ssn.startsWith('enc:v1:')).toBe(true);
      expect(storedRow.medicalNotes.startsWith('enc:v1:')).toBe(true);

      // Verify querying by primary key hydrates and decrypts automatically
      const fetched = await patientSet.find(1);
      expect(fetched).not.toBeNull();
      expect(fetched!.ssn).toBe('123-45-6789');
      expect(fetched!.medicalNotes).toBe('Diagnosis: Healthy');
    });

    it('transparently encrypts on update', async () => {
      await patientSet.add({
        id: 2,
        name: 'Jane Smith',
        ssn: '987-65-4321',
        medicalNotes: 'Initial checkup',
      });

      const updated = await patientSet.update(2, {
        medicalNotes: 'Updated prescription: Amoxicillin',
      });

      expect(updated.medicalNotes).toBe('Updated prescription: Amoxicillin');

      const rawRows = (adapter as any).tables.get('patients');
      const stored = rawRows.find((r: any) => r.id === 2);
      expect(stored.medicalNotes.startsWith('enc:v1:')).toBe(true);
      expect(EncryptionEngine.decrypt(stored.medicalNotes)).toBe('Updated prescription: Amoxicillin');
    });
  });
});
