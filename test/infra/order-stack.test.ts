import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { OrderStack } from '../../infra/lib/order-stack';

// Skip esbuild bundling so the test only checks the synthesized template.
const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
const template = Template.fromStack(new OrderStack(app, 'TestStack'));

describe('OrderStack', () => {
  it('creates the Orders and Shipments tables', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 2);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'orderId', KeyType: 'HASH' }],
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'customerId', KeyType: 'HASH' },
        { AttributeName: 'createdAt', KeyType: 'RANGE' },
      ],
    });
  });

  it('adds the byCustomer GSI on Orders (customerId, createdAt)', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'orderId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'byCustomer',
          KeySchema: [
            { AttributeName: 'customerId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    });
  });

  it('creates a generated PaginationSecret for signing nextToken', () => {
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({ PasswordLength: 64, ExcludePunctuation: true }),
    });
  });

  it('gives only the list functions (orders, shipments) the secret ARN and read access', () => {
    const withArn = template.findResources('AWS::Lambda::Function', {
      Properties: {
        Environment: { Variables: Match.objectLike({ PAGINATION_SECRET_ARN: Match.anyValue() }) },
      },
    });
    expect(Object.keys(withArn).sort()).toEqual([
      expect.stringMatching(/^ListOrdersFn/),
      expect.stringMatching(/^ListShipmentsFn/),
    ]);

    const policies = template.findResources('AWS::IAM::Policy');
    const readers = Object.entries(policies).filter(([, p]) =>
      JSON.stringify(p).includes('secretsmanager:GetSecretValue'),
    );
    expect(readers.map(([id]) => id).sort()).toEqual([
      expect.stringMatching(/^ListOrdersFn/),
      expect.stringMatching(/^ListShipmentsFn/),
    ]);
  });

  it('creates one function per route on Node.js 22', () => {
    template.resourcePropertiesCountIs('AWS::Lambda::Function', { Runtime: 'nodejs22.x' }, 6);
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 6);
  });

  it('routes PUT /orders/{orderId}/address', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'PUT /orders/{orderId}/address',
    });
  });

  it('routes PUT /orders/{orderId}/status', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'PUT /orders/{orderId}/status',
    });
  });

  it.each([
    ['UpdateOrderAddressFn', ['dynamodb:UpdateItem']],
    // The status handler also reads: a dead-end target status must answer 404 for a missing order.
    ['UpdateOrderStatusFn', ['dynamodb:UpdateItem', 'dynamodb:GetItem']],
  ])('grants %s exactly %p', (fnId, expected) => {
    const [roleId] = Object.entries(template.findResources('AWS::IAM::Role')).find(([id]) =>
      id.startsWith(fnId as string),
    )!;
    const policies = Object.values(template.findResources('AWS::IAM::Policy')).filter((p) =>
      (p.Properties.Roles as { Ref: string }[]).some((r) => r.Ref === roleId),
    );
    const actions = policies.flatMap((p) =>
      (p.Properties.PolicyDocument.Statement as { Action: string | string[] }[]).flatMap((s) => s.Action),
    );
    expect(actions.sort()).toEqual([...(expected as string[])].sort());
  });
});
