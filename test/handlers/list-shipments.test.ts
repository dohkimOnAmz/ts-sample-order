import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../../src/handlers/list-shipments';
import type { Shipment } from '../../src/model';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  process.env.SHIPMENTS_TABLE = 'shipments-test';
});

describe('GET /customers/{customerId}/shipments', () => {
  it("queries the customer's partition newest first", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ customerId: 'cust-1', shipmentId: 'shp-1', createdAt: '2026-09-02T00:00:00.000Z' }],
    });

    const res = await handler(apiEvent({ pathParameters: { customerId: 'cust-1' } }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<{ shipments: Shipment[] }>(res).shipments).toHaveLength(1);
    const query = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(query.ScanIndexForward).toBe(false);
    expect(query.ExpressionAttributeValues).toEqual({ ':customerId': 'cust-1' });
  });

  it('rejects an invalid customer id', async () => {
    const res = await handler(apiEvent({ pathParameters: {} }));
    expect(res.statusCode).toBe(400);
  });
});
