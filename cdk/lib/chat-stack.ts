import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';

// cringe: api gateway -> lambda -> ...
// based: api gateway -> load balancer VPC link ->  ECS Fargate containers -> ....
//        Fargate can add more containers based on number of user connections.
//        VPC ($7 per month) + Fargate ($10 per month) for 1 container

// fargate: pay for one lightweight container that's constantly running. always warm container.
// lambda: pay for used execution time, cost goes crazy high. cold starting lambda is hella slow.
// load balancer is required for response streaming REST APIs from VPC. (+$16 a month)
// +$33/month if I use fargate but handles super high traffic.

// could do the same for my MCP's lambda functions.. more work for future me.

interface ChatStackProps extends cdk.StackProps {
  agentCoreRuntime: agentcore.Runtime;
}

// separate because my one stack was getting too messy..
// this is the chat interface that the cloudfront website talks to.

// ref: https://github.com/aws-samples/http-api-aws-fargate-cdk/blob/master/cdk/singleAccount/lib/fargate-vpclink-stack.ts

export class ChatServicesStack extends cdk.Stack {

  public chatAPI: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ChatStackProps) {
    super(scope, id, props);

    const { agentCoreRuntime } = props;
 
    // set up virtual private cloud and a private namespace.
    const vpc = new ec2.Vpc(this, "RestaurantFargateVpc", {
      maxAzs: 2,
      natGateways: 0,
      // availabilityZones: ["us-east-1a", "us-east-1b", ],
    })

    // the fargate task should be set in a cluster that vpc can talk to.
    const cluster = new ecs.Cluster(this, "RestaurantECSCluster", { vpc } );
    const namespace = new servicediscovery.PrivateDnsNamespace(this, "RestaurantNameSpace", {
      name: "foodinternal",
      vpc: vpc,
      description: "Private DNSNamespace for microservices",
    });

    const execRole = new iam.Role(this, "ecsTaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    execRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy"
      )
    );

    // set up ECS fargate containers first.
    const fargateTaskDefinition = new ecs.FargateTaskDefinition(this, "RestaurantTaskFargate", {
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },
      cpu: 256, // 1024 = 1 vCPU
      memoryLimitMiB: 512, // 0.5 GB
      executionRole: execRole,
      taskRole: new iam.Role( this, "TaskRole", {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      }),
    });

    fargateTaskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:InvokeAgentRuntime",
          "bedrock-agentcore:InvokeAgentRuntimeForUser",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/*`,
        ],
      }),
    );

    const chatServiceContainer = fargateTaskDefinition.addContainer("ChatServiceContainer", {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, "../chat-service")),
      environment: {
        AWS_REGION: this.region,
        AGENTCORE_RUNTIME_ARN: agentCoreRuntime.agentRuntimeArn,
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "restaurant-chat",
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
    });

    chatServiceContainer.addPortMappings({
      containerPort: 3000,
    })

    // load balancer setup
    const publicSubnets = vpc.selectSubnets({ 
      subnetType: ec2.SubnetType.PUBLIC, 
    });

    const nlb = new elbv2.NetworkLoadBalancer(this, "NLB", {
      vpc,
      internetFacing: false,
      vpcSubnets: publicSubnets,
    })
    const cfnNlb = nlb.node.defaultChild as elbv2.CfnLoadBalancer;
    cfnNlb.securityGroups = [];

    const targetGroup = new elbv2.NetworkTargetGroup(this, "TargetGroup", {
      vpc,
      port: 3000,
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        enabled: true,
        protocol: elbv2.Protocol.HTTP,
        path: "/health",
        port: '3000',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
        interval: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(5),
      }
    });

    nlb.addListener("Listener", {
      port: 3000,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [targetGroup],
    })

    const vpcLink = new apigateway.VpcLink(this, "VPCLink", {
      vpcLinkName: "RestaurantVPCLink",
      targets: [nlb],
    })

    const chatServiceSecGrp = new ec2.SecurityGroup(this, "chatServiceSecurityGroup", {
      vpc: vpc,
      description: "Allow inbound to fargate",
      allowAllOutbound: true,
    });

    // allow inbound requests from vpc to to chatService
    chatServiceSecGrp.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(3000),
      'Allow inbound port :3000 on container',
    );

    const chatService = new ecs.FargateService(this, "chatService", {
      serviceName: "RestaurantFargateService",
      cluster: cluster,
      taskDefinition: fargateTaskDefinition,
      cloudMapOptions: {
        cloudMapNamespace: namespace,
        name: "chatService",
        dnsRecordType: servicediscovery.DnsRecordType.SRV,
        containerPort: 3000,
      },
      vpcSubnets: publicSubnets,
      securityGroups:  [ chatServiceSecGrp ],
      circuitBreaker: {
        enable: true,
        rollback: false,
      },
      assignPublicIp: true,
    });

    chatService.attachToNetworkTargetGroup(targetGroup);

    // fargate autoscaling:
    const scaling = chatService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 6,
    });

    scaling.scaleOnMetric("ConnectionCountScaling", {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/NetworkELB',
        metricName: 'ActiveFlowCount',
        dimensionsMap: {
          LoadBalancer: nlb.loadBalancerFullName,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      scalingSteps: [
        { upper: 400, change: 1 },
        { lower: 400, upper: 800, change: 2 },
        { lower: 800, upper: 1200, change: 3 },
        { lower: 1200, upper: 1600, change: 4 },
        { lower: 1600, change: 6 },
      ],
      adjustmentType: appscaling.AdjustmentType.EXACT_CAPACITY,
      cooldown: cdk.Duration.minutes(2),
    });

    // allow chatService to reach out to agentcoreRuntime.
    agentCoreRuntime.grantInvokeRuntimeForUser(fargateTaskDefinition.taskRole);

    const vpc_service = chatService.cloudMapService;
    if (!vpc_service) {
      throw new Error("Cloud Map service was not created - check cloudMapOptions");
    }

    // apigatewayv2 does not support response transfer mode: STREAMING. only collects and sends.
    // gotta go back to apigatewayv1..

    const vpcIntegration = new apigateway.Integration({
      type: apigateway.IntegrationType.HTTP_PROXY,
      integrationHttpMethod: "ANY",
      uri: `http://${nlb.loadBalancerDnsName}:3000/`,
      options: {
        connectionType: apigateway.ConnectionType.VPC_LINK,
        vpcLink: vpcLink,
      },
    });

    const chatAPI = new apigateway.RestApi(this, "chatApi", {
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deployOptions: {
        stageName: 'prod',
      },
    });

    const rootMethod = chatAPI.root.addMethod("ANY", vpcIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    });
    const cfnRootMethod = rootMethod.node.defaultChild as apigateway.CfnMethod;
    cfnRootMethod.addOverride('Properties.Integration.ResponseTransferMode', 'STREAM');

    new cdk.CfnOutput(this, "APIGatewayendpoint", {
      value: chatAPI.url,
      description: "API Gateway endpoint URL",
    });

    this.chatAPI = chatAPI;

    // Have to set up this api gateway for Cognito identity pools
    // TODO: read up on that..
  }
}
