import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { handler } from '../../src/handlers/list-orders';
import { encodeNextToken } from '../../src/lib/pagination';
import { resetPaginationSecretCache } from '../../src/lib/secret';
import type { Order } from '../../src/model';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);
const smMock = mockClient(SecretsManagerClient);
const SECRET = 'test-pagination-secret';
const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:111122223333:secret:PaginationSecret';

beforeEach(() => {
  ddbMock.reset();
  smMock.reset();
  resetPaginationSecretCache();
  process.env.ORDERS_TABLE = 'orders-test';
  process.env.PAGINATION_SECRET_ARN = SECRET_ARN;
  smMock.on(GetSecretValueCommand, { SecretId: SECRET_ARN }).resolves({ SecretString: SECRET });
});

const listEvent = (customerId: string, query?: Record<string, string>) =>
  apiEvent({ pathParameters: { customerId }, queryStringParameters: query });

type ListBody = { orders: Order[]; nextToken?: string };

describe('GET /customers/{customerId}/orders', () => {
  it("queries the byCustomer index newest first, without Scan", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { orderId: 'ord-2', customerId: 'cust-1', createdAt: '2026-09-03T00:00:00.000Z' },
        { orderId: 'ord-1', customerId: 'cust-1', createdAt: '2026-09-01T00:00:00.000Z' },
      ],
    });

    const res = await handler(listEvent('cust-1'));

    expect(res.statusCode).toBe(200);
    const body = parseBody<ListBody>(res);
    expect(body.orders.map((o) => o.orderId)).toEqual(['ord-2', 'ord-1']);
    expect(body.nextToken).toBeUndefined();

    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
    const [call] = ddbMock.commandCalls(QueryCommand);
    expect(call.args[0].input).toMatchObject({
      TableName: 'orders-test',
      IndexName: 'byCustomer',
      KeyConditionExpression: 'customerId = :customerId',
      ExpressionAttributeValues: { ':customerId': 'cust-1' },
      ScanIndexForward: false,
      Limit: 20,
    });
    expect(call.args[0].input.ExclusiveStartKey).toBeUndefined();
  });

  it('returns nextToken when there is another page, and resumes from it', async () => {
    const lastKey = { orderId: 'ord-5', customerId: 'cust-1', createdAt: '2026-09-05T00:00:00.000Z' };
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [lastKey], LastEvaluatedKey: lastKey })
      .resolvesOnce({ Items: [] });

    const first = await handler(listEvent('cust-1', { limit: '1' }));
    expect(first.statusCode).toBe(200);
    const { nextToken } = parseBody<ListBody>(first);
    expect(typeof nextToken).toBe('string');

    const second = await handler(listEvent('cust-1', { limit: '1', nextToken: nextToken! }));
    expect(second.statusCode).toBe(200);
    expect(parseBody<ListBody>(second).nextToken).toBeUndefined();

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.Limit).toBe(1);
    expect(calls[1].args[0].input.ExclusiveStartKey).toEqual(lastKey);
  });

  it.each(['0', '101', '1.5', 'abc', ''])('rejects limit=%p with 400', async (limit) => {
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

  it('rejects a malformed nextToken with 400', async () => {
    const res = await handler(listEvent('cust-1', { nextToken: 'not-a-token' }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it("rejects a nextToken that points at another customer's orders", async () => {
    const token = encodeNextToken(
      { orderId: 'ord-9', customerId: 'cust-2', createdAt: '2026-09-05T00:00:00.000Z' },
      SECRET,
    );
    const res = await handler(listEvent('cust-1', { nextToken: token }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('rejects a nextToken signed with a different key with 400', async () => {
    const token = encodeNextToken(
      { orderId: 'ord-5', customerId: 'cust-1', createdAt: '2026-09-05T00:00:00.000Z' },
      'not-the-server-secret',
    );
    const res = await handler(listEvent('cust-1', { nextToken: token }));
    expect(res.statusCode).toBe(400);
    expect(parseBody<{ message: string }>(res).message).toBe('nextToken is invalid');
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('rejects a nextToken whose payload was edited after signing with 400', async () => {
    const [, sig] = encodeNextToken(
      { orderId: 'ord-5', customerId: 'cust-1', createdAt: '2026-09-05T00:00:00.000Z' },
      SECRET,
    ).split('.');
    const edited = Buffer.from(
      JSON.stringify({ orderId: 'ord-6', customerId: 'cust-1', createdAt: '2026-09-06T00:00:00.000Z' }),
    ).toString('base64url');
    const res = await handler(listEvent('cust-1', { nextToken: `${edited}.${sig}` }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('reads the signing key from Secrets Manager once per container', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await handler(listEvent('cust-1'));
    await handler(listEvent('cust-1'));
    expect(smMock.commandCalls(GetSecretValueCommand)).toHaveLength(1);
  });

  it('returns 500 without detail when the signing key cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    smMock.on(GetSecretValueCommand).rejects(new Error('denied'));
    const res = await handler(listEvent('cust-1'));
    expect(res.statusCode).toBe(500);
    expect(parseBody<{ message: string }>(res).message).toBe('Internal Server Error');
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('rejects an invalid customer id', async () => {
    const res = await handler(apiEvent({ pathParameters: { customerId: 'a b' } }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 without detail when DynamoDB fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    ddbMock.on(QueryCommand).rejects(new Error('boom'));
    const res = await handler(listEvent('cust-1'));
    expect(res.statusCode).toBe(500);
    expect(parseBody<{ message: string }>(res).message).toBe('Internal Server Error');
  });
});
