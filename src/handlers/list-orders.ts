import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../lib/db';
import { badRequest, json, serverError, type HttpResult } from '../lib/http';
import { isValidId } from '../lib/validation';
import type { Order } from '../model';

// GET /customers/{customerId}/orders
// Returns the customer's orders, newest first.
export const handler = async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
  const customerId = event.pathParameters?.customerId;
  if (!isValidId(customerId)) {
    return badRequest('customerId is invalid');
  }

  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: tableName('ORDERS_TABLE'),
        FilterExpression: 'customerId = :customerId',
        ExpressionAttributeValues: { ':customerId': customerId },
      }),
    );
    const orders = (result.Items ?? []) as Order[];
    orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(200, { orders });
  } catch (err) {
    return serverError(err);
  }
};
