# 真实模型本地联调：启动、数据流与团队交接

更新：2026-10-22。默认仍是本地 SQLite 联调；设置 `FIX_DATABASE_URL` 后，API 和 worker 使用 PostgreSQL，并在启动时应用版本化 schema migration。仅上传代码、模型/原始数据与文档，不上传本地数据库、审核记录、执行日志或虚拟环境。

## 已接通的内容

模型来自 `ShawnZhang0318/FIX_dashboard` 的 `ai-model-v1`，源提交为 `96e41ff7b85e035d41d75000eaacb6f2d4add390`。导入模型、数据及对应说明，保留现有整合 Dashboard 和未提交的日志/接口工作，没有覆盖式切换分支。

```mermaid
flowchart LR
  CSV[原始 CSV 导入客户端] -->|POST /snapshots| API[公共 API :8000]
  UI[Dashboard :5174] <-->|创建、查询、审核、日志| API
  API <--> DB[(SQLite by default / PostgreSQL via FIX_DATABASE_URL)]
  W[独立 polling worker] <--> DB
  W -->|POST /analyze| AI[私有模型服务 :8001]
  AI -->|真实 P50 / P90| W
  AI --> L[AI 结构化日志文件]
  L -->|公共日志收集器读取| DB
```

- 页面只调用公共 API；不直接访问 AI 或数据库。
- 导入客户端验证原 CSV 哈希，只导入 S001 的 14,620 行，分成最多 100 行的批次，经 API 落库。重复运行会核对已存在行，已有不同内容则拒绝覆盖。
- 每个批次在同一事务中保存快照和库存；重复业务键返回 409 并回滚整个批次。库存等于最新快照的 `Inventory Level`，不再加 `Units Ordered` 或减 `Units Sold`。历史补录不覆盖更新的库存。
- 创建任务验证当天 20 商品覆盖，按 Daily 规则选择“销量大于零或与前一日相比库存变化”的商品，冻结快照 ID、原文件哈希和版本，原子创建 queued Run + pending Job，返回 202。
- worker 原子领取任务，先提交 claimed/processing，再访问 AI。没有在 API 请求中同步预测。每个商品使用截止日及此前 28 天的真实销量，共 29 天，不填补缺失日期。
- AI 使用已训练并校验哈希的 LightGBM 分位数模型。worker 验证返回身份、日期、周期、版本、输入引用和预测值后计算建议，再原子保存结果与可选异常案例。正常结果也保存。
- 查询结果只读取已保存数据。审核必须对应 completed、非 partial、pending_review 的案例；重复审核 409。审核不会改库存或发起采购。
- 模型调用失败保留真实错误和堆栈，任务/Job 一起变 failed；已提交结果保留并标记 partial，不可审核。没有自动重试或模拟数据回退。

## 如何打开

当前这台电脑已安装依赖、导入数据并启动服务。打开：

**http://127.0.0.1:5174/FIX_dashboard/#/analysis**

选择 `2023-11-15`，点击“运行每日分析”，等待完成后看预测结果、异常详情和任务日志。

这是本地网址，服务需在这台电脑运行。现有 github.io 页面不会自动获得这些本地服务。`public/runtime-config.js` 只在 localhost/127.0.0.1 选择本地 live 模式；其他域名仍为 mock，正式部署需配置可访问的公共 API。

### 下次启动

在项目根目录打开 PowerShell。已安装环境不需再次安装。

```powershell
# 可选：指定团队 PostgreSQL；不设置则使用本地 SQLite。
$env:FIX_DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/DBNAME"
.\scripts\start-local-demo.ps1
```

macOS/Linux shell 对应设置为 `export FIX_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DBNAME'`。API 和 worker 必须继承同一个变量。连接凭据仅放在环境变量或秘密管理服务中。PostgreSQL 是新数据库；切换过去不会自动复制 SQLite 里的快照、运行、审核或日志。

