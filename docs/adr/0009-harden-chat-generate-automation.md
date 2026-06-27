# ADR-0009: Harden the experimental chat/generate automation against UI changes

**Status:** Accepted
**Date:** 2026-06-26

## Context

The optional companion server drives two NotebookLM features through the content
script: streaming **chat** (`handleChatRequest`) and Studio **product generation**
(`handleGenerateProduct`). Both work by reaching into NotebookLM's live,
obfuscated, framework-generated DOM — there is no public API and no stable markup
contract. The original implementations encoded this fragility directly into the
control flow:

- Selectors were **scattered inline** across the two handlers (chat input, send
  button, response bubble, Guide button, format/Studio buttons), so a single
  Google UI change meant hunting through procedural code in several places.
- Waiting was done with **fixed `setTimeout` delays and fixed-count polling loops**
  (`while (attempts < 10) … setTimeout(1000)`; a 100ms `setInterval` counting 25
  "stale ticks"). Fixed delays are simultaneously too slow (wasted seconds on a
  fast page) and too fragile (a slow page silently misses the element).
- Failures `throw`, relying on a surrounding try/catch. The messages
  ("Could not find chat input") did not tell a maintainer *what to do*.

NotebookLM's UI changes without notice. We want these features to **break less
often and be repairable in one place**, while being honest that they are
experimental/best-effort: live correctness ultimately depends on Google's markup
and can never be guaranteed from inside the page.

## Decision

We will refactor the chat/generate automation path around four resilience
primitives, keeping the features explicitly experimental but far more maintainable:

1. **Centralized selector config.** A single `AUTOMATION_SELECTORS` object near the
   automation section maps each logical target (`chatInput`, `sendButton`,
   `chatResponse`, `guideButton`, `formatButton`) to an **ordered array of
   candidate strategies**. A strategy is either a CSS selector string or a
   `{ text: '...' }` / `{ buttonText: '...' }` descriptor handled by the existing
   `findElementByText` / `findButtonByText` helpers. When Google changes the UI,
   maintenance is editing one list.

2. **Prioritized multi-strategy resolution.** A `resolveElement(targetKey, root)`
   helper walks the strategies in order — stable attribute/role/aria-label
   selectors first, then text/aria matching, then looser structural fallbacks —
   and returns the first hit (or `null`). It reuses `safeQuery`,
   `findElementByText`, and `findButtonByText` so invalid selectors never throw.

3. **MutationObserver-based waiting.** `waitForElement(predicateOrTargetKey,
   { timeout })` resolves as soon as a target appears, using an immediate
   synchronous check, then a `MutationObserver` on the subtree, plus a timeout —
   replacing fixed-count polling. `waitForStableText(el, { quietMs, timeout })`
   observes a streaming response and resolves with the final text once it has been
   unchanged for `quietMs` (or on timeout), replacing the arbitrary "25 stale
   ticks" heuristic with an adaptive quiet-period detector.

4. **Graceful, non-throwing failure.** Every unresolved target returns a clear
   error object to the caller and logs a calm, actionable warning naming the fix
   (e.g. "Send button not found — NotebookLM UI may have changed; update
   AUTOMATION_SELECTORS in content.js"). No exception reaches the page, and the
   existing message shapes the background/server expect (`chat_chunk` with
   `text`/`done`, `chat_error` with `error`, and `response` with `data.error` or
   `data.success`/`data.content`) are preserved verbatim.

## Consequences

- **Positive:** One place to update when the DOM changes; each target degrades
  through ordered fallbacks instead of an all-or-nothing selector; waiting adapts
  to page speed (faster on a quick page, more patient on a slow one) and stream
  completion is detected by quiescence rather than a guess; failures are calm,
  actionable, and never crash the page.
- **Negative:** More moving parts than the inline version, and the selector config
  still has to be hand-maintained — this reduces breakage frequency, it does not
  eliminate it.
- **Neutral:** The features remain **experimental / best-effort**. Live correctness
  against the real NotebookLM DOM cannot be verified headlessly and is not
  guaranteed; this ADR is about resilience and maintainability, not a reliability
  promise. The companion server's request/response contract is unchanged.

## Alternatives Considered

- **Record/replay (e.g. captured Playwright traces):** brittle in the same way as
  hard-coded selectors, adds heavy tooling/deps, and can't run inside the page's
  content-script context. Rejected.
- **Official NotebookLM API:** none exists. Rejected (unavailable).
- **Pin to NotebookLM's internal `batchexecute` RPCs for chat/generate:** the
  listing path already does this (ADR-0008) and it is itself brittle (undocumented
  rpcids, WIZ tokens, args that change). Chat streaming and Studio generation have
  no stable documented RPC we can rely on; driving the rendered DOM with ordered
  fallbacks is the more repairable choice for these two features. Rejected for now.

## Supersedes / Superseded by

- Supersedes: none.
- Superseded by: none.
