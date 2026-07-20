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
 * Represents one heading-level section of parsed Markdown.
 */
export interface HeadingSection {
  level: number;       // 0 = no heading (preamble text), 1–6 = # … ######
  heading: string;     // the raw heading line (e.g. "## Section 1.1"), empty for preamble
  content: string;     // heading line + body text (no sub-headings)
  id: string;          // assigned canvas node UUID
  x?: number;          // assigned layout position
  y?: number;          // assigned layout position
}

/**
 * Parsed result of markdown text into heading sections.
 */
export interface HeadingParseResult {
  sections: HeadingSection[];
  roots: number[];                       // indices of top-level sections
  children: Map<number, number[]>;        // parent idx → child idxs
}

// ─── Markdown heading parser ────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.+)/;

/**
 * Split clipboard Markdown text into heading-level blocks.
 * Each section = its heading line + all body lines before the next
 * heading of equal or greater level.
 */
export function parseHeadingSections(text: string): HeadingParseResult {
  const lines = text.split("\n");
  const sections: HeadingSection[] = [];
  let currentLines: string[] = [];
  let currentLevel = 0;
  let currentHeading = "";

  function flush() {
    const content = currentLines.join("\n").trimEnd();
    if (!content) return;
    sections.push({
      level: currentLevel,
      heading: currentHeading,
      content,
      id: generateId(),
    });
    currentLines = [];
  }

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      const newLevel = m[1].length;
      // Flush previous section
      flush();
      currentLevel = newLevel;
      currentHeading = line;
    }
    currentLines.push(line);
  }
  // Flush the last section
  flush();

  // Build parent-child relationships (方案A: 层级父子树)
  const children = new Map<number, number[]>();
  const roots: number[] = [];
  const stack: { idx: number; level: number }[] = [];

  for (let i = 0; i < sections.length; i++) {
    const level = sections[i].level;
    // Pop until top has strictly lower level
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(i);
    } else {
      const parentIdx = stack[stack.length - 1].idx;
      if (!children.has(parentIdx)) {
        children.set(parentIdx, []);
      }
      children.get(parentIdx)!.push(i);
    }
    stack.push({ idx: i, level });
  }

  return { sections, roots, children };
}

// ─── Tree layout engine ──────────────────────────────────────────

export type EdgeDirection = "tb" | "lr";

const NODE_WIDTH = 360;
const NODE_HEIGHT = 150;
const H_GAP = 60;
const V_GAP = 100;

/**
 * Assign (x, y) positions to every section so that the tree renders
 * without overlapping siblings.
 *
 * @param direction  "tb" — top→bottom tree (children below, spread horizontally);
 *                   "lr" — left→right tree (children to the right, spread vertically).
 */
export function layoutTreeNodes(
  sections: HeadingSection[],
  children: Map<number, number[]>,
  roots: number[],
  startX: number,
  startY: number,
  direction: EdgeDirection = "tb",
): void {
  if (direction === "tb") {
    layoutTopDown(sections, children, roots, startX, startY);
  } else {
    layoutLeftRight(sections, children, roots, startX, startY);
  }
}

function layoutTopDown(
  sections: HeadingSection[],
  children: Map<number, number[]>,
  roots: number[],
  startX: number,
  startY: number,
): void {
  const subtreeWidth = new Map<number, number>();

  function computeWidth(idx: number): number {
    if (subtreeWidth.has(idx)) return subtreeWidth.get(idx)!;
    const kids = children.get(idx) ?? [];
    if (kids.length === 0) {
      subtreeWidth.set(idx, NODE_WIDTH);
      return NODE_WIDTH;
    }
    const total =
      kids.reduce((sum, k) => sum + computeWidth(k), 0) +
      (kids.length - 1) * H_GAP;
    const w = Math.max(NODE_WIDTH, total);
    subtreeWidth.set(idx, w);
    return w;
  }

  for (const r of roots) computeWidth(r);

  function layout(idx: number, x: number, y: number) {
    sections[idx].x = x;
    sections[idx].y = y;

    const kids = children.get(idx);
    if (!kids || kids.length === 0) return;

    const totalKidsWidth =
      kids.reduce((sum, k) => sum + subtreeWidth.get(k)!, 0) +
      (kids.length - 1) * H_GAP;
    let childX = x + (subtreeWidth.get(idx)! - totalKidsWidth) / 2;
    const childY = y + NODE_HEIGHT + V_GAP;

    for (const kid of kids) {
      layout(kid, childX, childY);
      childX += subtreeWidth.get(kid)! + H_GAP;
    }
  }

  let currentX = startX;
  for (const r of roots) {
    layout(r, currentX, startY);
    currentX += subtreeWidth.get(r)! + H_GAP;
  }
}

