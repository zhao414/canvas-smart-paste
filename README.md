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
- **Create edges** — 是否画箭头连接（heading tree、list tree、paragraphs）
- **Keep list numbering** — 编号列表是否保留序号
- **Auto-resize nodes** — 节点是否自动调整高度

## 用法

1. 复制 Markdown 文本（支持 heading、list、段落）
2. 打开 `.canvas` 文件
3. `Ctrl+P` → 选择命令

## 安装

### 社区插件（待上架）

### 手动安装

```bash
git clone https://github.com/zhao414/canvas-smart-paste.git
cp -r canvas-smart-paste /path/to/vault/.obsidian/plugins/
```

### BRAT

```
zhao414/canvas-smart-paste
```

## License

MIT
