# git-doc-viewer

**中文** · [English](README.en.md)

在浏览器里按**版本**阅读一个 Git 仓库中的 Markdown 文档，切换**语言版本**，并把任意两个版本**逐段渲染对比**或**逐行源码对比**。零依赖：Python 3.9+ 标准库 + 系统 `git`，前端纯静态。

## 快速开始

```bash
cd git-doc-viewer
python3 -m gitdocview --repo ~/workspaces/some-repo            # 打开浏览器 http://127.0.0.1:8765/
python3 -m gitdocview --repo ~/repo --docs ~/repo/docs         # 文档在子目录
python3 -m gitdocview --port 9000 --no-open                    # 只起服务
bin/gitdocview --repo ~/repo                                   # 等价的 shell 入口
```

也可以不带参数启动，在页面顶部工具栏里选择仓库。

导出成单个离线 HTML（不需要服务，双击即开）：

```bash
python3 -m gitdocview export --repo ~/repo --out dist/repo-docs.html
```

## 功能

| 区域 | 说明 |
|---|---|
| 工具栏（顶部，可折叠，`t`） | 选择 Git 仓库和文档目录（默认相同，可用「…」浏览文件夹）；版本来源：Git 标签 / 提交记录；最近打开的仓库 |
| 版本 | 所有标签按版本号排序，最后一项「工作区」是磁盘上未提交的文件；`←` `→` 切换 |
| 阅读 `1` | 渲染 Markdown，右栏目录随滚动定位 |
| 对比（渲染）`2` | 与「比较基准」（默认上一版本，可选任意版本）逐段对比：新增 / 删除 / 修改，修改段内词级高亮，表格按单元格、代码块按行；右栏按章节列出改动，`n` / `p` 跳转；可折叠未改动段落 |
| 对比（源码）`3` | 传统逐行 diff，±3 行上下文，可展开折叠区 |
| 版本总览 | 每个版本改动了哪些文档（芯片可点直接进对比），以及该版本的 CHANGELOG 条目 |
| 语言 | 按文件后缀识别译文（默认 `X.zh.md` 是 `X.md` 的中文版）；某版本没有译文时回退原文并提示，可一键改为与最近有译文的版本比较 |
| 外观配置 `,` | 见下节 |

## 配置文件

默认在 `~/.config/git-doc-viewer/config.json`，首次启动自动生成；`--config PATH` 可换位置。点右上角 ⚙ 打开配置面板：

- **profiles**：类似 iTerm 的 profile，可复制 / 改名 / 删除 / 切换。每个 profile 控制 H1–H4 的字号、字重、颜色（浅色 / 深色主题分别设置，留空则跟随主题）、正文字号 / 行高 / 内容宽度、三组字体、主色和 diff 三色。
- 表单里的每次改动**即时生效**，「保存」才写回文件；「JSON」页可直接编辑整个文件。
- 也可以用任何编辑器改文件，页面每 3 秒检查一次修改时间，自动重新加载（面板里有未保存修改时不会覆盖）。

`scan` 段控制怎么识别文档：

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

- `translation_commit_pattern`：译文若在另一条分支上、按「译文同步至 dev-v0.45.0」这样的提交信息落地，会被匹配到对应标签的版本里。
- `changelog_file`：若文档目录里有它，`## [tag] - date`（或 `## tag`）分节会显示为各版本的 CHANGELOG 条目。

## 语言切换

译文靠**文件名后缀**识别，不看文件内容。规则由 `scan.lang_suffixes` 决定：键是语言代码，值是该语言的文件后缀；不带任何配置后缀、只以 `.md` 结尾的文件是**原文**。

默认配置 `{"zh": ".zh.md"}` 表示：

```
docs/guide.md        ← 原文（工具栏里显示为 base_lang_label，默认 "English"）
docs/guide.zh.md     ← 它的中文版（显示为 lang_labels.zh，默认 "中文"）
```

如果你的译文用的是 `xxx.cn.md` 这样的命名，把后缀改成 `.cn.md` 即可：

```json
"scan": {
  "lang_suffixes": {"cn": ".cn.md"},
  "lang_labels": {"cn": "简体中文"}
}
```

要同时支持多种语言，多加几项即可，工具栏会为每种语言各显示一个按钮：

```json
"scan": {
  "base_lang_label": "中文",
  "lang_suffixes": {"en": ".en.md", "ja": ".ja.md"},
  "lang_labels": {"en": "English", "ja": "日本語"}
}
```

注意事项：

- 后缀匹配**不区分大小写**，且从最长的后缀开始匹配，所以 `.zh-Hant.md` 和 `.zh.md` 可以共存。
- 语言代码本身可以随意取（`zh` / `cn` / `chinese` 都行），它只是 `lang_labels` 的键和 URL 里的标识；没有配 `lang_labels` 时按钮上直接显示代码。
- 译文与原文必须在**同一目录、同一主名**下（`a/b.md` ↔ `a/b.cn.md`），否则不会被当作同一份文档。
- 某个版本缺少译文时会回退显示原文并给出提示；译文如果在另一条分支上，可用 `translation_commit_pattern` 关联到对应标签（见上节）。

## 结构

```
gitdocview/
  __main__.py   CLI：serve（默认）/ export
  server.py     127.0.0.1 上的 HTTP 服务：静态文件 + /api/{state,versions,blob,fs,config}
  repo.py       git 操作：标签 / 提交 / ls-tree / cat-file / 工作区 hash-object / CHANGELOG 分节
  config.py     配置文件读写与默认值
  export.py     生成单文件 HTML（数据 gzip+base64 内嵌）
  static/       index.html · favicon.svg · app.css · app.js（含 diff 引擎）· marked.min.js
```

服务只监听本机回环地址，浏览目录的 API 只列出目录名，读取文件仅限文档目录内的 Markdown。
