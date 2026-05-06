import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';
import { AwsClient } from 'aws4fetch';
import type { AppConfig } from './config';

export function createApiClient(config: AppConfig) {
  const credentialsProvider = fromCognitoIdentityPool({
    client: new CognitoIdentityClient({ region: config.region }),
    identityPoolId: config.identityPoolId,
  });

  return {
    async fetch(path: string, init: RequestInit = {}) {
      const creds = await credentialsProvider();
      const aws = new AwsClient({
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
        region: config.region,
        service: 'execute-api',
      });

      const url = new URL(path, config.apiUrl).toString();
      return aws.fetch(url, init);
    },
  };
}
