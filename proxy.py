#!/usr/bin/env python3
"""
Tiny reverse proxy that serves:
  /              → http://localhost:9080 (static sales site, file server)
  /api/*         → http://localhost:8095 (xkg-stripe backend)

Single Tailscale Funnel on port 443 → this proxy → splits traffic.

Run with sudo so it can bind to port 443:
  sudo python3 proxy.py
"""
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATIC = "http://127.0.0.1:9080"
API    = "http://127.0.0.1:8095"


class Proxy(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Quieter logs
        print(f"[proxy] {self.command} {self.path}", flush=True)

    def _proxy(self, target_base):
        # Reconstruct the upstream URL
        url = target_base + self.path
        # Strip the proxy's own headers
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "content-length")}
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        req = urllib.request.Request(url, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                self.send_response(resp.status)
                for k, v in resp.getheaders():
                    if k.lower() in ("transfer-encoding", "connection"):
                        continue
                    self.send_header(k, v)
                payload = resp.read()
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as e:
            payload = e.read()
            self.send_response(e.code)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except urllib.error.URLError as e:
            self.send_response(502)
            self.send_header("Content-Type", "text/plain")
            msg = f"Bad gateway: {e}".encode()
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def do_GET(self):     self._proxy(API if self.path.startswith("/api/") else STATIC)
    def do_HEAD(self):    self._proxy(API if self.path.startswith("/api/") else STATIC)
    def do_POST(self):    self._proxy(API if self.path.startswith("/api/") else STATIC)
    def do_PUT(self):     self._proxy(API if self.path.startswith("/api/") else STATIC)
    def do_DELETE(self):  self._proxy(API if self.path.startswith("/api/") else STATIC)
    def do_PATCH(self):   self._proxy(API if self.path.startswith("/api/") else STATIC)
    def do_OPTIONS(self): self._proxy(API if self.path.startswith("/api/") else STATIC)


if __name__ == "__main__":
    print("[proxy] /     → http://127.0.0.1:9080 (static)")
    print("[proxy] /api/ → http://127.0.0.1:8095 (stripe backend)")
    print("[proxy] listening on 0.0.0.0:9090 (then proxied through Tailscale)")
    ThreadingHTTPServer(("0.0.0.0", 9090), Proxy).serve_forever()