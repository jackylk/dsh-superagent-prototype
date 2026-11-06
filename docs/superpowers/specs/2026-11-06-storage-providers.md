# SuperAgent 同步存储扩展设计

## 目标与边界

用户选择 SQLite 或 Lakebase；多个 SuperAgent 实例各自使用一个 Lakebase 数据库。保留现有同步调用与事务语义，SQLite 仍为默认后端。核心只提供通用接口和扩展点，Lakebase 作为独立 DSH bundle 安装。Engine 的领域接口、任务调度、工具与管理页面保持原有业务流程。

本分支从 main 创建，原 `feat/lakebase-storage` 分支保留。开发范围包括设计文档、核心扩展点、SQLite 适配、Lakebase 插件及验证，不包含 PR、推送、生产部署或修改用户日常 GUI profile。

## 架构总览（PR 说明参考）

核心业务依赖同步 `Storage` 接口，SQLite 与 Lakebase 分别实现它。注册中心负责选择工厂；图中的注册关系与业务数据访问关系分开表示。

```text
                  用户配置
          storage.backend + options
                       |
                       v
+----------------------------------------------------------+
|                  SuperAgent 核心仓库                      |
|                                                          |
|  DSH 主插件入口                                           |
|        |                                                 |
|        v                                                 |
|  StorageProviders 注册中心                                |
|        |                                                 |
|        +-- sqlite  ---------> 内置 SQLite 工厂             |
|        |                                                 |
|        +-- lakebase --------> 外部插件注册的工厂            |
|        |                                                 |
|        | 解析所选工厂，交给 Runtime                         |
|        v                                                 |
|  Runtime                                                 |
|        |                                                 |
|        +--> Engine / Sessions / Tools / 管理 API           |
|        |                                                 |
|        +--> Effects：调度、并发、重试                       |
|                       |                                  |
|                       v                                  |
|              同步 Storage 接口                            |
|              +----------------------------------+        |
|              | 领域记录：Trigger / Ticket 等     |        |
|              | KV / 设置 / 历史 / 读取视图        |        |
|              | 收据 / EffectRecords             |        |
|              | atomic / afterCommit / close     |        |
|              +----------------------------------+        |
|                       ^                                  |
|                       | 实现                             |
|              +-------------------+                       |
|              | SQLite Store      |                       |
|              | SQLite SQL / 迁移 |                       |
|              +---------+---------+                       |
+------------------------|---------------------------------+
                         |
                         v
              <stateDir>/orchestrator.sqlite


              同一个同步 Storage 接口
                         ^
                         | 实现
+------------------------|---------------------------------+
|              独立 Lakebase 插件包                         |
|              plugins/lakebase-storage                    |
|                                                          |
|  插件入口 -- 注册 lakebase --> 核心 StorageProviders      |
|                                                          |
|              LakebaseStorage                             |
|                       |                                  |
|              PostgreSQL SQL / Schema                     |
|              读取视图 / EffectRecords                    |
|                       |                                  |
|              pg-native / libpq                           |
|              原生同步调用 + 严格 TLS                      |
+-----------------------|----------------------------------+
                        |
                        v
              DBay.cloud Lakebase
              每个 SuperAgent 实例独立一个数据库
```

Engine 使用 `Storage` 继承的 `Repositories` 领域接口；其他应用模块使用设置、读取视图、收据等扩展能力。运行时只实例化所选后端。两种后端均保持同步调用，没有 Worker 桥接；只有启动时等待 provider 注册是异步的。

一次业务写入的事务关系：

```text
Engine / 业务命令
       |
       v
Storage.atomic(() => {
    保存领域记录
    更新 KV / 收据
    写入 EffectRecords
})
       |
       +-- 失败 --> 一起回滚
       |
       +-- 提交成功 --> afterCommit --> Effects 执行外部动作
```

准备 PR 时可沿用当前两条提交的评审边界：

| 提交 | 评审范围 |
| --- | --- |
| `725b424`：通用同步存储扩展 | Storage 接口、provider 注册中心、Runtime 接入、SQLite 适配、公共导出、测试及核心文档；可独立评审，不依赖 Lakebase 插件 |
| `a13365e`：独立 Lakebase 插件 | 插件注册、原生 PG 驱动、SQL/schema、离线导入、专项测试、workspace 配置及设计/验收文档 |

实际验证范围与当时相对 main 的改动统计见 [重构验证记录](../plans/2026-11-06-storage-providers-validation.md)。后续修改应重新计算 PR diff；该记录保留本次验收时的统计。

## 核心接口

`src/app/storage.ts` 定义同步 `Storage`，扩展 Engine 现有的 `Repositories`：

| 能力 | 契约 |
| --- | --- |
| 领域记录 | Trigger、Thread、Ticket、Decision 与 disposition 的读取、保存和列举 |
| 原子事务 | `atomic` 同步返回；嵌套事务支持局部回滚；所有领域记录、KV、收据和 effects 使用同一事务 |
| 提交回调 | `afterCommit` 仅在外层提交成功后运行；回滚层的回调丢弃；回调异常通过 report 上报，不改变已提交结果 |
| KV 与设置 | 使用已有 KV 类型、SettingsSchema、版本记录与历史接口 |
| 读取视图 | 使用有类型的分页、时间线、搜索、统计与收据视图，避免业务层拼接 SQL |
| 持久队列 | EffectRecords 提供入队、待执行读取、完成、重试、取消和统计；调度、退避与并发策略仍由 Effects 持有 |
| 生命周期 | factory 同步返回 Storage；close 幂等；不可恢复连接丢失通过 onUnavailable 通知 Runtime |

