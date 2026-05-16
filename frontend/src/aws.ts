import type { AppConfig } from './config';
import { CognitoIdentityClient, GetIdCommand, GetOpenIdTokenCommand } from '@aws-sdk/client-cognito-identity';

const cognitoClient = new CognitoIdentityClient({ region: 'us-east-1' });
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getGuestToken(config: AppConfig): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const { IdentityId } = await cognitoClient.send(new GetIdCommand({
    AccountId: config.accountID,
    IdentityPoolId: config.cognitoPoolID,
  }));

  const { Token } = await cognitoClient.send(new GetOpenIdTokenCommand({
    IdentityId: IdentityId!,
  }));

  cachedToken = Token!;
  tokenExpiry = Date.now() + 55 * 60 * 1000; // 55 min (tokens last 1 hour)
  return cachedToken;
}

export function createApiClient(config: AppConfig) {
  const baseUrl = config.albUrl.replace(/\/chat$/, '');

  async function authorizedFetch(path: string, init: RequestInit = {}) {
    const token = await getGuestToken(config);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        'Authorization': `Bearer ${token}`,
      },
    });
  }

  return {
    fetch(init: RequestInit = {}) {
      return authorizedFetch('/chat', init);
    },

    fetchHistory(sessionID: string, init: RequestInit = {}) {
      return authorizedFetch(`/history?sessionId=${encodeURIComponent(sessionID)}`, init);
    },

    deleteSession(sessionID: string, init: RequestInit = {}) {
      return authorizedFetch(`/session?sessionId=${encodeURIComponent(sessionID)}`, {
        ...init,
        method: 'DELETE',
      });
    },
  };
}