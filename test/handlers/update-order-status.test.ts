import { mockClient } from 'aws-sdk-client-mock';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../../src/handlers/update-order-status';
import { apiEvent, parseBody } from '../helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);

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

describe('PUT /orders/{orderId}/status', () => {
  it.each([
    ['PAID', 'PENDING'],
    ['SHIPPED', 'PAID'],
  ])('changes the status to %s and requires the current status to be %s', async (to, from) => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderId: 'ord-1', status: to } });

    const res = await put({ status: to });

    expect(res.statusCode).toBe(200);
    expect(parseBody<{ status: string }>(res).status).toBe(to);

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.TableName).toBe('orders-test');
    expect(input.Key).toEqual({ orderId: 'ord-1' });
    expect(input.UpdateExpression).toBe('SET #status = :to');
    expect(input.ConditionExpression).toBe('attribute_exists(orderId) AND #status = :from');
    expect(input.ExpressionAttributeNames).toEqual({ '#status': 'status' });
    expect(input.ExpressionAttributeValues).toMatchObject({ ':to': to, ':from': from });
    expect(input.ReturnValuesOnConditionCheckFailure).toBe('ALL_OLD');
  });

  it.each(['PAID', 'SHIPPED'])('returns 409 when the current status does not allow %s', async (to) => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed({ orderId: { S: 'ord-1' }, status: { S: 'CANCELLED' } }));

    const res = await put({ status: to });

    expect(res.statusCode).toBe(409);
    expect(parseBody<{ message: string }>(res).message).toContain('CANCELLED');
  });

  it.each(['PENDING', 'CANCELLED'])('returns 409 for %s, which no transition ends at', async (to) => {
    const res = await put({ status: to });

    expect(res.statusCode).toBe(409);
    expect(parseBody<{ message: string }>(res).message).toContain(to);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('returns 404 when the order does not exist', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed());

    const res = await put({ status: 'PAID' }, 'missing');

    expect(res.statusCode).toBe(404);
  });

  it.each(['SHIPPED_OUT', 'paid', '', 'DONE'])('returns 400 for the unknown status %p', async (status) => {
    const res = await put({ status });

    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('returns 400 when status is missing', async () => {
    const res = await put({});

    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('returns 400 when status is not a string', async () => {
    const res = await put({ status: 1 });
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
    const res = await put({ status: 'PAID' }, '../etc');
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('returns 500 on an unexpected DynamoDB error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    ddbMock.on(UpdateCommand).rejects(new Error('boom'));

    const res = await put({ status: 'PAID' });

    expect(res.statusCode).toBe(500);
    expect(parseBody<{ message: string }>(res).message).toBe('Internal Server Error');
  });
});
