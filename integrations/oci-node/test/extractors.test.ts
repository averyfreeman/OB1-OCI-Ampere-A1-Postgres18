import assert from "node:assert/strict";
import { test } from "node:test";

import { chunkText, detectFile } from "../src/extractors.js";

test("detects common binary and text file types by content", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const detectedPng = await detectFile("scan.png", png);
  assert.equal(detectedPng.kind, "image");
  assert.equal(detectedPng.mimeType, "image/png");

  const markdown = await detectFile("notes.md", Buffer.from("# OB1\n\nA durable thought."));
  assert.equal(markdown.kind, "text");
  assert.equal(markdown.mimeType, "text/markdown");
});

test("accepts text-bearing SVG but rejects unsafe external content", async () => {
  const svg = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"><title>OB1 diagram</title><text>Brain</text></svg>");
  const detected = await detectFile("diagram.svg", svg);
  assert.equal(detected.kind, "svg");
  await assert.rejects(() => detectFile("bad.svg", Buffer.from("<svg><script>alert(1)</script></svg>")), /Unsupported|unsafe/i);
});

test("chunks long content with overlap and stable indexes", () => {
  const chunks = chunkText("alpha. ".repeat(120), 140, 20);
  assert.ok(chunks.length > 3);
  assert.deepEqual(chunks.map((chunk) => chunk.index), chunks.map((_, index) => index));
  assert.ok(chunks.every((chunk) => chunk.content.length <= 140));
});
