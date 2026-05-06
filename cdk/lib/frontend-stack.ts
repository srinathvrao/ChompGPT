import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3Deploy from "aws-cdk-lib/aws-s3-deployment";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";

interface FrontendStackProps extends cdk.StackProps {
  chatAPI: apigateway.RestApi;
};

export class FrontendStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { chatAPI } = props;
    // frontend.. serve s3 bucket with cloudfront.

    const cognitoPool = new cognito.CfnIdentityPool(this, "RestaurantIdentityPool", {
        identityPoolName: "restaurant-identity-pool",
        allowUnauthenticatedIdentities: true,
    });
    
    // all unauthenticated guests use this role
    const unauthRole = new iam.Role(this, "CognitoUnauthRole", {
        assumedBy: new iam.FederatedPrincipal(
            "cognito-identity.amazonaws.com",
            {
                StringEquals: {
                    "cognito-identity.amazonaws.com:aud": cognitoPool.ref,
                },
                "ForAnyValue:StringLike": {
                    "cognito-identity.amazonaws.com:amr": "unauthenticated",
                },
            },
            "sts:AssumeRoleWithWebIdentity",
        )
    })

    unauthRole.addToPolicy(new iam.PolicyStatement({
        actions: ['execute-api:Invoke'],
        resources: [chatAPI.arnForExecuteApi('*', '/*', 'prod')],
    }));

    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
        identityPoolId: cognitoPool.ref,
        roles: {
            unauthenticated: unauthRole.roleArn,
        },
    });

    // Expose the IDs the frontend needs
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: cognitoPool.ref });
    new cdk.CfnOutput(this, 'AwsRegion', { value: this.region });


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

    new s3Deploy.BucketDeployment(this, 'restaurantDeployment', {
      sources: [
        s3Deploy.Source.asset(path.join(__dirname, '../../frontend/dist')),
        s3Deploy.Source.jsonData("config.json", {
            region: this.region,
            identityPoolId: cognitoPool.ref,
            apiUrl: chatAPI.url,
        }),
      ],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, "CfnOutCloudFrontUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "The CloudFront URL",
    });

    new cdk.CfnOutput(this, "CfnOutApiGWURL", {
        value: chatAPI.url,
        description: "API gateway URL",
    })

  }
};