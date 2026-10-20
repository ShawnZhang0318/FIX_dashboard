# F.I.X. AI model handoff

2026-10-21 更新：本目录保留 AI v1 的交付与独立运行说明。真实模型回归和本地完整联调已完成；启动带关联日志的整体 Demo 请用[本地联调说明](../docs/local-integration-zh.md)，不要同时另起占用同一端口的 AI 服务。

本目录提供 S001 的累计销量预测模块，独立于 React 前端。使用现有
`s001-global-q-v1` 两份 LightGBM 模型及 P90 校准，不重新训练。

## 当前交付

- `artifacts/s001-global-q-v1/`：Drive 原始六个模型产物及新增 SHA-256 清单。
- `features.py`：从单商品历史生成截止日特征，保留训练时编码与列顺序。
- `predictor.py`：加载模型、校准、返回版本化预测。
- `schemas.py`、`service.py`：私有 worker 接口及 FastAPI 服务。
- `examples/`：原始请求与已有 Notebook 结果整理的响应。响应不是此次执行结果。
- `reports/`：原始评估报告、特征重要性；`notebooks/`：原始训练记录。
- `tests/`：使用合成历史和服务替身的测试，不加载 joblib、不执行训练模型预测。
- `scripts/prepare_data.py`：从原始 CSV 和冻结 catalog 重建清洗表；不训练、不入库。

## 环境与运行

从 FIX_dashboard 根目录执行：

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r ai/requirements-dev.txt
.venv/Scripts/python -m uvicorn ai.service:app --host 127.0.0.1 --port 8001
```

模型 manifest 记录 Python **3.13.16**、LightGBM 4.6.0、scikit-learn 1.6.1、
pandas 2.2.3、NumPy 2.1.3。starter 限定 Python 3.11，不能将其环境兼容性视为已验证。
joblib/scipy 是新增建议固定版本，原 Notebook 未记录它们；服务依赖沿用 starter。
requirements 不是已经完成模型验收的完整锁文件；正式运行前仍须在目标环境验证模型加载。

`FIX_MODEL_DIR` 可指定可信的完整模型目录；默认相对于 Python 模块定位，不依赖工作目录。
启动时校验文件并加载模型，失败则不启动。不要从不可信来源加载 joblib。
校验清单用于检测意外变化，不是签名认证。

私有服务提供 `GET /health/live`、`GET /health/ready`、`POST /analyze`。
不启动数据库、worker 或前端，不提供 `/analysis-runs`，不包含鉴权；应置于私有网络。
GitHub Pages 不会运行此 Python 服务。前端仍通过公共后端访问结果。

Python 调用形式：

```python
from ai.features import build_request
from ai.predictor import Predictor

# history 为 worker 从数据库读取的单个 store/product 历史。
request = build_request(history, store_id="S001", product_id="P0001",
                        as_of_date="2023-11-15", lead_time_days=3,
                        input_reference="snapshot-version/store/product/date")
predictor = Predictor()  # 进程启动时创建一次并复用
result = predictor.predict(request).model_dump(mode="json")
```

支持 P0001–P0020，每个商品只支持 catalog 中固定周期。预测目标为 t+1 至 t+L
累计已售数量，不等同于未受库存约束的潜在需求。日末已入库当天销量后才能调用。
历史必须涵盖 t-28 至 t 共 29 个日期，缺失日期/销量不填零；真实零销量是有效观测。
未实现异常检测、库存回放、补货策略、持久化或审核。

## 不运行模型的检查

```powershell
python -m pytest ai/tests -q
```

这些测试不是预测复现，也不验证 joblib 在当前 Python 环境中的兼容性。
按照本次要求，没有执行真实模型推理或重新训练。

## 真实模型测试（单独运行）

真实模型测试另放在 `ai/integration_tests/test_real_model.py`，不会被上述 `ai/tests`
命令执行。它使用写死的 S001/P0001/2023-11-15 请求加载真实模型，检查返回字段、
身份/版本、有限非负预测值、P90 ≥ P50，以及与 Notebook 基准结果一致；打印 JSON 和耗时。
不需要前端、数据库或启动 HTTP 服务。运行命令：

```powershell
python -m pytest ai/integration_tests/test_real_model.py -v -s
```

## 数据清洗命令

```powershell
python -m ai.scripts.prepare_data --output-dir data/rebuilt-v1
```

脚本核验原始 CSV 哈希，使用已冻结 catalog，拒绝覆盖目标清洗文件。
它只重建清洗数据；完整训练、标签、切分过程保留在 Notebook 中。
`data/metadata/v1/import_manifest.json` 保存 13 个导入文件的来源 ID、字节数和校验值。

详见 [模型合同](../docs/model-contract.md)、[数据交接](../docs/model-data-handoff.md)、
[交付计划与状态](../docs/ai-handoff-plan.md)。
