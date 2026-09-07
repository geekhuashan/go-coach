#!/usr/bin/env python3
"""Read the shared board or submit a versioned teacher action from a JSON file."""
import argparse
import json
from pathlib import Path
import urllib.request

URL = "http://127.0.0.1:8769"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def call(route, body=None):
    req = urllib.request.Request(URL + route, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type":"application/json"})
    with opener.open(req,timeout=100) as response:
        return json.load(response)

if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--action-file",type=Path)
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument("--analyze",action="store_true")
    mode.add_argument("--review",action="store_true",help="复核当前连续题的参考答案外走法")
    args=parser.parse_args()
    if args.action_file:
        result=call("/api/action",json.loads(args.action_file.read_text()))
    else:
        result=call("/api/state")
        if args.review:
            result=call("/api/action",{"type":"review_move","revision":result["revision"],"expected_profile_id":result.get("profile",{}).get("id")})
        elif args.analyze:
            result=call("/api/analyze",{"revision":result["revision"]})
    if "board" in result:
        result.pop("history",None)
        result.pop("initial_board",None)
        size=result["size"]
        result["board_text"]="\n".join(["   "+" ".join("ABCDEFGHJKLMNOPQRST"[:size])] + [str(size-y).rjust(2)+" "+" ".join("·●○"[c] for c in row) for y,row in enumerate(result.pop("board"))])
    print(json.dumps(result,ensure_ascii=False,indent=2))
