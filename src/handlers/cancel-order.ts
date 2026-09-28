import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../lib/db';
import { badRequest, json, notFound, serverError, type HttpResult } from '../lib/http';
import { isValidId } from '../lib/validation';
import type { Order } from '../model';

// POST /orders/{orderId}/cancel
// PENDING or PAID -> CANCELLED. Already SHIPPED or CANCELLED -> 409, unknown order -> 404.
export const handler = async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
  const orderId = event.pathParameters?.orderId;
  if (!isValidId(orderId)) {
    return badRequest('orderId is invalid');
  }

  try {
    // One conditional write: the status check is atomic, so two concurrent
    // cancels cannot both succeed.
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName('ORDERS_TABLE'),
        Key: { orderId },
        UpdateExpression: 'SET #status = :cancelled, cancelledAt = :cancelledAt',
        ConditionExpression: 'attribute_exists(orderId) AND #status IN (:pending, :paid)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':cancelled': 'CANCELLED',
          ':cancelledAt': new Date().toISOString(),
          ':pending': 'PENDING',
          ':paid': 'PAID',
        },
        // ALL_NEW returns the stored item, so cancelledAt in the response is the
        // value that was written rather than a second clock reading.
        ReturnValues: 'ALL_NEW',
        // Returns the current item with the failure, which is how a rejected
        // cancel is told apart: item present = wrong status, absent = no order.
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
    );
    return json(200, result.Attributes as Order);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      // err.Item is raw AttributeValue ({ S: ... }): the document client does not
      // unmarshall it. Only its presence is read here, never its value. Unmarshall
      // it first if a future change puts the stored status in the response body.
      return err.Item
        ? json(409, { message: 'order is not cancellable in its current status' })
        : notFound('order not found');
    }
    return serverError(err);
  }
};