业务模块只导入接口类型，不再依赖具体 Store。SQLite Store 保留内部 `db`，供自己的 SQL、历史迁移与 SQLite 专属测试使用；接口不暴露数据库句柄。Effects 的 SQL 移到 SQLite effect records，保证与领域写入使用同一连接。

Effect 的 `seq` 保持队列顺序，`generation` 在更新 payload 时递增。旧执行结果只能完成或重试相同 seq/generation 的记录，不能删除后续更新。provider 必须保留这个行为。

`dsh-superagent/storage` 为插件公开接口、注册服务、既有 KV/Settings/Versions 与领域类型。插件不引用核心相对源码路径；共享测试夹具只用于同仓开发验证。这个扩展 API 仍随原型演进，插件 peer 版本必须与核心匹配。

## Provider 注册与选择

核心 bundle 增加 `dsh-superagent/storage` entry，提供 Cordis `superagentStorage` 服务，内置 `sqlite` factory。可选 bundle 在服务中注册唯一名称，并随其 Cordis scope 卸载而注销。

主 entry 的配置增加：

```yaml
storage:
  backend: sqlite
  options: {}
```

默认配置继续使用 `<stateDir>/orchestrator.sqlite`。`options` 属于所选 provider，由对应 factory 严格验证。注册过程允许不同 bundle 的加载顺序，启动解析最多等待五秒；没有安装或启用所选 provider 时明确失败。移除已选 provider 后，Runtime 停止 intake、取消已加载 Agent，并释放数据库与本地锁。恢复 provider 后需重新启动主 entry。

只有启动时查找 provider 是异步的；数据库调用、atomic 与 factory 保持同步。配置变更通过现有 DSH entry 重启机制应用，不改变领域方法为 Promise。

## Lakebase 独立包

`plugins/lakebase-storage` 为单独 package，有自己的 package.json、build、类型检查、测试配置、DSH bundle patch 和 README。它依赖公开存储 API，通过 peer dependency 使用核心；`pg-native` 仅属于插件依赖。核心的 SQLite 安装不需要 libpq 或原生编译。

插件注册 `lakebase`。其 `options.connectionFile` 是绝对路径，文件须为 owner-only 权限，保存 DBay 返回的 PG URI。URI 必须使用唯一的 `sslmode=verify-full`，保留 endpoint 路由参数，并使用可信 CA 校验 hostname；不禁用 TLS 验证。

插件使用原生同步 libpq，持有独占 PostgreSQL session advisory lock。相同数据库的第二个实例被拒绝；不同实例使用不同数据库。网络请求阻塞 JS 线程，跨网络延迟会增加业务流程耗时，应按实际部署距离测量。数据库调用设置连接、语句、锁和空闲事务超时；断连后不自动重连或重放，避免丢失 owner lock 或重复执行不确定提交。

所有 PostgreSQL DDL、JSONB/generated columns、部分索引、稳定到达顺序 identity、参数化 SQL 与读取视图均在插件内显式实现。不存在运行时 SQLite SQL 转换器。领域 schema 11 与 PostgreSQL physical schema 1 分别校验。PostgreSQL aborted transaction 在 COMMIT 时会返回 ROLLBACK，因此驱动提交前检查事务状态，拒绝发布成功结果和 afterCommit 回调。

原生 addon 需匹配实际加载它的 Node/Electron ABI。CLI 可使用当前 Node 构建；桌面应用需针对其 Electron runtime 构建插件原生依赖，不能直接混用。安装和启用均在同一 DSH profile 中完成。

## 迁移

切换 backend 只选择存储，不自动传输数据。离线 importer 位于插件包：源实例与目标实例先停机，源 SQLite 只读打开，必须是 schema 11；schema 10 先由 SQLite 适配器升级备份。目标只允许无用户数据的数据库。

单次 PG 事务复制九张表，保留到达顺序、effects、设置与历史，逐值核验后校正 identity sequence。失败回滚目标写入，源文件不变。COMMIT 响应丢失属于不确定结果，先检查目标再决定下一步。

## 验证与验收

核心完整测试、类型检查和构建必须通过。SQLite 与插件调用同一套同步事务、记录、查询、收据和 effects 契约测试。插件另测严格 TLS、独占 owner、失联、aborted transaction、GC 安全关闭、进程强杀回滚、离线导入与受控 Runtime 业务流程。

本地 TLS PostgreSQL 用于快速回归；DBay.cloud 用专用 `superagent-test-*` 临时实例验证真实兼容性并清理。DSH 安装包使用隔离 profile 验证，检查 registry/provider entry 激活与管理 API 业务结果。受控模型 fixture 的 Runtime E2E 与真实模型/GitHub PR 明确区分，后者不在本次授权范围。

最终对比 main 分别列出：核心生产代码、SQLite 适配、可选插件、测试、文档、依赖元数据；机械类型导入与新增实现分别说明。社区提交流程可以先评审通用接口提交，再单独评审或外置 Lakebase 包。
