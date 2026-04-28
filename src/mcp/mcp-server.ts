#!/usr/bin/env node

/**
 * MCP 数据库万能连接器 - 主服务器
 * 通过 Model Context Protocol 让 Claude Desktop 连接数据库
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { DbAdapter, DbConfig } from '../types/adapter.js';
import { SchemaCacheConfig } from '../core/database-service.js';
import { StdioProfileManager } from '../core/stdio-profile-manager.js';
import { normalizeDbType } from '../utils/adapter-factory.js';

/**
 * 数据库 MCP 服务器类
 */
export class DatabaseMCPServer {
  private cacheConfig: Partial<SchemaCacheConfig>;
  private initialAdapter: DbAdapter | null = null;
  private initialConfig: DbConfig | null;
  private profileManager: StdioProfileManager;
  private server: Server;

  constructor(config?: DbConfig, cacheConfig?: Partial<SchemaCacheConfig>) {
    this.initialConfig = config || null;
    this.cacheConfig = cacheConfig || {};
    this.profileManager = new StdioProfileManager(this.cacheConfig);
    this.server = new Server(
      {
        name: 'universal-db-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * 构建连接信息对象
   */
  private buildConnectionInfo(config: DbConfig | null): Record<string, unknown> | null {
    if (!config) {
      return null;
    }

    return {
      type: config.type,
      host: config.host,
      port: config.port,
      database: config.database,
      filePath: config.filePath,
      permissionMode: config.permissionMode || 'safe',
    };
  }

  /**
   * 获取当前已连接的数据库服务
   */
  private getConnectedService() {
    const databaseService = this.profileManager.getDatabaseService();
    if (!databaseService) {
      throw new Error('数据库未连接。请先使用 connect_database 或 switch_profile 工具连接数据库。');
    }

    return databaseService;
  }

  /**
   * 设置 MCP 协议处理器
   */
  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'execute_query',
            description: '执行 SQL 查询或数据库命令。支持 SELECT、JOIN、聚合等查询操作。如果启用了写入模式，也可以执行 INSERT、UPDATE、DELETE 等操作。',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: '要执行的 SQL 语句或数据库命令',
                },
                params: {
                  type: 'array',
                  description: '查询参数（可选，用于参数化查询防止 SQL 注入）',
                  items: {
                    type: 'string',
                  },
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'get_schema',
            description: '获取数据库结构信息，包括所有 Schema 中用户可访问的表名、列名、数据类型、主键、索引等元数据。在执行查询前调用此工具可以帮助理解数据库结构。结果会被缓存以提高性能。',
            inputSchema: {
              type: 'object',
              properties: {
                forceRefresh: {
                  type: 'boolean',
                  description: '是否强制刷新缓存（可选，默认 false）。设为 true 可获取最新的数据库结构。',
                },
              },
            },
          },
          {
            name: 'get_table_info',
            description: '获取指定表的详细信息，包括列定义、索引、预估行数等。用于深入了解某个表的结构。',
            inputSchema: {
              type: 'object',
              properties: {
                tableName: {
                  type: 'string',
                  description: '表名。支持 schema.table_name 格式指定 Schema（如 analytics.users）。不指定 Schema 时查询默认 Schema。',
                },
                forceRefresh: {
                  type: 'boolean',
                  description: '是否强制刷新缓存（可选，默认 false）',
                },
              },
              required: ['tableName'],
            },
          },
          {
            name: 'clear_cache',
            description: '清除 Schema 缓存。当数据库结构发生变化（如新增表、修改列）时，可以调用此工具清除缓存。',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_enum_values',
            description: '获取指定列的所有唯一值。用于了解 status、type、category 等枚举类型列的所有可能值，帮助生成准确的 WHERE 条件。例如：获取 orders.status 列的所有状态值（pending, shipped, delivered 等）。',
            inputSchema: {
              type: 'object',
              properties: {
                tableName: {
                  type: 'string',
                  description: '表名。支持 schema.table_name 格式指定 Schema（如 analytics.users）。',
                },
                columnName: {
                  type: 'string',
                  description: '列名（通常是 status、type、category 等枚举类型的列）',
                },
                limit: {
                  type: 'number',
                  description: '最大返回数量（可选，默认 50，最大 100）。如果唯一值超过此数量，说明该列可能不是枚举类型。',
                },
                includeCount: {
                  type: 'boolean',
                  description: '是否包含每个值的出现次数（可选，默认 false）。设为 true 可了解数据分布。',
                },
              },
              required: ['tableName', 'columnName'],
            },
          },
          {
            name: 'get_sample_data',
            description: '获取表的示例数据（已自动脱敏）。用于了解数据格式，如日期格式（2024-01-01 vs 20240101）、ID格式（UUID vs 自增）、金额精度等。敏感数据（手机号、邮箱、身份证等）会自动脱敏保护隐私。',
            inputSchema: {
              type: 'object',
              properties: {
                tableName: {
                  type: 'string',
                  description: '表名。支持 schema.table_name 格式指定 Schema（如 analytics.users）。',
                },
                columns: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '要查看的列（可选，默认全部列）',
                },
                limit: {
                  type: 'number',
                  description: '返回行数（可选，默认 3，最大 10）',
                },
              },
              required: ['tableName'],
            },
          },
          {
            name: 'connect_database',
            description: '连接到数据库。支持动态指定数据库类型和连接参数，无需重启服务。如果当前已有连接，会自动断开旧连接再建立新连接。支持的数据库类型：mysql, postgres, redis, oracle, dm, sqlserver, mongodb, sqlite, kingbase, gaussdb, oceanbase, tidb, clickhouse, polardb, vastbase, highgo, goldendb。',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  description: '数据库类型',
                  enum: [
                    'mysql', 'postgres', 'redis', 'oracle', 'dm', 'sqlserver',
                    'mongodb', 'sqlite', 'kingbase', 'gaussdb', 'oceanbase',
                    'tidb', 'clickhouse', 'polardb', 'vastbase', 'highgo', 'goldendb',
                  ],
                },
                host: { type: 'string', description: '数据库主机地址' },
                port: { type: 'number', description: '数据库端口' },
                user: { type: 'string', description: '用户名' },
                password: { type: 'string', description: '密码' },
                database: { type: 'string', description: '数据库名称' },
                filePath: { type: 'string', description: 'SQLite 数据库文件路径' },
                allowWrite: { type: 'boolean', description: '是否允许写操作（默认 false）' },
                permissionMode: {
                  type: 'string',
                  description: '权限模式: safe(只读) | readwrite(读写不删) | full(完全控制)',
                  enum: ['safe', 'readwrite', 'full'],
                },
                authSource: { type: 'string', description: 'MongoDB 认证数据库（默认 admin）' },
                oracleClientPath: { type: 'string', description: 'Oracle Instant Client 路径' },
              },
              required: ['type'],
            },
          },
          {
            name: 'list_profiles',
            description: '列出当前 server 可用的所有命名数据库 profile，并返回默认 profile、当前 profile 和连接状态。',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'switch_profile',
            description: '切换到指定的命名数据库 profile。如果当前已有连接，会先断开再连接到目标 profile。',
            inputSchema: {
              type: 'object',
              properties: {
                profileName: {
                  type: 'string',
                  description: '要切换到的 profile 名称',
                },
              },
              required: ['profileName'],
            },
          },
          {
            name: 'disconnect_database',
            description: '断开当前数据库连接。断开后需要重新调用 connect_database 才能执行查询。',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_connection_status',
            description: '获取当前数据库连接状态。返回是否已连接、数据库类型、地址、数据库名、权限模式等信息。',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'connect_database': {
            const {
              type, host, port, user, password, database,
              filePath, allowWrite, permissionMode, authSource, oracleClientPath,
            } = args as Record<string, any>;

            const newConfig: DbConfig = {
              type: normalizeDbType(type),
              host,
              port,
              user,
              password,
              database,
              filePath,
              allowWrite: allowWrite || false,
              permissionMode: permissionMode || 'safe',
            };

            if (newConfig.type === 'mongodb' && authSource) {
              (newConfig as any).authSource = authSource;
            }

            if (newConfig.type === 'oracle' && oracleClientPath) {
              newConfig.oracleClientPath = oracleClientPath;
            }

            console.error(`🔌 正在连接 ${newConfig.type} 数据库...`);
            await this.profileManager.connectDirect(newConfig);

            const connInfo = newConfig.type === 'sqlite'
              ? `SQLite: ${newConfig.filePath}`
              : `${newConfig.type}: ${newConfig.host}:${newConfig.port}/${newConfig.database || '(default)'}`;

            console.error(`✅ 数据库连接成功: ${connInfo}`);

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: `已成功连接到 ${connInfo}`,
                  currentProfileName: null,
                  connection: this.buildConnectionInfo(newConfig),
                }, null, 2),
              }],
            };
          }

          case 'list_profiles': {
            const status = this.profileManager.getStatus();

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  availableProfiles: status.availableProfiles,
                  connected: status.connected,
                  currentProfileName: status.currentProfileName,
                  defaultProfile: status.defaultProfile,
                }, null, 2),
              }],
            };
          }

          case 'switch_profile': {
            const { profileName } = args as { profileName: string };

            console.error(`🔀 正在切换 profile: ${profileName}`);
            await this.profileManager.switchProfile(profileName);

            const status = this.profileManager.getStatus();

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  connected: status.connected,
                  currentProfileName: status.currentProfileName,
                  defaultProfile: status.defaultProfile,
                  availableProfiles: status.availableProfiles,
                  connection: this.buildConnectionInfo(status.config),
                }, null, 2),
              }],
            };
          }

          case 'disconnect_database': {
            const status = this.profileManager.getStatus();
            if (!status.connected) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ success: true, message: '当前没有活跃的数据库连接' }, null, 2),
                }],
              };
            }

            const oldType = status.config?.type;
            await this.profileManager.disconnectCurrent();

            console.error('👋 数据库连接已断开');

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: `已断开 ${oldType || ''} 数据库连接`,
                }, null, 2),
              }],
            };
          }

          case 'get_connection_status': {
            const snapshot = this.profileManager.getStatus();
            if (!snapshot.connected || !snapshot.config) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    availableProfiles: snapshot.availableProfiles,
                    connected: false,
                    currentProfileName: snapshot.currentProfileName,
                    defaultProfile: snapshot.defaultProfile,
                    message: '当前未连接任何数据库。请使用 connect_database 或 switch_profile 工具连接数据库。',
                    profileModeEnabled: snapshot.availableProfiles.length > 0,
                  }, null, 2),
                }],
              };
            }

            const responseStatus: Record<string, any> = {
              availableProfiles: snapshot.availableProfiles,
              connected: true,
              currentProfileName: snapshot.currentProfileName,
              defaultProfile: snapshot.defaultProfile,
              permissionMode: snapshot.config.permissionMode || 'safe',
              profileModeEnabled: snapshot.availableProfiles.length > 0,
              type: snapshot.config.type,
            };

            if (snapshot.config.type === 'sqlite') {
              responseStatus.filePath = snapshot.config.filePath;
            } else {
              responseStatus.host = snapshot.config.host;
              responseStatus.port = snapshot.config.port;
              responseStatus.database = snapshot.config.database;
            }

            const databaseService = this.profileManager.getDatabaseService();
            if (databaseService) {
              const cacheStats = databaseService.getCacheStats();
              responseStatus.schemaCache = {
                cached: cacheStats.isCached,
                hitRate: databaseService.getCacheHitRate() + '%',
              };
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(responseStatus, null, 2),
              }],
            };
          }

          default:
            break;
        }

        const databaseService = this.getConnectedService();

        switch (name) {
          case 'execute_query': {
            const { query, params } = args as { query: string; params?: unknown[] };

            console.error(`📊 执行查询: ${query.substring(0, 100)}...`);

            const result = await databaseService.executeQuery(query, params);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'get_schema': {
            const { forceRefresh } = (args as { forceRefresh?: boolean }) || {};

            console.error('📋 获取数据库结构...');

            const schema = await databaseService.getSchema(forceRefresh);
            const cacheStats = databaseService.getCacheStats();
            const response = {
              ...schema,
              _cacheInfo: {
                cached: cacheStats.isCached,
                cachedAt: cacheStats.cachedAt?.toISOString(),
                hitRate: databaseService.getCacheHitRate() + '%',
              },
            };

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(response, null, 2),
                },
              ],
            };
          }

          case 'get_table_info': {
            const { tableName, forceRefresh } = args as { tableName: string; forceRefresh?: boolean };

            console.error(`📄 获取表信息: ${tableName}`);

            const table = await databaseService.getTableInfo(tableName, forceRefresh);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(table, null, 2),
                },
              ],
            };
          }

          case 'clear_cache': {
            console.error('🗑️ 清除 Schema 缓存...');

            databaseService.clearSchemaCache();

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Schema 缓存已清除',
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_enum_values': {
            const { tableName, columnName, limit, includeCount } = args as {
              tableName: string;
              columnName: string;
              limit?: number;
              includeCount?: boolean;
            };

            console.error(`🔢 获取枚举值: ${tableName}.${columnName}`);

            const result = await databaseService.getEnumValues(
              tableName,
              columnName,
              limit,
              includeCount
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'get_sample_data': {
            const { tableName, columns, limit } = args as {
              tableName: string;
              columns?: string[];
              limit?: number;
            };

            console.error(`📝 获取示例数据: ${tableName}`);

            const result = await databaseService.getSampleData(
              tableName,
              columns,
              limit
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          default:
            throw new Error(`未知工具: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ 错误: ${errorMessage}`);

        return {
          content: [
            {
              type: 'text',
              text: `执行失败: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * 设置单连接启动配置使用的适配器
   */
  setAdapter(adapter: DbAdapter): void {
    this.initialAdapter = adapter;
  }

  /**
   * 设置命名 profile 配置
   */
  setProfiles(profiles: Record<string, DbConfig>, defaultProfile?: string | null): void {
    this.profileManager.setProfiles(profiles, defaultProfile);
  }

  /**
   * 获取当前连接状态快照
   */
  getConnectionStatusSnapshot(): ReturnType<StdioProfileManager['getStatus']> {
    return this.profileManager.getStatus();
  }

  /**
   * 获取 MCP Server 实例（用于 SSE/HTTP 传输）
   */
  getServer(): Server {
    return this.server;
  }

  /**
   * 切换到指定 profile
   */
  async switchProfile(profileName: string): Promise<void> {
    await this.profileManager.switchProfile(profileName);
  }

  /**
   * 连接数据库（不启动传输层）
   */
  async connectDatabase(): Promise<void> {
    if (this.initialAdapter && this.initialConfig) {
      console.error('🔌 正在连接数据库...');
      await this.initialAdapter.connect();
      this.profileManager.attachConnectedAdapter(this.initialAdapter, this.initialConfig, null);
      console.error('✅ 数据库连接成功');
      this.initialAdapter = null;
    } else {
      if (!this.initialConfig) {
        throw new Error('必须先提供启动配置才能连接数据库');
      }

      console.error('🔌 正在连接数据库...');
      await this.profileManager.connectDirect(this.initialConfig);
      console.error('✅ 数据库连接成功');
    }

    if (this.initialConfig?.allowWrite) {
      console.error('⚠️  警告: 写入模式已启用，请谨慎操作！');
    } else {
      console.error('🛡️  安全模式: 只读模式（推荐）');
    }

    console.error('📦 Schema 缓存已启用 (默认 TTL: 5 分钟)');
  }

  /**
   * 使用指定的传输层连接 MCP 服务器
   */
  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }

  /**
   * 启动服务器（使用 stdio 传输，用于 Claude Desktop）
   */
  async start(): Promise<void> {
    if (this.initialConfig) {
      await this.connectDatabase();
    } else if (this.profileManager.getDefaultProfile()) {
      const defaultProfile = this.profileManager.getDefaultProfile()!;
      console.error(`🔌 正在连接默认 profile: ${defaultProfile}...`);
      await this.profileManager.connectDefaultProfile();
      console.error('✅ 默认 profile 已连接');
    } else if (this.profileManager.hasProfiles()) {
      console.error('📡 已加载命名 profile，当前未连接数据库，等待通过 switch_profile 工具切换...');
    } else {
      console.error('📡 MCP 服务器以无连接模式启动，等待通过 connect_database 工具连接数据库...');
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('🚀 MCP 服务器已启动，等待客户端连接...');
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    try {
      await this.server.close();
    } catch (err) {
      console.error('关闭 MCP Server 时出错:', err instanceof Error ? err.message : String(err));
    }

    if (this.profileManager.getStatus().connected) {
      await this.profileManager.disconnectCurrent();
      console.error('👋 数据库连接已关闭');
    }
  }
}
