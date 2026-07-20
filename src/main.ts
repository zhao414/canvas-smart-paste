import { Plugin, Notice, PluginSettingTab, Setting } from "obsidian";
import {
  pasteToActiveCanvas,
  pasteHeadingTreeToCanvas,
  readClipboard,
  type EdgeDirection,
} from "./canvas-utils";

// ─── Settings ────────────────────────────────────────────────────

export interface CanvasClipboardSettings {
  edgeDirection: EdgeDirection;
  autoResize: boolean;
}

export const DEFAULT_SETTINGS: CanvasClipboardSettings = {
  edgeDirection: "tb",
  autoResize: true,
};

// ─── Plugin ──────────────────────────────────────────────────────

export default class CanvasClipboardPastePlugin extends Plugin {
  settings: CanvasClipboardSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new CanvasClipboardSettingTab(this.app, this));

    this.addCommand({
      id: "paste-clipboard-as-canvas-node",
      name: "Paste clipboard as canvas node",
      checkCallback: (checking: boolean) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        if (leaf.view.getViewType() !== "canvas") return false;
        if (!checking) this.handlePaste(leaf.view);
        return true;
      },
    });

    this.addCommand({
      id: "paste-clipboard-as-heading-tree",
      name: "Paste clipboard as heading tree",
      checkCallback: (checking: boolean) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        if (leaf.view.getViewType() !== "canvas") return false;
        if (!checking) this.handleHeadingTreePaste(leaf.view);
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
    const result = await pasteToActiveCanvas(this.app, canvasView, text, this.settings.autoResize);
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
      this.app,
      canvasView,
      text,
      this.settings.edgeDirection,
      this.settings.autoResize,
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Canvas Clipboard Paste" });

    new Setting(containerEl)
      .setName("Edge direction")
      .setDesc(
        "Heading tree connection direction: top→bottom or left→right.",
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
