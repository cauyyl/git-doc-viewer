# git-doc-viewer

[中文](README.md) · **English**

Read the Markdown docs of a Git repository in the browser **by version**, switch between **language versions**, and compare any two versions either **paragraph by paragraph (rendered)** or **line by line (source)**. Zero dependencies: Python 3.9+ standard library + system `git`, with a purely static frontend.

## Quick start

```bash
cd git-doc-viewer
python3 -m gitdocview --repo ~/workspaces/some-repo            # opens http://127.0.0.1:8765/ in the browser
python3 -m gitdocview --repo ~/repo --docs ~/repo/docs         # docs live in a subdirectory
python3 -m gitdocview --port 9000 --no-open                    # just start the server
bin/gitdocview --repo ~/repo                                   # equivalent shell entry point
```

You can also start it without arguments and pick a repository from the toolbar at the top of the page.

Export to a single offline HTML file (no server needed, just double-click it):

```bash
python3 -m gitdocview export --repo ~/repo --out dist/repo-docs.html
```

## Features

| Area | Description |
|---|---|
| Toolbar (top, collapsible, `t`) | Choose the Git repository and docs directory (same by default; use "…" to browse folders); version source: Git tags / commit history; recently opened repositories |
| Versions | All tags sorted by version number; the last entry, "Working tree", is the uncommitted files on disk; `←` `→` to switch |
| Read `1` | Renders Markdown; the table of contents in the right pane follows your scroll position |
| Compare (rendered) `2` | Compare against the "baseline" (previous version by default, any version selectable) block by block: added / removed / modified, with word-level highlighting inside modified blocks, tables by cell, code blocks by line; the right pane lists changes by section, `n` / `p` to jump; unchanged blocks can be collapsed |
| Compare (source) `3` | Classic line-by-line diff with ±3 lines of context and expandable folded regions |
| Version overview | Which documents changed in each version (chips are clickable and open the comparison directly), plus that version's CHANGELOG entry |
| Languages | Translations are detected by file suffix (by default `X.zh.md` is the Chinese version of `X.md`); when a version has no translation it falls back to the original with a notice, and one click switches the comparison to the nearest version that does have one |
| Appearance settings `,` | See next section |

## Configuration file

Defaults to `~/.config/git-doc-viewer/config.json`, generated automatically on first start; `--config PATH` changes the location. Click ⚙ in the top right to open the settings panel:

- **profiles**: iTerm-style profiles that can be duplicated / renamed / deleted / switched. Each profile controls the font size, weight and color of H1–H4 (set separately for light / dark themes; leave empty to follow the theme), body font size / line height / content width, three font families, the accent color and the three diff colors.
- Every change in the form **takes effect immediately**; "Save" writes it back to the file. The "JSON" tab lets you edit the whole file directly.
- You can also edit the file with any editor. The page checks the modification time every 3 seconds and reloads automatically (it will not overwrite unsaved changes in the panel).

The `scan` section controls how documents are recognized:

```json
"scan": {
  "lang_suffixes": {"zh": ".zh.md"},
  "base_lang_label": "English",
  "lang_labels": {"zh": "中文"},
  "exclude": ["node_modules/**", ".git/**"],
  "translation_commit_pattern": "译文同步至\\s+(\\S+)",
  "include_worktree": true,
  "changelog_file": "CHANGELOG.md",
  "commit_limit": 200
}
```

- `translation_commit_pattern`: if translations land on another branch with commit messages like "译文同步至 dev-v0.45.0" ("translation synced to dev-v0.45.0"), they are matched to the version of the corresponding tag.
- `changelog_file`: if this file exists in the docs directory, its `## [tag] - date` (or `## tag`) sections are shown as the CHANGELOG entry of each version.

## Language switching

Translations are recognized by **filename suffix**, not by content. The rule is defined by `scan.lang_suffixes`: keys are language codes, values are the file suffix for that language. A file that ends in plain `.md` with none of the configured suffixes is the **original**.

The default `{"zh": ".zh.md"}` means:

```
docs/guide.md        ← original (shown in the toolbar as base_lang_label, default "English")
docs/guide.zh.md     ← its Chinese version (shown as lang_labels.zh, default "中文")
```

If your translations are named like `xxx.cn.md`, just change the suffix to `.cn.md`:

```json
"scan": {
  "lang_suffixes": {"cn": ".cn.md"},
  "lang_labels": {"cn": "简体中文"}
}
```

To support several languages at once, add more entries; the toolbar shows one button per language:

```json
"scan": {
  "base_lang_label": "中文",
  "lang_suffixes": {"en": ".en.md", "ja": ".ja.md"},
  "lang_labels": {"en": "English", "ja": "日本語"}
}
```

Notes:

- Suffix matching is **case-insensitive** and tries the longest suffix first, so `.zh-Hant.md` and `.zh.md` can coexist.
- The language code itself is arbitrary (`zh` / `cn` / `chinese` all work); it is only the key into `lang_labels` and the identifier used in the URL. Without a `lang_labels` entry the button shows the code as-is.
- A translation must sit in the **same directory with the same base name** as the original (`a/b.md` ↔ `a/b.cn.md`); otherwise it is not treated as the same document.
- When a version lacks a translation, the original is shown with a notice; if translations live on another branch, use `translation_commit_pattern` to attach them to the matching tag (see the previous section).

## Layout

```
gitdocview/
  __main__.py   CLI: serve (default) / export
  server.py     HTTP server on 127.0.0.1: static files + /api/{state,versions,blob,fs,config}
  repo.py       git operations: tags / commits / ls-tree / cat-file / working-tree hash-object / CHANGELOG sections
  config.py     config file read/write and defaults
  export.py     builds the single-file HTML (data embedded as gzip+base64)
  static/       index.html · favicon.svg · app.css · app.js (includes the diff engine) · marked.min.js
```

The server only listens on the local loopback address, the directory-browsing API lists directory names only, and file reads are restricted to Markdown files inside the docs directory.
