# -*- coding: utf-8 -*-
import argparse, os, sys

from . import __version__
from .config import Config


def main(argv=None):
    ap = argparse.ArgumentParser(prog='gitdocview', description='Browse, compare and read a git repository\'s Markdown docs by version.')
    ap.add_argument('--version', action='version', version='git-doc-viewer ' + __version__)
    ap.add_argument('--config', help='config file (default ~/.config/git-doc-viewer/config.json)')
    sub = ap.add_subparsers(dest='cmd')

    s = sub.add_parser('serve', help='start the local web app (default)')
    s.add_argument('--repo', help='repository to open at start')
    s.add_argument('--docs', help='docs folder (default: the repository root)')
    s.add_argument('--host', default='127.0.0.1')
    s.add_argument('--port', type=int, default=8765)
    s.add_argument('--no-open', action='store_true', help='do not open the browser')

    e = sub.add_parser('export', help='write one self-contained HTML file')
    e.add_argument('--repo', required=True)
    e.add_argument('--docs')
    e.add_argument('--out', default='docsite.html')
    e.add_argument('--mode', choices=['tags', 'commits'], default='tags')

    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0].startswith('-') and argv[0] not in ('-h', '--help', '--version'):
        argv = ['serve'] + argv
    a = ap.parse_args(argv)
    config = Config(a.config)

    if a.cmd == 'export':
        from .export import export
        r = export(a.repo, a.docs, a.out, config, a.mode)
        print('%(versions)d versions, %(blobs)d blobs, %(bytes)d bytes -> %(out)s' % r)
        return 0

    from .server import serve
    defaults = {"repo": os.path.realpath(os.path.expanduser(a.repo)) if a.repo else None,
                "docs": os.path.realpath(os.path.expanduser(a.docs)) if a.docs else None}
    serve(a.host, a.port, config, defaults, open_browser=not a.no_open)
    return 0


if __name__ == '__main__':
    sys.exit(main())
