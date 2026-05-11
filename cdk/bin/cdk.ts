#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { CdkStack } from '../lib/cdk-stack';
import { ChatServicesStack } from '../lib/chat-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { DataStack } from '../lib/data-stack';

const env = { account: '', region: 'us-east-1' };
const app = new cdk.App();

const dataStack = new DataStack(app, 'RestaurantDataStack', { env });

const bedrockCDKStack = new CdkStack(app, 'RestaurantAgentCDKStack', {
  env: env,
});

const chatCDKStack = new ChatServicesStack(app, 'RestaurantChatStack', {
  env: env,
  agentCoreRuntime: bedrockCDKStack.agentCoreRuntime,
  chatHistoryTable: dataStack.chatHistoryTable,
});

new FrontendStack(app, 'ChompFrontendStack', {
  env,
  albDnsName: chatCDKStack.albDnsName,
});
