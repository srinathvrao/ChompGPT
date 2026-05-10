import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';

// cringe: api gateway -> lambda -> ...
// based: api gateway -> load balancer VPC link ->  ECS Fargate containers -> ....
//        Fargate can add more containers based on number of user connections.
//        VPC ($7 per month) + Fargate ($10 per month) for 1 container + Load balancer ($16/month)
//        extra cost for scalable setup: +$33/month

// fargate: pay for one lightweight container that's constantly running. always warm container.
// lambda: pay for used execution time, cost goes crazy high. cold starting lambda is hella slow.

// could do the same for my MCP's lambda functions.. more work for future me.

interface ChatStackProps extends cdk.StackProps {
  agentCoreRuntime: agentcore.Runtime;
}

// separate because my one stack was getting too messy..
// this is the chat interface that the cloudfront website talks to.

// ref: https://github.com/aws-samples/http-api-aws-fargate-cdk/blob/master/cdk/singleAccount/lib/fargate-vpclink-stack.ts

export class ChatServicesStack extends cdk.Stack {

  public readonly albDnsName: string;

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

    const albSecGrp = new ec2.SecurityGroup(this, "ALBSecurityGroup", {
      vpc,
      description: "ALB security group",
      allowAllOutbound: true,
    });
    albSecGrp.addIngressRule(
      ec2.Peer.prefixList('pl-3b927c52'), // us-east-1 aws cloudfront origins only
      ec2.Port.tcp(80),
      "Allow inbound :80 from CloudFront IPs only",
    );

    const alb = new elbv2.ApplicationLoadBalancer(this, "ALB", {
      vpc,
      internetFacing: true,
      vpcSubnets: publicSubnets,
      securityGroup: albSecGrp,
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      loadBalancingAlgorithmType: elbv2.TargetGroupLoadBalancingAlgorithmType.LEAST_OUTSTANDING_REQUESTS,
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

    alb.addListener("Listener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    const chatServiceSecGrp = new ec2.SecurityGroup(this, "chatServiceSecurityGroup", {
      vpc: vpc,
      description: "Allow inbound to fargate",
      allowAllOutbound: true,
    });

    chatServiceSecGrp.addIngressRule(
      albSecGrp,
      ec2.Port.tcp(3000),
      "Allow inbound :3000 from ALB",
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

    chatService.attachToApplicationTargetGroup(targetGroup);

    // fargate autoscaling, allows 30 * 500 = 15,000 concurrent users.
    chatService.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 30 })
      .scaleOnRequestCount("RequestCountScaling", {
        requestsPerTarget: 500,
        targetGroup,
        scaleInCooldown: cdk.Duration.minutes(5),
        scaleOutCooldown: cdk.Duration.minutes(1),
      });

    agentCoreRuntime.grantInvokeRuntimeForUser(fargateTaskDefinition.taskRole);

    this.albDnsName = alb.loadBalancerDnsName;
  }
}
