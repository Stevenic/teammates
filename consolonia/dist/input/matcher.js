/**
 * Base matcher interface for the input processing pipeline.
 * Inspired by Consolonia's InputProcessor matcher chain.
 */
/** Result of feeding a character to a matcher. */
export var MatchResult;
(function (MatchResult) {
    /** This character is not part of a sequence this matcher handles. */
    MatchResult[MatchResult["NoMatch"] = 0] = "NoMatch";
    /** This character continues a partial sequence; more input needed. */
    MatchResult[MatchResult["Partial"] = 1] = "Partial";
    /** This character completes a recognized sequence; call flush(). */
    MatchResult[MatchResult["Complete"] = 2] = "Complete";
})(MatchResult || (MatchResult = {}));
