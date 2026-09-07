#!/usr/bin/env python3
"""Start a detached, loopback-only board; preserve existing practice state."""
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
URL = "http://127.0.0.1:8769"

def healthy():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(URL + "/api/health", timeout=1) as response:
            return json.load(response).get("app") == "go-coach"
    except Exception:
        return False

if not healthy():
    with socket.socket() as sock:
        if sock.connect_ex(("127.0.0.1",8769)) == 0:
            sys.exit("8769 端口已被其他程序占用，请检查后再启动。")
    (ROOT / ".local").mkdir(exist_ok=True)
    with open(ROOT / ".local/server.log", "a") as log:
        process = subprocess.Popen([sys.executable,str(ROOT / "server.py")],cwd=ROOT,
                                   stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
    (ROOT / ".local/server.pid").write_text(str(process.pid))
    for _ in range(40):
        if healthy():
            break
        time.sleep(0.15)
    else:
        sys.exit("棋盘未启动，请查看 .local/server.log。")
print(URL)
if "--no-browser" not in sys.argv:
    webbrowser.open(URL)