脚本启动 API、worker、AI 和 Dashboard，窗口隐藏，保留进程编号及启动时间。已运行或端口占用时会停止启动并提示，不会结束其他程序。

首次准备环境：

```powershell
npm ci
python -m venv .venv-model
.\.venv-model\Scripts\python.exe -m pip install -r ai/requirements-dev.txt
.\scripts\start-local-demo.ps1
.\.venv-model\Scripts\python.exe -m local_backend.import_csv
```

导入前确认 `http://127.0.0.1:8000/health/ready` 与 `http://127.0.0.1:8001/health/ready` 返回成功；启动脚本报告“已启动进程”，不代替健康检查。如果第一次导入遇到服务尚未就绪，等待就绪后再执行导入命令。导入重跑会核对并跳过相同源记录。

停止：

```powershell
.\scripts\stop-local-demo.ps1
```

它只结束脚本记录且启动时间一致的进程及其 Python 服务子进程，保留数据库、预测、审核和应用日志。再次启动可继续查询原结果。若已独立启动 Vite，可用 `start-local-demo.ps1 -BackendOnly` 只启动三个后端进程。

如需旧 mock 演示，把 `public/runtime-config.js` 改回 `mode:'mock'`、`localIntegration:false`，构建并刷新。mock 数据仍在原浏览器存储中，与真实 SQLite 数据隔离。

## 本机保存在哪里

| 文件 / 目录 | 用途 |
| --- | --- |
| `.local-integration/fix.sqlite3` | 未设置 `FIX_DATABASE_URL` 时的本地 SQLite 数据 |
| `.local-integration/ai-events.jsonl` | 私有 AI 的真实应用日志；AI 不直接写业务数据库 |
| `.local-integration/*-stdout.log`、`*-stderr.log` | 各进程的本次启动控制台输出；下次启动覆盖这些控制台文件 |
| `.local-integration/verification.json` | 最近一次真实联调验收输出 |
| `.venv-model/` | 隔离的 Python 依赖 |

上述运行数据和环境已加入 `.gitignore`。SQLite 使用 WAL；备份时先正常停止服务，或用 SQLite 的备份接口，不要在运行中只复制一个数据库文件。

## 模型与 W04 需要明确的适配

