# AI 交付计划与状态（2026-10-19）

后续状态（2026-10-21）：下表是 AI 分支原始交付记录；现已完成真实制品回归及 Dashboard → 公共 API → SQLite → worker → AI 本地联调，详见[最新更新说明](changes-zh.md)与[本地联调说明](local-integration-zh.md)。原始模型产物和推理合同继续保留。

| 工作项 | 文件位置 | 本次状态 / 后续责任 |
| --- | --- | --- |
| 六个原始模型产物 | ai/artifacts/s001-global-q-v1/ | 已导入，原文件不改写 |
| 清洗数据、源数据、清洗清单 | data/processed/v1/、data/raw/、data/metadata/v1/ | 已导入；入库由数据负责人完成 |
| 请求、评估、重要性、Notebook | ai/examples/、ai/reports/、ai/notebooks/ | 已导入 |
| 特征构造 | ai/features.py | 已实现；29 日期、cutoff、分类编码与列顺序 |
| 推理与校准 | ai/predictor.py | 已实现；按要求未执行模型加载/预测复现 |
| 输入输出规范 | ai/schemas.py、docs/model-contract.md | 已实现及记录 |
| 私有 AI 服务 | ai/service.py | 已提供；真实模型服务未启动验收 |
| 环境清单 | ai/requirements*.txt | 已整理；Python 差异及新增依赖版本待目标环境验证 |
| 响应示例 | ai/examples/example_analyze_response.json | 从既有 Notebook 输出整理，不是新预测 |
| 特征/接口检查 | ai/tests/ | 不加载模型；服务使用替身 |
| 数据处理入口 | ai/scripts/prepare_data.py | 只重建清洗表，不训练/入库；完整训练保留 Notebook |
| 文件校验 | artifacts 内 checksums.json；data/metadata/v1/import_manifest.json | 已生成；含模型、校准、来源和字节数 |
| 数据交接说明 | docs/model-data-handoff.md | 已整理；库存快照与合成类别明确区分 |
| 后端接入 | 公共 API、worker、数据库 | 待团队实现，不属于此次模型文件整理 |
| 前端 live 配置 | index.html / runtime-config | 既有配置加载缺口待前端处理，本次未修改 |

参考项目：maie6000c-starter-CadenJ 的 services/ai/app/main.py、
services/common/schemas.py、services/worker/app/main.py、pyproject.toml、
docs/architecture.md、docs/dataset-profile.md。保留独立服务和模式校验思想，未复制通用
文本 triage、数据库或整个 starter，也未修改参考仓库。

本次不复现预测、不训练、不创建数据库、不自动发布；已有评估报告不代表新代码已完成
真实模型验收。下一步由团队在目标 Python 环境完成加载/推理验收，再接 worker。

## 本次验证记录

17 项测试通过：13 个导入文件校验、原始 source/schema/catalog 与训练 manifest
校验值一致、清洗脚本结果与交付 CSV 一致、历史特征与既有请求一致、未来数据隔离、
输入错误处理、校准公式、特征编码及使用替身的 HTTP 请求。没有反序列化 joblib、
没有调用已训练模型，也没有复现预测。

验证环境为工具自带 Python 3.12.14、pandas 3.0.1、NumPy 2.3.5、Pydantic 2.11.7、
FastAPI 0.116.1；不等同于 requirements 中的目标模型环境。TestClient 在沙箱中因
本机 socket 限制阻塞，授权后在沙箱外通过。存在一个 Starlette/AnyIO 的弃用警告。
临时测试依赖在 `.tmp-ai-test-deps/`，已被 Git 忽略；未修改系统 Python 环境。
