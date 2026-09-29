import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
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

  it('creates one function per route on Node.js 22', () => {
    template.resourcePropertiesCountIs('AWS::Lambda::Function', { Runtime: 'nodejs22.x' }, 5);
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 5);
  });

  it('routes PUT /orders/{orderId}/address', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'PUT /orders/{orderId}/address',
    });
  });

  it('grants the address function UpdateItem only', () => {
    const [roleId] = Object.entries(template.findResources('AWS::IAM::Role')).find(([id]) =>
      id.startsWith('UpdateOrderAddressFn'),
    )!;
    const policies = Object.values(template.findResources('AWS::IAM::Policy')).filter((p) =>
      (p.Properties.Roles as { Ref: string }[]).some((r) => r.Ref === roleId),
    );
    const actions = policies.flatMap((p) =>
      (p.Properties.PolicyDocument.Statement as { Action: string | string[] }[]).flatMap((s) => s.Action),
    );
    expect(actions).toEqual(['dynamodb:UpdateItem']);
  });
});
