import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// One client per Lambda container, reused across invocations.
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

type TableEnv = 'ORDERS_TABLE' | 'SHIPMENTS_TABLE';

export function tableName(envVar: TableEnv): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(`${envVar} is not set`);
  }
  return value;
}