1. **数据库。** 未设置 `FIX_DATABASE_URL` 时使用 SQLite；设置为 `postgresql://...` 时，API 与 worker 共用 PostgreSQL。首次启动会依序执行 `local_backend/migrations/` 中尚未应用的 SQL migration，版本记录写入 `schema_migrations`。PostgreSQL 实现 ERD 中的 Product、InventoryItem、Transaction、AnalysisRun、Job、ForecastResult 和 ExceptionCase，并保留 DailyInventorySnapshot 作为模型历史输入。InventoryItem 的 `product_id` 是主键，因此每个 Product 最多一个当前库存记录；`store_id` 保留为当前 S001 API 的兼容字段。CSV 提供的是每日汇总，不是逐笔交易，因此导入器不会伪造 Transaction 记录；交易表目前为空，需接入真实交易来源后再写入。Product 名称暂以稳定 product ID 填充，因为 CSV 没有独立产品名称；初始库存以首次录入该产品时的库存快照值初始化，默认运输方式未知时为 NULL。PostgreSQL 的 `data` 文本列保留现有 API 序列化响应，不替代规范化约束列。SQLite 仍使用现有本地 demo schema；现有 SQLite 记录不会自动复制到 PostgreSQL，请重新导入快照数据。
2. **PostgreSQL 环境配置。** 在启动 API 和 worker 的 shell 环境中都设置同一个 `FIX_DATABASE_URL`，例如 `postgresql://USER:PASSWORD@HOST:5432/DBNAME`。不要把真实密码提交到仓库。连接失败会导致服务启动失败，不会静默切回 SQLite。部署方仍需创建数据库、网络访问和备份策略；团队尚未确定 hosted provider。
3. **历史日期。** 模型训练标签至 2023-04-30、校准标签至 2023-08-31，因此接口拒绝 2023-09-01 之前的分析；默认改成 2023-11-15。W04 中的 2022-06-30 是示例日期，不适合用这个训练后的模型做无泄漏历史演示。
4. **交货期。** ai-model-v1 按商品冻结了模拟交货期 3/7/10/14/21 天，必须与其 catalog 一致。它不是 W04 提议的按训练窗口类别众数推导的交货期；本地采用模型已有映射并保存 catalog 哈希，没有偷偷重分配。原始类别/地区仍按快照保存。
5. **异常。** 该 AI 分支只输出分位数预测，未提供异常模型。worker 使用显式版本化规则：当日销量 > `max(5, 前28日平均销量 × 2)` 视为 unusual_demand。规则不使用未来数据或 CSV 的 Demand Forecast。异常分数记录销量/`max(历史均值,1)`，`anomaly_threshold` 是销量单位的实际阈值，`anomaly_severity` 为 0/1。规则、阈值和触发理由与结果一起保存。
6. **补货。** `safety_stock = P90 − P50`，`recommended_order_quantity = ceil(max(0, P90 − cutoff库存))`。补货大于零或触发异常规则才创建案例；两者同时出现为组合案例。
7. **冷启动。** 模型需要连续 29 日，缺失则创建任务时返回 422，不补零、不伪造预测。Monthly 暂不实现，明确拒绝；完整覆盖且没有 Daily 入选商品时成功完成零结果。
8. **模型不变。** 模型和哈希对应文件恢复为原发布字节；`.gitattributes` 禁止 Git 换行转换再次破坏哈希。推理仍验证所有制品校验值。仅本机执行线程数设为 1，避免单行推理的多线程开销，不改变模型树或校准参数。

本机为 Python 3.12.10；交付 manifest 记录训练环境 Python 3.13.16。其余主要模型依赖按分支固定版本安装，真实回归预测已在本机通过，不能据此推定所有 Python 版本都兼容。

## 后端日志具体怎样生成

- API：实际请求接收、响应状态/耗时、快照提交、Run/Job 入队、审核提交和失败。
- worker：领取任务、读取冻结历史、模型调用开始、响应校验、库存策略计算、结果/案例提交、任务终态；失败保存完整异常堆栈。
- AI：真实请求接收、模型自身的 `forecast_completed` / `forecast_failed` 记录、返回状态及耗时。通过上下文传递 Run/Job/Request/Trace/Product ID；不是前端按时间模拟的阶段。
- 任务的 `trace_id` 取 Run ID。API 在尚不知道 Run ID 时收到的初始请求可按 Request ID 查找；创建后和后续任务事件包含 Run/Job。审核记录可同时按案例、任务、Job 查找。
- API/worker 直接保存应用日志；AI 写结构化文件，由查询收集器导入。全局 sequence 表示收集顺序，timestamp 保留各服务原始发生时间；不是以文件导入时间冒充模型执行时间。
- `GET /logs` 建立固定查询快照，分页不会混进后续新事件；`GET /logs/export` 导出这一快照的全部匹配记录，不受当前页条数限制。
- coverage 表示 API、worker、AI **应用日志来源**的采集情况，缺来源或 worker 心跳过期标为不完整；不代表机器系统日志、所有库的控制台输出或 AI 服务此刻一定存活。后者用健康端点检查。
- 运行数据暂不自动清理；本机访问无需登录，reviewer_label 是演示标签。正式上线须由后端补认证授权、审计主体、日志保留与容量策略。

## 本次验证证据

