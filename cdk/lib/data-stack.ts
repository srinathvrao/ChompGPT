import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

// this is gonna be just a dynamodb table for storing chat histories.
// idk why separate, because "termination protection on the stateful stack"??
// https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html#best-practices-apps
// that lets me upgrade the rest of my system ezpz. nice!

export class DataStack extends cdk.Stack {

  public readonly chatHistoryTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.chatHistoryTable = new dynamodb.Table(this, 'ChatHistoryTable', {
      tableName: 'RestaurantChatHistory',
      partitionKey: { name: 'session_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
