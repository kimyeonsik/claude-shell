// ── Token Estimation (Claude BPE approximation) ──
//
// Character-type weighted estimation for mixed-language text.
// Measured against Claude tokenizer:
//   - English/ASCII: ~4 chars = 1 token
//   - Korean (Hangul): ~1 char = 1.5 tokens
//   - CJK Ideographs: ~1 char = 1.5 tokens
//   - Japanese Kana: ~1 char = 1.2 tokens
//   - Code punctuation: ~1 char = 0.5 tokens
//   - Whitespace: ~4 chars = 1 token

// Unicode range checks (inlined for performance)
function isHangul(c: number): boolean {
  return (
    (c >= 0xac00 && c <= 0xd7af) || // Hangul syllables (가-힣)
    (c >= 0x3131 && c <= 0x3163) || // Hangul compatibility jamo (ㄱ-ㅣ)
    (c >= 0x1100 && c <= 0x11ff)    // Hangul jamo
  );
}

function isCJK(c: number): boolean {
  return (
    (c >= 0x4e00 && c <= 0x9fff) || // CJK Unified Ideographs
    (c >= 0x3400 && c <= 0x4dbf) || // CJK Extension A
    (c >= 0xf900 && c <= 0xfaff)    // CJK Compatibility Ideographs
  );
}

function isKana(c: number): boolean {
  return (c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff);
}

function isAsciiAlnum(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) || // 0-9
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x61 && c <= 0x7a)    // a-z
  );
}

function isWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
}

const CODE_PUNCT = new Set([
  0x7b, 0x7d, // { }
  0x5b, 0x5d, // [ ]
  0x28, 0x29, // ( )
  0x3b,       // ;
  0x3a,       // :
  0x3d,       // =
  0x3c, 0x3e, // < >
  0x2f,       // /
  0x2a,       // *
  0x2b,       // +
  0x2d,       // -
  0x26,       // &
  0x7c,       // |
  0x21,       // !
  0x3f,       // ?
  0x2e,       // .
  0x2c,       // ,
  0x27,       // '
  0x22,       // "
  0x60,       // `
  0x40,       // @
  0x23,       // #
  0x25,       // %
  0x5e,       // ^
  0x7e,       // ~
  0x5c,       // \
]);

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;

  let tokens = 0;
  let asciiRun = 0;   // consecutive ASCII alphanumeric chars
  let wsRun = 0;      // consecutive whitespace chars

  // Flush accumulated ASCII/whitespace runs into token count
  const flushRuns = (): void => {
    if (asciiRun > 0) { tokens += asciiRun / 4; asciiRun = 0; }
    if (wsRun > 0) { tokens += wsRun / 4; wsRun = 0; }
  };

  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i)!;

    // Supplementary plane char (emoji, CJK Extension B, etc.)
    // codePointAt consumed both surrogates; advance index past the pair
    if (c > 0xffff) {
      i++;
      flushRuns();
      tokens += 1.5;
      continue;
    }

    if (isHangul(c)) {
      flushRuns();
      tokens += 1.5;
    } else if (isCJK(c)) {
      flushRuns();
      tokens += 1.5;
    } else if (isKana(c)) {
      flushRuns();
      tokens += 1.2;
    } else if (isAsciiAlnum(c)) {
      if (wsRun > 0) { tokens += wsRun / 4; wsRun = 0; }
      asciiRun++;
    } else if (isWhitespace(c)) {
      if (asciiRun > 0) { tokens += asciiRun / 4; asciiRun = 0; }
      wsRun++;
    } else if (CODE_PUNCT.has(c)) {
      flushRuns();
      tokens += 0.5;
    } else {
      // Other BMP characters (symbols, etc.)
      flushRuns();
      tokens += 1.5;
    }
  }

  // Flush remaining runs
  flushRuns();

  return Math.ceil(tokens);
}
