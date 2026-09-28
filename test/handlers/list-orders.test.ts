import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../../src/handlers/list-orders';
import { encodeNextToken } from '../../src/lib/pagination';
import type { Order } from '../../src/model';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  process.env.ORDERS_TABLE = 'orders-test';
});

const listEvent = (customerId: string, query?: Record<string, string>) =>
  apiEvent({ pathParameters: { customerId }, queryStringParameters: query });

describe('GET /customers/{customerId}/orders', () => {
  it("queries the byCustomer index newest first instead of scanning", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { orderId: 'ord-2', customerId: 'cust-1', createdAt: '2026-09-03T00:00:00.000Z' },
        { orderId: 'ord-1', customerId: 'cust-1', createdAt: '2026-09-01T00:00:00.000Z' },
      ],
    });

    const res = await handler(listEvent('cust-1'));

    expect(res.statusCode).toBe(200);
    const body = parseBody<{ orders: Order[]; nextToken?: string }>(res);
    expect(body.orders.map((o) => o.orderId)).toEqual(['ord-2', 'ord-1']);
    expect(body.nextToken).toBeUndefined();
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);

    const [call] = ddbMock.commandCalls(QueryCommand);
    expect(call.args[0].input).toEqual({
      TableName: 'orders-test',
      IndexName: 'byCustomer',
      KeyConditionExpression: 'customerId = :customerId',
      ExpressionAttributeValues: { ':customerId': 'cust-1' },
      ScanIndexForward: false,
      Limit: 20,
    });
  });

  it('returns nextToken when there is a next page', async () => {
    const lastKey = { orderId: 'ord-2', customerId: 'cust-1', createdAt: '2026-09-03T00:00:00.000Z' };
    ddbMock.on(QueryCommand).resolves({
      Items: [lastKey],
      LastEvaluatedKey: lastKey,
    });

    const res = await handler(listEvent('cust-1', { limit: '1' }));

    expect(res.statusCode).toBe(200);
    const body = parseBody<{ orders: Order[]; nextToken?: string }>(res);
    expect(body.orders).toHaveLength(1);
    expect(body.nextToken).toBe(encodeNextToken(lastKey));
    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.Limit).toBe(1);
  });

  it('continues from nextToken', async () => {
    const lastKey = { orderId: 'ord-2', customerId: 'cust-1', createdAt: '2026-09-03T00:00:00.000Z' };
    ddbMock.on(QueryCommand).resolves({
      Items: [{ orderId: 'ord-1', customerId: 'cust-1', createdAt: '2026-09-01T00:00:00.000Z' }],
    });

    const res = await handler(listEvent('cust-1', { nextToken: encodeNextToken(lastKey) }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<{ nextToken?: string }>(res).nextToken).toBeUndefined();
    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.ExclusiveStartKey).toEqual(lastKey);
  });

  it.each(['0', '101', '1.5', 'abc', '', '-1'])('rejects limit=%p', async (limit) => {
    const res = await handler(listEvent('cust-1', { limit }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('accepts limit=100', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(listEvent('cust-1', { limit: '100' }));
    expect(res.statusCode).toBe(200);
    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.Limit).toBe(100);
  });

  it('rejects a malformed nextToken', async () => {
    const res = await handler(listEvent('cust-1', { nextToken: 'not-a-token' }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it("rejects a nextToken issued for another customer", async () => {
    const otherKey = { orderId: 'ord-9', customerId: 'cust-2', createdAt: '2026-09-03T00:00:00.000Z' };
    const res = await handler(listEvent('cust-1', { nextToken: encodeNextToken(otherKey) }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('rejects an invalid customer id', async () => {
    const res = await handler(apiEvent({ pathParameters: { customerId: 'a b' } }));
    expect(res.statusCode).toBe(400);
  });
});
