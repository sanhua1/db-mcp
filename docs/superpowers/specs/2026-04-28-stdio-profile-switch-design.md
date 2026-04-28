# Stdio 命名连接配置与 Profile 切换设计

## 目标

为 `universal-db-mcp` 的 `stdio` 模式增加单 server 多数据库 profile 能力。

目标场景：

- Claude Code / Codex 里只配置一台 `db-mcp`
- 宿主配置文件里维护多套命名数据库配置
- server 启动后默认可不连接数据库
- agent 在会话里调用 `switch_profile` 再接入目标数据库

HTTP API 模式不在本次范围内。

## 约束

1. Claude Code 启动 stdio MCP 子进程时，真正传给进程的只有 `command / args / env / cwd / type` 一类字段。
2. 宿主配置里自定义的 `profiles` 字段不会自动传入子进程。
3. 因此要支持整洁的宿主配置结构，server 必须自己回读配置文件。

## 宿主配置形态

目标配置保持单 server 结构：

```json
{
  "mcpServers": {
    "db-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "universal-db-mcp",
        "--config-path",
        "C:/Users/example/.claude.json",
        "--config-key",
        "db-mcp"
      ],
      "profiles": {
        "profile-dev": {
          "type": "mysql",
          "host": "dev-db.example.com",
          "port": 3306,
          "user": "read-only",
          "password": "your_password",
          "database": "app_dev"
        }
      }
    }
  }
}
```

可选字段：

- `defaultProfile`
- `profiles`

`defaultProfile` 缺省时，server 启动后保持未连接状态。

## CLI 设计

新增两个 stdio 专用参数：

- `--config-path <path>`
- `--config-key <key>`

含义：

- `config-path`：宿主 MCP 配置文件路径
- `config-key`：`mcpServers` 下当前 server 的 key，例如 `db-mcp`

行为：

1. 启动时先解析已有单连接 CLI 参数
2. 如果提供 `--config-path + --config-key`，再从宿主配置中读取 `profiles` 和 `defaultProfile`
3. 如果读取到 profile 配置，则 stdio server 进入“profile 模式”
4. profile 模式下，旧的单连接 CLI 参数仍保留兼容，但优先级低于显式切换

## MCP 工具设计

新增两个工具：

### `list_profiles`

返回：

- 所有 profile 名
- 当前 profile 名
- 是否已连接
- 默认 profile 名

### `switch_profile`

入参：

- `profileName`

行为：

1. 校验 profile 是否存在
2. 如果当前已连接其他 profile，先断开
3. 用目标 profile 建立连接
4. 刷新 `adapter / config / databaseService / currentProfileName`
5. 返回切换结果

## 现有工具兼容策略

### `connect_database`

保留。

它继续支持“手工临时连接”。

如果调用它：

- 当前 profile 连接会被断开
- `currentProfileName` 清空
- 当前状态变成“已连接，但不是 profile 连接”

### `disconnect_database`

保留。

调用后：

- 断开当前连接
- 清空 `adapter / config / databaseService`
- 清空 `currentProfileName`

### `get_connection_status`

扩展返回：

- `currentProfileName`
- `defaultProfile`
- `profileModeEnabled`
- `availableProfiles`

## 内部结构

新增一个 stdio 专用管理层，负责：

1. 保存 profile 注册表
2. 保存当前 profile 名
3. 管理单个活动连接
4. 统一处理“切 profile / 手工连接 / 断开”

建议拆为两个小单元：

- `src/utils/mcp-config-reader.ts`
  - 读取宿主配置文件
  - 提取 `mcpServers[configKey].profiles`
  - 做结构校验

- `src/core/stdio-profile-manager.ts`
  - 管理 profile 注册表和当前活动连接

这样 `src/mcp/mcp-server.ts` 只保留协议层逻辑。

## 错误处理

以下情况直接报清晰错误：

1. `--config-path` 文件不存在
2. 配置文件不是合法 JSON
3. `mcpServers[configKey]` 不存在
4. `profiles` 缺失或不是对象
5. `defaultProfile` 指向不存在的 profile
6. `switch_profile` 指向未知 profile
7. profile 数据库连接失败

错误信息要求能直接指出：

- 哪个配置项错了
- 哪个 profile 错了
- 是读取失败还是连接失败

## 数据流

```text
[Claude/Codex 启动 db-mcp]
        │
        ├── argv: --config-path + --config-key
        │
        ├── 读取宿主配置文件
        │
        ├── 提取 profiles / defaultProfile
        │
        ├── 若有 defaultProfile → 自动连接
        │
        └── 若无 defaultProfile → 保持未连接
                │
                ├── list_profiles
                ├── switch_profile("profile-prod")
                └── execute_query(...)
```

## 测试策略

本次走 TDD。

至少覆盖：

1. 配置读取成功
2. 缺失 `profiles` 的错误路径
3. `defaultProfile` 校验失败
4. profile 模式下切换当前 profile
5. 手工连接覆盖当前 profile
6. 断开后状态清空
7. `get_connection_status` 返回 profile 信息

## 非目标

本次不做：

- HTTP API profile 能力
- 多活动连接并存
- 连接池跨 profile 复用
- profile 写入宿主配置文件
- 自动识别 Claude/Codex 配置路径

配置路径先走显式 `--config-path`。
