import { mockClient } from 'aws-sdk-client-mock';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../../src/handlers/update-order-address';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);

const address = { recipient: 'Kim', line1: '1 Main St', city: 'Seoul', postalCode: '04524' };

const put = (body: unknown, orderId = 'ord-1') =>
  handler(
    apiEvent({
      pathParameters: { orderId },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

const conditionFailed = (item?: Record<string, { S: string }>) =>
  new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {}, Item: item });

beforeEach(() => {
  ddbMock.reset();
  process.env.ORDERS_TABLE = 'orders-test';
});

describe('PUT /orders/{orderId}/address', () => {
  it('updates the address of a PENDING or PAID order and returns the order', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { orderId: 'ord-1', status: 'PAID', shippingAddress: address },
    });

    const res = await put(address);

    expect(res.statusCode).toBe(200);
    expect(parseBody<{ shippingAddress: unknown }>(res).shippingAddress).toEqual(address);

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.TableName).toBe('orders-test');
    expect(input.Key).toEqual({ orderId: 'ord-1' });
    expect(input.ConditionExpression).toContain('attribute_exists(orderId)');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':address': address,
      ':pending': 'PENDING',
      ':paid': 'PAID',
    });
    expect(input.ReturnValuesOnConditionCheckFailure).toBe('ALL_OLD');
  });

  it('trims the fields and stores only the four address fields', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderId: 'ord-1' } });

    const res = await put({ ...address, recipient: '  Kim  ', extra: 'ignored' });

    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.ExpressionAttributeValues?.[':address']).toEqual(address);
  });

  it.each(['SHIPPED', 'CANCELLED'])('returns 409 when the order is %s', async (status) => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed({ orderId: { S: 'ord-1' }, status: { S: status } }));

    const res = await put(address);

    expect(res.statusCode).toBe(409);
    expect(parseBody<{ message: string }>(res).message).toContain(status);
  });

  it('returns 404 when the order does not exist', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed());

    const res = await put(address, 'missing');

    expect(res.statusCode).toBe(404);
  });

  it.each(['recipient', 'line1', 'city', 'postalCode'])('returns 400 when %s is empty', async (field) => {
    const res = await put({ ...address, [field]: '   ' });

    expect(res.statusCode).toBe(400);
    expect(parseBody<{ message: string }>(res).message).toContain(field);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it.each(['recipient', 'line1', 'city', 'postalCode'])('returns 400 when %s is missing', async (field) => {
    const body: Record<string, unknown> = { ...address };
    delete body[field];

    const res = await put(body);

    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('returns 400 when a field is not a string', async () => {
    const res = await put({ ...address, postalCode: 4524 });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when a field is too long', async () => {
    const res = await put({ ...address, line1: 'x'.repeat(201) });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const res = await put('{not json');
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when the body is not an object', async () => {
    const res = await put('null');
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid id', async () => {
    const res = await put(address, '../etc');
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('returns 500 on an unexpected DynamoDB error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    ddbMock.on(UpdateCommand).rejects(new Error('boom'));

    const res = await put(address);

    expect(res.statusCode).toBe(500);
    expect(parseBody<{ message: string }>(res).message).toBe('Internal Server Error');
  });
});
