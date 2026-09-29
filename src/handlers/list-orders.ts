import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../lib/db';
import { badRequest, json, serverError, type HttpResult } from '../lib/http';
import { decodeNextToken, encodeNextToken, parseLimit, type PageKey } from '../lib/pagination';
import { isValidId } from '../lib/validation';
import type { Order } from '../model';

// Orders GSI: pk customerId, sk createdAt (see infra/lib/order-stack.ts).
const BY_CUSTOMER_INDEX = 'byCustomer';
const START_KEY_FIELDS = ['orderId', 'customerId', 'createdAt'];

// GET /customers/{customerId}/orders?limit=&nextToken=
// Returns the customer's orders, newest first, one page at a time.
export const handler = async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
  const customerId = event.pathParameters?.customerId;
  if (!isValidId(customerId)) {
    return badRequest('customerId is invalid');
  }

  const limitResult = parseLimit(event.queryStringParameters?.limit);
  if ('error' in limitResult) {
    return badRequest(limitResult.error);
  }

  let startKey: PageKey | undefined;
  const rawToken = event.queryStringParameters?.nextToken;
  if (rawToken !== undefined) {
    startKey = decodeNextToken(rawToken);
    // The key must be a GSI key for this customer; anything else is rejected
    // so a token cannot be used to read another customer's orders.
    if (!startKey || !isStartKeyFor(startKey, customerId)) {
      return badRequest('nextToken is invalid');
    }
  }

  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName('ORDERS_TABLE'),
        IndexName: BY_CUSTOMER_INDEX,
        KeyConditionExpression: 'customerId = :customerId',
        ExpressionAttributeValues: { ':customerId': customerId },
        ScanIndexForward: false,
        Limit: limitResult.limit,
        ExclusiveStartKey: startKey,
      }),
    );
    const orders = (result.Items ?? []) as Order[];
    const nextToken = result.LastEvaluatedKey
      ? encodeNextToken(result.LastEvaluatedKey as PageKey)
      : undefined;
    return json(200, nextToken ? { orders, nextToken } : { orders });
  } catch (err) {
    return serverError(err);
  }
};

function isStartKeyFor(key: PageKey, customerId: string): boolean {
  const fields = Object.keys(key);
  return (
    fields.length === START_KEY_FIELDS.length &&
    START_KEY_FIELDS.every((f) => typeof key[f] === 'string') &&
    key.customerId === customerId &&
    isValidId(key.orderId)
  );
}
