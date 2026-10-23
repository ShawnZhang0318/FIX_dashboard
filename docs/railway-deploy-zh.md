# Railway 部署说明

Railway 项目里的 `FIX_dashboard` 是静态前端。它不能直接连接 PostgreSQL；页面只访问公共 API，API 与 worker 共用 PostgreSQL，worker 调用私有模型服务。

## 在 Railway 项目中添加服务

在 `production` 环境的同一个 Railway 项目中，通过 `+ Add` → `GitHub Repo`，从 `ShawnZhang0318/FIX_dashboard` 的 `main` 分别创建三个服务。每个服务的 Source 均选该仓库，Root Directory 留空，并分别指定 Build → Dockerfile Path：

| 服务名建议 | Dockerfile Path | 公网域名 |
| --- | --- | --- |
| `API` | `/deploy/Dockerfile.api` | 需要生成，用作前端 API |
| `AI` | `/deploy/Dockerfile.ai` | 不需要，仅项目私网访问 |
| `Worker` | `/deploy/Dockerfile.worker` | 不需要 |

不要把 Postgres 的 `DATABASE_URL` 配到静态前端；数据库凭据只给 API 和 Worker。Railway 中同项目服务可通过私网通信，但一个服务的变量不会自动共享给另一个服务，需要添加 Reference Variable。

## 环境变量

在 `API` 的 Variables 中添加：

```text
FIX_DATABASE_URL=${{Postgres.DATABASE_URL}}
FIX_ALLOWED_ORIGINS=https://fixdashboard-production.up.railway.app
```

将 `FIX_ALLOWED_ORIGINS` 的值替换为前端服务实际生成的完整 HTTPS 域名，不加末尾斜线。API 的公网域名生成后，在前端 `FIX_dashboard` 服务的 Variables 中添加：

```text
VITE_FIX_API_URL=https://${{API.RAILWAY_PUBLIC_DOMAIN}}
```

`VITE_FIX_API_URL` 是公开 API 地址，不是密钥。变量修改后在 Railway 应用变更并部署，Vite 才会把该地址写入静态构建。

在 `AI` 服务中设置 `PORT=8001`。保持其没有公网域名。

在 `Worker` 的 Variables 中添加：

```text
FIX_DATABASE_URL=${{Postgres.DATABASE_URL}}
FIX_AI_URL=http://${{AI.RAILWAY_PRIVATE_DOMAIN}}:8001
```

在 Railway 的变量输入框中使用引用变量选择器确认服务名称和变量名；如果把服务改了名称，也要同步更新 `${{...}}` 中的名称。

## 初始化数据与检查

新建的 Postgres 是空库。API 启动时会应用 `local_backend/migrations/` 中的数据库迁移，但不会自动导入 CSV。待 API 部署并生成域名后，在本地仓库安装好 `ai/requirements-dev.txt` 依赖，再运行：

```powershell
python -m local_backend.import_csv --api https://<API的公网域名>
```

导入器会核对模型数据源校验值，并通过 API 写入快照；它不会把本机 SQLite 文件复制到 Railway。

检查 API 的 `/health/live`、`/health/ready`，再检查 AI 的 `/health/ready`。`/health/ready` 在 Worker 尚未写入心跳时会返回未就绪；等 Worker 启动后再看。只有页面顶栏不再显示 `Mock demo`，库存数据来自 API，且新分析运行的 trace 显示实际模型版本，才说明线上服务已连通。

## 目前的日志限制

AI 服务将结构化事件写在本地文件，而 Railway 每个服务有独立文件系统。单独部署 AI 服务后，API 无法直接读取 AI 容器中的日志文件；需要后续把 AI 事件转为经认证的 API 写入或共享日志存储，页面的 AI 日志采集状态才会完整。这不影响 API、Postgres 和模型推理链路本身。
