import type { AppConfig } from './config';

export function createApiClient(config: AppConfig) {
  return {
    fetch(path: string, init: RequestInit = {}) {
      const url = new URL(path, config.albUrl).toString();
      return fetch(url, init);
    },
  };
}
