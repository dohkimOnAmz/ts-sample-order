import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../lib/db';
import { badRequest, json, notFound, serverError, type HttpResult } from '../lib/http';
import { isValidId } from '../lib/validation';

// GET /orders/{orderId}
export const handler = async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
  const orderId = event.pathParameters?.orderId;
  if (!isValidId(orderId)) {
    return badRequest('orderId is invalid');
  }

  try {
    const result = await ddb.send(
      new GetCommand({ TableName: tableName('ORDERS_TABLE'), Key: { orderId } }),
    );
    if (!result.Item) {
      return notFound('order not found');
    }
    return json(200, result.Item);
  } catch (err) {
    return serverError(err);
  }
};
