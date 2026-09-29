import { mockClient } from 'aws-sdk-client-mock';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../../src/handlers/cancel-order';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);

// The condition failed and DynamoDB returned the row that blocked it: the order exists
// but its status is not cancellable.
function conditionFailed(item?: Record<string, unknown>): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: {},
    Item: item as ConditionalCheckFailedException['Item'],
  });
}

beforeEach(() => {
  ddbMock.reset();
  process.env.ORDERS_TABLE = 'orders-test';
});

describe('POST /orders/{orderId}/cancel', () => {
  it('cancels a PENDING order', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { orderId: 'ord-1', status: 'CANCELLED' },
    });

    const res = await handler(apiEvent({ pathParameters: { orderId: 'ord-1' } }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<{ status: string }>(res).status).toBe('CANCELLED');
  });

  it('only cancels PENDING or PAID orders, and returns the updated order', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { orderId: 'ord-2', status: 'CANCELLED' },
    });

    await handler(apiEvent({ pathParameters: { orderId: 'ord-2' } }));

    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(call.TableName).toBe('orders-test');
    expect(call.Key).toEqual({ orderId: 'ord-2' });
    expect(call.ConditionExpression).toContain('attribute_exists(orderId)');
    expect(Object.values(call.ExpressionAttributeValues ?? {})).toEqual(
      expect.arrayContaining(['PENDING', 'PAID', 'CANCELLED']),
    );
    expect(call.ReturnValues).toBe('ALL_NEW');
    expect(call.ReturnValuesOnConditionCheckFailure).toBe('ALL_OLD');
  });

  it('returns 409 for an order that is already SHIPPED', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed({ orderId: 'ord-3', status: 'SHIPPED' }));

    const res = await handler(apiEvent({ pathParameters: { orderId: 'ord-3' } }));

    expect(res.statusCode).toBe(409);
  });

  it('returns 409 for an order that is already CANCELLED', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed({ orderId: 'ord-4', status: 'CANCELLED' }));

    const res = await handler(apiEvent({ pathParameters: { orderId: 'ord-4' } }));

    expect(res.statusCode).toBe(409);
  });

  it('returns 404 when the order does not exist', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed(undefined));

    const res = await handler(apiEvent({ pathParameters: { orderId: 'missing' } }));

    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid id without calling DynamoDB', async () => {
    const res = await handler(apiEvent({ pathParameters: { orderId: '../etc' } }));

    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('returns 500 on an unexpected DynamoDB error', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('boom'));

    const res = await handler(apiEvent({ pathParameters: { orderId: 'ord-5' } }));

    expect(res.statusCode).toBe(500);
  });
});
