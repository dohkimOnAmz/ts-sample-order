import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../lib/db';
import { badRequest, json, serverError, type HttpResult } from '../lib/http';
import { isValidId } from '../lib/validation';
import type { Shipment } from '../model';

// GET /customers/{customerId}/shipments
// Returns the customer's shipments, newest first (sort key is createdAt).
export const handler = async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
  const customerId = event.pathParameters?.customerId;
  if (!isValidId(customerId)) {
    return badRequest('customerId is invalid');
  }

  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName('SHIPMENTS_TABLE'),
        KeyConditionExpression: 'customerId = :customerId',
        ExpressionAttributeValues: { ':customerId': customerId },
        ScanIndexForward: false,
      }),
    );
    const shipments = (result.Items ?? []) as Shipment[];
    return json(200, { shipments });
  } catch (err) {
    return serverError(err);
  }
};
