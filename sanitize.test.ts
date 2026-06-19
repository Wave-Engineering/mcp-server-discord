import { describe, test, expect } from "bun:test";
import { sanitizeSurrogates } from "./sanitize.ts";

const FFFD = "�";

describe("sanitizeSurrogates", () => {
  test("passes through plain ASCII unchanged", () => {
    expect(sanitizeSurrogates("hello world")).toBe("hello world");
  });

  test("preserves a valid surrogate pair (emoji)", () => {
    const fish = "🐟"; // 🐟 U+1F41F
    expect(sanitizeSurrogates(`a ${fish} b`)).toBe(`a ${fish} b`);
  });

  test("replaces a lone high surrogate with U+FFFD", () => {
    expect(sanitizeSurrogates("a\uD800b")).toBe(`a${FFFD}b`);
  });

  test("replaces a lone low surrogate with U+FFFD", () => {
    expect(sanitizeSurrogates("a\uDC00b")).toBe(`a${FFFD}b`);
  });

  test("lone high surrogate at end of string", () => {
    expect(sanitizeSurrogates("end\uD83D")).toBe(`end${FFFD}`);
  });

  test("high surrogate followed by a non-low char is replaced; the char survives", () => {
    expect(sanitizeSurrogates("\uD800x")).toBe(`${FFFD}x`);
  });

  test("two high surrogates in a row: first is lone, second pairs or is lone", () => {
    // \uD800\uD800 — neither forms a pair; both replaced
    expect(sanitizeSurrogates("\uD800\uD800")).toBe(`${FFFD}${FFFD}`);
  });

  test("mixed valid pair and lone surrogate", () => {
    const fish = "🐟";
    expect(sanitizeSurrogates(`${fish}\uD800${fish}`)).toBe(`${fish}${FFFD}${fish}`);
  });

  test("empty string", () => {
    expect(sanitizeSurrogates("")).toBe("");
  });

  test("output is JSON-serializable (the whole point)", () => {
    // A lone surrogate is not valid in JSON; after sanitization it must serialize.
    const poisoned = "payload \uD800 here";
    expect(() => JSON.stringify({ content: sanitizeSurrogates(poisoned) })).not.toThrow();
  });
});
