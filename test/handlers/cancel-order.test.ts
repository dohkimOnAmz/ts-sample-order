import { mockClient } from 'aws-sdk-client-mock';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../../src/handlers/cancel-order';
import type { Order } from '../../src/model';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  process.env.ORDERS_TABLE = 'orders-test';
});

function conditionFailed(item?: Record<string, unknown>): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: {},
    ...(item ? { Item: item as never } : {}),
  });
}

describe('POST /orders/{orderId}/cancel', () => {
  it('cancels a PENDING order', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { orderId: 'ord-1', customerId: 'cust-1', status: 'CANCELLED' },
    });

    const res = await handler(apiEvent({ pathParameters: { orderId: 'ord-1' } }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<Order>(res).status).toBe('CANCELLED');
    const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.TableName).toBe('orders-test');
    expect(update.Key).toEqual({ orderId: 'ord-1' });
    expect(update.ExpressionAttributeValues).toMatchObject({
      ':cancelled': 'CANCELLED',
      ':pending': 'PENDING',
      ':paid': 'PAID',
    });
  });

  it('cancels a PAID order', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { orderId: 'ord-2', customerId: 'cust-1', status: 'CANCELLED' },
    });

    const res = await handler(apiEvent({ pathParameters: { orderId: 'ord-2' } }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<Order>(res).status).toBe('CANCELLED');
  });

  it('returns 409 when the order is already SHIPPED', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed({ orderId: { S: 'ord-3' }, status: { S: 'SHIPPED' } }));

    const res = await handler(apiEvent({ pathParameters: { orderId: 'ord-3' } }));

    expect(res.statusCode).toBe(409);
  });

  it('returns 409 when the order is already CANCELLED', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed({ orderId: { S: 'ord-4' }, status: { S: 'CANCELLED' } }));

    const res = await handler(apiEvent({ pathParameters: { orderId: 'ord-4' } }));

    expect(res.statusCode).toBe(409);
  });

  it('returns 404 when the order does not exist', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed());

    const res = await handler(apiEvent({ pathParameters: { orderId: 'missing' } }));

    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid id', async () => {
    const res = await handler(apiEvent({ pathParameters: { orderId: '../etc' } }));

    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});
