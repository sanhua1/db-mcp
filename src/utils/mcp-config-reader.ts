/**
 * MCP Host Config Reader
 * Reads profile definitions from host MCP configuration files.
 */

import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { DbConfig } from '../types/adapter.js';

export interface McpProfilesConfig {
  defaultProfile: string | null;
  profiles: Record<string, DbConfig>;
}

export interface ResolvedMcpProfilesConfig extends McpProfilesConfig {
  configKey: string;
  configPath: string;
}

export interface ResolveMcpProfilesConfigOptions {
  configKey?: string;
  configPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

const DB_MCP_PROFILES_ENV_KEY = 'DB_MCP_PROFILES';
const DB_MCP_DEFAULT_PROFILE_ENV_KEY = 'DB_MCP_DEFAULT_PROFILE';

function extractProfilesConfig(
  serverConfig: any,
  configKey: string,
  configPath: string
): ResolvedMcpProfilesConfig {
  const profiles = serverConfig?.profiles;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new Error(`mcpServers.${configKey}.profiles 缺失或格式不正确`);
  }

  const defaultProfile = serverConfig.defaultProfile ?? null;
  if (defaultProfile !== null && !profiles[defaultProfile]) {
    throw new Error(`defaultProfile 指向不存在的 profile: ${defaultProfile}`);
  }

  return {
    configKey,
    configPath,
    defaultProfile,
    profiles: profiles as Record<string, DbConfig>,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function findServerCandidates(parsed: any): Array<{ key: string; value: any }> {
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
    return Object.entries(parsed.mcpServers)
      .filter((entry): entry is [string, any] => Array.isArray(entry) && typeof entry[0] === 'string')
      .map(([key, value]) => ({ key, value }));
  }

  if (parsed.profiles && typeof parsed.profiles === 'object' && !Array.isArray(parsed.profiles)) {
    return [{ key: 'db-mcp', value: parsed }];
  }

  return [];
}

async function parseJsonConfigFile(path: string): Promise<any> {
  const rawContent = await readFile(path, 'utf8');

  try {
    return JSON.parse(rawContent);
  } catch {
    throw new Error(`配置文件不是合法 JSON: ${path}`);
  }
}

function parseJsonContent(rawContent: string, sourceName: string): any {
  try {
    return JSON.parse(rawContent);
  } catch {
    throw new Error(`${sourceName} 不是合法 JSON`);
  }
}

function resolveServerConfigFromEnv(
  env: NodeJS.ProcessEnv,
  configKey?: string
): ResolvedMcpProfilesConfig | null {
  const rawProfilesConfig = env[DB_MCP_PROFILES_ENV_KEY]?.trim();
  if (!rawProfilesConfig) {
    return null;
  }

  const parsedProfilesConfig = parseJsonContent(rawProfilesConfig, `环境变量 ${DB_MCP_PROFILES_ENV_KEY}`);
  const parsedServerConfig = parsedProfilesConfig?.profiles &&
    typeof parsedProfilesConfig.profiles === 'object' &&
    !Array.isArray(parsedProfilesConfig.profiles)
    ? {
        profiles: parsedProfilesConfig.profiles,
        defaultProfile: parsedProfilesConfig.defaultProfile ?? env[DB_MCP_DEFAULT_PROFILE_ENV_KEY] ?? null,
      }
    : {
        profiles: parsedProfilesConfig,
        defaultProfile: env[DB_MCP_DEFAULT_PROFILE_ENV_KEY] ?? null,
      };

  const normalizedDefaultProfile = typeof parsedServerConfig.defaultProfile === 'string'
    ? parsedServerConfig.defaultProfile.trim() || null
    : parsedServerConfig.defaultProfile;

  return extractProfilesConfig(
    {
      profiles: parsedServerConfig.profiles,
      defaultProfile: normalizedDefaultProfile,
    },
    configKey || 'db-mcp',
    `env:${DB_MCP_PROFILES_ENV_KEY}`
  );
}

function resolveServerConfigFromParsed(
  parsed: any,
  configPath: string,
  configKey?: string
): ResolvedMcpProfilesConfig | null {
  const candidates = findServerCandidates(parsed);
  if (candidates.length === 0) {
    return null;
  }

  if (configKey) {
    const matchedCandidate = candidates.find((candidate) => candidate.key === configKey);
    if (!matchedCandidate) {
      throw new Error(`找不到 mcpServers.${configKey} 配置`);
    }

    return extractProfilesConfig(matchedCandidate.value, matchedCandidate.key, configPath);
  }

  const dbMcpCandidate = candidates.find((candidate) => candidate.key === 'db-mcp');
  if (dbMcpCandidate) {
    return extractProfilesConfig(dbMcpCandidate.value, dbMcpCandidate.key, configPath);
  }

  const profileCandidates = candidates.filter((candidate) => {
    const profiles = candidate.value?.profiles;
    return profiles && typeof profiles === 'object' && !Array.isArray(profiles);
  });

  if (profileCandidates.length === 1) {
    return extractProfilesConfig(profileCandidates[0].value, profileCandidates[0].key, configPath);
  }

  if (profileCandidates.length > 1) {
    const candidateKeys = profileCandidates.map((candidate) => candidate.key).join(', ');
    throw new Error(`发现多个包含 profiles 的 MCP server，无法自动判断，请显式指定 --config-key。候选: ${candidateKeys}`);
  }

  return null;
}

function collectAutoDiscoveryPaths(startDir: string, homeDir: string): string[] {
  const orderedPaths: string[] = [];
  const visitedPaths = new Set<string>();

  let currentDir = resolve(startDir);
  while (true) {
    const currentPath = join(currentDir, '.mcp.json');
    if (!visitedPaths.has(currentPath)) {
      orderedPaths.push(currentPath);
      visitedPaths.add(currentPath);
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  for (const homePath of [join(homeDir, '.mcp.json'), join(homeDir, '.claude.json')]) {
    if (!visitedPaths.has(homePath)) {
      orderedPaths.push(homePath);
      visitedPaths.add(homePath);
    }
  }

  return orderedPaths;
}

export async function readMcpProfilesConfig(
  configPath: string,
  configKey: string
): Promise<McpProfilesConfig> {
  const resolvedConfig = await resolveMcpProfilesConfig({
    configKey,
    configPath,
  });

  if (!resolvedConfig) {
    throw new Error(`在配置文件中找不到可用的 profile 配置: ${configPath}`);
  }

  return {
    defaultProfile: resolvedConfig.defaultProfile,
    profiles: resolvedConfig.profiles,
  };
}

export async function resolveMcpProfilesConfig(
  options: ResolveMcpProfilesConfigOptions = {}
): Promise<ResolvedMcpProfilesConfig | null> {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const homeDir = options.homeDir || homedir();

  if (options.configPath) {
    const parsed = await parseJsonConfigFile(options.configPath);
    return resolveServerConfigFromParsed(parsed, options.configPath, options.configKey);
  }

  const envConfig = resolveServerConfigFromEnv(env, options.configKey);
  if (envConfig) {
    return envConfig;
  }

  const candidatePaths = collectAutoDiscoveryPaths(cwd, homeDir);
  for (const candidatePath of candidatePaths) {
    if (!(await fileExists(candidatePath))) {
      continue;
    }

    const parsed = await parseJsonConfigFile(candidatePath);
    const resolvedConfig = resolveServerConfigFromParsed(parsed, candidatePath, options.configKey);
    if (resolvedConfig) {
      return resolvedConfig;
    }
  }

  return null;
}
