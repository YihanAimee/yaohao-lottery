#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 data/ 下的数据文件推送到 GitHub（Contents API 覆盖写，可与 Actions 并发）。"""
import base64, json, os, sys, urllib.request, urllib.error

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
