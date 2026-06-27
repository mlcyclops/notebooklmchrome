# ADR-0018: Fix the relay so async content-script replies are not dropped

**Status:** Accepted
**Date:** 2026-06-27

## Context

Live testing of the installed app surfaced a latent bug: with the extension fully
connected (`connectedClients: 1`), `GET /api/notebooks` and the live folders always
returned "NotebookLM tab is loading. Please refresh the page and try again.", even
with a loaded, logged-in NotebookLM tab.

Root cause is a race in `background.js`. The content script answers relayed requests
**asynchronously**: its `chrome.runtime.onMessage` listener returns `false` and sends
the real result later via a separate `chrome.runtime.sendMessage`. But the relay used
`chrome.tabs.sendMessage(tabId, message, callback)` with a response callback. Because
the listener returns `false`, Chrome closes that message channel with
`chrome.runtime.lastError = "The message port closed before a response was received."`
The callback treated **any** `lastError` as a fatal "tab is loading" error and
immediately sent it to the server, which resolved (and deleted) the pending request
**before** the real reply arrived. The genuine data was then dropped as "no pending
request". So the server-driven notebook/folder/generate features never worked over
the relay, regardless of setup.

## Decision

In `background.js`, distinguish the expected async-reply ack from a genuine missing
receiver:

- Ignore `lastError` messages matching "The message port closed before a response was
  received" (the normal consequence of the content script replying asynchronously).
  The real reply arrives on the separate `runtime.sendMessage` channel and resolves
  the request.
- Only emit the "tab is loading" error when `lastError` indicates there is no content
  script at all ("Receiving end does not exist" / "Could not establish connection").
- Also target a **loaded** NotebookLM tab (`status === 'complete'`) before falling
  back, so a still-loading tab is not picked when a ready one exists.

## Consequences

- **Positive:** Server- and Atlas-driven `list_notebooks`, `list_folders`, and
  `generate_product` now return real data live (verified: 175 notebooks, 7 folders).
  The helpful "open/refresh NotebookLM" error still appears when there truly is no
  content script.
- **Positive:** Covered by `tests/relay.test.js`, which loads the real `background.js`
  in a vm and asserts the three ack cases, so the regression cannot return silently.
- **Negative:** The detection relies on Chrome's `lastError` message text, which is
  stable but not a formal contract; if Chrome reworded it, the match would need an
  update (the test would catch the behavioral change).
- **Neutral:** No change to the server API or the content-script reply protocol; this
  only fixes how the background worker interprets the send acknowledgement.

## Alternatives Considered

- **Have the content script call `sendResponse` synchronously / return `true`.** Would
  also work, but it couples the reply to the tabs.sendMessage channel and duplicates
  the existing `runtime.sendMessage` path the server already consumes; the minimal,
  lower-risk fix is to interpret the ack correctly.
- **Drop the callback entirely.** Then a genuinely missing content script would go
  unreported (no helpful error). Keeping the callback but filtering the message
  preserves that UX.

## Supersedes / Superseded by

- Supersedes: none. Fixes the relay introduced with the companion server and used by
  [ADR-0017](0017-desktop-connectivity-live-folders.md).
- Superseded by: —