function layoutLeftRight(
  sections: HeadingSection[],
  children: Map<number, number[]>,
  roots: number[],
  startX: number,
  startY: number,
): void {
  // In left-right mode, "subtreeHeight" replaces "subtreeWidth"
  // and children are positioned vertically below each other, then
  // the whole subtree is placed to the right of the parent.
  const subtreeHeight = new Map<number, number>();

  function computeHeight(idx: number): number {
    if (subtreeHeight.has(idx)) return subtreeHeight.get(idx)!;
    const kids = children.get(idx) ?? [];
    if (kids.length === 0) {
      subtreeHeight.set(idx, NODE_HEIGHT);
      return NODE_HEIGHT;
    }
    const total =
      kids.reduce((sum, k) => sum + computeHeight(k), 0) +
      (kids.length - 1) * V_GAP;
    const h = Math.max(NODE_HEIGHT, total);
    subtreeHeight.set(idx, h);
    return h;
  }

  for (const r of roots) computeHeight(r);

  function layout(idx: number, x: number, y: number) {
    sections[idx].x = x;
    sections[idx].y = y;

    const kids = children.get(idx);
    if (!kids || kids.length === 0) return;

    const totalKidsHeight =
      kids.reduce((sum, k) => sum + subtreeHeight.get(k)!, 0) +
      (kids.length - 1) * V_GAP;
    // Center children vertically relative to parent's subtree
    let childY = y + (subtreeHeight.get(idx)! - totalKidsHeight) / 2;
    const childX = x + NODE_WIDTH + H_GAP;

    for (const kid of kids) {
      layout(kid, childX, childY);
      childY += subtreeHeight.get(kid)! + V_GAP;
    }
  }

  let currentY = startY;
  for (const r of roots) {
    layout(r, startX, currentY);
    currentY += subtreeHeight.get(r)! + V_GAP;
  }
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
  autoResize: boolean = true,
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
    data = raw.trim() ? JSON.parse(raw) : {};
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
  const newNode: any = {
    id: generateId(),
    type: "text",
    text,
    x: centerX,
    y: centerY,
    width,
    height,
  };
  if (autoResize) {
    newNode["auto-resize"] = true;
    newNode["dynamicHeight"] = true;
  }

  data.nodes.push(newNode);

  // Write back to vault — Obsidian handles the file watcher and canvas re-render
  await app.vault.modify(file, JSON.stringify(data, null, 2));

  return { success: true, message: "Content pasted to canvas." };
}

// ─── Heading tree paste ─────────────────────────────────────────

/**
 * Parse clipboard text as a heading tree and paste all nodes + edges
 * into the active canvas. Nodes are connected via parent→child arrows
 * following the Markdown heading hierarchy (方案A: 层级父子树).
 */
export async function pasteHeadingTreeToCanvas(
  app: App,
  canvasView: any,
  text: string,
  direction: EdgeDirection = "tb",
  autoResize: boolean = true,
): Promise<PasteResult> {
  const file: TFile | undefined = canvasView.file;
  if (!file) {
    return { success: false, message: "Could not determine the canvas file." };
  }

  // 1. Parse Markdown into heading sections
  const { sections, roots, children } = parseHeadingSections(text);
  if (sections.length === 0) {
    return { success: false, message: "No content found in clipboard." };
  }

  // 2. Read canvas file
  let data: any;
  try {
    const raw = await app.vault.read(file);
    data = raw.trim() ? JSON.parse(raw) : {};
    if (!data.nodes) data.nodes = [];
    if (!data.edges) data.edges = [];
  } catch (err) {
    return {
      success: false,
      message: `Failed to read canvas file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Determine start position
  let startX = 0;
  let startY = 0;
  let gotCenter = false;

  try {
    const ic = canvasView.canvas;
    if (ic && typeof ic.getViewportCenter === "function") {
      const c = ic.getViewportCenter();
      startX = c.x;
      startY = c.y;
      gotCenter = true;
    } else if (ic?.viewport) {
      const vp = ic.viewport;
      const z = vp.zoom ?? 1;
      startX = (vp.scrollX ?? 0) + (vp.width ?? 800) / 2 / z;
      startY = (vp.scrollY ?? 0) + (vp.height ?? 600) / 2 / z;
      gotCenter = true;
    }
  } catch { /* ignore */ }

  if (!gotCenter && data.nodes.length > 0) {
    const maxRight = Math.max(
      ...data.nodes.map((n: any) => (n.x ?? 0) + (n.width ?? 400)),
    );
    const maxBottom = Math.max(
      ...data.nodes.map((n: any) => (n.y ?? 0) + (n.height ?? 200)),
    );
    startX = maxRight + 50;
    startY = Math.max(0, maxBottom - 100);
  }

  // 4. Layout nodes
  layoutTreeNodes(sections, children, roots, startX, startY, direction);

  // 5. Compute individual node dimensions and add to data
  for (const sec of sections) {
    const lines = sec.content.split("\n");
    const lineCount = Math.max(lines.length, 1);
    const longest = lines.reduce(
      (max, l) => (l.length > max.length ? l : max),
      "",
    );
    const w = Math.min(Math.max(measureTextWidth(longest) + 40, 200), 600);
    const h = Math.min(Math.max(lineCount * 22, 60), 400);

    const nodeObj: any = {
      id: sec.id,
      type: "text",
      text: sec.content,
      x: sec.x ?? startX,
      y: sec.y ?? startY,
      width: w,
      height: h,
    };
    if (autoResize) {
      nodeObj["auto-resize"] = true;
      nodeObj["dynamicHeight"] = true;
    }
    data.nodes.push(nodeObj);
  }

  // 6. Create edges: parent → child, one-way arrow
  const isLR = direction === "lr";
  for (const [parentIdx, kidIdxs] of children) {
    for (const kidIdx of kidIdxs) {
      data.edges.push({
        id: generateId(),
        fromNode: sections[parentIdx].id,
        toNode: sections[kidIdx].id,
        fromSide: isLR ? "right" : "bottom",
        toSide: isLR ? "left" : "top",
        fromEnd: "none",
        toEnd: "arrow",
      });
    }
  }

  // 7. Write back
  const edgeCount = data.edges.filter(
    (e: any) => sections.some((s) => s.id === e.fromNode),
  ).length;

  await app.vault.modify(file, JSON.stringify(data, null, 2));

  return {
    success: true,
    message: `Pasted ${sections.length} node${sections.length > 1 ? "s" : ""}, ${edgeCount} edge${edgeCount !== 1 ? "s" : ""}.`,
  };
}
