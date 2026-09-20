import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

import { fileTypeFromBuffer } from "file-type";
import JSZip from "jszip";
import mammoth from "mammoth";

import type { Ob1Config } from "./config.js";
import type { ImageInput } from "./provider.js";

const execFile = promisify(execFileCallback);

export type FileKind = "pdf" | "docx" | "pptx" | "xlsx" | "image" | "svg" | "text";

export interface DetectedFile {
  kind: FileKind;
  mimeType: string;
  extension: string;
}

export interface ExtractedBlock {
  content: string;
  locator: Record<string, unknown>;
  method: string;
  generated: boolean;
  image?: ImageInput;
}

const EXTENSION_MIME: Record<string, { kind: FileKind; mimeType: string }> = {
  txt: { kind: "text", mimeType: "text/plain" },
  md: { kind: "text", mimeType: "text/markdown" },
  markdown: { kind: "text", mimeType: "text/markdown" },
  csv: { kind: "text", mimeType: "text/csv" },
  tsv: { kind: "text", mimeType: "text/tab-separated-values" },
  json: { kind: "text", mimeType: "application/json" },
  html: { kind: "text", mimeType: "text/html" },
  htm: { kind: "text", mimeType: "text/html" },
  xml: { kind: "text", mimeType: "application/xml" },
  pdf: { kind: "pdf", mimeType: "application/pdf" },
  docx: { kind: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pptx: { kind: "pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  xlsx: { kind: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  jpg: { kind: "image", mimeType: "image/jpeg" },
  jpeg: { kind: "image", mimeType: "image/jpeg" },
  png: { kind: "image", mimeType: "image/png" },
  webp: { kind: "image", mimeType: "image/webp" },
  gif: { kind: "image", mimeType: "image/gif" },
  svg: { kind: "svg", mimeType: "image/svg+xml" },
};

const MIME_KIND: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
};

function normalizedExtension(name: string): string {
  return extname(name).toLowerCase().replace(/^\./, "");
}

function isUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    const value = buffer.toString("utf8");
    return !value.includes("\ufffd");
  } catch {
    return false;
  }
}

async function zipKind(buffer: Buffer): Promise<{ kind: FileKind; mimeType: string } | null> {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return null;
  try {
    const zip = await JSZip.loadAsync(buffer, { createFolders: false, checkCRC32: false });
    const names = Object.keys(zip.files);
    const contentTypes = zip.file("[Content_Types].xml");
    const text = contentTypes ? await contentTypes.async("text") : "";
    if (names.some((name) => name.startsWith("word/"))) return EXTENSION_MIME.docx;
    if (names.some((name) => name.startsWith("ppt/"))) return EXTENSION_MIME.pptx;
    if (names.some((name) => name.startsWith("xl/"))) return EXTENSION_MIME.xlsx;
    if (/wordprocessingml|presentationml|spreadsheetml/i.test(text)) {
      if (/wordprocessingml/i.test(text)) return EXTENSION_MIME.docx;
      if (/presentationml/i.test(text)) return EXTENSION_MIME.pptx;
      if (/spreadsheetml/i.test(text)) return EXTENSION_MIME.xlsx;
    }
  } catch {
    return null;
  }
  return null;
}

export async function detectFile(originalName: string, buffer: Buffer): Promise<DetectedFile> {
  if (!buffer.length) throw new Error("Uploaded file is empty");
  const extension = normalizedExtension(originalName);
  const sniffed = await fileTypeFromBuffer(buffer);
  const zip = await zipKind(buffer);
  const byMagic = zip || (sniffed?.mime && MIME_KIND[sniffed.mime]
    ? { kind: MIME_KIND[sniffed.mime], mimeType: sniffed.mime }
    : null);

  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { kind: "pdf", mimeType: "application/pdf", extension: "pdf" };
  }
  if (extension === "svg" && isUtf8Text(buffer) && /<svg(?:\s|>)/i.test(buffer.toString("utf8"))) {
    assertSafeSvg(buffer.toString("utf8"));
    return { kind: "svg", mimeType: "image/svg+xml", extension: "svg" };
  }
  if (byMagic) {
    const detectedExtension = byMagic.kind === "image" ? (sniffed?.ext || extension || "bin") : extension || byMagic.kind;
    return { kind: byMagic.kind, mimeType: byMagic.mimeType, extension: detectedExtension };
  }
  const fallback = EXTENSION_MIME[extension];
  if (fallback?.kind === "text" && isUtf8Text(buffer)) {
    return { ...fallback, extension: extension || "txt" };
  }
  if (fallback?.kind === "svg" && isUtf8Text(buffer)) return { ...fallback, extension: "svg" };
  throw new Error(`Unsupported or unrecognized file type${extension ? `: .${extension}` : ""}`);
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)));
}

