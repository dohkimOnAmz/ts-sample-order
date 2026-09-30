import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../lib/db';
import { badRequest, json, serverError, type HttpResult } from '../lib/http';
import { decodeNextToken, encodeNextToken, parseLimit, type PageKey } from '../lib/pagination';
import { getPaginationSecret } from '../lib/secret';
import { isValidId } from '../lib/validation';
import type { Shipment } from '../model';

// Shipments table: pk customerId, sk createdAt (see infra/lib/order-stack.ts).
const START_KEY_FIELDS = ['customerId', 'createdAt'];

// GET /customers/{customerId}/shipments?limit=&nextToken=
// Returns the customer's shipments, newest first (sort key is createdAt), one page at a time.
export const handler = async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
  const customerId = event.pathParameters?.customerId;
  if (!isValidId(customerId)) {
    return badRequest('customerId is invalid');
  }

  const limitResult = parseLimit(event.queryStringParameters?.limit);
  if ('error' in limitResult) {
    return badRequest(limitResult.error);
  }

  const rawToken = event.queryStringParameters?.nextToken;

  try {
    const secret = await getPaginationSecret();

    let startKey: PageKey | undefined;
    if (rawToken !== undefined) {
      startKey = decodeNextToken(rawToken, secret);
      // The token must carry a valid signature and a Shipments key for this
      // customer; anything else is rejected so a token cannot be forged or
      // reused to read another customer's shipments.
      if (!startKey || !isStartKeyFor(startKey, customerId)) {
        return badRequest('nextToken is invalid');
      }
    }

    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName('SHIPMENTS_TABLE'),
        KeyConditionExpression: 'customerId = :customerId',
        ExpressionAttributeValues: { ':customerId': customerId },
        ScanIndexForward: false,
        Limit: limitResult.limit,
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

function isStartKeyFor(key: PageKey, customerId: string): boolean {
  const fields = Object.keys(key);
  return (
    fields.length === START_KEY_FIELDS.length &&
    START_KEY_FIELDS.every((f) => typeof key[f] === 'string') &&
    key.customerId === customerId
  );
}
