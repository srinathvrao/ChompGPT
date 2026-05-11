import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import * as path from "path";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import { RESTAURANT_SCHEMA, GEOCODER_SCHEMA, RESTAURANT_BY_LATLON_SCHEMA, RESTAURANT_BY_ADDRESS_SCHEMA } from "./mcp-schema";

const BEDROCK_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const BEDROCK_BASE_MODEL_ID = "anthropic.claude-haiku-4-5-20251001-v1:0";

export class CdkStack extends cdk.Stack {
  
  public agentCoreRuntime: agentcore.Runtime;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // NYC geocoder lambda - local CSV lookup
    const geocoderLambda = new lambda.Function(this, "GeocoderLambda", {
      functionName: "nyc-geocoder",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/geocoder")),
      timeout: cdk.Duration.seconds(5),
    });

    // NYC latlon finder lambda - supabase distance query
    const nyclatlonLambda = new lambda.Function(this, "NYCLatLonLambda", {
      functionName: "nyc-lat-lon-finder",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/nyc_latlon_finder")),
      timeout: cdk.Duration.seconds(12),
    });

    // NYC address finder lambda - supabase address matching
    const nycaddrLambda = new lambda.Function(this, "NYCAddrLambda", {
      functionName: "nyc-addr-finder",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/nyc_addr_finder")),
      timeout: cdk.Duration.seconds(12),
    });

    // NYC restaurant finder lambda - address not required
    const restaurantLambda = new lambda.Function(this, "NYCRestaurantLambda", {
      functionName: "nyc-restaurant-finder",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/restaurant_finder")),
      timeout: cdk.Duration.seconds(12),
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

    agentcore_gw.addLambdaTarget('GeocoderTool', {
      gatewayTargetName: "geocoder-tool",
      description:
        "Geocodes a NYC place name, address, neighborhood, or landmark to lat/lon. Skip when coordinates are already known.",
      lambdaFunction: geocoderLambda,
      toolSchema: agentcore.ToolSchema.fromInline(GEOCODER_SCHEMA),
    });

    agentcore_gw.addLambdaTarget('NYCLatLonTool', {
      gatewayTargetName: "nyc-lat-lon-tool",
      description:
        "Finds NYC restaurants near a lat/lon, sorted by distance. For any 'near X' or 'near me' query. Supports cuisine and price filters.",
      lambdaFunction: nyclatlonLambda,
      toolSchema: agentcore.ToolSchema.fromInline(RESTAURANT_BY_LATLON_SCHEMA),
    });

    agentcore_gw.addLambdaTarget('NYCAddressTool', {
      gatewayTargetName: "nyc-address-tool",
      description:
        "Looks up NYC restaurants by address field match. Use for restaurants AT a specific address, or as a geocoder fallback.",
      lambdaFunction: nycaddrLambda,
      toolSchema: agentcore.ToolSchema.fromInline(RESTAURANT_BY_ADDRESS_SCHEMA),
    });

    agentcore_gw.addLambdaTarget('NYCRestaurantSearchTool', {
      gatewayTargetName: "nyc-restaurant-search-tool",
      description:
        "Finds best-rated NYC restaurants for city-wide or borough-wide queries. Use when no neighborhood/landmark/address is specified - otherwise use the lat/lon finder.",
      lambdaFunction: restaurantLambda,
      toolSchema: agentcore.ToolSchema.fromInline(RESTAURANT_SCHEMA),
    });
    
  
    new cdk.CfnOutput(this, 'GatewayUrl', {
      value: agentcore_gw.gatewayUrl!,
      description: 'AgentCore MCP Gateway URL',
    });

    geocoderLambda.addPermission("AgentCoreGatewayInvokeGeocoder", {
      principal: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: agentcore_gw.gatewayArn,
    });

    nyclatlonLambda.addPermission("AgentCoreGatewayInvokeNYCLatLon", {
      principal: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: agentcore_gw.gatewayArn,
    });

    nycaddrLambda.addPermission("AgentCoreGatewayInvokeNYCAddr", {
      principal: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: agentcore_gw.gatewayArn,
    });

    restaurantLambda.addPermission("AgentCoreGatewayInvokeNYCRest", {
      principal: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: agentcore_gw.gatewayArn,
    });

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
      },
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: cdk.Duration.minutes(2),
        maxLifetime: cdk.Duration.hours(8),
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


    this.agentCoreRuntime = agentcoreRuntime;
    
  }
}
