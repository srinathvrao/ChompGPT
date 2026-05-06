#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { CdkStack } from '../lib/cdk-stack';
import { ChatServicesStack } from '../lib/chat-stack';
import { FrontendStack } from '../lib/frontend-stack';

const env = { region: 'us-east-1' };
const app = new cdk.App();
const bedrockCDKStack = new CdkStack(app, 'RestaurantAgentCDKStack', {
  env: env,
});

const chatCDKStack = new ChatServicesStack(app, 'RestaurantChatStack', {
  env: env,
  agentCoreRuntime: bedrockCDKStack.agentCoreRuntime,
});

const frontendCDKStack = new FrontendStack(app, 'ChompFrontendStack', {
  env: env,
  chatAPI: chatCDKStack.chatAPI,
})