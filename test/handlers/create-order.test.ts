import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../../src/handlers/create-order';
import type { Order } from '../../src/model';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  process.env.ORDERS_TABLE = 'orders-test';
});

describe('POST /orders', () => {
  it('stores a PENDING order with the computed total', async () => {
    ddbMock.on(PutCommand).resolves({});

    const res = await handler(
      apiEvent({
        body: JSON.stringify({
          customerId: 'cust-1',
          items: [
            { sku: 'sku-a', quantity: 2, unitPrice: 1500 },
            { sku: 'sku-b', quantity: 1, unitPrice: 3000 },
          ],
        }),
      }),
    );

    expect(res.statusCode).toBe(201);
    const order = parseBody<Order>(res);
    expect(order.status).toBe('PENDING');
    expect(order.totalAmount).toBe(6000);
    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(put.TableName).toBe('orders-test');
    expect(put.ConditionExpression).toBe('attribute_not_exists(orderId)');
  });

  it('rejects a body that is not JSON', async () => {
    const res = await handler(apiEvent({ body: '{not json' }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects empty items', async () => {
    const res = await handler(apiEvent({ body: JSON.stringify({ customerId: 'cust-1', items: [] }) }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it.each([
    ['a fractional quantity', 1.5],
    ['zero', 0],
    ['more than 1000', 1001],
    ['a numeric string', '2'],
    ['null', null],
  ])('rejects %s as quantity', async (_label, quantity) => {
    const res = await handler(
      apiEvent({
        body: JSON.stringify({
          customerId: 'cust-1',
          items: [{ sku: 'sku-a', quantity, unitPrice: 3000 }],
        }),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it.each([1, 1000])('accepts integer quantity %d at the boundary', async (quantity) => {
    ddbMock.on(PutCommand).resolves({});

    const res = await handler(
      apiEvent({
        body: JSON.stringify({
          customerId: 'cust-1',
          items: [{ sku: 'sku-a', quantity, unitPrice: 3000 }],
        }),
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(parseBody<Order>(res).totalAmount).toBe(quantity * 3000);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});
