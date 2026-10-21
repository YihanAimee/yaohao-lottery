#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 data/ 下的数据文件推送到 GitHub（Contents API 覆盖写，可与 Actions 并发）。"""
import base64, json, os, subprocess, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.github.com"
REPO = os.environ.get("GITHUB_REPO", "YihanAimee/yaohao-lottery")
FILES = ["data/factors.json", "data/factors.js", "data/factors.csv", "data/status.json"]


def token():
    t = os.environ.get("GITHUB_TOKEN", "").strip()
    if not t:
        p = os.path.expanduser("~/.yaohao_gh_token")
        if os.path.exists(p):
            t = open(p, encoding="utf-8").read().strip()
    if not t:
        sys.exit("no GITHUB_TOKEN")
    return t


def _curl(path, method="GET", data=None):
    """TLS 握手失败时的兜底通道（本机 Python 的 SSL 偶尔被中间设备打断）"""
    cmd = ["curl", "-sS", "--max-time", "45", "-X", method, API + path,
           "-H", "Authorization: Bearer " + token(),
           "-H", "Accept: application/vnd.github+json",
           "-H", "X-GitHub-Api-Version: 2022-11-28",
           "-H", "User-Agent: yaohao-push"]
    if data is not None:
        cmd += ["-H", "Content-Type: application/json", "--data-binary", json.dumps(data)]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError("curl failed %s: %s" % (path, p.stderr.strip()[:200]))
    txt = p.stdout.strip()
    if not txt:
        return {}
    try:
        return json.loads(txt)
    except ValueError:
        raise RuntimeError("bad response %s: %s" % (path, txt[:200]))


def api(path, method="GET", data=None):
    req = urllib.request.Request(API + path, data=(json.dumps(data).encode() if data else None), method=method)
    req.add_header("Authorization", "Bearer " + token())
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else {}
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %s %s: %s" % (e.code, path, e.read().decode("utf-8", "ignore")[:200]))
    except Exception as e:
        print("  urllib 失败（%s），改用 curl 通道…" % type(e).__name__, file=sys.stderr)
        return _curl(path, method, data)


def main():
    for rel in FILES:
        src = os.path.join(ROOT, rel)
        if not os.path.exists(src):
            print("跳过:", rel); continue
        content = base64.b64encode(open(src, "rb").read()).decode()
        sha = None
        try:
            sha = api("/repos/%s/contents/%s" % (REPO, rel)).get("sha")
        except RuntimeError:
            pass
        payload = {"message": "chore: 更新基准因子数据 " + os.path.basename(src), "content": content, "branch": "main"}
        if sha:
            payload["sha"] = sha
        api("/repos/%s/contents/%s" % (REPO, rel), "PUT", payload)
        print("已推送:", rel)


if __name__ == "__main__":
    main()
