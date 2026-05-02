import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3Deploy from "aws-cdk-lib/aws-s3-deployment";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import * as path from "path";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import { RESTAURANT_SCHEMA } from "./mcp-schema";

const BEDROCK_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const BEDROCK_BASE_MODEL_ID = "anthropic.claude-haiku-4-5-20251001-v1:0";

export class CdkStack extends cdk.Stack {
  private cfnOutCloudFrontUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // frontend.. serve s3 bucket with cloudfront.

    const bucket = new s3.Bucket(this, "restaurantApp", {
      bucketName:  'restaurantbucket-mcp-app',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const distribution = new cloudfront.Distribution(this, "RestaurantDistribution", {
      defaultBehavior: {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        compress: true,
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 400,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(10),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(10),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(10),
        },
      ],
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2019,
    });

    this.cfnOutCloudFrontUrl = new cdk.CfnOutput(this, "CfnOutCloudFrontUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "The CloudFront URL",
    });

    new s3Deploy.BucketDeployment(this, 'restaurantDeployment', {
      sources: [
        s3Deploy.Source.asset(path.join(__dirname, '../../frontend/dist')),
      ],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // backend- lambda that talks to supabase.

    const restaurantFinderLambda = new lambda.Function(this, "RestaurantFinderLambda", {
      functionName: "restaurant-finder-action",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/restaurant_finder")),
      timeout: cdk.Duration.seconds(30),
    });

    // set this restaurant lambda behind agentcore mcp:
    const agentcore_gw = new agentcore.Gateway(this, 'RestaurantGateway', {
      gatewayName: "restaurant-gateway",
      protocolConfiguration: new agentcore.McpProtocolConfiguration({
        instructions: "Use this gateway to connect to external MCP tools",
        searchType: agentcore.McpGatewaySearchType.SEMANTIC,
        supportedVersions: [
          agentcore.MCPProtocolVersion.MCP_2025_03_26,
          agentcore.MCPProtocolVersion.MCP_2025_06_18,
        ],
      }),
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
    });

    agentcore_gw.addLambdaTarget('RestaurantTool', {
      gatewayTargetName: "restaurant-tool",
      description: "Finds restaurants in a given city and state in the US.",
      lambdaFunction: restaurantFinderLambda,
      toolSchema: agentcore.ToolSchema.fromInline( RESTAURANT_SCHEMA ),
    });

    new cdk.CfnOutput(this, 'GatewayUrl', {
      value: agentcore_gw.gatewayUrl!,
      description: 'AgentCore MCP Gateway URL',
    });

    restaurantFinderLambda.addPermission("AgentCoreGatewayInvoke", {
      principal: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: agentcore_gw.gatewayArn,
    })

    // agentcore runtime...
  
    const agentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromAsset(
      path.join(__dirname, "../strands_agent"),
      {
        platform: ecr_assets.Platform.LINUX_ARM64,
      },
    );

    const agentcoreRuntime = new agentcore.Runtime(this, 'RestaurantAgentRuntime', {
      runtimeName: "restaurant_agent",
      agentRuntimeArtifact,
      environmentVariables: {
        GATEWAY_URL: agentcore_gw.gatewayUrl!,
      }
    });

    agentcoreRuntime.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["bedrock-agentcore:InvokeGateway"],
      resources: [agentcore_gw.gatewayArn],

    }));

    agentcoreRuntime.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ],
      resources: [
        `arn:aws:bedrock:us-east-1::foundation-model/${BEDROCK_BASE_MODEL_ID}`,
        `arn:aws:bedrock:us-east-2::foundation-model/${BEDROCK_BASE_MODEL_ID}`,
        `arn:aws:bedrock:us-west-2::foundation-model/${BEDROCK_BASE_MODEL_ID}`,
        `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/${BEDROCK_MODEL_ID}`,
      ],
    }));

    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: agentcoreRuntime.agentRuntimeArn,
      description: 'AgentCore Runtime ARN',
    });


  }
}
