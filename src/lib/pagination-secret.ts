import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

// HMAC key for nextToken signing. The stack generates it in Secrets Manager and
// passes the ARN in PAGINATION_SECRET_ARN. Fetched once per Lambda container;
// a failed fetch is not cached, so the next invocation retries.
const sm = new SecretsManagerClient({});
const cache = new Map<string, Promise<string>>();

export function getPaginationSecret(): Promise<string> {
  const arn = process.env.PAGINATION_SECRET_ARN;
  if (!arn) {
    return Promise.reject(new Error('PAGINATION_SECRET_ARN is not set'));
  }
  let secret = cache.get(arn);
  if (!secret) {
    secret = sm.send(new GetSecretValueCommand({ SecretId: arn })).then((res) => {
      if (!res.SecretString) throw new Error('pagination secret is empty');
      return res.SecretString;
    });
    secret.catch(() => cache.delete(arn));
    cache.set(arn, secret);
  }
  return secret;
}
