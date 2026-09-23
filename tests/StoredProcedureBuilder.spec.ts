import { StoredProcedureBuilder, SqlType, ParameterDirection } from '../src/procedure';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { ProcedureException } from '../src/errors';

describe('StoredProcedureBuilder', () => {
  let adapter: MockDbAdapter;

  beforeEach(() => {
    adapter = new MockDbAdapter();
  });

  it('throws error if procedure name is empty or whitespace', () => {
    expect(() => new StoredProcedureBuilder(adapter, '')).toThrow(ProcedureException);
    expect(() => new StoredProcedureBuilder(adapter, '   ')).toThrow(ProcedureException);
  });

  it('configures input parameters with and without explicit SqlType', () => {
    const builder = new StoredProcedureBuilder(adapter, 'usp_GetUser')
      .withParam('UserId', 42, SqlType.Int)
      .withParam('@Username', 'alice', SqlType.VarChar, { maxLength: 50 });

    const params = builder.getParams();
    expect(params).toHaveLength(2);

    expect(params[0]).toEqual({
      name: 'UserId',
      value: 42,
      type: SqlType.Int,
      direction: ParameterDirection.Input,
    });

    // '@' should be stripped
    expect(params[1]).toEqual({
      name: 'Username',
      value: 'alice',
      type: SqlType.VarChar,
      direction: ParameterDirection.Input,
      maxLength: 50,
    });
  });

  it('configures multiple parameters from an object using withParams', () => {
    const builder = new StoredProcedureBuilder(adapter, 'usp_Filter')
      .withParams({ age: 30, status: 'active' });

    const params = builder.getParams();
    expect(params).toHaveLength(2);
    expect(params.find(p => p.name === 'age')?.value).toBe(30);
    expect(params.find(p => p.name === 'status')?.value).toBe('active');
  });

  it('configures output and inout parameters and return value', () => {
    const builder = new StoredProcedureBuilder(adapter, 'usp_Calculate')
      .withOutputParam('TotalScore', SqlType.Decimal, { precision: 10, scale: 2 })
      .withInputOutputParam('Counter', 5, SqlType.Int)
      .withReturnValue();

    const params = builder.getParams();
    expect(params).toHaveLength(3);

    const outParam = params.find(p => p.name === 'TotalScore');
    expect(outParam?.direction).toBe(ParameterDirection.Output);
    expect(outParam?.precision).toBe(10);
    expect(outParam?.scale).toBe(2);

    const inoutParam = params.find(p => p.name === 'Counter');
    expect(inoutParam?.direction).toBe(ParameterDirection.InputOutput);
    expect(inoutParam?.value).toBe(5);

    const retParam = params.find(p => p.direction === ParameterDirection.ReturnValue);
    expect(retParam).toBeDefined();
    expect(retParam?.type).toBe(SqlType.Int);
  });

  it('executes procedure query and returns typed records', async () => {
    adapter.registerProcedure('usp_GetUsers', {
      records: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      outputParams: {},
      returnValue: 0,
      rowsAffected: 2,
    });

    const builder = new StoredProcedureBuilder(adapter, 'usp_GetUsers');
    const result = await builder.executeQuery<{ id: number; name: string }>();

    expect(result.records).toHaveLength(2);
    expect(result.records[0].name).toBe('Alice');
    expect(result.rowsAffected).toBe(2);
  });

  it('executes scalar and returns first column of first row', async () => {
    adapter.registerProcedure('usp_Count', {
      records: [{ totalCount: 99 }],
      outputParams: {},
      returnValue: 0,
      rowsAffected: 1,
    });

    const builder = new StoredProcedureBuilder(adapter, 'usp_Count');
    const total = await builder.executeScalar<number>();
    expect(total).toBe(99);
  });

  it('executes procedure without records and captures output parameters', async () => {
    adapter.registerProcedure('usp_CreateUser', {
      outputParams: { NewUserId: 1001 },
      returnValue: 0,
      rowsAffected: 1,
    });

    const builder = new StoredProcedureBuilder(adapter, 'usp_CreateUser')
      .withParam('Name', 'Charlie')
      .withOutputParam('NewUserId', SqlType.Int);

    const result = await builder.execute();
    expect(result.outputParams['NewUserId']).toBe(1001);
    expect(result.returnValue).toBe(0);
    expect(result.rowsAffected).toBe(1);
  });

  it('executes procedure returning multiple result sets', async () => {
    adapter.registerProcedure('usp_GetDashboard', {
      records: [
        [{ id: 1, name: 'Widget' }],
        [{ orderId: 50, total: 199.99 }],
      ],
      outputParams: {},
      returnValue: 0,
      rowsAffected: 2,
    });

    const builder = new StoredProcedureBuilder(adapter, 'usp_GetDashboard');
    const result = await builder.executeMultiple<[
      { id: number; name: string }[],
      { orderId: number; total: number }[]
    ]>();

    expect(result.records).toHaveLength(2);
    expect(result.records[0][0].name).toBe('Widget');
    expect(result.records[1][0].total).toBe(199.99);
  });

  it('supports dynamic mock handler function for custom logic', async () => {
    adapter.registerProcedure('usp_Add', (params) => {
      const a = Number(params['a'] || 0);
      const b = Number(params['b'] || 0);
      return {
        outputParams: { sum: a + b },
        returnValue: 0,
      };
    });

    const builder = new StoredProcedureBuilder(adapter, 'usp_Add')
      .withParam('a', 15)
      .withParam('b', 27)
      .withOutputParam('sum', SqlType.Int);

    const result = await builder.execute();
    expect(result.outputParams['sum']).toBe(42);
  });
});
