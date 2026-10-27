#!/usr/bin/env python3
"""
错题本 · 本地 OCR 服务（零框架依赖）
=================================================
一个只用 Python 标准库实现的 HTTP 服务，把开源 OCR 引擎包装成
**PaddleOCR Serving v2 兼容**的接口，供后端 `server/` 的 OCR 适配器调用。

特点
----
* 不需要 Flask/FastAPI：`python3 ocr_service.py` 就能跑。
* 引擎按优先级自动探测：RapidOCR → PaddleOCR → CnOCR → 报错并给出安装指引。
* 返回格式与 PaddleOCR Serving v2 一致，因此后端无需任何改动即可对接。
* 图片不出本机，适合校园/家庭私有化部署。

启动
----
    pip install -r requirements.txt
    python3 ocr_service.py                 # 默认监听 0.0.0.0:8868

    # 或者用官方 PaddleOCR Serving（更重，但版面/公式更强）
    paddleocr --host 0.0.0.0 --port 8868 --use_angle_cls true --lang ch

接口
----
    GET  /health   → {"ok":true,"engine":"rapidocr","version":"..."}
    POST /predict  → {"images":["<base64>"]}
                  → {"result":{"ocrResults":[{"prunedResult":{
                        "rec_texts":["...","..."],
                        "rec_scores":[0.99,0.93]}}]}}
    POST /ocr      → {"image":"<base64>"} → {"text":"...","confidence":0.96}
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = os.environ.get("OCR_HOST", "0.0.0.0")
PORT = int(os.environ.get("OCR_PORT", "8868"))
MAX_IMAGE_BYTES = int(os.environ.get("OCR_MAX_BYTES", str(12 * 1024 * 1024)))

_engine_name = "none"
_engine = None
_engine_lock = threading.Lock()
_engine_error: str | None = None


# --------------------------------------------------------------------------
# 引擎探测
# --------------------------------------------------------------------------
def _try_rapidocr():
    """RapidOCR（onnxruntime 版）：PaddleOCR 模型转 ONNX，CPU 可跑，体积小。"""
    global _engine_name
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore

        _engine_name = "rapidocr"
        return RapidOCR()
    except ImportError:
        pass
    try:
        from rapidocr import RapidOCR  # type: ignore

        _engine_name = "rapidocr"
        return RapidOCR()
    except ImportError:
        return None


def _try_paddleocr():
    """官方 PaddleOCR：版面/公式/表格能力最全，但依赖较重。"""
    global _engine_name
    try:
        from paddleocr import PaddleOCR  # type: ignore

        _engine_name = "paddleocr"
        return PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
    except Exception:
        return None


def _try_cnocr():
    """CnOCR：轻量备选。"""
    global _engine_name
    try:
        from cnocr import CnOcr  # type: ignore

        _engine_name = "cnocr"
        return CnOcr()
    except Exception:
        return None


def get_engine():
    """惰性加载 OCR 引擎；加载失败时缓存错误信息，避免每次请求都重试。"""
    global _engine, _engine_error
    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is not None:
            return _engine
        if _engine_error is not None:
            return None
        for loader in (_try_rapidocr, _try_paddleocr, _try_cnocr):
            eng = loader()
            if eng is not None:
                _engine = eng
                print(f"[ocr] 引擎已就绪：{_engine_name}", flush=True)
                return _engine
        _engine_error = (
            "未找到可用的 OCR 引擎。请执行：pip install -r requirements.txt "
            "（推荐 rapidocr-onnxruntime，纯 CPU 即可运行）"
        )
        print(f"[ocr] {_engine_error}", file=sys.stderr, flush=True)
        return None


# --------------------------------------------------------------------------
# 引擎调用适配：不同引擎返回结构不同，统一成 (texts, scores)
# --------------------------------------------------------------------------
def _normalize(raw: Any) -> tuple[list[str], list[float]]:
    texts: list[str] = []
    scores: list[float] = []

    def push(t: Any, s: Any) -> None:
        if t is None:
            return
        text = str(t).strip()
        if not text:
            return
        texts.append(text)
        try:
            scores.append(float(s))
        except (TypeError, ValueError):
            scores.append(0.9)

    # PaddleOCR 3.x / 2.x: result = [[ [box, (text, score)], ... ]]
    if isinstance(raw, list) and raw and isinstance(raw[0], list):
        for line in raw:
            if not line:
                continue
            last = line[-1]
            if isinstance(last, (list, tuple)) and len(last) >= 2:
                push(last[0], last[1])
            elif isinstance(last, str):
                push(last, 0.9)
        return texts, scores

    # RapidOCR: (result_list, elapse) 且 result_list 元素为 (box, text, score)
    if isinstance(raw, tuple) and len(raw) == 2 and isinstance(raw[0], list):
        raw = raw[0]
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, (list, tuple)) and len(item) >= 3:
                push(item[1], item[2])
            elif isinstance(item, dict):
                push(item.get("text"), item.get("score", item.get("confidence")))
        return texts, scores

    # 已经是 dict 的情况
    if isinstance(raw, dict):
        if "rec_texts" in raw:
            ss = raw.get("rec_scores") or []
            for i, t in enumerate(raw["rec_texts"]):
                push(t, ss[i] if i < len(ss) else 0.9)
        elif "text" in raw:
            push(raw.get("text"), raw.get("confidence", raw.get("score", 0.9)))
        return texts, scores

    return texts, scores


def run_ocr(image_bytes: bytes) -> tuple[list[str], list[float]]:
    engine = get_engine()
    if engine is None:
        raise RuntimeError(_engine_error or "OCR 引擎不可用")

    try:
        from PIL import Image  # type: ignore

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        img = image_bytes  # 让引擎自己处理

    try:
        raw = engine(img)
    except TypeError:
        # 某些版本签名是 engine(img, use_det=True, use_cls=True, use_rec=True)
        raw = engine(img, True, True, True)
    return _normalize(raw)


def decode_image(b64: str) -> bytes:
    if not b64:
        raise ValueError("空的图片数据")
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[-1]
    b64 = b64.strip().replace("\n", "").replace("\r", "")
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"base64 解码失败：{exc}") from exc
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("图片过大")
    return data


# --------------------------------------------------------------------------
# HTTP 处理
# --------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:  # 精简日志
        print(f"[ocr] {self.address_string()} {fmt % args}", flush=True)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in ("/health", ""):
            eng = get_engine()
            self._send(
                200 if eng is not None else 503,
                {
                    "ok": eng is not None,
                    "engine": _engine_name,
                    "error": _engine_error,
                    "maxBytes": MAX_IMAGE_BYTES,
                },
            )
            return
        self._send(404, {"error": "NotFound", "message": f"未知路径 {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._send(400, {"error": "BadRequest", "message": "请求体为空"})
            return
        if length > MAX_IMAGE_BYTES * 2:
            self._send(413, {"error": "PayloadTooLarge", "message": "请求体过大"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._send(400, {"error": "BadRequest", "message": f"JSON 解析失败：{exc}"})
            return

        started = time.time()
        try:
            if self.path.rstrip("/") == "/predict":
                images = payload.get("images") or []
                if not isinstance(images, list) or not images:
                    raise ValueError("缺少 images 数组")
                results = []
                for item in images:
                    data = decode_image(item)
                    texts, scores = run_ocr(data)
                    results.append(
                        {"prunedResult": {"rec_texts": texts, "rec_scores": scores}}
                    )
                self._send(
                    200,
                    {
                        "result": {
                            "ocrResults": results,
                            "elapse": round(time.time() - started, 3),
                        }
                    },
                )
                return

            if self.path.rstrip("/") == "/ocr":
                image = payload.get("image")
                if not image:
                    raise ValueError("缺少 image 字段")
                texts, scores = run_ocr(decode_image(image))
                mean = sum(scores) / len(scores) if scores else 0.0
                self._send(
                    200,
                    {"text": "\n".join(texts), "confidence": round(mean, 4)},
                )
                return

            self._send(404, {"error": "NotFound", "message": f"未知路径 {self.path}"})
        except ValueError as exc:
            self._send(400, {"error": "BadRequest", "message": str(exc)})
        except RuntimeError as exc:
            self._send(503, {"error": "EngineUnavailable", "message": str(exc)})
        except Exception as exc:  # pragma: no cover - 兜底
            self._send(500, {"error": "InternalError", "message": f"{type(exc).__name__}: {exc}"})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[ocr] 本地 OCR 服务已启动：http://{HOST}:{PORT}", flush=True)
    print(f"[ocr] 引擎：{_engine_name}（首次调用时惰性加载）", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[ocr] 已停止", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
