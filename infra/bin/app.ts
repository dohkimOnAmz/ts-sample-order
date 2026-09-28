#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { OrderStack } from '../lib/order-stack';

const app = new App();
new OrderStack(app, 'TsSampleOrderStack');
