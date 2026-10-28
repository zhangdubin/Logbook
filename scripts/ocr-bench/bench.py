#!/usr/bin/env python3
"""
scripts/ocr-bench/bench.py —— OCR 准确率 + 学科判定基准测试
=============================================================
对着 make_samples.py 生成的样例，测三件事：

  1. 字符错误率（CER）：识别出来的字和原文差多少
  2. 平均识别分：引擎自己对这个结果有多自信
  3. 学科判定对不对：拿识别文本喂给后端的启发式判定，看判学科准不准
     （第 3 项走真实接口 POST /api/analyze/photo，所以后端改了立刻能看出效果）

用法：
  # 只测 OCR 引擎
  OCR_HOST=http://127.0.0.1:8869 python3 scripts/ocr-bench/bench.py
  # 连后端一起测（学科判定）
  OCR_HOST=http://127.0.0.1:8869 API_BASE=http://127.0.0.1:5188 \
    API_COOKIE=/tmp/ck.txt python3 scripts/ocr-bench/bench.py
"""
import argparse, base64, json, os, re, sys, difflib, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DIR = os.environ.get('OCR_DIR', '/tmp/ocrtest')


def norm(s):
    return re.sub(r'\s+', '', str(s or ''))


def cer(ref, hyp):
    ref, hyp = norm(ref), norm(hyp)
    if not ref:
        return 1.0
    sm = difflib.SequenceMatcher(None, ref, hyp)
    t = sum(b.size for b in sm.get_matching_blocks())
    return 1 - t / len(ref)


def ocr(host, path, timeout=120):
    b = base64.b64encode(open(path, 'rb').read()).decode()
    req = urllib.request.Request(f'{host}/predict',
                                 data=json.dumps({"images": [b]}).encode(),
                                 headers={'Content-Type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=timeout))
    res = r['result']['ocrResults'][0]['prunedResult']
    return res.get('rec_texts', []), res.get('rec_scores', [])


def api_subject(api_base, cookie_file, data_url, timeout=180):
    """走真实接口拿后端判定的学科"""
    if not api_base or not cookie_file or not os.path.exists(cookie_file):
        return None
    try:
        # cookie 文件可能是两种格式：
        #   1) curl 的 Netscape cookie jar（#HttpOnly_ 前缀 + 制表符分隔）
        #   2) 一整行 Cookie 头（name=value; name=value）
        raw = open(cookie_file, encoding='utf-8', errors='ignore').read()
        pairs = []
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.startswith('#') and not line.startswith('#HttpOnly_'):
                continue
            if line.startswith('#HttpOnly_'):
                line = line[len('#HttpOnly_'):]
            if '\t' in line:
                parts = line.split('\t')
                if len(parts) >= 7:
                    pairs.append(f'{parts[5]}={parts[6]}')
            elif '=' in line and ' ' not in line.split('=')[0]:
                pairs.append(line)
        ck = '; '.join(pairs) if pairs else raw.strip()
        body = json.dumps({"image": data_url}).encode()
        req = urllib.request.Request(f'{api_base}/api/analyze/photo', data=body,
                                     headers={'Content-Type': 'application/json', 'Cookie': ck})
        r = json.load(urllib.request.urlopen(req, timeout=timeout))
        d = r.get('draft') or {}
        return {'subject': d.get('subject'),
                'confidence': d.get('subjectConfidence'),
                'evidence': d.get('subjectEvidence') or [],
                'warnings': (r.get('pipeline') or {}).get('warnings') or []}
    except Exception as e:
        return {'error': str(e)[:120]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=DEFAULT_DIR)
    ap.add_argument('--ocr-host', default=os.environ.get('OCR_HOST', 'http://127.0.0.1:8869'))
    ap.add_argument('--api-base', default=os.environ.get('API_BASE', ''))
    ap.add_argument('--cookie', default=os.environ.get('API_COOKIE', ''))
    ap.add_argument('--tiers', default='clean,phone,hard')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    truth_file = os.path.join(args.dir, 'truth.json')
    if not os.path.exists(truth_file):
        sys.exit(f'找不到 {truth_file}，先跑 make_samples.py')
    truth = json.load(open(truth_file, encoding='utf-8'))

    summary = {}
    for tier in [t.strip() for t in args.tiers.split(',') if t.strip()]:
        tdir = os.path.join(args.dir, tier)
        if not os.path.isdir(tdir):
            continue
        print(f'\n  ═══ {tier} ═══')
        print('  样例          行数  平均分   字符错误率  关键词命中  学科判定')
        print('  ' + '-' * 62)
        cers, hits, kws, subs = [], 0, 0, 0
        for name, meta in truth.items():
            files = [f for f in os.listdir(tdir) if f.startswith(name + '.')]
            if not files:
                continue
            path = os.path.join(tdir, sorted(files)[0])
            try:
                texts, scores = ocr(args.ocr_host, path)
            except Exception as e:
                print(f'  {name:<13} OCR 调用失败: {str(e)[:80]}')
                continue
            hyp = ''.join(texts)
            ref = ''.join(meta['lines'])
            c = cer(ref, hyp)
            cers.append(c)
            avg = sum(scores) / len(scores) if scores else 0
            nh = norm(hyp)
            hit = sum(1 for k in meta['keywords'] if norm(k) in nh)
            hits += hit
            kws += len(meta['keywords'])
            sub = '—'
            if args.api_base:
                data_url = 'data:image/png;base64,' + base64.b64encode(open(path, 'rb').read()).decode()
                r = api_subject(args.api_base, args.cookie, data_url)
                if r and not r.get('error'):
                    mark = '✅' if r.get('subject') == meta['subject'] else '❌'
                    sub = f"{r.get('subject')} {mark}"
                    if r.get('subject') == meta['subject']:
                        subs += 1
            print(f'  {name:<13} {len(texts):>4}  {avg:.3f}   {c*100:5.1f}%     {hit}/{len(meta["keywords"])}      {sub}')
            if args.verbose:
                print(f'      识别: {nh[:110]}')
                print(f'      原文: {norm(ref)[:110]}')
        avg_cer = sum(cers) / len(cers) * 100 if cers else 0
        sub_txt = f'  学科判定 {subs}/{len(cers)}' if args.api_base else ''
        print(f'  → 平均 CER {avg_cer:.1f}%   关键词命中 {hits}/{kws}{sub_txt}')
        summary[tier] = {'cer': round(avg_cer, 2), 'kw': f'{hits}/{kws}'}

    print('\n  ═══ 汇总 ═══')
    for k, v in summary.items():
        print(f'  {k:<8} CER {v["cer"]:>5.2f}%   关键词命中 {v["kw"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