async function extractDocx(filePath: string): Promise<ExtractedBlock[]> {
  const result = await mammoth.extractRawText({ path: filePath });
  const content = normalizeText(result.value);
  if (!content) throw new Error("DOCX contained no extractable text");
  return [{ content, locator: { kind: "document" }, method: "mammoth", generated: false }];
}

async function extractPptx(filePath: string): Promise<ExtractedBlock[]> {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer, { createFolders: false, checkCRC32: false });
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));
  const blocks: ExtractedBlock[] = [];
  for (const name of names) {
    const xml = await zip.file(name)!.async("text");
    const values = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)].map((match) => decodeXml(match[1]));
    const content = normalizeText(values.join(" "));
    if (content) blocks.push({ content, locator: { slide: Number(name.match(/\d+/)?.[0] || 0) }, method: "pptx-xml", generated: false });
  }
  if (!blocks.length) throw new Error("PPTX contained no extractable text");
  return blocks;
}

async function extractXlsx(filePath: string): Promise<ExtractedBlock[]> {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath), { createFolders: false, checkCRC32: false });
  const sharedStrings = zip.file("xl/sharedStrings.xml")
    ? [...(await zip.file("xl/sharedStrings.xml")!.async("text")).matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1]))
    : [];
  const workbookXml = zip.file("xl/workbook.xml") ? await zip.file("xl/workbook.xml")!.async("text") : "";
  const names = [...workbookXml.matchAll(/<sheet\b[^>]*name\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((match) => decodeXml(match[1]));
  const sheetFiles = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));
  const blocks: ExtractedBlock[] = [];
  for (let sheetIndex = 0; sheetIndex < sheetFiles.length; sheetIndex += 1) {
    const sheetFile = sheetFiles[sheetIndex];
    const sheetName = names[sheetIndex] || `sheet ${sheetIndex + 1}`;
    const xml = await zip.file(sheetFile)!.async("text");
    const rows: string[] = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const cells: string[] = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const attributes = cellMatch[1];
        const type = attributes.match(/\bt\s*=\s*["']([^"']+)["']/i)?.[1] || "";
        const value = cellMatch[2].match(/<v[^>]*>([\s\S]*?)<\/v>/i)?.[1]
          || cellMatch[2].match(/<t[^>]*>([\s\S]*?)<\/t>/i)?.[1]
          || "";
        const decoded = type === "s" ? sharedStrings[Number(value)] || "" : decodeXml(value);
        cells.push(decoded);
      }
      if (cells.some(Boolean)) rows.push(cells.join("\t"));
    }
    const content = normalizeText(rows.join("\n"));
    if (content) blocks.push({ content, locator: { sheet: sheetName }, method: "xlsx-xml", generated: false });
  }
  if (!blocks.length) throw new Error("XLSX contained no extractable cells");
  return blocks;
}

