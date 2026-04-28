/**
 * Stdio Profile Manager
 * Manages named profiles and one active stdio connection.
 */

import type { DbAdapter, DbConfig } from '../types/adapter.js';
import { createAdapter } from '../utils/adapter-factory.js';
import { DatabaseService, SchemaCacheConfig } from './database-service.js';

export interface StdioProfileStatus {
  availableProfiles: string[];
  config: DbConfig | null;
  connected: boolean;
  currentProfileName: string | null;
  defaultProfile: string | null;
}

export class StdioProfileManager {
  private adapter: DbAdapter | null = null;
  private cacheConfig: Partial<SchemaCacheConfig>;
  private config: DbConfig | null = null;
  private currentProfileName: string | null = null;
  private databaseService: DatabaseService | null = null;
  private defaultProfile: string | null = null;
  private profiles: Record<string, DbConfig> = {};

  constructor(cacheConfig?: Partial<SchemaCacheConfig>) {
    this.cacheConfig = cacheConfig || {};
  }

  async connectDirect(config: DbConfig): Promise<void> {
    await this.connectWithConfig(config, null);
  }

  async connectDefaultProfile(): Promise<void> {
    if (!this.defaultProfile) {
      return;
    }

    await this.switchProfile(this.defaultProfile);
  }

  async disconnectCurrent(): Promise<void> {
    if (this.databaseService) {
      this.databaseService.clearSchemaCache();
    }

    if (this.adapter) {
      await this.adapter.disconnect();
    }

    this.adapter = null;
    this.config = null;
    this.currentProfileName = null;
    this.databaseService = null;
  }

  getAdapter(): DbAdapter | null {
    return this.adapter;
  }

  getConfig(): DbConfig | null {
    return this.config;
  }

  getDatabaseService(): DatabaseService | null {
    return this.databaseService;
  }

  getDefaultProfile(): string | null {
    return this.defaultProfile;
  }

  getStatus(): StdioProfileStatus {
    return {
      availableProfiles: Object.keys(this.profiles),
      config: this.config ? { ...this.config } : null,
      connected: this.adapter !== null && this.config !== null,
      currentProfileName: this.currentProfileName,
      defaultProfile: this.defaultProfile,
    };
  }

  hasProfiles(): boolean {
    return Object.keys(this.profiles).length > 0;
  }

  listProfiles(): string[] {
    return Object.keys(this.profiles);
  }

  setProfiles(profiles: Record<string, DbConfig>, defaultProfile?: string | null): void {
    this.profiles = { ...profiles };
    this.defaultProfile = defaultProfile ?? null;

    if (this.defaultProfile && !this.profiles[this.defaultProfile]) {
      throw new Error(`defaultProfile 指向不存在的 profile: ${this.defaultProfile}`);
    }
  }

  async switchProfile(profileName: string): Promise<void> {
    const profileConfig = this.profiles[profileName];
    if (!profileConfig) {
      throw new Error(`找不到 profile: ${profileName}`);
    }

    await this.connectWithConfig(profileConfig, profileName);
  }

  attachConnectedAdapter(
    adapter: DbAdapter,
    config: DbConfig,
    profileName: string | null
  ): void {
    this.adapter = adapter;
    this.config = { ...config };
    this.currentProfileName = profileName;
    this.databaseService = new DatabaseService(adapter, this.config, this.cacheConfig);
  }

  private async connectWithConfig(
    config: DbConfig,
    profileName: string | null
  ): Promise<void> {
    await this.disconnectCurrent();

    const adapter = createAdapter(config);
    await adapter.connect();

    this.adapter = adapter;
    this.config = { ...config };
    this.currentProfileName = profileName;
    this.databaseService = new DatabaseService(adapter, this.config, this.cacheConfig);
  }
}
