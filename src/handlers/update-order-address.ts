import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../lib/db';
import { badRequest, json, notFound, serverError, type HttpResult } from '../lib/http';
import { isValidId, parseAddress } from '../lib/validation';

// PUT /orders/{orderId}/address  { recipient, line1, city, postalCode }
// Only PENDING or PAID orders can change their address.
export const handler = async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
  const orderId = event.pathParameters?.orderId;
  if (!isValidId(orderId)) {
    return badRequest('orderId is invalid');
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('body must be valid JSON');
  }
  const parsed = parseAddress(body);
  if ('error' in parsed) {
    return badRequest(parsed.error);
  }

  try {
    // One conditional write: existence and status are checked atomically with the update.
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName('ORDERS_TABLE'),
        Key: { orderId },
        UpdateExpression: 'SET shippingAddress = :address',
        ConditionExpression: 'attribute_exists(orderId) AND #status IN (:pending, :paid)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':address': parsed.address,
          ':pending': 'PENDING',
          ':paid': 'PAID',
        },
        ReturnValues: 'ALL_NEW',
        // On a failed condition, return the existing item so 404 and 409 can be told apart.
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
    );
    return json(200, result.Attributes);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      if (!err.Item) {
        return notFound('order not found');
      }
      const status = err.Item.status?.S ?? 'unknown';
      return json(409, { message: `address cannot be changed for a ${status} order` });
    }
    return serverError(err);
  }
};
