# syntax=docker/dockerfile:1
#
# deploy/docker/ocr.Dockerfile —— 本地 OCR 侧车
# ============================================================================
# 把开源 OCR 引擎（RapidOCR）包成 HTTP 服务，供后端的 OCR 适配器调用：
#
#   POST {baseUrl}/predict  body {"images": ["<base64>"]}
#   GET  {baseUrl}/health   → {"ok": true, "engine": "rapidocr", ...}
#
# 目的：把拍照识别的置信度从 0.32 提升到 0.97~0.99，同时图片不出本机。
#
# 构建：
#   docker build -f deploy/docker/ocr.Dockerfile -t cuoti-analytics-ocr:1.0.0 .
#
# ---------------------------------------------------------------------------
# 两个关键设计（都是踩过坑之后定下来的）：
#
# 1) **用 opencv-python-headless，不用 opencv-python**
#    opencv-python 会去链 libGL / libxcb，在 slim 镜像里没有，
#    import cv2 会直接报 `ImportError: libxcb.so.1: cannot open shared object file`。
#    换 headless 版就不需要任何图形库 —— 也就不需要 apt 装 libgl1/libglib2.0-0，
#    顺带躲开了 Debian 13 把 libglib2.0-0 改名成 libglib2.0-0t64 的坑。
#
# 2) **pip 走镜像源并支持回退**
#    直连 pypi.org 在国内经常超时；这里按 清华 → 阿里 → 官方 的顺序试，
#    哪个通用哪个。也可以用 --build-arg 指定。
# ---------------------------------------------------------------------------

FROM python:3.12-slim-bookworm

LABEL org.opencontainers.image.title="错题本 · 本地 OCR 服务" \
      org.opencontainers.image.description="RapidOCR 封装成 PaddleOCR Serving v2 兼容接口" \
      org.opencontainers.image.source="https://github.com/zhangdubin/Logbook"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    OCR_HOST=0.0.0.0 \
    OCR_PORT=8868 \
    OCR_MAX_BYTES=12582912

WORKDIR /app

# --- Python 依赖 ---------------------------------------------------------
# rapidocr-onnxruntime 会连带装上完整的 opencv-python，
# 这里装完之后立刻换成 headless 版（两版都提供 cv2 模块，必须卸掉一个）。
ARG PIP_MIRRORS="https://pypi.tuna.tsinghua.edu.cn/simple https://mirrors.aliyun.com/pypi/simple https://pypi.org/simple"

COPY ocr-service/requirements.txt ./requirements.txt

RUN set -eu; \
    ok=0; \
    for m in $PIP_MIRRORS; do \
      echo "[ocr] 试 pip 源：$m"; \
      if pip install --no-cache-dir --index-url "$m" --timeout 30 --retries 2 \
           -r requirements.txt >/dev/null 2>&1; then ok=1; break; fi; \
    done; \
    [ "$ok" = "1" ] || { echo "[ocr] 所有 pip 源都不可达"; exit 1; }; \
    pip uninstall -y opencv-python >/dev/null 2>&1 || true; \
    pip install --no-cache-dir --index-url "$m" --timeout 30 --retries 2 \
        opencv-python-headless >/dev/null 2>&1 \
      || pip install --no-cache-dir --timeout 30 --retries 2 opencv-python-headless >/dev/null 2>&1; \
    python3 -c "import cv2; from rapidocr_onnxruntime import RapidOCR; print('[ocr] 依赖就绪, opencv', cv2.__version__)"

# --- OCR 服务本体 ---------------------------------------------------------
COPY ocr-service/ocr_service.py ./ocr_service.py

# --- 非 root 运行 ---------------------------------------------------------
# 模型随 pip 包一起装在 site-packages 里（约 15 MB），不需要额外的缓存卷
#
# 权限用 RUN chmod 归一化而不用 COPY --chmod：
#   --chmod 是 BuildKit 独有的，没装 buildx 的服务器（classic builder）
#   会直接报 "the --chmod option requires BuildKit" 而构建失败。
RUN useradd --system --create-home --shell /usr/sbin/nologin ocr \
 && chmod 644 requirements.txt ocr_service.py \
 && chown -R ocr:ocr /app
USER ocr

EXPOSE 8868

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8868/health',timeout=5).status==200 else 1)"

CMD ["python3", "ocr_service.py"]
