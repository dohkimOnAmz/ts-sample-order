import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { Construct } from 'constructs';

const HANDLERS_DIR = path.join(__dirname, '..', '..', 'src', 'handlers');

export class OrderStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Orders: pk orderId
    const orders = new dynamodb.Table(this, 'OrdersTable', {
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.DESTROY, // sample stack; do not copy to production
    });
    // GET /customers/{customerId}/orders: Query a customer's orders, newest first.
    orders.addGlobalSecondaryIndex({
      indexName: 'byCustomer',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Shipments: pk customerId, sk createdAt
    const shipments = new dynamodb.Table(this, 'ShipmentsTable', {
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const environment = {
      ORDERS_TABLE: orders.tableName,
      SHIPMENTS_TABLE: shipments.tableName,
    };
    const fn = (name: string, file: string) =>
      new NodejsFunction(this, name, {
        entry: path.join(HANDLERS_DIR, file),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: Duration.seconds(10),
        environment,
      });

    const createOrder = fn('CreateOrderFn', 'create-order.ts');
    const getOrder = fn('GetOrderFn', 'get-order.ts');
    const listOrders = fn('ListOrdersFn', 'list-orders.ts');
    const listShipments = fn('ListShipmentsFn', 'list-shipments.ts');

    orders.grantWriteData(createOrder);
    orders.grantReadData(getOrder);
    orders.grantReadData(listOrders);
    shipments.grantReadData(listShipments);

    // No authorizer: this is a demo stack. Add IAM or JWT auth before exposing real data.
    const api = new HttpApi(this, 'OrderApi');
    const route = (routePath: string, method: HttpMethod, handler: NodejsFunction) =>
      api.addRoutes({
        path: routePath,
        methods: [method],
        integration: new HttpLambdaIntegration(`${handler.node.id}Integration`, handler),
      });
    route('/orders', HttpMethod.POST, createOrder);
    route('/orders/{orderId}', HttpMethod.GET, getOrder);
    route('/customers/{customerId}/orders', HttpMethod.GET, listOrders);
    route('/customers/{customerId}/shipments', HttpMethod.GET, listShipments);

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
  }
}
