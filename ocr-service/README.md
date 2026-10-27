# 本地 OCR 服务（开源方案接入）

本目录提供一个**零框架依赖**的本地 OCR HTTP 服务，把开源 OCR 引擎包装成
**PaddleOCR Serving v2 兼容**接口，供后端 `server/` 的 OCR 适配器调用。

> 目的：把「拍照识别」的置信度从提示词猜测的 **0.32** 提升到实测 **0.97~0.99**，
> 同时让**图片不出本机**（校园/家庭私有化部署友好）。

---

## 1. 快速开始

```bash
cd ocr-service

# 1) 安装依赖（本机若已有 rapidocr-onnxruntime 可跳过）
pip install -r requirements.txt

# 2) 启动（默认 0.0.0.0:8868）
python3 ocr_service.py

# 3) 健康检查
curl http://127.0.0.1:8868/health
# → {"ok": true, "engine": "rapidocr", "error": null, "maxBytes": 12582912}
```

环境变量：`OCR_HOST`、`OCR_PORT`、`OCR_MAX_BYTES`。

---

## 2. 接入系统

1. 打开网页左侧 **⚙️ 模型设置** 页面；
2. 打开「本地 OCR 服务」开关，地址填 `http://127.0.0.1:8868`（局域网其它机器填 `http://<内网IP>:8868`）；
3. 保存，回到「📷 拍照录入」即可。识别链路卡片会显示引擎为 `本地 OCR`。

后端配置优先级：**网页设置 > .env > 本地启发式引擎**。

---

## 3. 接口约定

### `GET /health`

```json
{ "ok": true, "engine": "rapidocr", "error": null, "maxBytes": 12582912 }
```

### `POST /predict`（PaddleOCR Serving v2 兼容）

请求：

```json
{ "images": ["<base64，可带或不带 data: 前缀>"] }
```

响应：

```json
{
  "result": {
    "ocrResults": [
      { "prunedResult": { "rec_texts": ["题干第一行", "题干第二行"], "rec_scores": [0.986, 0.993] } }
    ],
    "elapse": 0.42
  }
}
```

多个 `images` 会返回同序的多个 `ocrResults`。

### `POST /ocr`（便捷接口，返回整段文本 + 平均置信度）

请求：`{ "image": "<base64>" }`
响应：`{ "text": "3.小明有24颗糖…\n答：C", "confidence": 0.988 }`

---

## 4. 引擎优先级

| 顺序 | 引擎 | 许可 | 特点 |
|---|---|---|---|
| 1 | **RapidOCR**（onnxruntime 版） | Apache-2.0 | PaddleOCR 模型转 ONNX，**纯 CPU 可跑**、体积小、中文效果好 —— **本项目默认推荐** |
| 2 | **PaddleOCR** 官方 | Apache-2.0 | 版面 / 表格 / 公式能力最强，依赖较重 |
| 3 | **CnOCR** | Apache-2.0 | 轻量备选 |

服务启动时惰性探测，探测到哪个用哪个；都没有时 `/health` 返回 503 并给出安装指引。

---

## 5. 换用官方 PaddleOCR Serving

想要更强的版面/公式识别，可以直接用官方服务，接口天然兼容：

```bash
paddleocr --host 0.0.0.0 --port 8868 --use_angle_cls true --lang ch
```

此时把 `ocr-service` 关掉即可，系统照常调用。

---

## 6. 隐私

* 识别全程在本机完成，**图片不会离开设备**，只有识别出的文本会交给后端用于结构化。
* 若同时启用了云端视觉模型，则图片会发往该模型供应商 —— 请根据未成年人数据合规要求谨慎开启，
  并优先使用**本地 Ollama 视觉模型**（如 `qwen2.5-vl:7b`）实现完全离线。
