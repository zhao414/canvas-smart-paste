# Canvas Smart Paste

An Obsidian plugin that intelligently pastes clipboard content into Canvas as nodes.

## Commands

| Command | Description |
|---------|-------------|
| **Paste clipboard as a single canvas node** | All content → one text node |
| **Paste clipboard as heading tree** | Create nodes by Markdown heading hierarchy + arrow connections |
| **Paste clipboard as list tree** | Create nodes by bullet/numbered list indentation + arrow connections |
| **Paste clipboard as paragraphs** | Each paragraph → separate node, headings isolated, top-to-bottom layout |
| **Paste clipboard as tree** | Auto-detect: has heading → heading tree, only list → list tree, else → paragraphs |

## Settings

- **Edge direction** — Connection direction: top→bottom / left→right
- **Create edges** — Whether to draw arrow connections (heading tree, list tree, paragraphs)
- **Keep list numbering** — Whether to keep number prefix for ordered lists
- **Auto-resize nodes** — Whether nodes auto-adjust height to fit content

## Usage

1. Copy Markdown text
2. Open a `.canvas` file
3. `Ctrl+P` → select a command

## Installation

### Manual

```bash
git clone https://github.com/zhao414/canvas-smart-paste.git
cp -r canvas-smart-paste /path/to/vault/.obsidian/plugins/
```

### BRAT

```
zhao414/canvas-smart-paste
```

## Support

If this plugin makes your daily life with Obsidian easier, consider buying me a coffee.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I3E121X4Y7)

May the passion be with you!

## License

MIT

---

# Canvas Smart Paste

Obsidian 插件：智能粘贴剪贴板内容到 Canvas。

## 命令

| 命令 | 说明 |
|------|------|
| **Paste clipboard as a single canvas node** | 全部内容 → 一个文本节点 |
| **Paste clipboard as heading tree** | 按 Markdown heading 层级创建节点 + 箭头连接 |
| **Paste clipboard as list tree** | 按 bullet/numbered list 缩进创建节点 + 箭头连接 |
| **Paste clipboard as paragraphs** | 每段 → 独立节点，heading 分离，自上而下排列 |
| **Paste clipboard as tree** | 自动检测：heading → heading tree，仅 list → list tree，其他 → paragraphs |

## 设置

- **Edge direction** — 连接方向：上→下 / 左→右
- **Create edges** — 是否画箭头连接
- **Keep list numbering** — 编号列表是否保留序号
- **Auto-resize nodes** — 节点是否自动调整高度

## 用法

1. 复制 Markdown 文本
2. 打开 `.canvas` 文件
3. `Ctrl+P` → 选择命令

## 安装

### 手动安装

```bash
git clone https://github.com/zhao414/canvas-smart-paste.git
cp -r canvas-smart-paste /path/to/vault/.obsidian/plugins/
```

### BRAT

```
zhao414/canvas-smart-paste
```

## Support

如果这个插件让你的 Obsidian 日常使用更顺手，不妨请我喝杯咖啡 ☕

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I3E121X4Y7)

好好学习，天天向上！

## License

MIT
