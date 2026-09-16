# -*- coding: utf-8 -*-
"""Everything that talks to git or the working tree."""
import datetime, fnmatch, io, os, re, subprocess

CHANGELOG_HEAD_RE = re.compile(r'^## \[?([^\]\s]+)\]?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$', re.M)
SHA_RE = re.compile(r'^[0-9a-f]{4,64}$')
_BLOBS = {}   # (repo, sha) -> text; git blobs are immutable


class GitError(Exception):
    pass


def git(repo, *args):
    p = subprocess.run(['git', '-C', repo] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise GitError(p.stderr.decode('utf-8', 'replace').strip() or 'git ' + ' '.join(args) + ' failed')
    return p.stdout.decode('utf-8', 'replace')


def toplevel(path):
    """Absolute repo root for `path`, or None when it is not inside a git work tree."""
    try:
        return os.path.realpath(git(path, 'rev-parse', '--show-toplevel').strip())
    except (GitError, OSError):
        return None


def rel_docs(repo, docs):
    rel = os.path.relpath(os.path.realpath(docs), os.path.realpath(repo))
    if rel == '..' or rel.startswith('..' + os.sep):
        raise GitError('docs folder must be inside the repository: ' + docs)
    return '' if rel == '.' else rel.replace(os.sep, '/')


def _excluded(relpath, patterns):
    return any(fnmatch.fnmatch(relpath, p) or fnmatch.fnmatch(relpath, p.rstrip('*').rstrip('/') + '/*') for p in patterns)


def parse_name(relpath, suffixes):
    """'guides/00-intro.zh.md' -> ('guides/00-intro', 'zh'); base language is 'base'."""
    low = relpath.lower()
    for lang, suf in sorted(suffixes.items(), key=lambda kv: -len(kv[1])):
        if low.endswith(suf.lower()):
            return relpath[:-len(suf)], lang
    if low.endswith('.md'):
        return relpath[:-3], 'base'
    return None, None


def tree_files(repo, ref, rel, scan):
    """{relpath-within-docs: sha} for Markdown blobs at `ref`."""
    args = ['ls-tree', '-r', '-z', ref]
    if rel:
        args += ['--', rel]
    out = {}
    for entry in git(repo, *args).split('\0'):
        if not entry:
            continue
        meta, path = entry.split('\t', 1)
        typ, sha = meta.split()[1:3]
        if typ != 'blob' or not path.lower().endswith('.md'):
            continue
        if rel:
            path = path[len(rel) + 1:]
        if not _excluded(path, scan.get('exclude') or []):
            out[path] = sha
    return out


_WT = {}      # (repo, sha) -> absolute path of a working-tree file hashed by git hash-object


def worktree_files(repo, docs, scan):
    """{relpath: sha} for Markdown files on disk; sha is git's blob id, so unchanged files match their committed blob."""
    rels = []
    for root, dirs, files in os.walk(docs):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for name in files:
            if name.lower().endswith('.md'):
                relpath = os.path.relpath(os.path.join(root, name), docs).replace(os.sep, '/')
                if not _excluded(relpath, scan.get('exclude') or []):
                    rels.append(relpath)
    if not rels:
        return {}
    p = subprocess.run(['git', '-C', repo, 'hash-object', '--stdin-paths'], input='\n'.join(os.path.join(docs, r) for r in rels).encode('utf-8'),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise GitError(p.stderr.decode('utf-8', 'replace').strip())
    shas = p.stdout.decode().split()
    out = {}
    for relpath, sha in zip(rels, shas):
        out[relpath] = sha
        _WT[(repo, sha)] = os.path.join(docs, relpath)
    return out


def list_tags(repo):
    out = []
    for line in git(repo, 'for-each-ref', '--sort=v:refname', 'refs/tags', '--format=%(refname:short)%09%(creatordate:short)').splitlines():
        tag, _, date = line.partition('\t')
        if tag:
            out.append((tag, date))
    return out


def list_commits(repo, rel, limit):
    args = ['log', '--format=%h%x09%cs%x09%s', '-n', str(limit), '--reverse']
    if rel:
        args += ['--', rel]
    out = []
    for line in git(repo, *args).splitlines():
        parts = line.split('\t', 2)
        if len(parts) == 3:
            out.append(tuple(parts))
    return out


def translation_commits(repo, pattern):
    """{tag: commit} from commits whose subject matches `pattern` (group 1 = tag). Newest wins."""
    if not pattern:
        return {}
    try:
        rx = re.compile(pattern)
    except re.error:
        return {}
    found = {}
    for line in git(repo, 'log', '--all', '--format=%H%x09%s').splitlines():
        sha, _, subj = line.partition('\t')
        m = rx.search(subj)
        if m and m.group(1) not in found:
            found[m.group(1)] = sha
    return found


def changelog_sections(text):
    heads = list(CHANGELOG_HEAD_RE.finditer(text))
    out = {}
    for i, h in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        out[h.group(1)] = text[h.end():end].strip()
    return out


def doc_label(doc_id):
    name = doc_id.rsplit('/', 1)[-1]
    m = re.match(r'^(\d+)[-_.\s]+(.+)$', name)
    num, rest = (m.group(1), m.group(2)) if m else ('', name)
    rest = re.sub(r'-(platform-contract|service)$', '', rest)
    prefix = doc_id[:-len(name)] if '/' in doc_id else ''
    return num, prefix + rest


def build_versions(repo, docs, scan, mode='tags'):
    repo = os.path.realpath(repo)
    docs = os.path.realpath(docs or repo)
    rel = rel_docs(repo, docs)
    suffixes = scan.get('lang_suffixes') or {}
    versions = []

    def add(vid, label, date, kind, files, extra_lang_files=None):
        byid = {}
        for path, sha in files.items():
            did, lang = parse_name(path, suffixes)
            if did:
                byid.setdefault(did, {})[lang] = sha
        for path, sha in (extra_lang_files or {}).items():
            did, lang = parse_name(path, suffixes)
            if did and lang != 'base':
                byid.setdefault(did, {}).setdefault(lang, sha)
        versions.append({"id": vid, "label": label, "date": date, "kind": kind, "files": byid})

    if mode == 'commits':
        for sha, date, subj in list_commits(repo, rel, int(scan.get('commit_limit') or 200)):
            add(sha, sha + ' ' + subj[:60], date, 'commit', tree_files(repo, sha, rel, scan))
    else:
        tr = translation_commits(repo, scan.get('translation_commit_pattern'))
        for tag, date in list_tags(repo):
            extra = tree_files(repo, tr[tag], rel, scan) if tag in tr else None
            add(tag, tag, date, 'tag', tree_files(repo, tag, rel, scan), extra)
    if scan.get('include_worktree', True) and os.path.isdir(docs):
        add('@worktree', '工作区', datetime.date.today().isoformat(), 'worktree', worktree_files(repo, docs, scan))

    doc_ids = sorted({d for v in versions for d in v['files']})
    docs_meta = []
    for d in doc_ids:
        num, short = doc_label(d)
        docs_meta.append({"id": d, "num": num, "short": short})
    langs = sorted({l for v in versions for f in v['files'].values() for l in f if l != 'base'})

    changelog = {}
    cl = scan.get('changelog_file')
    if cl:
        p = os.path.join(docs, cl)
        if os.path.isfile(p):
            with io.open(p, encoding='utf-8', errors='replace') as f:
                changelog = changelog_sections(f.read())
    for v in versions:
        v['changelog'] = changelog.get(v['id'])

    return {"repo": repo, "docs": docs, "mode": mode, "docs_list": docs_meta, "langs": langs, "versions": versions,
            "branch": git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').strip(), "head": git(repo, 'rev-parse', '--short', 'HEAD').strip()}


def blob(repo, docs, sha):
    repo = os.path.realpath(repo)
    if not SHA_RE.match(sha):
        raise GitError('bad blob id')
    key = (repo, sha)
    if key in _WT:                       # working-tree file: read from disk (may change between requests)
        with io.open(_WT[key], encoding='utf-8', errors='replace') as f:
            return f.read()
    if key not in _BLOBS:
        _BLOBS[key] = git(repo, 'cat-file', '-p', sha)
    return _BLOBS[key]


def list_dir(path):
    """Directory picker helper: sub-directories with git/markdown hints."""
    path = os.path.realpath(os.path.expanduser(path or '~'))
    if not os.path.isdir(path):
        raise GitError('not a directory: ' + path)
    dirs = []
    for name in sorted(os.listdir(path), key=str.lower):
        if name.startswith('.'):
            continue
        full = os.path.join(path, name)
        if os.path.isdir(full):
            try:
                md = sum(1 for n in os.listdir(full) if n.lower().endswith('.md'))
            except OSError:
                md = 0
            dirs.append({"name": name, "is_git": os.path.isdir(os.path.join(full, '.git')), "md_count": md})
    here_md = sum(1 for n in os.listdir(path) if n.lower().endswith('.md'))
    return {"path": path, "parent": os.path.dirname(path) if path != os.sep else None, "dirs": dirs,
            "is_git": toplevel(path) is not None, "md_count": here_md}
