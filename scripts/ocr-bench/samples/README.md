# OCR 基准样例的「标准答案」

`truth.json` 是基准测试的**标准答案**（每个样例图对应的正确文本）。

## 为什么把它提交进仓库

样例图**本身不用提交** —— `make_samples.py` 用**确定性随机种子**生成，
在同一个仓库版本下逐字节可复现：

```bash
python3 scripts/ocr-bench/make_samples.py --out /tmp/ocrtest
```

实测：4 档 × 5 个样例 = **20 张图 + truth.json 全部逐字节一致**。

但**标准答案要提交**，两个原因：

1. **字体依赖**：生成脚本要系统里有中文字体（`Hiragino Sans GB` / `文泉驿` /
   `Noto Sans CJK`）。换台机器字体不同，渲染出来的图就不一样 ——
   数字对不上，就没法跟历史结果比。
2. **标准答案是「定义」，不是「产物」**。改了生成脚本的渲染参数，
   标准答案不该跟着变 —— 它应该由人来校对。

## 怎么用

```bash
# 1. 生成样例图
python3 scripts/ocr-bench/make_samples.py --out /tmp/ocrtest

# 2. 跑四档基准
python3 scripts/ocr-bench/bench.py --dir /tmp/ocrtest --ocr-host http://127.0.0.1:8869

# 3. 跑增强图收益基准（需要两个侧车，见脚本文件头）
python3 scripts/ocr-bench/bench-enhanced.py
```

> ⚠️ **跨环境的数字不能直接比** —— 同一个代码在**本机 pip 环境**和 **docker 镜像**里，
> opencv/numpy 版本不同，CER 会差 1 个百分点左右。
> **同环境对比才有意义**。
