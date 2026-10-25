"""Local dev server: serves site/ and forwards /proxy/ and /upload/ requests to Canvas
with the same rules as the nginx config on the real server (server/cnv.byhrt.com.conf).
Tokens are only passed through, never stored or logged.

    python dev_server.py [port]
"""
import http.client
import http.server
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
HOST = r"([a-z0-9-]+\.instructure\.com)"
QUERY = r"(\?[^#]*)?$"
WRITE = re.compile(rf"^/proxy/{HOST}/(api/v1/(?:courses/[0-9~]+/(?:assignments/[0-9~]+/submissions(?:/self/files)?|discussion_topics/[0-9~]+/entries)|conversations(?:/[0-9~]+/add_message)?)){QUERY}")
READ = re.compile(rf"^/proxy/{HOST}/(api/v1/[^?#]*){QUERY}")
UPLOAD = re.compile(r"^/upload/((?:[a-z0-9-]+\.)*(?:instructure\.com|inscloudgate\.net)|instructure-uploads[a-z0-9-]*\.s3[a-z0-9.-]*\.amazonaws\.com)/([^?#]*)" + QUERY)
FILEDL = re.compile(rf"^/filedl/{HOST}/((?:courses/[0-9~]+/)?files/[0-9~]+/download){QUERY}")
CANVAS_URL = re.compile(r"^https://([a-z0-9-]+\.instructure\.com)/(.*)$")
PASS_BACK = ("Content-Type", "Link", "WWW-Authenticate")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        m = FILEDL.match(self.path)
        if m:
            return self.download(*m.groups())
        if self.path.startswith(("/proxy/", "/upload/", "/filedl/")):
            m = READ.match(self.path)
            return self.forward(*m.groups(), send_auth=True) if m else self.send_error(403)
        super().do_GET()

    def do_POST(self):
        m = WRITE.match(self.path)
        if m:
            return self.forward(*m.groups(), send_auth=True)
        m = UPLOAD.match(self.path)
        if m:
            return self.forward(*m.groups(), send_auth=False, upload=True)
        self.send_error(403)

    def forward(self, host, path, query, send_auth, upload=False):
        # Canvas refuses requests with no User-Agent; nginx passes the browser's along, so do the same.
        names = ["Accept", "Content-Type", "User-Agent"] + (["Authorization"] if send_auth else [])
        headers = {h: self.headers[h] for h in names if self.headers.get(h)}
        body = None
        if self.command == "POST":
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            conn = http.client.HTTPSConnection(host, timeout=300 if upload else 30)
            conn.request(self.command, f"/{path}{query or ''}", body=body, headers=headers)
            res = conn.getresponse()
            data = res.read()
        except OSError:
            return self.send_error(502)

        location = res.getheader("Location")
        if upload and 300 <= res.status < 400:
            # Same as nginx: hand the confirm address to the page instead of redirecting.
            self.send_response(204)
            self.send_header("X-Cnv-Location", location or "")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(res.status)
        for h in PASS_BACK:
            if res.getheader(h):
                self.send_header(h, res.getheader(h))
        if location:
            m = CANVAS_URL.match(location)
            self.send_header("Location", f"/proxy/{m[1]}/{m[2]}" if m else location)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def download(self, host, path, query):
        # Same as nginx's /filedl/: no token, follow Canvas's redirects to its file storage.
        req = urllib.request.Request(f"https://{host}/{path}{query or ''}", headers={"User-Agent": self.headers.get("User-Agent", "Coursework")})
        try:
            res = urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as err:
            return self.send_error(err.code)
        except OSError:
            return self.send_error(502)
        data = res.read()
        self.send_response(200)
        self.send_header("Content-Type", res.headers.get("Content-Type", "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        if not self.path.startswith(("/proxy/", "/upload/", "/filedl/")):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    print(f"Serving on http://localhost:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
