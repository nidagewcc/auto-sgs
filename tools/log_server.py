"""AutoX dev server: serve source files + receive logs/screenshots from phone."""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = r"D:\develops\auto-sgs"
LOG_DIR = os.path.join(BASE, "_logs")
SRC_EXTS = (".js", ".json", ".png", ".jpg", ".txt", ".md")

CMD_QUEUE = []
CMD_LOCK = threading.Lock()

os.makedirs(LOG_DIR, exist_ok=True)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, data, ctype="application/octet-stream"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/ping"):
            return self._send(200, b'{"ok":true,"msg":"autox dev server"}', "application/json")

        # 手机端每 3 秒轮询一次：有指令就取走，没有返回空
        if path == "/cmd":
            with CMD_LOCK:
                cmd = CMD_QUEUE.pop(0) if CMD_QUEUE else ""
            return self._send(200, cmd.encode("utf-8"), "text/plain; charset=utf-8")

        if path.startswith("/src/"):
            rel = path[len("/src/"):].strip("/")
            # main.js 统一返回拼装后的单文件 bundle（eval 环境里 floaty/threads 会 NPE）
            if rel == "main.js":
                bundle = os.path.join(BASE, "build", "bundle.js")
                if os.path.isfile(bundle):
                    with open(bundle, "rb") as f:
                        data = f.read()
                    print("[%s] GET bundle (%d bytes)" % (time.strftime("%H:%M:%S"), len(data)))
                    return self._send(200, data, "text/plain; charset=utf-8")
            rel = rel.replace("/", os.sep)
            target = os.path.normpath(os.path.join(BASE, rel))
            if not target.startswith(os.path.normpath(BASE)):
                return self._send(403, b"forbidden", "text/plain")
            if not os.path.isfile(target):
                return self._send(404, ("not found: " + rel).encode(), "text/plain")
            with open(target, "rb") as f:
                data = f.read()
            ctype = "text/plain; charset=utf-8" if target.endswith((".js", ".json", ".txt", ".md")) else "application/octet-stream"
            print("[%s] GET src %s (%d bytes)" % (time.strftime("%H:%M:%S"), rel, len(data)))
            return self._send(200, data, ctype)

        return self._send(404, b"not found", "text/plain")

    def _restore(self, body):
        """AutoX http.post encodes the string as an indexed form (0=..&1=..); rebuild it."""
        import urllib.parse
        if body[:2] == b"0=" and b"&1=" in body:
            out = []
            for part in body.split(b"&"):
                if b"=" in part:
                    _, v = part.split(b"=", 1)
                    out.append(urllib.parse.unquote(v.decode("utf-8", "replace")))
            return "".join(out).encode("utf-8")
        # some builds percent-encode the whole payload without the index prefix
        if b"%" in body and b"\n" not in body and len(body) > 200:
            try:
                return urllib.parse.unquote(body.decode("utf-8", "replace")).encode("utf-8")
            except Exception:
                return body
        return body

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(n) if n else b""
        path = self.path.split("?")[0]
        ts = time.strftime("%Y%m%d-%H%M%S")

        # 电脑 -> 手机 的指令投递，不做表单还原
        if path == "/cmd":
            cmd = raw.decode("utf-8", "replace").strip()
            with CMD_LOCK:
                CMD_QUEUE.append(cmd)
                qlen = len(CMD_QUEUE)
            print("[%s] CMD in: %s (queue=%d)" % (time.strftime("%H:%M:%S"), cmd, qlen))
            return self._send(200, json.dumps({"ok": True, "queue": qlen}).encode(), "application/json")

        body = self._restore(raw)

        if path == "/log":
            fn = os.path.join(LOG_DIR, "log-%s.txt" % ts)
            with open(fn, "ab") as f:
                f.write(body)
                f.write(b"\n")
        elif path == "/shot":
            # phone sends base64(jpg/png); decode and pick extension by magic bytes
            try:
                import base64
                raw = base64.b64decode(body, validate=False)
            except Exception:
                raw = body
            ext = "jpg" if raw[:2] == b"\xff\xd8" else ("png" if raw[:4] == b"\x89PNG" else "bin")
            fn = os.path.join(LOG_DIR, "shot-%s.%s" % (ts, ext))
            with open(fn, "wb") as f:
                f.write(raw)
        else:
            fn = os.path.join(LOG_DIR, "raw-%s.bin" % ts)
            with open(fn, "wb") as f:
                f.write(body)

        print("[%s] %s -> %s (%d bytes)" % (time.strftime("%H:%M:%S"), path, os.path.basename(fn), len(body)))
        return self._send(200, json.dumps({"ok": True, "file": os.path.basename(fn)}).encode(), "application/json")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print("serving %s on 0.0.0.0:8099" % BASE, flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8099), H).serve_forever()
