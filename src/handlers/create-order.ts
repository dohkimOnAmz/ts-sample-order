import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../lib/db';
import { badRequest, json, serverError, type HttpResult } from '../lib/http';
import { isValidId, parseItems } from '../lib/validation';
import type { Order } from '../model';

// POST /orders  { customerId, items: [{ sku, quantity, unitPrice }] }
export const handler = async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('body must be valid JSON');
  }

  const customerId = typeof body.customerId === 'string' ? body.customerId : undefined;
  if (!isValidId(customerId)) {
    return badRequest('customerId is invalid');
  }
  const items = parseItems(body.items);
  if (!items) {
    return badRequest('items is invalid');
  }

  const order: Order = {
    orderId: randomUUID(),
    customerId,
    status: 'PENDING',
    items,
    totalAmount: items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0),
    createdAt: new Date().toISOString(),
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName('ORDERS_TABLE'),
        Item: order,
        ConditionExpression: 'attribute_not_exists(orderId)',
      }),
    );
    return json(201, order);
  } catch (err) {
    return serverError(err);
  }
};
