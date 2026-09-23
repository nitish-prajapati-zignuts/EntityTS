import { ParameterDirection } from '../procedure/ParameterDirection';
import { SqlType } from '../procedure/SqlType';

export interface AdapterParam {
  name: string;
  value?: unknown;
  type?: SqlType;
  direction?: ParameterDirection;
  maxLength?: number;
  precision?: number;
  scale?: number;
}
