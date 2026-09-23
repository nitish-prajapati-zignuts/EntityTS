import { DbContext } from '../src/context/DbContext';
import { DbContextOptionsBuilder } from '../src/context/DbContextOptionsBuilder';
import { Entity, Table, PrimaryKey, Column } from '../src/decorators';
import { EntityCreated, EntityUpdated, EntityDeleted } from '../src/events';

@Table('accounts')
class Account {
  @PrimaryKey()
  id!: number;

  @Column()
  email!: string;

  @Column()
  balance!: number;
}

class EventDbContext extends DbContext {
  public accounts = this.set(Account);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useMock();
  }
}

describe('Event Bus / Domain Events (db.on, db.off, EntityCreated/Updated/Deleted)', () => {
  let db: EventDbContext;

  beforeEach(() => {
    db = new EventDbContext();
  });

  afterEach(async () => {
    await db.dispose();
  });

  it('emits Account:created when an entity is inserted via DbSet.add()', async () => {
    const receivedEntities: Account[] = [];

    db.on<Account>('Account:created', async entity => {
      receivedEntities.push(entity);
    });

    const created = await db.accounts.add({
      email: 'alex@example.com',
      balance: 1000,
    });

    expect(receivedEntities).toHaveLength(1);
    expect(receivedEntities[0].email).toBe('alex@example.com');
    expect(receivedEntities[0].balance).toBe(1000);
    expect(receivedEntities[0]).toBe(created);
  });

  it('emits Account:updated when an entity is updated via DbSet.update()', async () => {
    const updatedEvents: Account[] = [];

    const account = await db.accounts.add({
      email: 'beth@example.com',
      balance: 500,
    });

    db.on<Account>('Account:updated', async entity => {
      updatedEvents.push(entity);
    });

    await db.accounts.update(account.id, { balance: 2500 });

    expect(updatedEvents).toHaveLength(1);
    expect(updatedEvents[0].balance).toBe(2500);
  });

  it('emits Account:deleted when an entity is removed via DbSet.remove()', async () => {
    const deletedEvents: any[] = [];

    const account = await db.accounts.add({
      email: 'charlie@example.com',
      balance: 300,
    });

    db.on('Account:deleted', async entity => {
      deletedEvents.push(entity);
    });

    await db.accounts.remove(account.id);

    expect(deletedEvents).toHaveLength(1);
    expect(deletedEvents[0].email).toBe('charlie@example.com');
  });

  it('supports wildcard patterns such as *:created and Account:*', async () => {
    const wildcardCreated: any[] = [];
    const wildcardAccount: any[] = [];

    db.on('*:created', payload => {
      wildcardCreated.push(payload);
    });

    db.on('Account:*', payload => {
      wildcardAccount.push(payload);
    });

    const account = await db.accounts.add({
      email: 'dave@example.com',
      balance: 750,
    });

    expect(wildcardCreated).toHaveLength(1);
    expect(wildcardAccount).toHaveLength(1);

    await db.accounts.update(account.id, { balance: 900 });

    // *:created should still have 1, Account:* should have 2 (created + updated)
    expect(wildcardCreated).toHaveLength(1);
    expect(wildcardAccount).toHaveLength(2);
  });

  it('emits typed domain events EntityCreated, EntityUpdated, EntityDeleted', async () => {
    let createdDomainEvent: EntityCreated<Account> | undefined;
    let updatedDomainEvent: EntityUpdated<Account> | undefined;
    let deletedDomainEvent: EntityDeleted<any> | undefined;

    db.on<EntityCreated<Account>>('EntityCreated', ev => {
      createdDomainEvent = ev;
    });

    db.on<EntityUpdated<Account>>('EntityUpdated', ev => {
      updatedDomainEvent = ev;
    });

    db.on<EntityDeleted<any>>('EntityDeleted', ev => {
      deletedDomainEvent = ev;
    });

    const account = await db.accounts.add({
      email: 'eve@example.com',
      balance: 100,
    });

    expect(createdDomainEvent).toBeInstanceOf(EntityCreated);
    expect(createdDomainEvent?.entityName).toBe('Account');
    expect(createdDomainEvent?.tableName).toBe('accounts');
    expect(createdDomainEvent?.entity.email).toBe('eve@example.com');

    await db.accounts.update(account.id, { balance: 200 });
    expect(updatedDomainEvent).toBeInstanceOf(EntityUpdated);
    expect(updatedDomainEvent?.entity.balance).toBe(200);

    await db.accounts.remove(account.id);
    expect(deletedDomainEvent).toBeInstanceOf(EntityDeleted);
    expect(deletedDomainEvent?.entity.id).toBe(account.id);
  });

  it('fires db.once() handler only on the first mutation', async () => {
    let callCount = 0;

    db.once('Account:created', () => {
      callCount++;
    });

    await db.accounts.add({ email: 'first@corp.com', balance: 10 });
    await db.accounts.add({ email: 'second@corp.com', balance: 20 });

    expect(callCount).toBe(1);
  });

  it('stops receiving events after db.off() is invoked', async () => {
    let callCount = 0;
    const handler = () => {
      callCount++;
    };

    db.on('Account:created', handler);
    await db.accounts.add({ email: 'a@corp.com', balance: 10 });
    expect(callCount).toBe(1);

    db.off('Account:created', handler);
    await db.accounts.add({ email: 'b@corp.com', balance: 20 });
    expect(callCount).toBe(1);
  });

  it('supports local listeners directly on DbSet via db.accounts.on()', async () => {
    const localEvents: Account[] = [];

    db.accounts.on('created', account => {
      localEvents.push(account);
    });

    await db.accounts.add({ email: 'local@corp.com', balance: 999 });

    expect(localEvents).toHaveLength(1);
    expect(localEvents[0].email).toBe('local@corp.com');
  });

  it('fires events during context.saveChanges() for tracked changes', async () => {
    const createdList: any[] = [];
    db.on('Account:created', entity => {
      createdList.push(entity);
    });

    const acc = new Account();
    acc.email = 'tracked@corp.com';
    acc.balance = 400;

    db.changeTracker.add(acc);
    expect(createdList).toHaveLength(0);

    await db.saveChanges();
    expect(createdList).toHaveLength(1);
    expect(createdList[0].email).toBe('tracked@corp.com');
  });
});
