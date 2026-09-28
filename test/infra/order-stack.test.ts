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

  it('indexes Orders by customer, newest first by createdAt', () => {
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

  it('gives list-orders a generated secret for signing nextToken', () => {
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({ PasswordLength: 64, ExcludePunctuation: true }),
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({ PAGINATION_SECRET_ARN: Match.anyValue() }),
      },
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  it('creates one function per route on Node.js 22', () => {
    template.resourcePropertiesCountIs('AWS::Lambda::Function', { Runtime: 'nodejs22.x' }, 4);
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 4);
  });
});
