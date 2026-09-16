# -*- coding: utf-8 -*-
"""Local HTTP server: static app + JSON API. Binds to 127.0.0.1 by default."""
import json, mimetypes, os, sys, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from . import repo as R
from .config import Config

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')


def make_handler(config, defaults):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'git-doc-viewer'

        def log_message(self, fmt, *args):      # quieter log: only API errors
            pass

        # ---- helpers ----
        def _json(self, obj, status=200):
            body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def _text(self, text, ctype='text/plain; charset=utf-8', cache=False):
            body = text.encode('utf-8') if isinstance(text, str) else text
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable' if cache else 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            n = int(self.headers.get('Content-Length') or 0)
            return json.loads(self.rfile.read(n).decode('utf-8')) if n else None

        def _repo_docs(self, q):
            repo = q.get('repo', [''])[0]
            top = R.toplevel(os.path.expanduser(repo)) if repo else None
            if not top:
                raise R.GitError('不是 git 仓库：' + (repo or '(空)'))
            docs = os.path.realpath(os.path.expanduser(q.get('docs', [''])[0] or top))
            if not os.path.isdir(docs):
                raise R.GitError('文档目录不存在：' + docs)
            return top, docs

        # ---- routes ----
        def do_GET(self):
            u = urlparse(self.path)
            q = parse_qs(u.query)
            try:
                if u.path == '/api/state':
                    cfg = config.load()
                    return self._json({"config": cfg, "config_path": config.path, "config_mtime": config.mtime(),
                                       "home": os.path.expanduser('~'), "defaults": defaults})
                if u.path == '/api/config':
                    return self._json({"config": config.load(), "mtime": config.mtime()})
                if u.path == '/api/fs':
                    return self._json(R.list_dir(q.get('path', ['~'])[0]))
                if u.path == '/api/versions':
                    top, docs = self._repo_docs(q)
                    scan = config.load().get('scan', {})
                    data = R.build_versions(top, docs, scan, q.get('mode', ['tags'])[0])
                    config.remember(top, docs)
                    return self._json(data)
                if u.path == '/api/blob':
                    top, docs = self._repo_docs(q)
                    sha = q.get('sha', [''])[0]
                    return self._text(R.blob(top, docs, sha), 'text/markdown; charset=utf-8', cache=(top, sha) not in R._WT)
                if u.path.startswith('/api/'):
                    return self._json({"error": "unknown endpoint"}, 404)
                # static
                rel = 'index.html' if u.path in ('', '/') else u.path.lstrip('/')
                full = os.path.realpath(os.path.join(STATIC, rel))
                if not full.startswith(STATIC + os.sep) or not os.path.isfile(full):
                    return self._json({"error": "not found"}, 404)
                ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
                if ctype.startswith('text/') or ctype in ('application/javascript', 'application/json'):
                    ctype += '; charset=utf-8'
                with open(full, 'rb') as f:
                    return self._text(f.read(), ctype)
            except R.GitError as e:
                return self._json({"error": str(e)}, 400)
            except Exception as e:
                traceback.print_exc()
                return self._json({"error": "%s: %s" % (type(e).__name__, e)}, 500)

        def do_PUT(self):
            u = urlparse(self.path)
            try:
                if u.path == '/api/config':
                    mtime = config.save(self._body())
                    return self._json({"ok": True, "mtime": mtime})
                return self._json({"error": "unknown endpoint"}, 404)
            except (ValueError, TypeError) as e:
                return self._json({"error": str(e)}, 400)
            except Exception as e:
                traceback.print_exc()
                return self._json({"error": "%s: %s" % (type(e).__name__, e)}, 500)

    return Handler


def serve(host, port, config, defaults, open_browser=True):
    config.ensure_exists()
    httpd = ThreadingHTTPServer((host, port), make_handler(config, defaults))
    url = 'http://%s:%d/' % (host, httpd.server_address[1])
    print('git-doc-viewer  %s   (config: %s)' % (url, config.path))
    if open_browser:
        import webbrowser
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nbye')
