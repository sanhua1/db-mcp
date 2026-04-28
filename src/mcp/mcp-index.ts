#!/usr/bin/env node

/**
 * MCP 数据库万能连接器 - MCP 模式入口
 */

import { Command } from 'commander';
import { DatabaseMCPServer } from './mcp-server.js';
import type { DbConfig, PermissionType, PermissionMode } from '../types/adapter.js';
import { normalizeDbType } from '../utils/adapter-factory.js';
import { resolveMcpProfilesConfig } from '../utils/mcp-config-reader.js';
import { resolvePermissions, formatPermissions } from '../utils/safety.js';

/**
 * Start MCP server
 */
export async function startMcpServer(): Promise<void> {
  const program = new Command();

  program
    .name('universal-db-mcp')
    .description('MCP 数据库万能连接器 - 让 Claude Desktop 直接连接你的数据库')
    .version('1.0.0')
    .option('--type <type>', '数据库类型 (mysql|postgres|redis|oracle|dm|sqlserver|mssql|mongodb|sqlite|kingbase|gaussdb|opengauss|oceanbase|tidb|clickhouse|polardb|vastbase|highgo|goldendb)。不指定则以无连接模式启动，可在对话中通过 connect_database 动态连接。')
    .option('--host <host>', '数据库主机地址')
    .option('--port <port>', '数据库端口', parseInt)
    .option('--user <user>', '用户名')
    .option('--password <password>', '密码')
    .option('--database <database>', '数据库名称')
    .option('--file <file>', 'SQLite 数据库文件路径')
    .option('--auth-source <authSource>', 'MongoDB 认证数据库（默认为 admin）')
    .option('--oracle-client-path <path>', 'Oracle Instant Client 路径（启用 Thick 模式以支持 11g）')
    .option('--danger-allow-write', '启用完全写入模式（危险！等价于 --permission-mode=full）', false)
    .option('--permission-mode <mode>', '权限模式: safe(只读) | readwrite(读写不删) | full(完全控制)', 'safe')
    .option('--permissions <list>', '自定义权限列表，逗号分隔: read,insert,update,delete,ddl')
    .option('--config-path <path>', '宿主 MCP 配置文件路径，用于读取命名 profile 配置')
    .option('--config-key <key>', '宿主配置中 mcpServers 下当前 server 的 key，如 db-mcp')
    .action(async (options) => {
      try {
        // 提取 graceful shutdown 逻辑为复用函数
        function setupGracefulShutdown(server: DatabaseMCPServer): void {
          let shuttingDown = false;

          async function gracefulShutdown(reason: string): Promise<void> {
            if (shuttingDown) return;
            shuttingDown = true;

            console.error(`\n⏹️  正在关闭服务器 (${reason})...`);

            try {
              await Promise.race([
                server.stop(),
                new Promise<void>((resolve) => setTimeout(() => {
                  console.error('⚠️  关闭超时，强制退出');
                  resolve();
                }, 5000)),
              ]);
            } catch (err) {
              console.error('关闭过程中出错:', err instanceof Error ? err.message : String(err));
            } finally {
              process.exit(0);
            }
          }

          // 信号处理
          process.on('SIGINT', () => gracefulShutdown('SIGINT'));
          process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

          // stdin 关闭处理（核心修复）
          // 当 MCP 客户端（如 Codex CLI）关闭 stdin 管道时触发
          process.stdin.resume();
          process.stdin.on('end', () => gracefulShutdown('stdin-end'));
          process.stdin.on('close', () => gracefulShutdown('stdin-close'));
        }

        const hostProfileConfig = await resolveMcpProfilesConfig({
          configKey: options.configKey,
          configPath: options.configPath,
        });

        if (options.type) {
          // === 有初始配置：和原来完全一样的逻辑 ===
          // Normalize database type
          const dbType = normalizeDbType(options.type);

          // Parse permissions from command line
          const parsedPermissions = options.permissions
            ? options.permissions.split(',').map((p: string) => p.trim()) as PermissionType[]
            : undefined;

          // Build configuration
          const config: DbConfig = {
            type: dbType as any,
            host: options.host,
            port: options.port,
            user: options.user,
            password: options.password,
            database: options.database,
            filePath: options.file,
            allowWrite: options.dangerAllowWrite,
            permissionMode: options.dangerAllowWrite ? 'full' : options.permissionMode as PermissionMode,
            permissions: parsedPermissions,
          };

          // Add MongoDB-specific config
          if (dbType === 'mongodb' && options.authSource) {
            (config as any).authSource = options.authSource;
          }

          // Add Oracle-specific config
          if (dbType === 'oracle' && options.oracleClientPath) {
            config.oracleClientPath = options.oracleClientPath;
          }

          // Resolve and display permissions
          const permissions = resolvePermissions(config);
          const isSafeMode = permissions.length === 1 && permissions[0] === 'read';

          console.error('🔧 配置信息:');
          console.error(`   数据库类型: ${config.type}`);
          if (config.type === 'sqlite') {
            console.error(`   数据库文件: ${config.filePath}`);
          } else {
            console.error(`   主机地址: ${config.host}:${config.port}`);
            console.error(`   数据库名: ${config.database || '(默认)'}`);
          }
          console.error(`   权限模式: ${isSafeMode ? '✅ 只读模式' : '⚠️  ' + formatPermissions(permissions)}`);
          console.error('');

          // Create server
          const server = new DatabaseMCPServer(config);
          if (hostProfileConfig) {
            server.setProfiles(hostProfileConfig.profiles, hostProfileConfig.defaultProfile);
            console.error(`📚 已从 ${hostProfileConfig.configPath} 的 ${hostProfileConfig.configKey} 加载命名 profile: ${Object.keys(hostProfileConfig.profiles).length} 个`);
          }
          await server.start();

          setupGracefulShutdown(server);
        } else {
          // === 无初始配置：无连接模式启动 ===
          if (hostProfileConfig) {
            console.error(`📚 已从 ${hostProfileConfig.configPath} 的 ${hostProfileConfig.configKey} 加载命名 profile: ${Object.keys(hostProfileConfig.profiles).length} 个`);
            if (hostProfileConfig.defaultProfile) {
              console.error(`🎯 默认 profile: ${hostProfileConfig.defaultProfile}`);
            } else {
              console.error('📡 未设置默认 profile，启动后保持未连接状态');
            }
          } else {
            console.error('📡 无连接模式：未指定数据库类型，等待通过 connect_database 工具动态连接...');
          }
          console.error('');

          const server = new DatabaseMCPServer();
          if (hostProfileConfig) {
            server.setProfiles(hostProfileConfig.profiles, hostProfileConfig.defaultProfile);
          }
          await server.start();

          setupGracefulShutdown(server);
        }
      } catch (error) {
        console.error('❌ 启动失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  program.parse();
}

// If running directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer();
}
