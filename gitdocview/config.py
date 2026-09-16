# -*- coding: utf-8 -*-
"""Config file: appearance profiles (iTerm-style), scan rules, recent repos."""
import copy, io, json, os, tempfile

DEFAULT_PATH = os.path.join(os.path.expanduser('~'), '.config', 'git-doc-viewer', 'config.json')

DEFAULT_PROFILE = {
    "name": "默认",
    "content_width": 900,
    "body": {"font": "\"Source Serif 4\", \"Songti SC\", \"Noto Serif CJK SC\", Georgia, serif", "size": 16, "line_height": 1.78},
    "ui_font": "\"IBM Plex Sans\", \"PingFang SC\", \"Hiragino Sans GB\", system-ui, sans-serif",
    "mono_font": "\"IBM Plex Mono\", Menlo, Consolas, monospace",
    "headings": {
        "h1": {"size": 30, "weight": 600, "color": "", "color_dark": ""},
        "h2": {"size": 22, "weight": 600, "color": "", "color_dark": ""},
        "h3": {"size": 17.5, "weight": 600, "color": "", "color_dark": ""},
        "h4": {"size": 15, "weight": 600, "color": "", "color_dark": ""},
    },
    "accent": {"light": "#0E6B87", "dark": "#5DB8D5"},
    "diff": {"ins": "#3F9F69", "del": "#D46A6A", "mod": "#D6A11E"},
}

DEFAULT_CONFIG = {
    "version": 1,
    "active_profile": "default",
    "profiles": {"default": DEFAULT_PROFILE},
    "scan": {
        "lang_suffixes": {"zh": ".zh.md"},
        "base_lang_label": "English",
        "lang_labels": {"zh": "中文"},
        "exclude": ["node_modules/**", ".git/**"],
        "translation_commit_pattern": "译文同步至\\s+(\\S+)",
        "include_worktree": True,
        "changelog_file": "CHANGELOG.md",
        "commit_limit": 200,
    },
    "recent": [],
    "toolbar_collapsed": False,
}


def _merge(base, over):
    """Deep-merge dicts: keys in `over` win; missing keys come from `base`."""
    if not isinstance(base, dict) or not isinstance(over, dict):
        return copy.deepcopy(over)
    out = copy.deepcopy(base)
    for k, v in over.items():
        out[k] = _merge(base[k], v) if k in base and isinstance(base[k], dict) and isinstance(v, dict) else copy.deepcopy(v)
    return out


class Config(object):
    def __init__(self, path=None):
        self.path = os.path.abspath(path or DEFAULT_PATH)

    def mtime(self):
        try:
            return os.stat(self.path).st_mtime
        except OSError:
            return 0

    def load(self):
        try:
            with io.open(self.path, encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        cfg = _merge(DEFAULT_CONFIG, data)
        # every profile gets the default profile's missing keys, so old files keep working
        cfg['profiles'] = {k: _merge(DEFAULT_PROFILE, v) for k, v in (cfg.get('profiles') or {}).items()} or {"default": copy.deepcopy(DEFAULT_PROFILE)}
        if cfg['active_profile'] not in cfg['profiles']:
            cfg['active_profile'] = sorted(cfg['profiles'])[0]
        return cfg

    def save(self, cfg):
        if not isinstance(cfg, dict) or not isinstance(cfg.get('profiles'), dict) or not cfg['profiles']:
            raise ValueError('config must be an object with a non-empty "profiles" object')
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path), prefix='.config.', suffix='.json')
        with io.open(fd, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
            f.write('\n')
        os.replace(tmp, self.path)
        return self.mtime()

    def ensure_exists(self):
        if not os.path.exists(self.path):
            self.save(copy.deepcopy(DEFAULT_CONFIG))

    def remember(self, repo, docs):
        cfg = self.load()
        entry = {"repo": repo, "docs": docs}
        cfg['recent'] = [entry] + [r for r in cfg.get('recent', []) if r != entry][:11]
        self.save(cfg)
