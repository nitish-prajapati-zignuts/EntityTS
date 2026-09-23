export enum IsolationLevel {
  ReadUncommitted = 'READ UNCOMMITTED',
  ReadCommitted = 'READ COMMITTED',
  RepeatableRead = 'REPEATABLE READ',
  Serializable = 'SERIALIZABLE',
  Snapshot = 'SNAPSHOT',
}
