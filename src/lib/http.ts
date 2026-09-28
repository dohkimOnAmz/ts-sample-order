import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export type HttpResult = APIGatewayProxyStructuredResultV2;

export function json(statusCode: number, body: unknown): HttpResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function badRequest(message: string): HttpResult {
  return json(400, { message });
}

export function notFound(message: string): HttpResult {
  return json(404, { message });
}

export function serverError(err: unknown): HttpResult {
  // Log the detail for operators; never return it to the caller.
  console.error(err);
  return json(500, { message: 'Internal Server Error' });
}
