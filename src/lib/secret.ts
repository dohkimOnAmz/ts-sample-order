import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

// One client per Lambda container, reused across invocations.
const secretsManager = new SecretsManagerClient({});

let cached: Promise<string> | undefined;

// HMAC key for signing nextToken, read from the secret named by PAGINATION_SECRET_ARN.
// Fetched once per container; a failed read is not cached, so the next request retries.
export function getPaginationSecret(): Promise<string> {
  if (!cached) {
    cached = loadSecret().catch((err: unknown) => {
      cached = undefined;
      throw err;
    });
  }
  return cached;
}

async function loadSecret(): Promise<string> {
  const secretId = process.env.PAGINATION_SECRET_ARN;
  if (!secretId) {
    throw new Error('PAGINATION_SECRET_ARN is not set');
  }
  const result = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!result.SecretString) {
    throw new Error('pagination secret has no string value');
  }
  return result.SecretString;
}

// Test hook: forget the cached key so each test starts cold.
export function resetPaginationSecretCache(): void {
  cached = undefined;
}
