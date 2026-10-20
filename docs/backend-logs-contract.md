# 后端完整执行日志：Dashboard 接入约定

## 当前状态

Dashboard 的“日志”默认展示后端执行日志。浏览器本地操作记录保留在“浏览器诊断”，不是本需求的日志来源。2026-10-20 已接入本地真实 API、worker、AI 的应用执行日志；实现与启动见[本地联调说明](local-integration-zh.md)。本机访问使用 `http://127.0.0.1:8000`，后端关闭时显示错误，不回退浏览器日志或虚构记录。正式团队部署仍待接入。

本地原始 MAIE6000C1 starter 未修改。下面两个端点已由新增的 `local_backend/log_api.py` 实现，正式后端可继续遵守相同合同。日志记录实际应用事件、关联编号、耗时、错误和异常堆栈；服务进程的启动控制台输出另保留在 `.local-integration/*-stdout.log`、`*-stderr.log`，页面覆盖状态不代表操作系统或所有第三方库的日志收集。

## 哪些日志构成完整执行过程

| 服务 / 阶段 | 后端应实际记录的事件 |
| --- | --- |
| API 接收 | 请求接收、校验失败 / 通过、创建 run/job 后提交成功、响应状态与耗时 |
| 排队与 worker | 入队、领取任务、开始处理、job ID、run ID、执行尝试次数 |
| 读取数据 | 门店 / 商品 / 日期范围、输入快照版本、读取行数、缺失数据与读取失败 |
| 模型调用 | 模型版本、开始调用、完成、超时、校验失败、调用耗时；不得包含密钥 |
| 计算与持久化 | 预测及建议数量计算、写入结果和异常案例、数据库提交成功 / 失败、部分结果 |
| 重试 | 重试原因、当前 attempt、下一次计划时间、最终放弃；没有实际重试则不得虚构 |
| 任务终态 | completed / failed 的真实落库时间、处理数量、错误类型与堆栈 |
| 人工审核 | 案例与任务关联、审核事务提交、状态冲突、操作主体的服务端标识；按访问权限展示 |

所有服务传递 `run_id`、`job_id`、`trace_id`，HTTP 请求用 `request_id` 关联。worker 调用模型服务时传递同一 trace ID。页面关闭后后台继续产生的日志，重新打开时仍应可查询。日志时间由服务端生成；不可使用浏览器估算的 1.2 秒 / 5.2 秒模拟状态代替。

## 1. 查询：GET /logs

过滤参数全部在服务端执行：`run_id`、`job_id`、`case_id`、`request_id`、`trace_id`、`level`、`service`、`stage`、`from`、`to`、`query`。时间为带时区的 ISO 字符串，包含边界。`level` 为 DEBUG / INFO / WARNING / ERROR / CRITICAL。`query` 搜索消息或事件名。

分页：`limit` 默认 100（服务端应限制范围）；首次查询不带 cursor。服务端返回固定快照 ID、总数和下一页游标。后续携带相同筛选、`snapshot_id` 和 `cursor`。新日志到来不能改变该快照分页结果。按采集端全局递增 `sequence` 降序排列，避免跨服务时间误差导致分页遗漏。`id` 唯一。

以下为接口形状示例，不是真实执行记录：

```json
{
  "items": [{
    "id": "log-example-42",
    "sequence": 42,
    "timestamp": "2026-10-15T03:30:00.000Z",
    "level": "ERROR",
    "service": "worker",
    "stage": "predicting",
    "event": "model.request.failed",
    "message": "Model request timed out for one product.",
    "run_id": "run-example",
    "job_id": "job-example",
    "request_id": "request-example",
    "trace_id": "trace-example",
    "case_id": null,
    "product_id": "P0001",
    "attempt": 2,
    "duration_ms": 20000,
    "error": {
      "type": "TimeoutError",
      "message": "Model response exceeded the configured deadline.",
      "stack_trace": "Traceback: ...\nTimeoutError: ...",
      "retryable": true
    },
    "context": {"model_version": "version-example", "input_reference": "snapshot-example"}
  }],
  "total": 1,
  "next_cursor": null,
  "snapshot_id": "snapshot-example",
  "generated_at": "2026-10-15T03:31:00.000Z",
  "order": "desc",
  "coverage": {
    "status": "partial",
    "services": [
      {"name": "api", "status": "available"},
      {"name": "worker", "status": "available"},
      {"name": "ai", "status": "unavailable", "message": "AI log collector is not connected."}
    ],
    "retained_from": "2026-10-01T00:00:00.000Z"
  }
}
```

必填行字段：id、sequence、timestamp、level、service、stage、event、message。关联 ID 可为空或省略；有值时统一使用字符串，包括原 starter 的整数 job ID。attempt 为正整数；duration_ms 为非负数。error 可为空，否则仅包含字符串 type/message/stack_trace 和布尔 retryable。context 为 JSON 对象。

