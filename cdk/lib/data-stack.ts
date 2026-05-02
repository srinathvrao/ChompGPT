import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";

// this is gonna be just a dynamodb table for storing chat histories.
// idk why separate, because "termination protection on the stateful stack"??
// https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html#best-practices-apps
// that lets me upgrade the rest of my system ezpz. nice!

// this might be incredibly slow.. every chat request, i fetch the history -> then send to agent?

export class DataStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // hello dynamodb, "chat-service" lambda will reach out to you for conversation history.



  }
}
