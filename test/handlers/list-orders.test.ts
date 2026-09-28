import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../../src/handlers/list-orders';
import type { Order } from '../../src/model';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  process.env.ORDERS_TABLE = 'orders-test';
});

describe('GET /customers/{customerId}/orders', () => {
  it("returns the customer's orders newest first", async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { orderId: 'ord-1', customerId: 'cust-1', createdAt: '2026-09-01T00:00:00.000Z' },
        { orderId: 'ord-2', customerId: 'cust-1', createdAt: '2026-09-03T00:00:00.000Z' },
      ],
    });

    const res = await handler(apiEvent({ pathParameters: { customerId: 'cust-1' } }));

    expect(res.statusCode).toBe(200);
    const { orders } = parseBody<{ orders: Order[] }>(res);
    expect(orders.map((o) => o.orderId)).toEqual(['ord-2', 'ord-1']);
  });

  it('rejects an invalid customer id', async () => {
    const res = await handler(apiEvent({ pathParameters: { customerId: 'a b' } }));
    expect(res.statusCode).toBe(400);
  });
});
