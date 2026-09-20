import assert from "node:assert/strict";
import { test } from "node:test";

import { compactFingerprint, vectorLiteral } from "../src/db.js";

test("vector serialization enforces the immutable dimension contract", () => {
  assert.equal(vectorLiteral([0.1, 0.2], 2), "[0.1,0.2]");
  assert.throws(() => vectorLiteral([0.1], 2), /dimension mismatch/i);
  assert.throws(() => vectorLiteral([Number.NaN], 1), /non-finite/i);
});

test("fingerprints normalize whitespace and punctuation", () => {
  assert.equal(compactFingerprint("  Hello,   OB1! "), compactFingerprint("hello ob1"));
});
