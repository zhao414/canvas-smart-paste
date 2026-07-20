import { Plugin, Notice } from "obsidian";
import { pasteToActiveCanvas, readClipboard } from "./canvas-utils";

export default class CanvasClipboardPastePlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "paste-clipboard-as-canvas-node",
      name: "Paste clipboard as canvas node",
      // Per Obsidian convention: do not set default hotkeys
      checkCallback: (checking: boolean) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        if (leaf.view.getViewType() !== "canvas") return false;

        if (!checking) {
          this.handlePaste(leaf.view);
        }
        return true;
      },
    });
  }

  private async handlePaste(canvasView: any) {
    const text = await readClipboard();

    if (!text) {
      new Notice("Clipboard is empty or contains no readable text.");
      return;
    }

    const result = await pasteToActiveCanvas(this.app, canvasView, text);

    if (result.success) {
      new Notice(result.message);
    } else {
      new Notice(`Failed: ${result.message}`);
    }
  }
}
