import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../../src/handlers/get-order';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  process.env.ORDERS_TABLE = 'orders-test';
});

describe('GET /orders/{orderId}', () => {
  it('returns the order', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { orderId: 'ord-1', customerId: 'cust-1' } });

    const res = await handler(apiEvent({ pathParameters: { orderId: 'ord-1' } }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<{ orderId: string }>(res).orderId).toBe('ord-1');
  });

  it('returns 404 when the order does not exist', async () => {
    ddbMock.on(GetCommand).resolves({});
    const res = await handler(apiEvent({ pathParameters: { orderId: 'missing' } }));
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid id', async () => {
    const res = await handler(apiEvent({ pathParameters: { orderId: '../etc' } }));
    expect(res.statusCode).toBe(400);
  });
});
