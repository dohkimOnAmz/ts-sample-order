import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../lib/db';
import { badRequest, json, serverError, type HttpResult } from '../lib/http';
import { decodeNextToken, encodeNextToken, parseLimit, type PageKey } from '../lib/pagination';
import { getPaginationSecret } from '../lib/pagination-secret';
import { isValidId } from '../lib/validation';
import type { Shipment } from '../model';

// Key attributes of the Shipments table (pk customerId, sk createdAt).
const PAGE_KEY_NAMES = ['customerId', 'createdAt'] as const;

// GET /customers/{customerId}/shipments?limit=&nextToken=
// Returns the customer's shipments, newest first (sort key is createdAt), one page at a time.
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

  try {
    const secret = await getPaginationSecret();

    let startKey: PageKey | undefined;
    if (query.nextToken !== undefined) {
      startKey = decodeNextToken(query.nextToken, PAGE_KEY_NAMES, secret);
      // A token from another customer's list would not match the key condition.
      if (startKey === undefined || startKey.customerId !== customerId) {
        return badRequest('nextToken is invalid');
      }
    }

    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName('SHIPMENTS_TABLE'),
        KeyConditionExpression: 'customerId = :customerId',
        ExpressionAttributeValues: { ':customerId': customerId },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: startKey,
      }),
    );
    const shipments = (result.Items ?? []) as Shipment[];
    const nextToken = result.LastEvaluatedKey
      ? encodeNextToken(result.LastEvaluatedKey as PageKey, secret)
      : undefined;
    return json(200, nextToken ? { shipments, nextToken } : { shipments });
  } catch (err) {
    return serverError(err);
  }
};
