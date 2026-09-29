import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../lib/db';
import { badRequest, conflict, json, notFound, serverError, type HttpResult } from '../lib/http';
import { isValidId } from '../lib/validation';
import type { OrderStatus } from '../model';

const CANCELLABLE: OrderStatus[] = ['PENDING', 'PAID'];

// POST /orders/{orderId}/cancel
export const handler = async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
  const orderId = event.pathParameters?.orderId;
  if (!isValidId(orderId)) {
    return badRequest('orderId is invalid');
  }

  try {
    // One conditional write: the status check and the update cannot interleave, so two
    // concurrent cancels cannot both succeed. ALL_OLD on failure tells "no such order"
    // (no item) apart from "not cancellable" (item returned).
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName('ORDERS_TABLE'),
        Key: { orderId },
        UpdateExpression: 'SET #status = :cancelled',
        ConditionExpression: 'attribute_exists(orderId) AND #status IN (:pending, :paid)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':cancelled': 'CANCELLED' satisfies OrderStatus,
          ':pending': CANCELLABLE[0],
          ':paid': CANCELLABLE[1],
        },
        ReturnValues: 'ALL_NEW',
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
    );
    return json(200, result.Attributes);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return err.Item
        ? conflict(`order cannot be cancelled; it must be ${CANCELLABLE.join(' or ')}`)
        : notFound('order not found');
    }
    return serverError(err);
  }
};
