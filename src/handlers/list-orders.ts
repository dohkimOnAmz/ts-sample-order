import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../lib/db';
import { badRequest, json, serverError, type HttpResult } from '../lib/http';
import { decodeNextToken, encodeNextToken, parseLimit, type PageKey } from '../lib/pagination';
import { isValidId } from '../lib/validation';
import type { Order } from '../model';

// Key attributes of an item read through the byCustomer index:
// the index key (customerId, createdAt) plus the table key (orderId).
const PAGE_KEY_NAMES = ['orderId', 'customerId', 'createdAt'] as const;

// GET /customers/{customerId}/orders?limit=&nextToken=
// Returns the customer's orders, newest first, one page at a time.
export const handler = async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
  const customerId = event.pathParameters?.customerId;
  if (!isValidId(customerId)) {
    return badRequest('customerId is invalid');
  }

  const query = event.queryStringParameters ?? {};
  const limit = parseLimit(query.limit);
  if (limit === undefined) {
    return badRequest('limit must be an integer between 1 and 100');
  }

  let startKey: PageKey | undefined;
  if (query.nextToken !== undefined) {
    startKey = decodeNextToken(query.nextToken, PAGE_KEY_NAMES);
    // A token from another customer's list would not match the key condition.
    if (startKey === undefined || startKey.customerId !== customerId) {
      return badRequest('nextToken is invalid');
    }
  }

  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName('ORDERS_TABLE'),
        IndexName: 'byCustomer',
        KeyConditionExpression: 'customerId = :customerId',
        ExpressionAttributeValues: { ':customerId': customerId },
        ScanIndexForward: false,
        Limit: limit,
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
