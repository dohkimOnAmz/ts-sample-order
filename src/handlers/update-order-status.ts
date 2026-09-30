import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { OrderStatus } from '../model';
import { ddb, tableName } from '../lib/db';
import { badRequest, json, notFound, serverError, type HttpResult } from '../lib/http';
import { isOrderStatus, isValidId } from '../lib/validation';

// The only status a request may move an order to, and the status it must be in to do so.
const ALLOWED_SOURCE: Partial<Record<OrderStatus, OrderStatus>> = {
  PAID: 'PENDING',
  SHIPPED: 'PAID',
};

// PUT /orders/{orderId}/status  { status }
// PENDING -> PAID and PAID -> SHIPPED only.
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
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return badRequest('body must be an object');
  }
  const { status } = body as Record<string, unknown>;
  if (!isOrderStatus(status)) {
    return badRequest('status is invalid');
  }

  const from = ALLOWED_SOURCE[status];
  if (!from) {
    // No transition ends at this status, so the order is never read: the answer is the
    // same whatever state it is in, and a missing order cannot make this request legal.
    return json(409, { message: `an order cannot be changed to ${status}` });
  }

  try {
    // One conditional write: existence and current status are checked atomically with the update.
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName('ORDERS_TABLE'),
        Key: { orderId },
        UpdateExpression: 'SET #status = :to',
        ConditionExpression: 'attribute_exists(orderId) AND #status = :from',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':to': status, ':from': from },
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
      const current = err.Item.status?.S ?? 'unknown';
      return json(409, { message: `an order cannot go from ${current} to ${status}` });
    }
    return serverError(err);
  }
};
