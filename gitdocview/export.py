# -*- coding: utf-8 -*-
"""Export one repository as a self-contained HTML file (works from file://, no server)."""
import base64, gzip, io, json, os

from . import repo as R

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')


def export(repo, docs, out, config, mode='tags'):
    cfg = config.load()
    top = R.toplevel(os.path.expanduser(repo))
    if not top:
        raise R.GitError('not a git repository: ' + repo)
    docs = os.path.realpath(os.path.expanduser(docs or top))
    data = R.build_versions(top, docs, cfg.get('scan', {}), mode)
    blobs = {}
    for v in data['versions']:
        for f in v['files'].values():
            for sha in f.values():
                if sha not in blobs:
                    blobs[sha] = R.blob(top, docs, sha)
    embed = {"data": data, "blobs": blobs, "config": cfg}
    raw = json.dumps(embed, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    b64 = base64.b64encode(gzip.compress(raw, 9)).decode('ascii')

    def read(name):
        with io.open(os.path.join(STATIC, name), encoding='utf-8') as f:
            return f.read()
    html = read('index.html')
    html = html.replace('href="favicon.svg"', 'href="data:image/svg+xml;base64,' + base64.b64encode(read('favicon.svg').encode('utf-8')).decode('ascii') + '"')
    html = html.replace('<link rel="stylesheet" href="app.css">', '<style>\n' + read('app.css') + '\n</style>')
    html = html.replace('<script src="marked.min.js"></script>', '<script>' + read('marked.min.js').replace('</script', '<\\/script') + '</script>')
    html = html.replace('<script src="app.js"></script>', '<script id="embed" type="application/octet-stream">' + b64 + '</script>\n<script>' + read('app.js').replace('</script', '<\\/script') + '</script>')
    os.makedirs(os.path.dirname(os.path.abspath(out)) or '.', exist_ok=True)
    with io.open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    return {"versions": len(data['versions']), "blobs": len(blobs), "bytes": len(html), "out": os.path.abspath(out)}
