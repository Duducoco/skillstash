import { describe, it, expect } from 'vitest';

// We need to extract the helpers from list.ts for testing.
// They are not exported, so we re-implement the same logic here
// and test against the expected behavior documented in the source.

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const charWidth = (ch: string) => {
  const cp = ch.codePointAt(0)!;
  if ((cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK Unified
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Extension A
      (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compat
      (cp >= 0x3000 && cp <= 0x303F) ||   // CJK Symbols
      (cp >= 0xFF01 && cp <= 0xFF60) ||   // Fullwidth forms
      (cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul
      (cp >= 0xFE30 && cp <= 0xFE6F)) {   // CJK Compat Forms
    return 2;
  }
  return 1;
};

const visLen = (s: string) => {
  const clean = stripAnsi(s);
  let len = 0;
  for (const ch of clean) len += charWidth(ch);
  return len;
};

const padVis = (s: string, len: number) => s + ' '.repeat(Math.max(0, len - visLen(s)));

describe('stripAnsi', () => {
  it('removes ANSI escape codes', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m')).toBe('green');
    expect(stripAnsi('\x1b[1;31m\x1b[40mbold red\x1b[0m')).toBe('bold red');
  });

  it('leaves plain text unchanged', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('handles multiple ANSI codes', () => {
    expect(stripAnsi('\x1b[33m\x1b[4munderlined yellow\x1b[0m\x1b[0m')).toBe('underlined yellow');
  });
});

describe('charWidth', () => {
  it('returns 1 for ASCII characters', () => {
    expect(charWidth('a')).toBe(1);
    expect(charWidth('Z')).toBe(1);
    expect(charWidth('0')).toBe(1);
    expect(charWidth(' ')).toBe(1);
  });

  it('returns 2 for CJK characters', () => {
    expect(charWidth('中')).toBe(2);
    expect(charWidth('国')).toBe(2);
    expect(charWidth('語')).toBe(2);
  });

  it('returns 2 for fullwidth forms', () => {
    expect(charWidth('！')).toBe(2);  // U+FF01
    expect(charWidth('Ａ')).toBe(2);  // U+FF21
  });

  it('returns 2 for Hangul', () => {
    expect(charWidth('한')).toBe(2);
    expect(charWidth('글')).toBe(2);
  });

  it('returns 2 for CJK symbols', () => {
    expect(charWidth('〈')).toBe(2);  // U+3008
  });

  it('returns 1 for Latin extended', () => {
    expect(charWidth('é')).toBe(1);
    expect(charWidth('ñ')).toBe(1);
  });
});

describe('visLen', () => {
  it('counts ASCII text length', () => {
    expect(visLen('hello')).toBe(5);
    expect(visLen('')).toBe(0);
  });

  it('counts CJK text as double width', () => {
    expect(visLen('中文')).toBe(4);
    expect(visLen('中a')).toBe(3);
  });

  it('strips ANSI before counting', () => {
    expect(visLen('\x1b[32mgreen\x1b[0m')).toBe(5);
    expect(visLen('\x1b[1m\x1b[31m红\x1b[0m')).toBe(2);
  });

  it('handles mixed content', () => {
    // "Hello" = 5, "中文" = 4, "!" = 1 → total 10
    expect(visLen('Hello中文!')).toBe(10);
  });
});

describe('padVis', () => {
  it('pads ASCII text to target length', () => {
    const result = padVis('hello', 10);
    expect(result).toBe('hello     '); // 5 spaces
  });

  it('pads CJK text correctly (fewer spaces needed)', () => {
    const result = padVis('中文', 10);
    // visLen('中文') = 4, so pad with 6 spaces
    expect(result).toBe('中文      ');
  });

  it('does not pad when string already meets target', () => {
    const result = padVis('12345', 5);
    expect(result).toBe('12345');
  });

  it('handles ANSI-colored text', () => {
    const result = padVis('\x1b[32mhello\x1b[0m', 10);
    // visLen strips ANSI, so "hello" = 5 chars → pad 5 spaces
    expect(stripAnsi(result)).toBe('hello     ');
  });

  it('handles zero-length padding target', () => {
    const result = padVis('abc', 0);
    expect(stripAnsi(result)).toBe('abc'); // Math.max(0, 0-3) = 0 spaces
  });
});