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

/** Detect a fenced code block boundary (```...). */
function isFence(line: string): boolean {
  return /^```/.test(line.trim());
}

/** Check whether a line starts with $$ (but not $$$...). */
function isLatexOpen(line: string): boolean {
  return /^\$\$(?!\$)/.test(line.trim());
}

/** True when a line starts with $$ and has a closing $$ at the very end. */
function isLatexSingleLine(line: string): boolean {
  const t = line.trim();
  if (!/^\$\$(?!\$)/.test(t)) return false;
  const rest = t.substring(2);
  const idx = rest.indexOf("$$");
  if (idx === -1) return false;
  return idx + 2 === rest.length;
}

/** Check whether a text block contains any ATX-style headings. */
export function containsHeadings(text: string): boolean {
  let inCode = false;
  let inLatex = false;
  for (const line of text.split("\n")) {
    if (isLatexOpen(line)) {
      if (inLatex) { inLatex = false; continue; }
      if (isLatexSingleLine(line)) continue;
      inLatex = true; continue;
    }
    if (inLatex) continue;
    if (isFence(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    if (/^#{1,6}\s+/m.test(line)) return true;
  }
  return false;
}

/** Check whether every non-blank line is a list item (bullet or numbered). */
export function isOnlyList(text: string): boolean {
  let hasListItem = false;
  let inCode = false;
  let inLatex = false;
  for (const line of text.split("\n")) {
    if (isLatexOpen(line)) {
      if (inLatex) { inLatex = false; continue; }
      if (isLatexSingleLine(line)) continue;
      inLatex = true; continue;
    }
    if (inLatex) continue;
    if (isFence(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    if (line.trim() === "") continue;
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      hasListItem = true;
      continue;
    }
    return false;
  }
  return hasListItem;
}

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
  let inCode = false;
  let inLatex = false;

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
    if (isLatexOpen(line)) {
      if (inLatex) { inLatex = false; currentLines.push(line); continue; }
      if (isLatexSingleLine(line)) { currentLines.push(line); continue; }
      inLatex = true; currentLines.push(line); continue;
    }
    if (inLatex) { currentLines.push(line); continue; }
    if (isFence(line)) { inCode = !inCode; currentLines.push(line); continue; }
    if (inCode) { currentLines.push(line); continue; }
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
    // Pop until top has strictly lower level; preamble (level 0)
    // never becomes parent of a heading (level ≥ 1).
    while (stack.length > 0 &&
           (stack[stack.length - 1].level >= level ||
            (level >= 1 && stack[stack.length - 1].level === 0))) {
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

// ─── List parser ──────────────────────────────────────────────

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)/;

/**
 * Parse bullet or numbered list text into sections (reuses heading tree
 * data model). Indentation depth acts as the hierarchy level.
 */
export function parseListItems(text: string): HeadingParseResult {
  const lines = text.split("\n");
  const sections: HeadingSection[] = [];
  let currentLines: string[] = [];
  let currentIndent = -1; // -1 = not inside a list item
  let currentHeading = "";
  const preambleLines: string[] = []; // non-list lines before first list item
  let inCode = false;
  let inLatex = false;

  function flush() {
    const content = currentLines.join("\n").trimEnd();
    if (!content) return;
    sections.push({
      level: currentIndent,
      heading: currentHeading,
      content,
      id: generateId(),
    });
    currentLines = [];
  }

  function flushPreamble() {
    const content = preambleLines.join("\n").trimEnd();
    if (!content) return;
    sections.push({ level: 0, heading: "", content, id: generateId() });
    preambleLines.length = 0;
  }

  for (const line of lines) {
    if (isLatexOpen(line)) {
      if (inLatex) {
        inLatex = false;
        if (currentIndent >= 0) currentLines.push(line);
        else preambleLines.push(line);
        continue;
      }
      if (isLatexSingleLine(line)) {
        if (currentIndent >= 0) currentLines.push(line);
        else preambleLines.push(line);
        continue;
      }
      inLatex = true;
      if (currentIndent >= 0) currentLines.push(line);
      else preambleLines.push(line);
      continue;
    }
    if (inLatex) {
      if (currentIndent >= 0) currentLines.push(line);
      else preambleLines.push(line);
      continue;
    }
    if (isFence(line)) {
      inCode = !inCode;
      if (currentIndent >= 0) currentLines.push(line);
      else preambleLines.push(line);
      continue;
    }
    if (inCode) {
      if (currentIndent >= 0) currentLines.push(line);
      else preambleLines.push(line);
      continue;
    }
    const m = LIST_RE.exec(line);
    if (m) {
      const indent = m[1].length;
      if (preambleLines.length > 0) flushPreamble();
      if (currentIndent >= 0) flush();
      currentIndent = indent;
      currentHeading = line;
      currentLines.push(line);
    } else if (currentIndent >= 0) {
      // Non-list line inside list section
      if (line.trim() !== "") {
        // Non-blank → break out of list, become a separate level-0 node
        flush();
        currentIndent = -1;
        preambleLines.push(line);
      } else {
        // Blank line → still part of current list item (paragraph break)
        currentLines.push(line);
      }
    } else {
      preambleLines.push(line);
    }
  }
  if (preambleLines.length > 0) flushPreamble();
  flush();

  // Build parent-child relationships (方案A: 层级父子树)
  const children = new Map<number, number[]>();
  const roots: number[] = [];
  const stack: { idx: number; level: number }[] = [];

  for (let i = 0; i < sections.length; i++) {
    const level = sections[i].level;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(i);
    } else {
      const parentIdx = stack[stack.length - 1].idx;
      if (!children.has(parentIdx)) children.set(parentIdx, []);
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
  createEdges: boolean = true,
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

  // 6. Create edges: parent → child, one-way arrow (only when enabled)
  let edgeCount = 0;
  if (createEdges) {
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
    edgeCount = data.edges.filter(
      (e: any) => sections.some((s) => s.id === e.fromNode),
    ).length;
  }

  await app.vault.modify(file, JSON.stringify(data, null, 2));

  return {
    success: true,
    message: `Pasted ${sections.length} node${sections.length > 1 ? "s" : ""}, ${edgeCount} edge${edgeCount !== 1 ? "s" : ""}.`,
  };
}

// ─── List tree paste ─────────────────────────────────────────

/**
 * Strip list item indentation and marker from each line.
 * @param keepNumbering  When true, numbered markers (1., 1)) are kept.
 *                       Bullet markers (-, *, +) are always removed.
 */
function cleanListItemContent(content: string, keepNumbering: boolean): string {
  return content
    .split("\n")
    .map((line) => {
      const m = LIST_RE.exec(line);
      if (m) {
        const marker = m[2];
        const text = m[3];
        const isNumbered = /^\d+[.)]$/.test(marker);
        if (isNumbered && keepNumbering) {
          return marker + " " + text;
        }
        return text;
      }
      // Continuation line: only strip leading whitespace
      return line.trimStart();
    })
    .join("\n");
}

/**
 * Parse clipboard text as a bullet/numbered list tree and paste
 * all nodes + edges into the active canvas. Hierarchy is determined
 * by indentation depth.
 */
export async function pasteListTreeToCanvas(
  app: App,
  canvasView: any,
  text: string,
  direction: EdgeDirection = "tb",
  autoResize: boolean = true,
  createEdges: boolean = true,
  keepListNumbering: boolean = true,
): Promise<PasteResult> {
  const file: TFile | undefined = canvasView.file;
  if (!file) {
    return { success: false, message: "Could not determine the canvas file." };
  }

  // 1. Parse list items
  const { sections, roots, children } = parseListItems(text);
  if (sections.length === 0) {
    return { success: false, message: "No list items found in clipboard." };
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
    const cleaned = cleanListItemContent(sec.content, keepListNumbering);
    const lines = cleaned.split("\n");
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
      text: cleaned,
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

  // 6. Create edges (only when enabled)
  let edgeCount = 0;
  if (createEdges) {
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
    edgeCount = data.edges.filter(
      (e: any) => sections.some((s) => s.id === e.fromNode),
    ).length;
  }

  await app.vault.modify(file, JSON.stringify(data, null, 2));

  return {
    success: true,
    message: `Pasted ${sections.length} list node${sections.length > 1 ? "s" : ""}, ${edgeCount} edge${edgeCount !== 1 ? "s" : ""}.`,
  };
}

// ─── Paragraph paste ─────────────────────────────────────────

/**
 * Read Obsidian's "Strict line breaks" editor setting.
 */
function isStrictLineBreaks(app: App): boolean {
  try {
    return !!(app.vault as any).getConfig?.("strictLineBreaks");
  } catch {
    return false;
  }
}

/**
 * Split text into paragraphs, treating contiguous list items as one paragraph.
 */
function splitParagraphs(text: string, strict: boolean): string[] {
  const lines = text.split("\n");
  const paragraphs: string[] = [];
  const current: number[] = [];
  let inList = false;
  let inCode = false;
  let inLatex = false;

  const isListItem = (line: string) =>
    /^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line);

  const flush = () => {
    const content = current.map((i) => lines[i]).join("\n").trim();
    if (content) paragraphs.push(content);
    current.length = 0;
    inList = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const empty = line.trim() === "";

    // LaTeX block: collect everything until closing $$
    if (isLatexOpen(line)) {
      if (inLatex) {
        current.push(i);
        flush();
        inLatex = false;
        continue;
      }
      if (isLatexSingleLine(line)) { current.push(i); flush(); continue; }
      if (current.length > 0) flush();
      inLatex = true;
      current.push(i);
      continue;
    }
    if (inLatex) { current.push(i); continue; }

    // Code block: collect everything until closing fence
    if (isFence(line)) {
      if (inCode) {
        current.push(i);
        flush();
        inCode = false;
        continue;
      }
      if (current.length > 0) flush();
      inCode = true;
      current.push(i);
      continue;
    }

    if (inCode) {
      current.push(i);
      continue;
    }

    if (isListItem(line)) {
      if (!inList && current.length > 0) flush();
      inList = true;
      current.push(i);
      continue;
    }

    if (inList) {
      if (empty) {
        const nextNonEmpty = lines.slice(i + 1).find((l) => l.trim() !== "");
        if (nextNonEmpty && isListItem(nextNonEmpty)) {
          current.push(i);
          continue;
        }
        flush();
        continue;
      }
      if (/^\s+\S/.test(line)) {
        current.push(i);
        continue;
      }
      flush();
    }

    if (empty) {
      flush();
    } else {
      if (strict && current.length > 0) flush();
      current.push(i);
    }
  }
  flush();
  return paragraphs;
}

const PARA_HEADING_RE = /^(#{1,6})\s+/;

/**
 * Paste clipboard text as paragraphs. Heading paragraphs become
 * parent nodes; non-heading paragraphs attach to the nearest
 * preceding heading. Layout uses the tree engine.
 */
export async function pasteParagraphsToCanvas(
  app: App,
  canvasView: any,
  text: string,
  autoResize: boolean = true,
  direction: EdgeDirection = "tb",
  createEdges: boolean = true,
): Promise<PasteResult> {
  const file: TFile | undefined = canvasView.file;
  if (!file) {
    return { success: false, message: "Could not determine the canvas file." };
  }

  const strict = isStrictLineBreaks(app);
  const paragraphs = splitParagraphs(text, strict);
  if (paragraphs.length === 0) {
    return { success: false, message: "No paragraphs found in clipboard." };
  }

  // Build sections: heading line → separate node from its body text
  const HEADING_PARSE_RE = /^(#{1,6})\s+(.+)/;
  const sections: HeadingSection[] = [];

  for (const para of paragraphs) {
    const lines = para.split("\n");
    const firstLine = lines[0];
    const m = HEADING_PARSE_RE.exec(firstLine);

    if (m && lines.length > 1) {
      // Heading + body → two nodes
      sections.push({
        level: 1, heading: firstLine, content: firstLine, id: generateId(),
      });
      const body = lines.slice(1).join("\n").trim();
      if (body) {
        sections.push({
          level: 0, heading: "", content: body, id: generateId(),
        });
      }
    } else if (m) {
      // Heading only
      sections.push({
        level: 1, heading: firstLine, content: firstLine, id: generateId(),
      });
    } else {
      // Plain content paragraph
      sections.push({
        level: 0, heading: "", content: para, id: generateId(),
      });
    }
  }

  // All headings are sibling roots; content paragraphs attach to last heading
  const children = new Map<number, number[]>();
  const roots: number[] = [];
  let lastHeadingIdx: number | null = null;

  for (let i = 0; i < sections.length; i++) {
    if (sections[i].level === 1) {
      roots.push(i);
      lastHeadingIdx = i;
    } else if (lastHeadingIdx !== null) {
      if (!children.has(lastHeadingIdx)) children.set(lastHeadingIdx, []);
      children.get(lastHeadingIdx)!.push(i);
    } else {
      roots.push(i);
    }
  }

  // Read canvas file
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

  // Determine start position
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

  // Layout
  layoutTreeNodes(sections, children, roots, startX, startY, direction);

  // Create nodes
  for (const sec of sections) {
    const lines = sec.content.split("\n");
    const lineCount = Math.max(lines.length, 1);
    const longest = lines.reduce(
      (max, l) => (l.length > max.length ? l : max),
      "",
    );
    const w = Math.min(Math.max(measureTextWidth(longest) + 40, 200), 600);
    const h = Math.min(Math.max(lineCount * 22, 60), 400);

    const node: any = {
      id: sec.id,
      type: "text",
      text: sec.content,
      x: sec.x ?? startX,
      y: sec.y ?? startY,
      width: w,
      height: h,
    };
    if (autoResize) {
      node["auto-resize"] = true;
      node["dynamicHeight"] = true;
    }
    data.nodes.push(node);
  }

  // Create edges
  let edgeCount = 0;
  if (createEdges) {
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
    edgeCount = data.edges.filter(
      (e: any) => sections.some((s) => s.id === e.fromNode),
    ).length;
  }

  await app.vault.modify(file, JSON.stringify(data, null, 2));

  return {
    success: true,
    message: `Pasted ${sections.length} paragraph node${sections.length > 1 ? "s" : ""}, ${edgeCount} edge${edgeCount !== 1 ? "s" : ""}.`,
  };
}
