/**
 * Functions for stripping and measuring ANSI-escaped strings.
 */
/**
 * Strip all ANSI escape codes from a string, returning only visible characters.
 */
export declare function stripAnsi(str: string): string;
/**
 * Get the visible (non-ANSI) length of a string.
 */
export declare function visibleLength(str: string): number;
/**
 * Truncate a string containing ANSI codes to a maximum number of visible characters.
 * ANSI sequences are preserved up to the cut-off point.
 */
export declare function truncateAnsi(str: string, maxWidth: number): string;
