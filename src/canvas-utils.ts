import { App, TFile } from "obsidian";

/**
 * Generate a UUID v4 for canvas node/edge IDs
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Read clipboard content with format detection.
 * Returns the best available text representation, or null if empty/unavailable.
 */
export async function readClipboard(): Promise<string | null> {
  // Try modern clipboard API first (supports format detection)
  try {
    const items = await navigator.clipboard.read();

    for (const item of items) {
      // Prefer plain text to preserve Markdown syntax (wikilinks, headings, etc.)
      if (item.types.includes("text/plain")) {
        const blob = await item.getType("text/plain");
        const text = await blob.text();
        if (text.trim()) return text;
      }
      // Fallback: extract plain text from HTML (loses formatting)
      if (item.types.includes("text/html")) {
        const blob = await item.getType("text/html");
        const html = await blob.text();
        const text = stripHtml(html);
        if (text.trim()) return text;
      }
    }
  } catch {
    // navigator.clipboard.read() requires permission/user gesture in some browsers
    // Fall through to readText()
  }

  // Fallback: simple text read
  try {
    const text = await navigator.clipboard.readText();
    return text.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Measure the rendered width of a text string using Canvas 2D API.
 * Uses Obsidian's UI font to match the canvas node rendering.
 * Falls back to 8px per character if measurement is unavailable.
 */
function measureTextWidth(text: string): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.length * 8;
  // Match Obsidian canvas node text style
  ctx.font = "16px var(--font-text, var(--font-interface, sans-serif))";
  return ctx.measureText(text).width;
}

/**
 * Strip HTML tags and decode common entities, returning plain text.
 */
function stripHtml(html: string): string {
  let text = html
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, "")
    // Remove script and style blocks
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Remove all remaining tags
    .replace(/<[^>]*>/g, "")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");

  // Collapse excessive blank lines
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

/**
 * Simplified canvas text node data (matches Obsidian's CanvasTextData format)
 */
export interface CanvasTextNodeData {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

/**
 * Result of a paste operation
 */
export interface PasteResult {
  success: boolean;
  message: string;
}

/**
 * Paste text into the active canvas view as a new text node.
 *
 * @param app          Obsidian App instance
 * @param canvasView   The active canvas view (must already be confirmed as canvas type)
 * @param text         Text content to paste
 */
export async function pasteToActiveCanvas(
  app: App,
  canvasView: any,
  text: string,
): Promise<PasteResult> {
  // 1. Get the canvas file
  const file: TFile | undefined = canvasView.file;
  if (!file) {
    return { success: false, message: "Could not determine the canvas file." };
  }

  // 2. Read the canvas file once (single read avoids race condition)
  let data: any;
  try {
    const raw = await app.vault.read(file);
    data = JSON.parse(raw);
    if (!data.nodes) {
      data.nodes = [];
    }
  } catch (err) {
    return {
      success: false,
      message: `Failed to read canvas file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Determine target position (viewport center or fallback)
  let centerX = 0;
  let centerY = 0;
  let gotCenter = false;

  // @internal — Obsidian Canvas internal API (no public typedefs).
  // Compatible with Obsidian ≥ v1.5. May break on future versions.
  try {
    const internalCanvas = canvasView.canvas;
    if (internalCanvas) {
      if (typeof internalCanvas.getViewportCenter === "function") {
        const center = internalCanvas.getViewportCenter();
        centerX = center.x;
        centerY = center.y;
        gotCenter = true;
      } else if (internalCanvas.viewport) {
        // Fallback path when getViewportCenter() is absent
        const vp = internalCanvas.viewport;
        const zoom = vp.zoom ?? 1;
        centerX = (vp.scrollX ?? 0) + (vp.width ?? 800) / 2 / zoom;
        centerY = (vp.scrollY ?? 0) + (vp.height ?? 600) / 2 / zoom;
        gotCenter = true;
      }
    }
  } catch {
    // Internal API unavailable — use fallback below
  }

  // 4. Fallback position: place below the rightmost existing node
  if (!gotCenter && data.nodes.length > 0) {
    const maxRight = Math.max(
      ...data.nodes.map((n: any) => (n.x ?? 0) + (n.width ?? 400)),
    );
    const maxBottom = Math.max(
      ...data.nodes.map((n: any) => (n.y ?? 0) + (n.height ?? 200)),
    );
    centerX = maxRight + 50;
    centerY = Math.max(0, maxBottom - 100);
  }

  // 5. Calculate node dimensions based on text content
  const lines = text.split("\n");
  const lineCount = Math.max(lines.length, 1);
  // Measure the widest line using Canvas 2D API for accurate text width
  const longestLine = lines.reduce(
    (max, line) => (line.length > max.length ? line : max),
    "",
  );
  const measuredWidth = measureTextWidth(longestLine);
  const width = Math.min(Math.max(measuredWidth + 40, 200), 600);
  const height = Math.min(Math.max(lineCount * 22, 60), 400);

  // 6. Append new node and write back
  const newNode: CanvasTextNodeData = {
    id: generateId(),
    type: "text",
    text,
    x: centerX,
    y: centerY,
    width,
    height,
  };

  data.nodes.push(newNode);

  // Write back to vault — Obsidian handles the file watcher and canvas re-render
  await app.vault.modify(file, JSON.stringify(data, null, 2));

  return { success: true, message: "Content pasted to canvas." };
}
