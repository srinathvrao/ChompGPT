import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3Deploy from "aws-cdk-lib/aws-s3-deployment";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as path from "path";

const BEDROCK_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const BEDROCK_BASE_MODEL_ID = "anthropic.claude-haiku-4-5-20251001-v1:0";

// openapi schema from the bedrock agent web ui
const RESTAURANT_FINDER_SCHEMA = `openapi: 3.0.0
info:
  title: Restaurant Finder API
  version: 1.0.0
  description: API for finding restaurants near a city
paths:
  /rpc/find_restaurants_near_city:
    post:
      operationId: findRestaurantsNearCity
      summary: Find restaurants near a city
      description: Finds restaurants near a given city and state in the USA, optionally filtered by cuisine type (could be something like ramen, noodles, thai, chinese, indian).
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - city_name
                - city_state
              properties:
                city_name:
                  type: string
                  description: The name of the city
                city_state:
                  type: string
                  description: The state abbreviation, e.g. NY
                cuisine:
                  type: string
                  description: Optional cuisine type to filter by, e.g. ramen, pizza
                limit_n:
                  type: integer
                  description: Maximum number of restaurants to return
                  default: 20
      responses:
        "200":
          description: A list of restaurants in and around the specified city`;


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

    // give bedrock access to invoke this lambda.
    restaurantFinderLambda.addPermission("AllowBedrockInvoke", {
      principal: new iam.ServicePrincipal("bedrock.amazonaws.com"),
      sourceAccount: this.account,
      sourceArn: `arn:aws:bedrock:${this.region}:${this.account}:agent/*`,
    });

    // iam role

    const bedrockAgentRole = new iam.Role(this, "BedrockAgentRole", {
      roleName: "AmazonBedrockExecutionRoleForAgents_RestaurantFinder",
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: { "aws:SourceArn": `arn:aws:bedrock:${this.region}:${this.account}:agent/*` },
        },
      }),
      inlinePolicies: {
        InvokeFoundationModel: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
              ],
              resources: [
                `arn:aws:bedrock:us-east-1::foundation-model/${BEDROCK_BASE_MODEL_ID}`,
                `arn:aws:bedrock:us-east-2::foundation-model/${BEDROCK_BASE_MODEL_ID}`,
                `arn:aws:bedrock:us-west-2::foundation-model/${BEDROCK_BASE_MODEL_ID}`,
                `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${BEDROCK_MODEL_ID}`,
              ],
            }),
          ],
        }),
      },
    });


    // system prompt for the agent.. And model to use.
    const bedrockAgent = new bedrock.CfnAgent(this, "RestaurantAgent", {
      agentName: "RestaurantFinderAgent",
      description: "Finds restaurants near a city using natural language queries.",
      autoPrepare: true,
      instruction:
        "You are a restaurant finder assistant. Use the restaurant-finder-action lambda function to find restaurants near a city in the United States. " +
        "Always ask for the city and state in the USA if not provided, with an optional preference for cuisine. " +
        "Present results clearly with name, lat/lon and cuisine and web link if available.",
      foundationModel: BEDROCK_MODEL_ID,
      agentResourceRoleArn: bedrockAgentRole.roleArn,
      idleSessionTtlInSeconds: 600,
      actionGroups: [
        {
          actionGroupName: "RestaurantFinderActionGroup",
          description: "Finds restaurants near a given city using a Supabase RPC call.",
          actionGroupExecutor: {
            lambda: restaurantFinderLambda.functionArn,
          },
          apiSchema: {
            payload: RESTAURANT_FINDER_SCHEMA,
          },
        },
      ],
    });

    // annoying pt 2 .. we use an agent alias and tag the "live" version to the latest deployed version.
    const bedrockAgentAlias = new bedrock.CfnAgentAlias(this, "RestaurantAgentAlias", {
      agentId: bedrockAgent.attrAgentId,
      agentAliasName: "live"
    });

    new cdk.CfnOutput(this, "BedrockAgentId", {
      value: bedrockAgent.attrAgentId,
      description: "Bedrock Agent ID",
    });

    new cdk.CfnOutput(this, "BedrockAgentAliasId", {
      value: bedrockAgentAlias.attrAgentAliasId,
      description: "Bedrock Agent Alias ID",
    });
  }
}
