/**
 * Represents a single cell's character content.
 */
/**
 * Determine the display width of a single character.
 * Returns 2 for wide characters (CJK, fullwidth forms), 1 otherwise.
 */
export function charWidth(codePoint) {
    // CJK Unified Ideographs
    if (codePoint >= 0x4E00 && codePoint <= 0x9FFF)
        return 2;
    // CJK Unified Ideographs Extension A
    if (codePoint >= 0x3400 && codePoint <= 0x4DBF)
        return 2;
    // CJK Unified Ideographs Extension B
    if (codePoint >= 0x20000 && codePoint <= 0x2A6DF)
        return 2;
    // CJK Compatibility Ideographs
    if (codePoint >= 0xF900 && codePoint <= 0xFAFF)
        return 2;
    // Fullwidth Forms (excluding halfwidth range)
    if (codePoint >= 0xFF01 && codePoint <= 0xFF60)
        return 2;
    // Fullwidth Forms (extra)
    if (codePoint >= 0xFFE0 && codePoint <= 0xFFE6)
        return 2;
    // CJK Radicals Supplement
    if (codePoint >= 0x2E80 && codePoint <= 0x2EFF)
        return 2;
    // Kangxi Radicals
    if (codePoint >= 0x2F00 && codePoint <= 0x2FDF)
        return 2;
    // CJK Symbols and Punctuation
    if (codePoint >= 0x3000 && codePoint <= 0x303F)
        return 2;
    // Hiragana
    if (codePoint >= 0x3040 && codePoint <= 0x309F)
        return 2;
    // Katakana
    if (codePoint >= 0x30A0 && codePoint <= 0x30FF)
        return 2;
    // Bopomofo
    if (codePoint >= 0x3100 && codePoint <= 0x312F)
        return 2;
    // Hangul Compatibility Jamo
    if (codePoint >= 0x3130 && codePoint <= 0x318F)
        return 2;
    // Kanbun
    if (codePoint >= 0x3190 && codePoint <= 0x319F)
        return 2;
    // Bopomofo Extended
    if (codePoint >= 0x31A0 && codePoint <= 0x31BF)
        return 2;
    // CJK Strokes
    if (codePoint >= 0x31C0 && codePoint <= 0x31EF)
        return 2;
    // Katakana Phonetic Extensions
    if (codePoint >= 0x31F0 && codePoint <= 0x31FF)
        return 2;
    // Enclosed CJK Letters and Months
    if (codePoint >= 0x3200 && codePoint <= 0x32FF)
        return 2;
    // CJK Compatibility
    if (codePoint >= 0x3300 && codePoint <= 0x33FF)
        return 2;
    // Hangul Syllables
    if (codePoint >= 0xAC00 && codePoint <= 0xD7AF)
        return 2;
    // CJK Compatibility Ideographs Supplement
    if (codePoint >= 0x2F800 && codePoint <= 0x2FA1F)
        return 2;
    return 1;
}
/**
 * Create a Symbol from a text string.
 * Width is auto-detected from the first code point.
 */
export function sym(text, pattern = 0) {
    const cp = text.codePointAt(0) ?? 0;
    return {
        text,
        width: pattern !== 0 ? 1 : charWidth(cp),
        pattern,
    };
}
/** An empty symbol (space character). */
export const EMPTY_SYMBOL = { text: " ", width: 1, pattern: 0 };
