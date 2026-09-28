import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export function apiEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/',
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    requestContext: {} as APIGatewayProxyEventV2['requestContext'],
    ...overrides,
  };
}

export function parseBody<T = unknown>(result: { body?: string }): T {
  return JSON.parse(result.body ?? 'null') as T;
}
