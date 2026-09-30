import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { handler } from '../../src/handlers/list-shipments';
import { encodeNextToken } from '../../src/lib/pagination';
import { resetPaginationSecretCache } from '../../src/lib/secret';
import type { Shipment } from '../../src/model';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);
const smMock = mockClient(SecretsManagerClient);
const SECRET = 'test-pagination-secret';
const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:111122223333:secret:PaginationSecret';

beforeEach(() => {
  ddbMock.reset();
  smMock.reset();
  resetPaginationSecretCache();
  process.env.SHIPMENTS_TABLE = 'shipments-test';
  process.env.PAGINATION_SECRET_ARN = SECRET_ARN;
  smMock.on(GetSecretValueCommand, { SecretId: SECRET_ARN }).resolves({ SecretString: SECRET });
});

const listEvent = (customerId: string, query?: Record<string, string>) =>
  apiEvent({ pathParameters: { customerId }, queryStringParameters: query });

type ListBody = { shipments: Shipment[]; nextToken?: string };

const key = (createdAt: string, customerId = 'cust-1') => ({ customerId, createdAt });

describe('GET /customers/{customerId}/shipments', () => {
  it("queries the customer's partition newest first, 20 per page by default", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ customerId: 'cust-1', shipmentId: 'shp-1', createdAt: '2026-09-02T00:00:00.000Z' }],
    });

    const res = await handler(listEvent('cust-1'));

    expect(res.statusCode).toBe(200);
    const body = parseBody<ListBody>(res);
    expect(body.shipments).toHaveLength(1);
    expect(body.nextToken).toBeUndefined();
    const query = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(query).toMatchObject({
      TableName: 'shipments-test',
      KeyConditionExpression: 'customerId = :customerId',
      ExpressionAttributeValues: { ':customerId': 'cust-1' },
      ScanIndexForward: false,
      Limit: 20,
    });
    expect(query.ExclusiveStartKey).toBeUndefined();
  });

  it('pages through first, next and last page with nextToken', async () => {
    const k1 = key('2026-09-05T00:00:00.000Z');
    const k2 = key('2026-09-03T00:00:00.000Z');
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ ...k1, shipmentId: 'shp-5' }], LastEvaluatedKey: k1 })
      .resolvesOnce({ Items: [{ ...k2, shipmentId: 'shp-3' }], LastEvaluatedKey: k2 })
      .resolvesOnce({ Items: [{ ...key('2026-09-01T00:00:00.000Z'), shipmentId: 'shp-1' }] });

    const first = parseBody<ListBody>(await handler(listEvent('cust-1', { limit: '1' })));
    expect(first.shipments.map((s) => s.shipmentId)).toEqual(['shp-5']);
    expect(typeof first.nextToken).toBe('string');

    const second = parseBody<ListBody>(
      await handler(listEvent('cust-1', { limit: '1', nextToken: first.nextToken! })),
    );
    expect(second.shipments.map((s) => s.shipmentId)).toEqual(['shp-3']);
    expect(typeof second.nextToken).toBe('string');

    const last = parseBody<ListBody>(
      await handler(listEvent('cust-1', { limit: '1', nextToken: second.nextToken! })),
    );
    expect(last.shipments.map((s) => s.shipmentId)).toEqual(['shp-1']);
    expect(last.nextToken).toBeUndefined();

    const calls = ddbMock.commandCalls(QueryCommand).map((c) => c.args[0].input);
    expect(calls.map((c) => c.Limit)).toEqual([1, 1, 1]);
    expect(calls[1].ExclusiveStartKey).toEqual(k1);
    expect(calls[2].ExclusiveStartKey).toEqual(k2);
  });

  it('accepts limit=100', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(listEvent('cust-1', { limit: '100' }));
    expect(res.statusCode).toBe(200);
    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.Limit).toBe(100);
  });

  it.each(['0', '101', '1.5', 'abc', ''])('rejects limit=%p with 400', async (limit) => {
    const res = await handler(listEvent('cust-1', { limit }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('rejects a malformed nextToken with 400', async () => {
    const res = await handler(listEvent('cust-1', { nextToken: 'not-a-token' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody<{ message: string }>(res).message).toBe('nextToken is invalid');
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('rejects a nextToken signed with a different key with 400', async () => {
    const token = encodeNextToken(key('2026-09-05T00:00:00.000Z'), 'not-the-server-secret');
    const res = await handler(listEvent('cust-1', { nextToken: token }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it("rejects a signed nextToken for another customer's shipments with 400", async () => {
    const token = encodeNextToken(key('2026-09-05T00:00:00.000Z', 'cust-2'), SECRET);
    const res = await handler(listEvent('cust-1', { nextToken: token }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('rejects a signed nextToken that is not a Shipments key with 400', async () => {
    const token = encodeNextToken(
      { orderId: 'ord-1', customerId: 'cust-1', createdAt: '2026-09-05T00:00:00.000Z' },
      SECRET,
    );
    const res = await handler(listEvent('cust-1', { nextToken: token }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('rejects an invalid customer id', async () => {
    const res = await handler(apiEvent({ pathParameters: {} }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 without detail when the signing key cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    smMock.on(GetSecretValueCommand).rejects(new Error('denied'));
    const res = await handler(listEvent('cust-1'));
    expect(res.statusCode).toBe(500);
    expect(parseBody<{ message: string }>(res).message).toBe('Internal Server Error');
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('returns 500 without detail when DynamoDB fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    ddbMock.on(QueryCommand).rejects(new Error('boom'));
    const res = await handler(listEvent('cust-1'));
    expect(res.statusCode).toBe(500);
    expect(parseBody<{ message: string }>(res).message).toBe('Internal Server Error');
  });
});
