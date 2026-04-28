/**
 * MCP Host Config Reader
 * Reads profile definitions from the host MCP configuration file.
 */

import { readFile } from 'node:fs/promises';
import type { DbConfig } from '../types/adapter.js';

export interface McpProfilesConfig {
  defaultProfile: string | null;
  profiles: Record<string, DbConfig>;
}

export async function readMcpProfilesConfig(
  configPath: string,
  configKey: string
): Promise<McpProfilesConfig> {
  const rawContent = await readFile(configPath, 'utf8');

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new Error(`配置文件不是合法 JSON: ${configPath}`);
  }

  const serverConfig = parsed?.mcpServers?.[configKey];
  if (!serverConfig) {
    throw new Error(`找不到 mcpServers.${configKey} 配置`);
  }

  const profiles = serverConfig.profiles;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new Error(`mcpServers.${configKey}.profiles 缺失或格式不正确`);
  }

  const defaultProfile = serverConfig.defaultProfile ?? null;
  if (defaultProfile !== null && !profiles[defaultProfile]) {
    throw new Error(`defaultProfile 指向不存在的 profile: ${defaultProfile}`);
  }

  return {
    defaultProfile,
    profiles: profiles as Record<string, DbConfig>,
  };
}