`coverage` 必须如实描述采集覆盖。status 为 complete 或 partial，services 列出系统应该接入的日志源及 available / partial / unavailable，不能只列已经成功的服务。`retained_from` 是服务端保留范围的起始时间，不知道时传 null。页面不会把缺失服务或过期日志解释为没有执行过。

空查询为 items=[]、total=0、next_cursor=null，仍应返回快照和 coverage。快照过期返回 410（或约定 409），提示重新查询，不得在旧游标下悄悄切换快照。输入错误返回 422，未授权 401，无权读取 403。接口未实现的 404 不能返回假的空数组。

## 2. 导出：GET /logs/export

携带同样的过滤参数及当前 `snapshot_id`，不携带 limit/cursor。导出该快照下全部匹配且有权访问、仍保留的记录。响应：`Content-Type: application/x-ndjson; charset=utf-8`；每行一个完整日志 JSON，推荐 `Content-Disposition: attachment`。

导出不能只返回已在浏览器加载的 100 条。若记录规模过大，应明确返回限制错误或提供异步导出机制，不得静默截断并声称完整。快照过期、认证、权限和脱敏规则与查询一致。当前前端采用文件响应下载，超大规模异步导出后续另行适配。

## 后端如何提供来源

建议将 API、worker、AI 的结构化日志收集到同一个持久存储（日志平台或独立日志表），查询 API 从该存储读取。若用数据库，至少保存本约定的行字段，对 run_id/sequence、trace_id/sequence、service/timestamp 建索引。保留策略独立管理，Dashboard 不提供删除服务端日志的功能。

原 starter 可复用的埋点：

- `services/api/app/main.py`：request_completed、case_created。
- `services/worker/app/main.py`：worker_started、job_claimed、job_completed、job_processing_failed。
- `services/ai/app/main.py`：triage_request_received、triage_completed。
- `services/common/config.py`：当前 `StreamHandler` 只输出 JSON 到控制台，需要增加采集与持久化。

尚需后端补充：UTC 时区时间、日志唯一 ID、sequence、run/trace/request 关联、数据读取和数据库提交阶段、失败日志的具体 job/run ID。现有 triage 不是库存预测模型；接入真实预测代码时应在实际调用位置记录开始 / 完成 / 异常。只有重试逻辑确实执行时才记录 attempt 与 retry 事件。

“完整”不意味着输出密码、令牌、数据库连接密码或不受权限控制的原始数据。服务端统一脱敏并鉴权；客户端以纯文本展示消息、堆栈及原始记录，不执行日志中的 HTML。页面展示的完整范围以采集覆盖、保留策略和访问权限为准。

## Dashboard 配置与交接

在 `public/runtime-config.js` 设置：

```js
globalThis.FIX_CONFIG = {
  mode: 'mock',
  apiBaseUrl: 'http://localhost:8000',
  backendLogsBaseUrl: 'http://localhost:8000',
  sendRequestId: false
};
```

上例允许业务页面继续 mock，同时连接真实日志服务。`backendLogsBaseUrl: null` 时：live 模式复用 apiBaseUrl；mock 模式明确不连接后端日志。也可使用同源代理 `/api`。没有 mock 日志后备。跨域需后端配置 CORS；认证建议复用同源后端会话，跨域登录机制需团队另行约定，不在公开配置放密钥。

开启 `sendRequestId` 前，后端允许请求头 X-Request-ID，并通过 Access-Control-Expose-Headers 暴露服务端 X-Request-ID。后端仍应自行生成并传递 run / job / trace 关联。

前端文件：`src/pages/BackendLogsPage.jsx`、`src/backendLogs.js`、`frontend/backend-logs.js`。只在适配器修改后端路径或字段映射，不在各页面散布 fetch。旧浏览器诊断地址为 `#/logs?source=browser`；任务页进入 `#/logs?run_id=...` 查询服务端日志。

## 验收边界

当前测试使用受控 HTTP 响应，验证过滤编码、嵌套错误详情、完整导出、稳定分页、错误处理、取消和无模拟回退。只有连接团队真实后端，并完成“提交任务 → API → worker → 模型 → 持久化 → 审核 → 重启后查询”后，才能声称完整执行日志已联通。目前尚未完成该真实链路验收。

2026-10-15 验证：22 项自动测试与生产构建通过。浏览器使用明确标记 TEST FIXTURE ONLY 的独立本地接口验证了服务端消息、错误堆栈、attempt、上下文、历史分页和采集缺失提示，控制台无错误。默认本地入口验证为“后端日志尚未接入”。

需要复查页面时，可在构建后运行 `node frontend/tests/log-viewer-server.mjs`，访问输出的 5185 测试地址。它只提供接口形状样例，不是业务后端；不得作为模型或 worker 实际运行证据。验收结束停止该测试进程，正常演示继续使用原预览地址。