async function commandText(command: string, args: string[]): Promise<string> {
  try {
    const result = await execFile(command, args, { maxBuffer: 32 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "command failed";
    throw new Error(`${command} unavailable or failed: ${message.slice(0, 240)}`);
  }
}

async function renderPdfPage(filePath: string, page: number): Promise<Buffer> {
  const directory = await fs.mkdtemp(join(tmpdir(), "ob1-pdf-"));
  const output = join(directory, "page");
  try {
    await commandText("pdftoppm", ["-f", String(page), "-l", String(page), "-png", "-singlefile", "-r", "144", filePath, output]);
    return await fs.readFile(`${output}.png`);
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractPdf(filePath: string, config: Ob1Config): Promise<ExtractedBlock[]> {
  const text = await commandText("pdftotext", ["-layout", filePath, "-"]);
  const pages = text.split("\f");
  if (pages.length > config.maxPdfPages + 1) {
    throw new Error(`PDF has more than the configured ${config.maxPdfPages} page limit`);
  }
  const blocks: ExtractedBlock[] = [];
  let visionPages = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = index + 1;
    const content = normalizeText(pages[index]);
    if (content) blocks.push({ content, locator: { page: pageNumber }, method: "pdftotext", generated: false });
    if (content.length < 80 && visionPages < config.maxVisionPages) {
      try {
        const image = await renderPdfPage(filePath, pageNumber);
        blocks.push({
          content: "",
          locator: { page: pageNumber, modality: "image" },
          method: "pdftoppm-vision",
          generated: true,
          image: { mimeType: "image/png", data: image },
        });
        visionPages += 1;
      } catch {
        // Text extraction remains useful when rendering tools are unavailable.
      }
    }
  }
  if (!blocks.length) throw new Error("PDF contained no extractable text or renderable pages");
  return blocks;
}

function assertSafeSvg(xml: string): void {
  if (/<\/?script\b|<!ENTITY\b|<!DOCTYPE\b|(?:xlink:href|href)\s*=\s*["'](?!data:|#)|(?:url\s*\(\s*["']?(?:https?:|\/\/|file:|ftp:))/i.test(xml)) {
    throw new Error("SVG contains unsafe script, entity, or external-reference content");
  }
}

async function rasterizeSvg(filePath: string): Promise<Buffer> {
  const directory = await fs.mkdtemp(join(tmpdir(), "ob1-svg-"));
  const output = join(directory, "image.png");
  try {
    await execFile("rsvg-convert", [
      "--format", "png",
      "--width", "2048",
      "--height", "2048",
      "--keep-aspect-ratio",
      "--output", output,
      filePath,
    ], { maxBuffer: 4 * 1024 * 1024 });
    return await fs.readFile(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : "rsvg-convert failed";
    throw new Error(`SVG rasterization unavailable or failed: ${message.slice(0, 240)}`);
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractSvg(buffer: Buffer, filePath: string): Promise<ExtractedBlock[]> {
  const xml = buffer.toString("utf8");
  assertSafeSvg(xml);
  const labels = [
    ...[...xml.matchAll(/<(?:title|desc)[^>]*>([\s\S]*?)<\/(?:title|desc)>/gi)].map((match) => decodeXml(match[1])),
    ...[...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi)].map((match) => decodeXml(match[1].replace(/<[^>]+>/g, " "))),
    ...[...xml.matchAll(/(?:aria-label|data-name|id)\s*=\s*["']([^"']+)["']/gi)].map((match) => decodeXml(match[1])),
  ];
  const content = normalizeText([...new Set(labels)].join("\n"));
  const blocks: ExtractedBlock[] = content
    ? [{ content, locator: { kind: "svg", modality: "text" }, method: "svg-xml", generated: false }]
    : [];
  try {
    blocks.push({
      content: "",
      locator: { kind: "svg", modality: "image" },
      method: "svg-raster",
      generated: true,
      image: { mimeType: "image/png", data: await rasterizeSvg(filePath) },
    });
  } catch (error) {
    if (!blocks.length) throw error;
  }
  if (!blocks.length) throw new Error("SVG contained no accessible text or renderable artwork");
  return blocks;
}

export async function extractFile(filePath: string, detected: DetectedFile, config: Ob1Config, originalName: string): Promise<ExtractedBlock[]> {
  switch (detected.kind) {
    case "pdf": return extractPdf(filePath, config);
    case "docx": return extractDocx(filePath);
    case "pptx": return extractPptx(filePath);
    case "xlsx": return extractXlsx(filePath);
    case "svg": return extractSvg(await fs.readFile(filePath), filePath);
    case "image":
      return [{
        content: "",
        locator: { kind: "image", filename: basename(originalName) },
        method: "vision",
        generated: true,
        image: { mimeType: detected.mimeType, data: await fs.readFile(filePath) },
      }];
    case "text": {
      const content = normalizeText(await fs.readFile(filePath, "utf8"));
      if (!content) throw new Error("Text file was empty");
      return [{ content, locator: { kind: "document" }, method: "text", generated: false }];
    }
  }
}

export interface TextChunk {
  content: string;
  index: number;
}

export function chunkText(text: string, maxChars: number, overlapChars: number): TextChunk[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [{ content: normalized, index: 0 }];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    const hardEnd = Math.min(normalized.length, start + maxChars);
    let end = hardEnd;
    if (hardEnd < normalized.length) {
      const boundary = normalized.lastIndexOf("\n\n", hardEnd);
      const sentence = normalized.lastIndexOf(". ", hardEnd);
      const candidate = Math.max(boundary, sentence);
      if (candidate > start + Math.floor(maxChars * 0.55)) end = candidate + (candidate === sentence ? 1 : 0);
    }
    const content = normalized.slice(start, end).trim();
    if (content) chunks.push({ content, index: chunks.length });
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlapChars);
  }
  return chunks;
}