- AI 原分支 17 项测试和 1 项真实制品回归通过；新增 worker 传输 8 项、本地后端 12 项通过，共 38 项 Python 检查（分轮执行）。32 项前端测试和 Vite 构建通过。
- 回归值：S001 / P0001 / 2023-11-15 / 3 天，P50 `424.03519375145015`，P90 `648.0340855078196`，与交付参考值一致。
- 页面创建的真实任务 `86642938-9336-44a8-87fd-1e34f465edea` 完成 20/20；P0001 使用历史库存 82，建议 567，案例 `fab32d3b-6120-4c5c-951e-020c8eb4efc3` 在页面批准，服务重启后仍可回读。
- 通过当前前端 live adapter 再跑任务 `4295a6d9-559e-4c69-8d38-265615a92c0e`：20/20、审核回读、库存完全不变；175 条 Run/Job 关联日志包含 API/worker/AI，分页去重完整，NDJSON 导出 ID/数量与查询快照一致。
- 该历史日期的 20 商品都触发补货案例，这是模型加当前模拟策略在原始数据上的实际输出；没有为演示正常商品而修改源数据。正常无案例、组合异常、仅异常、零商品、失败部分结果等分支另用明确标记的测试数据验证。

重跑验收（会创建一个真实任务和一条本地测试审核）：

```powershell
node scripts/verify-local-demo.mjs
```

单元/回归检查：

```powershell
New-Item -ItemType Directory -Path .local-integration -Force
.\.venv-model\Scripts\python.exe -m pytest ai/tests ai/integration_tests integration/tests local_backend/tests -q --basetemp=.local-integration/test-check
node --test frontend/tests/*.test.js
npm run build
```

测试目录必须用专用空目录；pytest 会清理其指定的 basetemp，不能指定数据库所在的 `.local-integration` 本身。原文件副本 `docs/w04-reference/` 保持不变。

PostgreSQL workflow test 默认跳过。若要运行，先设置 `FIX_TEST_POSTGRES_URL` 指向专用、可丢弃的测试数据库，再执行 `local_backend/tests/test_flow.py`；测试会清空该数据库的工作流表。不要指向团队共享或生产数据库。

## 交给其他同学接入的接口边界

| 部分 | 本次文件 | 正式接入方式 |
| --- | --- | --- |
| Dashboard 公共请求及校验 | `frontend/live-api.js`、`requests.js`、`contracts.js`、`backend-logs.js` | 保持端点、DTO、202 和状态语义；切换配置中的公共 API 地址 |
| 公共 API | `local_backend/service.py`、`schemas.py` | 后端同学可复用行为合同，替换持久化实现 |
| 数据库 / 冻结输入 | `local_backend/storage.py` | 使用 PostgreSQL 规范化表、外键/约束、事务和版本化 SQL migration；保留不可变来源 |
| worker / 策略 | `local_backend/worker.py` | 保留原子领取、网络调用前提交、结果/案例一起落库和失败可追溯 |
| 私有模型客户端 | `integration/worker_ai.py` | 通过 `FIX_AI_URL` 指定内部模型服务；不要改成 Dashboard 直连 |
| 队友模型 | `ai/`、`data/` | 保留版本和哈希；发布新模型需重新冻结 manifest 与验证 |
| AI 日志包装 / 公共日志查询 | `local_backend/ai_service.py`、`log_api.py` | 正式环境替换成本队统一日志收集器，保留查询/分页/导出合同 |

正式版本仍需：在团队选定的 PostgreSQL 服务上执行集成验收、连接池与部署、认证授权、超时领取恢复、容量/保留策略、共享数据导入规范。当前 worker 不自动重放进程被强制中断时已 claimed 的工作，可能保留 processing；请查看其日志并新建独立任务，不手工篡改数据库伪装成功。已经完成或明确失败的记录会保留。

Zhou 继续负责前端公共请求、分析/结果/日志展示及联调协调；这套本地后端是联调支撑，不意味着正式后端与数据库的团队职责自动转给 Zhou。Zhang 的库存、异常详情和审核页面沿用同一公共 API，无需另写一条到模型的调用链。
