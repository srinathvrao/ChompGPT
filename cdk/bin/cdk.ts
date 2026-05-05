#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { CdkStack } from '../lib/cdk-stack';
import { ChatServicesStack } from '../lib/chat-stack';

const env = { region: 'us-east-1' };
const app = new cdk.App();
const bedrockCDKStack = new CdkStack(app, 'RestaurantCDKStack', {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  env: env,

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});

const chatCDKStack = new ChatServicesStack(app, 'RestaurantChatStack', {
  env: env,
  agentCoreRuntime: bedrockCDKStack.agentCoreRuntime,
  cloudfrontDistribution: bedrockCDKStack.cloudfrontDistribution,
});
