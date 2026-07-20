import { Plugin, Notice, PluginSettingTab, Setting, View } from "obsidian";
import {
  pasteToActiveCanvas,
  pasteHeadingTreeToCanvas,
  pasteListTreeToCanvas,
  pasteParagraphsToCanvas,
  readClipboard,
  containsHeadings,
  isOnlyList,
  type EdgeDirection,
} from "./canvas-utils";

// ─── Settings ────────────────────────────────────────────────────

export interface CanvasClipboardSettings {
  edgeDirection: EdgeDirection;
  autoResize: boolean;
  createEdges: boolean;
  keepListNumbering: boolean;
}

export const DEFAULT_SETTINGS: CanvasClipboardSettings = {
  edgeDirection: "tb",
  autoResize: true,
  createEdges: true,
  keepListNumbering: true,
};

// ─── Plugin ──────────────────────────────────────────────────────

export default class CanvasClipboardPastePlugin extends Plugin {
  settings: CanvasClipboardSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new CanvasClipboardSettingTab(this.app, this));

    this.addCommand({
      id: "paste-clipboard-as-canvas-node",
      name: "Paste clipboard as a single canvas node",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(View);
        if (!view) return false;
        if (view.getViewType() !== "canvas") return false;
        if (!checking) void this.handlePaste(view);
        return true;
      },
    });

    this.addCommand({
      id: "paste-clipboard-as-heading-tree",
      name: "Paste clipboard as heading tree",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(View);
        if (!view) return false;
        if (view.getViewType() !== "canvas") return false;
        if (!checking) void this.handleHeadingTreePaste(view);
        return true;
      },
    });

    this.addCommand({
      id: "paste-clipboard-as-list-tree",
      name: "Paste clipboard as list tree",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(View);
        if (!view) return false;
        if (view.getViewType() !== "canvas") return false;
        if (!checking) void this.handleListTreePaste(view);
        return true;
      },
    });

    this.addCommand({
      id: "paste-clipboard-as-tree",
      name: "Paste clipboard as tree",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(View);
        if (!view) return false;
        if (view.getViewType() !== "canvas") return false;
        if (!checking) void this.handleAutoTreePaste(view);
        return true;
      },
    });

    this.addCommand({
      id: "paste-clipboard-as-paragraphs",
      name: "Paste clipboard as paragraphs",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(View);
        if (!view) return false;
        if (view.getViewType() !== "canvas") return false;
        if (!checking) void this.handleParagraphPaste(view);
        return true;
      },
    });
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData() as Partial<CanvasClipboardSettings>,
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ── Command handlers ─────────────────────────────────────────

  private async handlePaste(canvasView: any) {
    const text = await readClipboard();
    if (!text) {
      new Notice("Clipboard is empty or contains no readable text.");
      return;
    }
    const result = await pasteToActiveCanvas(
      this.app, canvasView, text, this.settings.autoResize,
    );
    if (result.success) {
      new Notice(result.message);
    } else {
      new Notice(`Failed: ${result.message}`);
    }
  }

  private async handleHeadingTreePaste(canvasView: any) {
    const text = await readClipboard();
    if (!text) {
      new Notice("Clipboard is empty or contains no readable text.");
      return;
    }
    const result = await pasteHeadingTreeToCanvas(
      this.app, canvasView, text,
      this.settings.edgeDirection,
      this.settings.autoResize,
      this.settings.createEdges,
    );
    if (result.success) {
      new Notice(result.message);
    } else {
      new Notice(`Failed: ${result.message}`);
    }
  }

  private async handleListTreePaste(canvasView: any) {
    const text = await readClipboard();
    if (!text) {
      new Notice("Clipboard is empty or contains no readable text.");
      return;
    }
    const result = await pasteListTreeToCanvas(
      this.app, canvasView, text,
      this.settings.edgeDirection,
      this.settings.autoResize,
      this.settings.createEdges,
      this.settings.keepListNumbering,
    );
    if (result.success) {
      new Notice(result.message);
    } else {
      new Notice(`Failed: ${result.message}`);
    }
  }

  private async handleAutoTreePaste(canvasView: any) {
    const text = await readClipboard();
    if (!text) {
      new Notice("Clipboard is empty or contains no readable text.");
      return;
    }

    let result;
    if (containsHeadings(text)) {
      result = await pasteHeadingTreeToCanvas(
        this.app, canvasView, text,
        this.settings.edgeDirection,
        this.settings.autoResize,
        this.settings.createEdges,
      );
    } else if (isOnlyList(text)) {
      result = await pasteListTreeToCanvas(
        this.app, canvasView, text,
        this.settings.edgeDirection,
        this.settings.autoResize,
        this.settings.createEdges,
        this.settings.keepListNumbering,
      );
    } else {
      result = await pasteParagraphsToCanvas(
        this.app, canvasView, text,
        this.settings.autoResize,
        this.settings.edgeDirection,
        this.settings.createEdges,
      );
    }

    if (result.success) {
      new Notice(result.message);
    } else {
      new Notice(`Failed: ${result.message}`);
    }
  }

  private async handleParagraphPaste(canvasView: any) {
    const text = await readClipboard();
    if (!text) {
      new Notice("Clipboard is empty or contains no readable text.");
      return;
    }
    const result = await pasteParagraphsToCanvas(
      this.app, canvasView, text, this.settings.autoResize,
      this.settings.edgeDirection, this.settings.createEdges,
    );
    if (result.success) {
      new Notice(result.message);
    } else {
      new Notice(`Failed: ${result.message}`);
    }
  }
}

// ─── Settings tab ────────────────────────────────────────────────

class CanvasClipboardSettingTab extends PluginSettingTab {
  plugin: CanvasClipboardPastePlugin;

  constructor(app: any, plugin: CanvasClipboardPastePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions() {
    return [];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Canvas Clipboard Paste")
      .setHeading();

    new Setting(containerEl)
      .setName("Edge direction")
      .setDesc(
        "Heading / list tree connection direction: top→bottom or left→right.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("tb", "Top to bottom")
          .addOption("lr", "Left to right")
          .setValue(this.plugin.settings.edgeDirection)
          .onChange(async (value) => {
            this.plugin.settings.edgeDirection = value as EdgeDirection;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Create edges")
      .setDesc(
        "When enabled, tree nodes are connected with arrows. Applies to heading tree and list tree.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.createEdges)
          .onChange(async (value) => {
            this.plugin.settings.createEdges = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Keep list numbering")
      .setDesc(
        "When enabled, numbered list items keep their number (1. item). Bullet markers are always removed.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.keepListNumbering)
          .onChange(async (value) => {
            this.plugin.settings.keepListNumbering = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Auto-resize nodes")
      .setDesc(
        "When enabled, canvas nodes resize automatically to fit text content.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoResize)
          .onChange(async (value) => {
            this.plugin.settings.autoResize = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
