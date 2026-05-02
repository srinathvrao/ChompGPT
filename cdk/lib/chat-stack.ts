import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";

interface ChatStackProps extends cdk.StackProps {
  agentID: string,
  agentAliasID: string;
}

// separate because my one stack was getting too messy..
// this is the chat interface that the cloudfront website talks to.
// needs an API gateway that allows websocket connections
// needs a lambda fn that can publish to the websocket conn.

export class ChatStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: ChatStackProps) {
    super(scope, id, props);

    const { agentID, agentAliasID } = props;

    // give this lambda access to dynamodb, bedrock agent invoking, and output streams.
    const chat_lambda = new lambda.Function(this, "chatLambdaFn", {
      functionName: "chat-service",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/chat_service")),
      timeout: cdk.Duration.seconds(30),
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeAgent"],
          resources: [
            `arn:aws:bedrock:${this.region}:${this.account}:agent/${agentID}`,
            `arn:aws:bedrock:${this.region}:${this.account}:agent-alias/${agentID}/${agentAliasID}`,
          ],
        }),
      ]
    });

    // now I need a lambda that can talk to RestaurantFinderAgent
    
  }
}
