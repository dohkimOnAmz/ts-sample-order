import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { handler } from '../../src/handlers/list-shipments';
import { encodeNextToken } from '../../src/lib/pagination';
import type { Shipment } from '../../src/model';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);
const smMock = mockClient(SecretsManagerClient);
const SECRET = 'test-pagination-secret';

beforeEach(() => {
  ddbMock.reset();
  smMock.reset();
  smMock.on(GetSecretValueCommand).resolves({ SecretString: SECRET });
  process.env.SHIPMENTS_TABLE = 'shipments-test';
  process.env.PAGINATION_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:111111111111:secret:pagination';
});

const listEvent = (customerId: string, query?: Record<string, string>) =>
  apiEvent({ pathParameters: { customerId }, queryStringParameters: query });

const lastKey = { customerId: 'cust-1', createdAt: '2026-09-02T00:00:00.000Z' };

describe('GET /customers/{customerId}/shipments', () => {
  it("returns the first page of the customer's partition newest first", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ customerId: 'cust-1', shipmentId: 'shp-1', createdAt: '2026-09-02T00:00:00.000Z' }],
    });

    const res = await handler(listEvent('cust-1'));

    expect(res.statusCode).toBe(200);
    const body = parseBody<{ shipments: Shipment[]; nextToken?: string }>(res);
    expect(body.shipments).toHaveLength(1);
    expect(body.nextToken).toBeUndefined();
    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toEqual({
      TableName: 'shipments-test',
      KeyConditionExpression: 'customerId = :customerId',
      ExpressionAttributeValues: { ':customerId': 'cust-1' },
      ScanIndexForward: false,
      Limit: 20,
    });
  });

  it('returns a signed nextToken when there is a next page', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ customerId: 'cust-1', shipmentId: 'shp-2', createdAt: lastKey.createdAt }],
      LastEvaluatedKey: lastKey,
    });

    const res = await handler(listEvent('cust-1', { limit: '1' }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<{ nextToken?: string }>(res).nextToken).toBe(encodeNextToken(lastKey, SECRET));
    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.Limit).toBe(1);
  });

  it('continues from nextToken and omits nextToken on the last page', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ customerId: 'cust-1', shipmentId: 'shp-1', createdAt: '2026-09-01T00:00:00.000Z' }],
    });

    const res = await handler(listEvent('cust-1', { nextToken: encodeNextToken(lastKey, SECRET) }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<{ nextToken?: string }>(res).nextToken).toBeUndefined();
    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.ExclusiveStartKey).toEqual(lastKey);
  });

  it.each(['0', '101', '1.5', 'abc', '', '-1'])('rejects limit=%p', async (limit) => {
    const res = await handler(listEvent('cust-1', { limit }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it.each([
    ['malformed', 'not-a-token'],
    ['unsigned', Buffer.from(JSON.stringify(lastKey), 'utf8').toString('base64url')],
    ['signed with another key', encodeNextToken(lastKey, 'some-other-secret')],
    ['issued for another customer', encodeNextToken({ ...lastKey, customerId: 'cust-2' }, SECRET)],
    [
      'an orders-list token',
      encodeNextToken({ orderId: 'ord-1', customerId: 'cust-1', createdAt: lastKey.createdAt }, SECRET),
    ],
  ])('rejects a %s nextToken', async (_label, nextToken) => {
    const res = await handler(listEvent('cust-1', { nextToken }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('rejects an invalid customer id', async () => {
    const res = await handler(apiEvent({ pathParameters: {} }));
    expect(res.statusCode).toBe(400);
  });
});
