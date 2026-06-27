# Privacy Policy: Folderizer for NotebookLM

_Last updated: 2026-06-27_

Folderizer is designed to be private by default. It does not collect, sell, or
transmit your personal data to the developer or any third party.

## What the extension stores

- **Your folder structure** (folder names, nesting, colors, icons, and which
  notebooks belong to which folder) is saved in your browser via
  `chrome.storage.local`. It stays on your device.
- **Optional cross-device sync:** if you turn it on, the same folder structure is
  mirrored through `chrome.storage.sync`, which Google syncs across your own
  signed-in Chrome profile. This is off by default and uses your own Google sync, not
  any server operated by us.

## What the extension reads

- On `notebooklm.google.com`, the extension reads the page to list your notebooks
  (titles and ids) so it can show them in the folder sidebar. This information is
  used only to render the sidebar in your browser and is not sent anywhere.

## Permissions and why they are needed

- `storage`: save your folders locally (and optionally to your Chrome sync).
- Host access to `https://notebooklm.google.com/*`: run the folder sidebar on
  NotebookLM and read your notebook list to display it.
- Host access to `http://localhost:3000/*`: connect to the **optional**, user-run
  local companion server. This is only used if you choose to run that server on your
  own computer; nothing is sent to the internet.

## The optional companion server

The companion server is a separate, optional component that you run yourself on
`localhost`. It communicates only between your browser and your own machine. It does
not send your data to the developer or any external service.

## Data we receive

None. The developer does not receive analytics, telemetry, or any user content.

## Contact

Questions about this policy: nicholas.chadwick.ctr@gmail.com
