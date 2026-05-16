import { createContext, useContext, useState, useEffect, createElement } from 'react'
import type { ReactNode } from 'react'

export interface AppConfig {
  region: string;
  albUrl: string;
  cognitoPoolID: string;
  accountID: string;
}

let cached: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load config');
  cached = await res.json();
  return cached!;
}

const ConfigContext = createContext<AppConfig | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => { loadConfig().then(setConfig); }, []);
  if (!config) return null;
  return createElement(ConfigContext.Provider, { value: config }, children);
}

export const useConfig = () => useContext(ConfigContext)!;
