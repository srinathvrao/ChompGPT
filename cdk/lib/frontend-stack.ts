import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3Deploy from "aws-cdk-lib/aws-s3-deployment";
import * as path from "path";

interface FrontendStackProps extends cdk.StackProps {
  albDnsName: string;
}

export class FrontendStack extends cdk.Stack {

  public readonly distributionUrl: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { albDnsName } = props;

    const bucket = new s3.Bucket(this, "restaurantApp", {
      bucketName: 'restaurantbucket-mcp-app',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const albOrigin = new cloudfrontOrigins.HttpOrigin(albDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
    });

    const distribution = new cloudfront.Distribution(this, "RestaurantDistribution", {
      defaultBehavior: {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        compress: true,
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/chat': {
          origin: albOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          compress: false,
        },
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

    this.distributionUrl = `https://${distribution.distributionDomainName}`;

    new s3Deploy.BucketDeployment(this, 'restaurantDeployment', {
      sources: [
        s3Deploy.Source.asset(path.join(__dirname, '../../frontend/dist')),
        s3Deploy.Source.jsonData("config.json", {
          region: this.region,
          albUrl: `https://${distribution.distributionDomainName}/chat`,
        }),
      ],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, "CfnOutCloudFrontUrl", {
      value: this.distributionUrl,
      description: "CloudFront distribution URL",
    });
  }
};
