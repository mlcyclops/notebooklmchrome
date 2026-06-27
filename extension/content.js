// NotebookLM Folderizer & Connector Content Script

let folderData = { folders: [] };
let notebooksList = [];
// Detection lifecycle for the notebook list, so the UI can tell a *verified
// empty* account apart from a *failed/loading* fetch (ADR-0008).
//   'idle'    — no fetch attempted yet
//   'loading' — a fetch is in flight
//   'ok'      — detection succeeded (notebooksList is trustworthy, may be empty)
//   'error'   — detection failed; the list is unknown, not known-empty
let notebooksStatus = 'idle';
let isConnected = false;
// Transient, in-memory search/filter query (ADR-0005). Lowercased substring;
// never persisted. Empty string => normal full render.
let searchQuery = '';

// Folder ids the user has collapsed (accordion). Kept in memory only — this is
// transient view state, so it deliberately does NOT touch the stored folder
// data model / storage contract (ADR-0002/0003/0008). Survives re-renders
// within a session; resets on reload, which is expected for a view toggle.
const collapsedFolders = new Set();

// Rolling request id for batchexecute calls. Google increments `_reqid` by a
// fixed step per request within a session; the exact value is not validated, it
// just needs to be present and changing.
let rpcReqId = Math.floor(1e5 + Math.random() * 9e5);

const STORAGE_KEY = 'nlm_folders';

// Opt-in cross-device sync (ADR-0006). When enabled, folder writes are mirrored
// into chrome.storage.sync (which Chrome replicates across the user's signed-in
// devices) and remote edits flow back via a storage.onChanged listener.
// chrome.storage.local remains the always-present render source; this flag,
// persisted in chrome.storage.local, defaults OFF so existing behavior is
// unchanged until the user opts in.
const SYNC_ENABLED_KEY = 'nlm_sync_enabled';

// In-memory mirror of the sync-enabled setting so synchronous code paths
// (writes, onChanged guard) can consult it without an async storage round-trip.
// Hydrated once at init from chrome.storage.local and kept current on toggle.
let syncEnabled = false;

// Curated, dependency-free presets for folder customization (ADR-0003).
// These are allow-lists: any color/icon placed into markup or an inline style
// MUST be one of these values. Anything else falls back to the defaults below,
// which closes the CSS/HTML injection vector by construction.
const FOLDER_COLOR_PRESETS = [
  '#a78bfa', // violet (default accent)
  '#f87171', // red
  '#fb923c', // orange
  '#fbbf24', // amber
  '#34d399', // green
  '#22d3ee', // cyan
  '#60a5fa', // blue
  '#f472b6'  // pink
];
const FOLDER_ICON_PRESETS = [
  '📁', '📂', '⭐', '📌', '🔖', '💡',
  '🚀', '📚', '🧠', '🎯', '🔬', '💼'
];
const DEFAULT_FOLDER_COLOR = FOLDER_COLOR_PRESETS[0];
const DEFAULT_FOLDER_ICON = FOLDER_ICON_PRESETS[0];

// Validate a stored/loaded color against the preset allow-list. Returns the
// value only if it is an exact match; otherwise returns the safe default.
function sanitizeFolderColor(color) {
  return FOLDER_COLOR_PRESETS.includes(color) ? color : DEFAULT_FOLDER_COLOR;
}

// Validate a stored/loaded icon against the curated emoji set. Returns the
// value only if it is an exact match; otherwise returns the safe default.
function sanitizeFolderIcon(icon) {
  return FOLDER_ICON_PRESETS.includes(icon) ? icon : DEFAULT_FOLDER_ICON;
}

// -------------------------------------------------------------
// GENERIC HELPERS
// -------------------------------------------------------------

// Escape a string for safe interpolation into innerHTML. Prevents folder
// names / notebook titles like `<img onerror=...>` from injecting markup.
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Real text-matching helper to replace the invalid `:contains()` pseudo-selector.
// Queries `selector` (default 'button') and returns the first element whose
// textContent / innerText / aria-label contains `text` (case-insensitive).
function findElementByText(selector, text) {
  if (!text) return null;
  const needle = String(text).toLowerCase();
  const nodes = document.querySelectorAll(selector || '*');
  for (const el of nodes) {
    const content = (el.innerText || el.textContent || '').toLowerCase();
    const aria = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
    if (content.includes(needle) || aria.includes(needle)) {
      return el;
    }
  }
  return null;
}

// Convenience wrapper: find a <button> (or button-role element) by its text.
function findButtonByText(text) {
  return findElementByText('button, [role="button"]', text);
}

// Safe single-element query: logs a clear warning and returns null instead of
// letting a missing node turn into a downstream TypeError.
function safeQuery(selector, root) {
  try {
    const el = (root || document).querySelector(selector);
    if (!el) {
      console.warn(`NotebookLM Folderizer: no element matched selector "${selector}"`);
    }
    return el;
  } catch (err) {
    console.warn(`NotebookLM Folderizer: invalid selector "${selector}":`, err.message);
    return null;
  }
}

// -------------------------------------------------------------
// SEARCH / FILTER HELPERS (ADR-0005)
// -------------------------------------------------------------

// Does a single notebook title contain the (already lowercased) query?
function notebookMatchesQuery(nb, q) {
  if (!q) return true;
  return String((nb && nb.title) || '').toLowerCase().includes(q);
}

// Pure recursive predicate: should this folder node be visible under query `q`?
// True if the folder's own name matches, OR any notebook assigned to it matches,
// OR any descendant folder matches. Recurses through the same parentId /
// notebookIds assignment logic the normal render uses. Never mutates anything.
function nodeMatchesQuery(node, q, allFolders, notebooks) {
  if (!q) return true;
  const name = String((node && node.name) || '').toLowerCase();
  if (name.includes(q)) return true;

  const assignedIds = (node && node.notebookIds) || [];
  for (const nb of notebooks) {
    if (assignedIds.includes(nb.id) && notebookMatchesQuery(nb, q)) return true;
  }

  const children = allFolders.filter(f => f.parentId === node.id);
  for (const child of children) {
    if (nodeMatchesQuery(child, q, allFolders, notebooks)) return true;
  }
  return false;
}

// Injection-safe highlight: escape FIRST, then wrap matches of the query in the
// already escaped string. User text is never placed into innerHTML raw. Returns
// an HTML string safe to interpolate. `q` is the lowercased query.
function highlightMatch(text, q) {
  const escaped = escapeHtml(text);
  if (!q) return escaped;
  // Search the escaped string case-insensitively. Because escaping only maps to
  // entity sequences that contain none of the characters in a typical typed
  // query except for the leading chars of an entity, matching on the escaped
  // string is safe and keeps offsets valid for the output we emit.
  const haystack = escaped.toLowerCase();
  const needle = q.toLowerCase();
  if (!needle) return escaped;
  let out = '';
  let from = 0;
  let idx = haystack.indexOf(needle, from);
  while (idx !== -1) {
    out += escaped.slice(from, idx);
    out += '<mark class="nlm-search-hl">' + escaped.slice(idx, idx + needle.length) + '</mark>';
    from = idx + needle.length;
    idx = haystack.indexOf(needle, from);
  }
  out += escaped.slice(from);
  return out;
}

// Initialize when page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  console.log('NotebookLM Folderizer Content Script Initialized');
  
  // Hydrate the opt-in sync flag (ADR-0006) BEFORE injecting the sidebar so the
  // toggle renders in the right state, then register the cross-device listener.
  readSyncEnabled().then((enabled) => {
    syncEnabled = enabled;
    updateSyncToggleUI();
  });
  registerSyncListener();

  // Inject sidebar DOM
  injectSidebar();

  // Connect check loop (updates connection status indicator)
  setInterval(checkServerStatus, 5000);
  checkServerStatus();

  // Load custom folder structure
  loadFolders();

  // Listen for messages from background script (from companion server)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script received command:', message.type);

    if (message.type === 'list_notebooks') {
      // Single response path: background only relays runtime.sendMessage packets
      // back to the companion server, so respond exclusively through that channel.
      fetchNotebooksList().then(notebooks => {
        chrome.runtime.sendMessage({
          id: message.id,
          type: 'response',
          data: notebooks
        });
      }).catch(err => {
        chrome.runtime.sendMessage({
          id: message.id,
          type: 'response',
          data: { error: err.message }
        });
      });
      return false; // No synchronous sendResponse; reply travels via sendMessage
    }

    else if (message.type === 'list_folders') {
      // Expose the user's real folder structure (chrome.storage.local) to the
      // companion server so Atlas shows the folders that actually exist, instead
      // of the server-side folders.json. Reply via the same sendMessage channel.
      readFoldersFromStorage().then(folders => {
        chrome.runtime.sendMessage({
          id: message.id,
          type: 'response',
          data: { folders: Array.isArray(folders) ? folders : [] }
        });
      }).catch(err => {
        chrome.runtime.sendMessage({
          id: message.id,
          type: 'response',
          data: { error: err.message }
        });
      });
      return false;
    }

    else if (message.type === 'chat_request') {
      handleChatRequest(message.id, message.data);
    } 
    
    else if (message.type === 'generate_product') {
      handleGenerateProduct(message.id, message.data);
    }
  });
}

// -------------------------------------------------------------
// UI / DOM INJECTION
// -------------------------------------------------------------
function injectSidebar() {
  if (document.getElementById('nlm-sidebar')) return;

  // Create Sidebar
  const sidebar = document.createElement('div');
  sidebar.id = 'nlm-sidebar';
  sidebar.innerHTML = `
    <div class="nlm-header">
      <div class="nlm-title-row">
        <h2 class="nlm-title">Notebook Folders</h2>
      </div>
      <button class="nlm-btn-add" id="nlm-btn-add-folder">
        <span>➕</span> New Root Folder
      </button>
      <div class="nlm-header-actions">
        <button class="nlm-btn-secondary" id="nlm-btn-export-folders" title="Download your folder structure as a JSON file">
          <span>⬇️</span> Export
        </button>
        <button class="nlm-btn-secondary" id="nlm-btn-import-folders" title="Replace your folders from a JSON file">
          <span>⬆️</span> Import
        </button>
      </div>
      <input type="file" id="nlm-import-file-input" accept="application/json,.json" hidden />
      <div class="nlm-import-status" id="nlm-import-status" hidden></div>
      <label class="nlm-sync-toggle" id="nlm-sync-toggle" title="Sync your folders across devices via Chrome (opt-in)">
        <input type="checkbox" id="nlm-sync-checkbox" />
        <span class="nlm-sync-track"><span class="nlm-sync-thumb"></span></span>
        <span class="nlm-sync-label">Sync across devices</span>
      </label>
      <div class="nlm-sync-status" id="nlm-sync-status-line" hidden></div>
      <div class="nlm-search-row">
        <span class="nlm-search-icon">🔍</span>
        <input type="search" id="nlm-search-input" class="nlm-search-input" placeholder="Search folders & notebooks" autocomplete="off" spellcheck="false" />
        <button class="nlm-search-clear" id="nlm-search-clear" type="button" title="Clear search" hidden>×</button>
      </div>
    </div>
    <div class="nlm-body" id="nlm-sidebar-body">
      <div class="nlm-section">
        <div class="nlm-section-title">Folders</div>
        <div id="nlm-folders-tree"></div>
      </div>
      <div class="nlm-section">
        <div class="nlm-section-title">Unorganized Notebooks</div>
        <div id="nlm-unorganized-list"></div>
      </div>
    </div>
  `;
  document.body.appendChild(sidebar);

  // Create Toggle Tab
  const toggle = document.createElement('div');
  toggle.id = 'nlm-sidebar-toggle';
  toggle.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
    <span>Folders</span>
  `;
  document.body.appendChild(toggle);

  // Toggle Action
  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    toggle.classList.toggle('open');
    
    // Refresh notebook list on open
    if (sidebar.classList.contains('open')) {
      refreshData();
    }
  });

  // Root Folder Add Button
  document.getElementById('nlm-btn-add-folder').addEventListener('click', () => {
    const name = prompt('Enter root folder name:');
    if (name && name.trim()) {
      addFolder(name.trim(), null);
    }
  });

  // Export folders to a downloadable JSON file.
  document.getElementById('nlm-btn-export-folders').addEventListener('click', () => {
    exportFolders();
  });

  // Import folders: the visible button proxies a click to the hidden file input.
  const importInput = document.getElementById('nlm-import-file-input');
  document.getElementById('nlm-btn-import-folders').addEventListener('click', () => {
    setImportStatus('', false);
    importInput.value = ''; // allow re-importing the same filename
    importInput.click();
  });
  importInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importFolders(file);
  });

  // Search / filter (ADR-0005): debounced, client-side, in-memory. Typing only
  // changes what is rendered from the existing folderData + notebooksList; it
  // never mutates or persists data, and clearing restores the full tree.
  const searchInput = document.getElementById('nlm-search-input');
  const searchClear = document.getElementById('nlm-search-clear');
  let searchDebounce = null;
  searchInput.addEventListener('input', () => {
    const raw = searchInput.value;
    searchClear.hidden = raw.length === 0;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchQuery = raw.trim().toLowerCase();
      renderSidebar();
    }, 180);
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    clearTimeout(searchDebounce);
    searchQuery = '';
    renderSidebar();
    searchInput.focus();
  });

  // Cross-device sync toggle (ADR-0006). Opt-in; persisted in
  // chrome.storage.local. Reflect the current flag, then handle changes.
  const syncCheckbox = document.getElementById('nlm-sync-checkbox');
  if (syncCheckbox) {
    syncCheckbox.checked = syncEnabled;
    syncCheckbox.addEventListener('change', () => {
      handleSyncToggle(syncCheckbox.checked);
    });
  }

  // Setup Global Document Clicks for Dropdowns
  document.addEventListener('click', (e) => {
    // Keep an open popover alive if the click lands on its trigger area
    // (notebook move button, folder customize button) or inside the popover
    // itself; otherwise dismiss any open dropdowns/popovers.
    if (!e.target.closest('.nlm-notebook-actions') &&
        !e.target.closest('.nlm-folder-actions') &&
        !e.target.closest('.nlm-dropdown')) {
      document.querySelectorAll('.nlm-dropdown').forEach(d => d.classList.remove('show'));
    }
  });
}

// -------------------------------------------------------------
// METADATA SYNC (Companion Server REST Calls)
// -------------------------------------------------------------
async function checkServerStatus() {
  // The optional companion server enables programmatic control. We track
  // `isConnected` for those features; the old header status dot was removed, so
  // this no longer depends on a DOM element (but updates it if one ever exists).
  try {
    const res = await fetch('http://localhost:3000/status');
    isConnected = res.ok;
  } catch (e) {
    isConnected = false;
  }
  const statusIndicator = document.getElementById('nlm-sync-status');
  if (statusIndicator) statusIndicator.classList.toggle('online', isConnected);
}

// Default folder structure seeded on first run so the UI is never blank.
function defaultFolderData() {
  return {
    folders: [
      { id: 'starter-research', name: 'Research', parentId: null, notebookIds: [], color: DEFAULT_FOLDER_COLOR, icon: '🔬' },
      { id: 'starter-personal', name: 'Personal', parentId: null, notebookIds: [], color: '#34d399', icon: '⭐' }
    ]
  };
}

// Normalize arbitrary stored/loaded data into a valid { folders: [...] } shape.
function normalizeFolderData(data) {
  if (!data || !Array.isArray(data.folders)) {
    return defaultFolderData();
  }
  // Default-fill the optional color/icon fields (ADR-0003) so folders stored
  // before this feature still render. Existing valid values are preserved;
  // anything missing or out-of-allow-list falls back to a safe default.
  const folders = data.folders.map((f) => ({
    ...f,
    color: sanitizeFolderColor(f.color),
    icon: sanitizeFolderIcon(f.icon)
  }));
  return { folders };
}

// chrome.storage.local is the source of truth for folders. The companion
// server is an optional sync target only. Folders work fully offline.
function readFoldersFromStorage() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          console.warn('NotebookLM Folderizer: storage read failed:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(result ? result[STORAGE_KEY] : null);
      });
    } catch (e) {
      console.warn('NotebookLM Folderizer: storage unavailable:', e.message);
      resolve(null);
    }
  });
}

// Persist folder data. Local is ALWAYS written first (offline source of truth).
// When opt-in sync is enabled (ADR-0006), the same value is ALSO mirrored to
// chrome.storage.sync; a quota/error there degrades to local-only via
// `handleSyncDegradation` and is reported in the resolved value — it never
// throws and never loses the local copy.
function writeFoldersToStorage(data) {
  return new Promise((resolve) => {
    const finishLocal = () => {
      if (!syncEnabled) {
        resolve({ synced: false });
        return;
      }
      writeFoldersToSync(data).then((res) => {
        if (res.ok) {
          resolve({ synced: true });
        } else {
          handleSyncDegradation(res.reason);
          resolve({ synced: false, syncError: res.reason });
        }
      });
    };
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: data }, () => {
        if (chrome.runtime.lastError) {
          console.warn('NotebookLM Folderizer: storage write failed:', chrome.runtime.lastError.message);
        }
        finishLocal();
      });
    } catch (e) {
      console.warn('NotebookLM Folderizer: storage write unavailable:', e.message);
      // Local failed, but still attempt sync mirroring per the same policy.
      finishLocal();
    }
  });
}

// A sync write failed (quota or otherwise): keep local data, stop syncing, flip
// the opt-in flag back OFF, and surface a calm, non-blocking status. No throw,
// no data loss.
function handleSyncDegradation(reason) {
  syncEnabled = false;
  writeSyncEnabled(false);
  updateSyncToggleUI();
  setSyncStatus('Folder set too large to sync — kept locally', 'error');
  console.warn('NotebookLM Folderizer: sync disabled (degraded to local-only):', reason);
}

// Show/clear the small sync status line under the toggle. kind is 'error' |
// 'info' | '' (clear). Plain textContent — never innerHTML — so it is
// injection-safe by construction.
function setSyncStatus(message, kind) {
  const el = document.getElementById('nlm-sync-status-line');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('nlm-sync-status-error', 'nlm-sync-status-info');
    return;
  }
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle('nlm-sync-status-error', kind === 'error');
  el.classList.toggle('nlm-sync-status-info', kind === 'info');
}

// Keep the checkbox in sync with the in-memory flag (used after a degrade).
function updateSyncToggleUI() {
  const cb = document.getElementById('nlm-sync-checkbox');
  if (cb) cb.checked = syncEnabled;
}

// User flipped the toggle. Persist the flag; on ON, migrate the current local
// folders up to chrome.storage.sync (first write) — if that fails on quota,
// revert to OFF with the degraded message. On OFF, just stop mirroring.
async function handleSyncToggle(enabled) {
  if (enabled) {
    // Optimistically reflect intent, then attempt the migrating write.
    syncEnabled = true;
    await writeSyncEnabled(true);
    const normalized = normalizeFolderData(folderData);
    const res = await writeFoldersToSync(normalized);
    if (res.ok) {
      setSyncStatus('Syncing across your devices', 'info');
    } else {
      // writeFoldersToSync already logged; degrade cleanly and revert toggle.
      handleSyncDegradation(res.reason);
    }
  } else {
    syncEnabled = false;
    await writeSyncEnabled(false);
    updateSyncToggleUI();
    setSyncStatus('', '');
  }
}

// Pull a remote folder update (from another device) into local + memory and
// re-render. Called by the storage.onChanged listener for area 'sync'.
async function applyRemoteFolders(remote) {
  const normalized = normalizeFolderData(remote);
  // Write straight to local (the render source) — do NOT route through
  // writeFoldersToStorage, which would mirror back to sync and risk a loop.
  await new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: normalized }, () => {
        if (chrome.runtime.lastError) {
          console.warn('NotebookLM Folderizer: remote-apply local write failed:', chrome.runtime.lastError.message);
        }
        resolve();
      });
    } catch (e) {
      console.warn('NotebookLM Folderizer: remote-apply local write unavailable:', e.message);
      resolve();
    }
  });
  folderData = normalized;
  renderSidebar(); // honors the active searchQuery via renderSidebar()
}

// Register the cross-device listener once. Reacts only to chrome.storage.sync
// changes to the folders key, and only while sync is enabled. Guards against
// feedback loops by ignoring a payload equal to what we already hold.
function registerSyncListener() {
  try {
    if (!chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      if (!syncEnabled) return;
      if (!changes || !changes[STORAGE_KEY]) return;
      const remote = changes[STORAGE_KEY].newValue;
      if (!remote || !Array.isArray(remote.folders)) return;
      // Loop guard: if the incoming value matches our current data, ignore it.
      try {
        if (JSON.stringify(remote) === JSON.stringify(folderData)) return;
      } catch (e) { /* fall through and apply */ }
      applyRemoteFolders(remote);
    });
  } catch (e) {
    console.warn('NotebookLM Folderizer: could not register sync listener:', e.message);
  }
}

// -------------------------------------------------------------
// CROSS-DEVICE SYNC (ADR-0006) — opt-in, chrome.storage.sync
// -------------------------------------------------------------

// Read the persisted opt-in flag from chrome.storage.local. Defaults to false
// so a fresh/never-toggled profile behaves exactly as before.
function readSyncEnabled() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([SYNC_ENABLED_KEY], (result) => {
        if (chrome.runtime.lastError) {
          console.warn('NotebookLM Folderizer: sync-flag read failed:', chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        resolve(!!(result && result[SYNC_ENABLED_KEY]));
      });
    } catch (e) {
      console.warn('NotebookLM Folderizer: sync-flag read unavailable:', e.message);
      resolve(false);
    }
  });
}

// Persist the opt-in flag to chrome.storage.local. Never throws into the page.
function writeSyncEnabled(enabled) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [SYNC_ENABLED_KEY]: !!enabled }, () => {
        if (chrome.runtime.lastError) {
          console.warn('NotebookLM Folderizer: sync-flag write failed:', chrome.runtime.lastError.message);
        }
        resolve();
      });
    } catch (e) {
      console.warn('NotebookLM Folderizer: sync-flag write unavailable:', e.message);
      resolve();
    }
  });
}

// Mirror the folder data into chrome.storage.sync. Resolves with
// { ok: true } on success or { ok: false, reason } on any quota/error so the
// caller can degrade to local-only. NEVER throws into the page and NEVER
// touches local data — local has already been written by writeFoldersToStorage.
function writeFoldersToSync(data) {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.set({ [STORAGE_KEY]: data }, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn('NotebookLM Folderizer: sync write failed:', err.message);
          resolve({ ok: false, reason: err.message || 'sync write failed' });
          return;
        }
        resolve({ ok: true });
      });
    } catch (e) {
      // Some Chrome builds throw synchronously on QUOTA_BYTES_PER_ITEM_EXCEEDED.
      console.warn('NotebookLM Folderizer: sync write threw:', e.message);
      resolve({ ok: false, reason: e.message || 'sync write threw' });
    }
  });
}

async function loadFolders() {
  const stored = await readFoldersFromStorage();

  if (stored && Array.isArray(stored.folders)) {
    folderData = normalizeFolderData(stored);
  } else {
    // First run (or empty/corrupt storage): seed a sensible default and persist.
    folderData = defaultFolderData();
    await writeFoldersToStorage(folderData);
  }

  renderSidebar();
}

async function saveFolders() {
  // Persist to local storage first — this is the offline source of truth.
  await writeFoldersToStorage(folderData);
  renderSidebar();

  // Best-effort optional sync to the companion server when available.
  // Failure here is non-fatal and must not spam the console with errors.
  if (isConnected) {
    try {
      await fetch('http://localhost:3000/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(folderData)
      });
    } catch (e) {
      // Server went away mid-session; storage already holds the truth.
      console.warn('NotebookLM Folderizer: optional server sync skipped:', e.message);
    }
  }
}

// -------------------------------------------------------------
// IMPORT / EXPORT (ADR-0004)
// -------------------------------------------------------------

// Current schema version for the export envelope. Bump when the on-disk shape
// changes so future importers can validate / migrate.
const FOLDER_EXPORT_VERSION = 1;

// Pure: turn the live folder structure into the versioned export envelope.
function buildExportEnvelope(data) {
  return {
    version: FOLDER_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: data
  };
}

// Pure validation/normalization for an imported, already-JSON-parsed payload.
// Accepts either the enveloped form ({ version, data }) or a bare folder
// structure ({ folders: [...] }). Returns { ok: true, data } with a fully
// normalized + sanitized structure (color/icon forced onto the ADR-0003
// allow-lists), or { ok: false, error } with a user-facing message. Never throws.
function parseImportedFolders(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'File is not a valid folder export (expected a JSON object).' };
  }

  // Unwrap the envelope if present, otherwise treat the object as a bare structure.
  let candidate;
  if (Object.prototype.hasOwnProperty.call(parsed, 'data')) {
    candidate = parsed.data;
  } else {
    candidate = parsed;
  }

  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.folders)) {
    return { ok: false, error: 'File does not contain a folder structure (missing "folders" array).' };
  }

  // normalizeFolderData coerces shape and runs every node's color/icon through
  // the sanitize* allow-lists, so an import can never smuggle unsafe values.
  const normalized = normalizeFolderData(candidate);
  return { ok: true, data: normalized };
}

// Serialize the current folders to a downloadable JSON file.
function exportFolders() {
  try {
    const envelope = buildExportEnvelope(folderData);
    const json = JSON.stringify(envelope, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `notebooklm-folders-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    setImportStatus('Exported your folders to a JSON file.', false);
  } catch (e) {
    console.warn('NotebookLM Folderizer: export failed:', e.message);
    setImportStatus('Could not export folders: ' + e.message, true);
  }
}

// Read, validate, and (after confirmation) REPLACE the current folders with an
// imported JSON file. Invalid files produce a clear, non-throwing message.
function importFolders(file) {
  const reader = new FileReader();
  reader.onerror = () => {
    setImportStatus('Could not read the selected file.', true);
  };
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      setImportStatus('That file is not valid JSON.', true);
      return;
    }

    const result = parseImportedFolders(parsed);
    if (!result.ok) {
      setImportStatus(result.error, true);
      return;
    }

    const count = result.data.folders.length;
    if (!confirm('This will replace your current folders. Continue?')) {
      setImportStatus('Import cancelled.', false);
      return;
    }

    folderData = result.data;
    saveFolders(); // persists to chrome.storage.local + re-renders + optional server sync
    setImportStatus(`Imported ${count} folder${count === 1 ? '' : 's'}.`, false);
  };
  reader.readAsText(file);
}

// Small inline status line under the header buttons. `isError` tints it red.
function setImportStatus(message, isError) {
  const el = document.getElementById('nlm-import-status');
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.hidden = true;
    el.classList.remove('error');
    return;
  }
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle('error', !!isError);
}

// -------------------------------------------------------------
// NOTEBOOK LM API BRIDGE (LIST NOTEBOOKS)
// -------------------------------------------------------------
async function fetchNotebooksList() {
  // Detection has two independent sources (ADR-0008): the batchexecute RPC and a
  // structural DOM scan. We try the RPC first (authoritative when it works), then
  // merge in anything the DOM scan finds so a changed RPC shape or a list view
  // that the RPC misses can't leave the user staring at a falsely empty list.
  let rpcOk = false;
  const merged = [];
  const seen = new Set();
  const addAll = (items) => {
    for (const nb of items) {
      if (nb && nb.id && !seen.has(nb.id)) {
        seen.add(nb.id);
        merged.push(nb);
      }
    }
  };

  try {
    // `wXbhsf` is the "My notebooks" RPC: it returns the user's own notebooks
    // (each as [title, sources, id, emoji, …]) newest-first. `ub2Bae` was the
    // wrong call — it returns the Featured gallery. Empty args `[]` return only a
    // small recent subset, so we send the page's real query args (copied verbatim
    // from the home page request) which return the full owned list.
    const rpcId = 'wXbhsf';
    const rpcArgs = '[null,1,null,[2,null,null,[1,null,null,null,null,null,null,null,null,null,[1]]],null,[[null,null,[]],[[]],[null,[]]]]';

    // Google's batchexecute rejects requests (HTTP 400) without the per-session
    // XSRF token `at` (SNlM0e). Pull it — and the session ids that round out a
    // well-formed request — from the WIZ data embedded in the page HTML.
    const at = getWizParam('SNlM0e');
    const fsid = getWizParam('FdrFJe');
    const bl = getWizParam('cfb2h');

    const innerReq = JSON.stringify([[[ rpcId, rpcArgs, null, 'generic' ]]]);
    const body = new URLSearchParams();
    body.set('f.req', innerReq);
    if (at) body.set('at', at);

    const qs = new URLSearchParams({ rpcids: rpcId, 'source-path': '/', hl: 'en', rt: 'c' });
    if (fsid) qs.set('f.sid', fsid);
    if (bl) qs.set('bl', bl);
    rpcReqId += 100000;
    qs.set('_reqid', String(rpcReqId));

    const res = await fetch(`/_/LabsTailwindUi/data/batchexecute?${qs.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: body.toString()
    });

    if (!res.ok) {
      throw new Error(`RPC list request failed with status ${res.status}` +
        (at ? '' : ' (no SNlM0e token found in page)'));
    }

    const text = await res.text();
    const { notebooks: found, sawFrame } = extractNotebooksFromBatch(text);
    addAll(found);
    // Only treat the RPC as authoritative if it actually returned a data frame.
    // A 200 with no frame means a stale rpcid — fall through to the DOM scan.
    rpcOk = sawFrame;
    console.log('NotebookLM Folderizer: RPC returned', found.length,
      'notebooks (data frame:', sawFrame, ')');
    if (!sawFrame) {
      console.warn('NotebookLM Folderizer: RPC responded 200 but with no data frame; rpcid may be stale.');
    }
  } catch (err) {
    console.warn('NotebookLM Folderizer: list RPC failed; relying on DOM scan.', err);
  }

  // Always fold in the DOM scan — cheap, and it catches notebooks the RPC missed.
  try {
    addAll(scrapeNotebooksFromDom());
  } catch (err) {
    console.warn('NotebookLM Folderizer: DOM scan failed.', err);
  }

  notebooksList = merged;

  // Status policy: the RPC succeeding makes an empty list *trustworthy* (a real
  // empty account). If the RPC failed, an empty DOM scan is ambiguous — treat it
  // as an error so the UI offers a retry instead of lying "nothing here".
  if (rpcOk || merged.length > 0) {
    notebooksStatus = 'ok';
  } else {
    notebooksStatus = 'error';
  }

  console.log('NotebookLM Folderizer: notebook detection', notebooksStatus, '-', merged.length, 'found');
  return notebooksList;
}

// Structural DOM fallback for the home/list views. Rather than only reading
// <a href="/notebook/…"> anchors (which the list view does not expose), this
// scans any attribute on any element for a notebook URL, so JS-navigated rows
// and cards are detected too. Titles come from link text, aria-label, or the
// nearest meaningful row text.
function scrapeNotebooksFromDom() {
  const list = [];
  const seen = new Set();
  const idRe = /\/notebook\/([a-zA-Z0-9_-]+)/;

  const add = (id, rawTitle) => {
    if (!id || seen.has(id)) return;
    let title = (rawTitle || '').replace(/\s+/g, ' ').trim();
    if (!title || title === 'Folders') title = 'Untitled Notebook';
    seen.add(id);
    list.push({ id, title });
  };

  // 1. Classic anchors.
  document.querySelectorAll('a[href*="/notebook/"]').forEach(a => {
    const m = (a.getAttribute('href') || '').match(idRe);
    if (m) add(m[1], a.getAttribute('aria-label') || a.innerText);
  });

  // 2. Any element carrying a notebook URL in some attribute (data-*, jslog,
  //    href on non-anchors, etc.) — covers list rows that navigate via script.
  if (list.length === 0) {
    document.querySelectorAll('*').forEach(el => {
      if (!el.attributes || el.attributes.length === 0) return;
      for (const attr of el.attributes) {
        const m = attr.value && attr.value.match(idRe);
        if (m) {
          const titleHost = el.closest('[role="row"], [role="listitem"], li, tr') || el;
          add(m[1], el.getAttribute('aria-label') || titleHost.innerText || el.innerText);
          break;
        }
      }
    });
  }

  return list;
}

// Read a WIZ bootstrap parameter (e.g. SNlM0e, FdrFJe, cfb2h) out of the page
// HTML. The content script's isolated world can't touch the page's `window`,
// but these values are embedded as "name":"value" in inline scripts, so a
// text scan of the served markup recovers them.
function getWizParam(name) {
  try {
    const html = document.documentElement.innerHTML;
    const m = html.match(new RegExp('"' + name + '":"([^"]*)"'));
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

// Tolerant parser for a batchexecute response. The payload comes back as a
// `)]}'`-prefixed sequence of length-delimited JSON chunks; the notebook data
// lives inside a `wrb.fr` frame as a *nested* JSON string. We scan every chunk,
// unwrap any `wrb.fr` payload we find, and recurse for notebook rows — so the
// exact framing and chunk count don't matter.
function extractNotebooksFromBatch(text) {
  const notebooks = [];
  let sawFrame = false; // did we see a real wrb.fr data frame (vs. an error)?
  const push = (items) => {
    for (const nb of items) {
      if (nb && nb.id && !notebooks.some(n => n.id === nb.id)) notebooks.push(nb);
    }
  };

  const body = text.replace(/^\)\]\}'\n?/, '');
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[')) continue;
    let chunk;
    try {
      chunk = JSON.parse(trimmed);
    } catch (e) {
      continue;
    }
    const walk = (arr) => {
      if (!Array.isArray(arr)) return;
      if (arr[0] === 'wrb.fr' && typeof arr[2] === 'string') {
        sawFrame = true;
        try {
          push(extractNotebooksFromRPC(JSON.parse(arr[2])));
        } catch (e) { /* not the frame we want */ }
      }
      for (const item of arr) {
        if (Array.isArray(item)) walk(item);
      }
    };
    walk(chunk);
  }
  // `sawFrame` distinguishes a genuine empty account (data frame, zero rows)
  // from a stale/wrong rpcid (no data frame) so the caller doesn't claim "ok".
  return { notebooks, sawFrame };
}

// Parse notebook rows out of a batchexecute payload. A notebook entry has a
// fixed, recognizable shape:
//   [ title (string), sources (array), notebookId (id token), emoji (string), … ]
// We recurse so the entry's position within the wrapper doesn't matter, but we
// read each field by index, which is far more reliable than guessing which
// string is the title (source rows look superficially similar).
function extractNotebooksFromRPC(data) {
  const notebooks = [];

  // An opaque id (UUID or base64url): id-safe characters, no spaces.
  const isId = (s) =>
    typeof s === 'string' && s.length >= 8 && s.length <= 80 &&
    !s.includes(' ') && !s.includes('\n') && /^[a-zA-Z0-9_-]+$/.test(s);

  function recurse(arr) {
    if (!Array.isArray(arr)) return;

    // title at [0], sources array at [1], notebook id at [2]. Requiring all
    // three excludes source rows (whose [0] is an array) and metadata tuples.
    if (typeof arr[0] === 'string' && arr[0].trim().length > 0 &&
        Array.isArray(arr[1]) && isId(arr[2])) {
      const id = arr[2];
      if (!notebooks.some(n => n.id === id)) {
        notebooks.push({
          id,
          title: arr[0].trim(),
          sourceCount: arr[1].length,
          icon: typeof arr[3] === 'string' ? arr[3] : null
        });
      }
    }

    for (const item of arr) {
      if (Array.isArray(item)) {
        recurse(item);
      }
    }
  }
  recurse(data);
  return notebooks;
}

async function refreshData() {
  // Show the loading state immediately so the user sees progress, not a stale
  // or falsely-empty list, while the fetch is in flight (ADR-0008).
  notebooksStatus = 'loading';
  renderSidebar();
  await fetchNotebooksList();
  await loadFolders(); // re-renders with the resolved status
}

// -------------------------------------------------------------
// SIDEBAR RENDERING & INTERACTIONS
// -------------------------------------------------------------
function renderSidebar() {
  const treeContainer = document.getElementById('nlm-folders-tree');
  const unorganizedContainer = document.getElementById('nlm-unorganized-list');
  if (!treeContainer || !unorganizedContainer) return;

  const q = searchQuery;

  // 1. Render Folders Tree
  const treeHtml = renderFolderNode(null, 0);
  treeContainer.innerHTML = treeHtml;

  // 2. Render Unorganized Notebooks (filtered by title under an active query).
  const organizedIds = new Set();
  folderData.folders.forEach(f => {
    if (f.notebookIds) {
      f.notebookIds.forEach(id => organizedIds.add(id));
    }
  });

  let unorganized = notebooksList.filter(nb => !organizedIds.has(nb.id));
  if (q) {
    unorganized = unorganized.filter(nb => notebookMatchesQuery(nb, q));
  }
  // Honest loading / error+retry / verified-empty states (ADR-0008) with the
  // search filter + match highlighting (ADR-0005) folded in.
  unorganizedContainer.innerHTML = renderUnorganizedState(unorganized, q);

  // 2b. Gentle "No matches" state when an active query matches nothing anywhere.
  if (q && treeHtml.trim() === '' && unorganized.length === 0) {
    treeContainer.innerHTML = `<div class="nlm-search-empty">No matches for “${escapeHtml(searchQuery)}”</div>`;
  }

  // 3. Attach Listeners for buttons and Drag & Drop
  attachUIEventListeners();

  // Retry affordance for the error state (ADR-0008).
  const retryBtn = document.getElementById('nlm-notebooks-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => { refreshData(); });
  }
}

// Render the four honest states of the unorganized list (ADR-0008): loading,
// error (with retry), verified-empty, and the populated list. Distinguishing
// these is what stops the UI from showing "No unorganized notebooks" when the
// real cause is a fetch that never resolved.
function renderUnorganizedState(unorganized, q) {
  if (notebooksStatus === 'loading') {
    const skeleton = `<div class="nlm-skeleton-row"><span class="nlm-skeleton-dot"></span><span class="nlm-skeleton-bar"></span></div>`;
    return `<div class="nlm-notebooks-loading" aria-live="polite">${skeleton.repeat(4)}</div>`;
  }

  if (notebooksStatus === 'error') {
    return `
      <div class="nlm-notebooks-message nlm-notebooks-error" role="alert">
        <div class="nlm-message-icon">⚠️</div>
        <div class="nlm-message-text">Couldn't load your notebooks.</div>
        <button class="nlm-btn-retry" id="nlm-notebooks-retry">Retry</button>
      </div>`;
  }

  if (unorganized.length === 0) {
    // While searching, stay silent here — the tree-level "No matches" message
    // covers an empty result. Otherwise this is a verified-empty account.
    if (q) return '';
    return `
      <div class="nlm-notebooks-message nlm-notebooks-empty">
        <div class="nlm-message-icon">🎉</div>
        <div class="nlm-message-text">Everything's filed away.</div>
      </div>`;
  }

  return unorganized.map(nb => `
    <div class="nlm-notebook-item" draggable="true" data-notebook-id="${escapeHtml(nb.id)}">
      <span class="nlm-notebook-icon">📓</span>
      <span class="nlm-notebook-link" data-notebook-id="${escapeHtml(nb.id)}" title="${escapeHtml(nb.title)}">${highlightMatch(nb.title, q)}</span>
      <div class="nlm-notebook-actions">
        <button class="nlm-action-btn move-notebook-btn" data-notebook-id="${escapeHtml(nb.id)}">📂</button>
      </div>
    </div>
  `).join('');
}

function renderFolderNode(parentId, depth) {
  const q = searchQuery;
  let nodes = folderData.folders.filter(f => f.parentId === parentId);
  // Under an active query, only keep folders that match or contain a match
  // (ancestor preservation falls out of this: a folder stays whenever a
  // descendant matches). Pure read of in-memory data; nothing is mutated.
  if (q) {
    nodes = nodes.filter(n => nodeMatchesQuery(n, q, folderData.folders, notebooksList));
  }
  let html = '';

  for (const node of nodes) {
    const childFoldersHtml = renderFolderNode(node.id, depth + 1);
    let notebooksInFolder = notebooksList.filter(n => node.notebookIds && node.notebookIds.includes(n.id));
    // The folder's own name matching means show all its children; otherwise only
    // show the notebooks whose title matches.
    const folderNameMatches = q && String(node.name || '').toLowerCase().includes(q);
    if (q && !folderNameMatches) {
      notebooksInFolder = notebooksInFolder.filter(n => notebookMatchesQuery(n, q));
    }

    const folderId = escapeHtml(node.id);
    const folderName = escapeHtml(node.name);
    const folderNameHtml = highlightMatch(node.name, q);
    // Color/icon are validated against the preset allow-lists before being
    // placed into markup or an inline style — never trust stored values raw.
    const folderColor = sanitizeFolderColor(node.color);
    const folderIcon = sanitizeFolderIcon(node.icon);
    // Accordion: a folder is collapsible when it has nested folders or
    // notebooks. Collapse state lives in `collapsedFolders` so it survives the
    // full re-render that follows most actions.
    const notebooksHtml = notebooksInFolder.map(nb => `
            <div class="nlm-notebook-item" draggable="true" data-notebook-id="${escapeHtml(nb.id)}">
              <span class="nlm-notebook-icon">📓</span>
              <span class="nlm-notebook-link" data-notebook-id="${escapeHtml(nb.id)}" title="${escapeHtml(nb.title)}">${highlightMatch(nb.title, q)}</span>
              <div class="nlm-notebook-actions">
                <button class="nlm-action-btn move-notebook-btn" data-notebook-id="${escapeHtml(nb.id)}">📂</button>
              </div>
            </div>
          `).join('');
    const hasContent = childFoldersHtml.trim().length > 0 || notebooksInFolder.length > 0;
    // Force-expand while a search is active so matches inside a previously
    // collapsed folder are visible.
    const isCollapsed = hasContent && !q && collapsedFolders.has(node.id);
    const chevron = hasContent
      ? `<span class="nlm-folder-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg></span>`
      : `<span class="nlm-folder-chevron nlm-folder-chevron--empty" aria-hidden="true"></span>`;
    html += `
      <div class="nlm-folder" data-folder-id="${folderId}">
        <div class="nlm-folder-header${isCollapsed ? ' is-collapsed' : ''}" draggable="true" data-folder-id="${folderId}" style="border-left: 3px solid ${folderColor};">
          ${chevron}
          <span class="nlm-folder-icon" style="color: ${folderColor};">${folderIcon}</span>
          <span class="nlm-folder-title" title="${folderName}">${folderNameHtml}</span>
          <div class="nlm-folder-actions">
            <button class="nlm-action-btn customize-folder-btn" data-folder-id="${folderId}" title="Customize">🎨</button>
            <button class="nlm-action-btn rename-folder-btn" data-folder-id="${folderId}" title="Rename">✏️</button>
            <button class="nlm-action-btn add-subfolder-btn" data-folder-id="${folderId}" title="Add Subfolder">➕</button>
            <button class="nlm-action-btn delete-folder-btn" data-folder-id="${folderId}" title="Delete">🗑️</button>
          </div>
        </div>
        <div class="nlm-folder-children${isCollapsed ? ' collapsed' : ''}" data-folder-id="${folderId}">
          <div class="nlm-folder-children-inner">
            ${childFoldersHtml}
            ${notebooksHtml}
          </div>
        </div>
      </div>
    `;
  }
  return html;
}

function attachUIEventListeners() {
  // Folder UI Buttons
  document.querySelectorAll('.rename-folder-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-folder-id');
      const folder = folderData.folders.find(f => f.id === id);
      if (folder) {
        const newName = prompt('Enter new folder name:', folder.name);
        if (newName && newName.trim()) {
          folder.name = newName.trim();
          saveFolders();
        }
      }
    });
  });

  document.querySelectorAll('.add-subfolder-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parentId = btn.getAttribute('data-folder-id');
      const name = prompt('Enter subfolder name:');
      if (name && name.trim()) {
        addFolder(name.trim(), parentId);
      }
    });
  });

  document.querySelectorAll('.delete-folder-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-folder-id');
      if (confirm('Are you sure you want to delete this folder? Inside notebooks will be unorganized.')) {
        removeFolder(id);
      }
    });
  });

  // Customize folder color / icon
  document.querySelectorAll('.customize-folder-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-folder-id');
      showCustomizeDropdown(btn, id);
    });
  });

  // Accordion: click a folder header to collapse/expand its contents. We toggle
  // classes on the existing DOM (not a full re-render) so the grid-rows
  // transition animates; the action buttons stop propagation so they're unaffected.
  document.querySelectorAll('.nlm-folder-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.nlm-folder-actions') || e.target.closest('.nlm-dropdown')) return;
      const id = header.getAttribute('data-folder-id');
      const folder = header.closest('.nlm-folder');
      const children = folder && folder.querySelector(':scope > .nlm-folder-children');
      // Only foldable when there's something inside (chevron present).
      if (!children || !header.querySelector('.nlm-folder-chevron:not(.nlm-folder-chevron--empty)')) return;
      const collapsed = !collapsedFolders.has(id);
      if (collapsed) collapsedFolders.add(id); else collapsedFolders.delete(id);
      header.classList.toggle('is-collapsed', collapsed);
      children.classList.toggle('collapsed', collapsed);
    });
  });

  // Notebook click to open (navigates on Google site)
  document.querySelectorAll('.nlm-notebook-link').forEach(link => {
    link.addEventListener('click', (e) => {
      const notebookId = link.getAttribute('data-notebook-id');
      // Navigate to notebook
      window.location.href = `/notebook/${notebookId}`;
    });
  });

  // Dropdown Move To Folder action
  document.querySelectorAll('.move-notebook-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const notebookId = btn.getAttribute('data-notebook-id');
      showMoveDropdown(btn, notebookId);
    });
  });

  // Drag and Drop (HTML5 API)
  setupDragAndDrop();
}

function addFolder(name, parentId) {
  const newFolder = {
    id: Math.random().toString(36).substring(2, 9),
    name: name,
    parentId: parentId,
    notebookIds: [],
    color: DEFAULT_FOLDER_COLOR,
    icon: DEFAULT_FOLDER_ICON
  };
  folderData.folders.push(newFolder);
  saveFolders();
}

function removeFolder(id) {
  // Recursively collect folders to delete
  const toDelete = [id];
  function collectChildren(pId) {
    folderData.folders.forEach(f => {
      if (f.parentId === pId) {
        toDelete.push(f.id);
        collectChildren(f.id);
      }
    });
  }
  collectChildren(id);

  // Remove them
  folderData.folders = folderData.folders.filter(f => !toDelete.includes(f.id));
  saveFolders();
}

function showMoveDropdown(anchorEl, notebookId) {
  // Clear any existing dropdown
  document.querySelectorAll('.nlm-dropdown').forEach(d => d.remove());

  const dropdown = document.createElement('div');
  dropdown.className = 'nlm-dropdown';
  
  // Options
  dropdown.innerHTML = `
    <div class="nlm-dropdown-item" data-folder-id="unorganized">🚫 Unorganized</div>
    ${folderData.folders.map(f => `
      <div class="nlm-dropdown-item" data-folder-id="${escapeHtml(f.id)}">📁 ${escapeHtml(f.name)}</div>
    `).join('')}
  `;

  // Position next to anchor button
  anchorEl.parentNode.appendChild(dropdown);
  
  setTimeout(() => dropdown.classList.add('show'), 10);

  dropdown.querySelectorAll('.nlm-dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetFolderId = item.getAttribute('data-folder-id');
      
      // Clean up notebook ID from any existing folders
      folderData.folders.forEach(f => {
        if (f.notebookIds) {
          f.notebookIds = f.notebookIds.filter(id => id !== notebookId);
        }
      });

      if (targetFolderId !== 'unorganized') {
        const folder = folderData.folders.find(f => f.id === targetFolderId);
        if (folder) {
          if (!folder.notebookIds) folder.notebookIds = [];
          folder.notebookIds.push(notebookId);
        }
      }

      dropdown.remove();
      saveFolders();
    });
  });
}

// Inline popover for picking a folder's color + icon (ADR-0003). Reuses the
// dropdown styling/positioning and the global click-to-close handler. Every
// value comes from the curated allow-lists, so nothing untrusted is rendered.
function showCustomizeDropdown(anchorEl, folderId) {
  // Clear any existing dropdown/popover.
  document.querySelectorAll('.nlm-dropdown').forEach(d => d.remove());

  const folder = folderData.folders.find(f => f.id === folderId);
  if (!folder) return;

  const currentColor = sanitizeFolderColor(folder.color);
  const currentIcon = sanitizeFolderIcon(folder.icon);

  const popover = document.createElement('div');
  popover.className = 'nlm-dropdown nlm-customize-popover';

  const swatchesHtml = FOLDER_COLOR_PRESETS.map(color => `
    <button class="nlm-color-swatch${color === currentColor ? ' selected' : ''}"
            data-color="${color}" title="${color}"
            style="background: ${color};"></button>
  `).join('');

  const iconsHtml = FOLDER_ICON_PRESETS.map(icon => `
    <button class="nlm-icon-choice${icon === currentIcon ? ' selected' : ''}"
            data-icon="${icon}">${icon}</button>
  `).join('');

  popover.innerHTML = `
    <div class="nlm-customize-label">Color</div>
    <div class="nlm-color-swatches">${swatchesHtml}</div>
    <div class="nlm-customize-label">Icon</div>
    <div class="nlm-icon-choices">${iconsHtml}</div>
  `;

  anchorEl.parentNode.appendChild(popover);
  setTimeout(() => popover.classList.add('show'), 10);

  popover.querySelectorAll('.nlm-color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      // Re-validate against the allow-list before persisting.
      folder.color = sanitizeFolderColor(swatch.getAttribute('data-color'));
      popover.remove();
      saveFolders();
    });
  });

  popover.querySelectorAll('.nlm-icon-choice').forEach(choice => {
    choice.addEventListener('click', (e) => {
      e.stopPropagation();
      folder.icon = sanitizeFolderIcon(choice.getAttribute('data-icon'));
      popover.remove();
      saveFolders();
    });
  });
}

function setupDragAndDrop() {
  const notebookItems = document.querySelectorAll('.nlm-notebook-item');
  const folderHeaders = document.querySelectorAll('.nlm-folder-header');

  notebookItems.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      const notebookId = item.getAttribute('data-notebook-id');
      e.dataTransfer.setData('text/plain', notebookId);
      item.classList.add('dragging');
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
    });
  });

  folderHeaders.forEach(header => {
    header.addEventListener('dragover', (e) => {
      e.preventDefault();
      header.classList.add('drag-over');
    });

    header.addEventListener('dragleave', () => {
      header.classList.remove('drag-over');
    });

    header.addEventListener('drop', (e) => {
      e.preventDefault();
      header.classList.remove('drag-over');
      
      const notebookId = e.dataTransfer.getData('text/plain');
      const targetFolderId = header.getAttribute('data-folder-id');

      if (!notebookId || !targetFolderId) return;

      // Remove notebook from existing folders mapping
      folderData.folders.forEach(f => {
        if (f.notebookIds) {
          f.notebookIds = f.notebookIds.filter(id => id !== notebookId);
        }
      });

      // Add to target folder
      const folder = folderData.folders.find(f => f.id === targetFolderId);
      if (folder) {
        if (!folder.notebookIds) folder.notebookIds = [];
        if (!folder.notebookIds.includes(notebookId)) {
          folder.notebookIds.push(notebookId);
        }
      }

      saveFolders();
    });
  });
}

// -------------------------------------------------------------
// AUTOMATION RESILIENCE LAYER (ADR-0010)
//
// The chat / generate features drive NotebookLM's obfuscated, framework-generated
// DOM. There is no public API and no stable markup contract, so these features are
// inherently EXPERIMENTAL / best-effort. This layer makes them break less often and
// be repairable in ONE place:
//   - AUTOMATION_SELECTORS: every candidate selector for each target, centralized.
//   - resolveElement(): ordered multi-strategy resolution (first hit wins).
//   - waitForElement(): MutationObserver + immediate check + timeout (no fixed sleeps).
//   - waitForStableText(): resolves once a streaming response stops changing.
// Live correctness still depends on Google's UI and is NOT guaranteed.
// -------------------------------------------------------------

// Centralized selector config. Each logical target maps to an ORDERED list of
// candidate strategies, tried in priority order:
//   - a string            => CSS selector (resolved via safeQuery)
//   - { buttonText }      => match a button / [role=button] by text or aria-label
//   - { text, selector }  => match any element (optionally scoped by `selector`)
//                            by text or aria-label
// When Google changes the UI, this is the one place to update.
const AUTOMATION_SELECTORS = {
  // Chat prompt input box.
  chatInput: [
    'textarea[aria-label*="prompt" i]',
    'textarea[aria-label*="question" i]',
    'textarea',
    '[contenteditable="true"]',
    'input[type="text"]'
  ],
  // Button that submits the prompt.
  sendButton: [
    'button[aria-label*="Send" i]',
    'button[type="submit"]',
    'button[aria-label*="submit" i]',
    { buttonText: 'Send' }
  ],
  // Container holding the streaming assistant response (last match = newest).
  chatResponse: [
    '[data-message-author="assistant"]',
    '.message-bubble',
    '.chat-message',
    '[role="presentation"] .markdown'
  ],
  // Notebook Guide / Studio toggle.
  guideButton: [
    'button[aria-label*="Guide" i]',
    '.notebook-guide-button',
    { buttonText: 'Guide' }
  ],
  // Container the generated Studio artifact renders into.
  studioOutput: [
    '.studio-panel',
    '.artifact-viewer',
    '.guide-content'
  ]
};

// Resolve a single logical target to a live element using its ordered strategies.
// Returns the first matching element or null. Never throws (delegates to the
// non-throwing safeQuery / findElementByText / findButtonByText helpers).
function resolveElement(targetKey, root) {
  const strategies = AUTOMATION_SELECTORS[targetKey];
  if (!strategies) {
    console.warn(`NotebookLM Folderizer: no AUTOMATION_SELECTORS entry for "${targetKey}"`);
    return null;
  }
  const scope = root || document;
  for (const strategy of strategies) {
    let el = null;
    if (typeof strategy === 'string') {
      // safeQuery logs on a true miss, which is noisy across an ordered list; do a
      // quiet try here and let resolveElement log once if everything misses.
      try {
        el = scope.querySelector(strategy);
      } catch (err) {
        console.warn(`NotebookLM Folderizer: invalid selector "${strategy}":`, err.message);
        el = null;
      }
    } else if (strategy && strategy.buttonText) {
      el = findButtonByText(strategy.buttonText);
    } else if (strategy && strategy.text) {
      el = findElementByText(strategy.selector || '*', strategy.text);
    }
    if (el) return el;
  }
  return null;
}

// Resolve ALL matching elements for a target (used where we need the newest of
// several, e.g. the latest response bubble). Returns a flat, de-duped array in
// document order across the strategies. Never throws.
function resolveAllElements(targetKey, root) {
  const strategies = AUTOMATION_SELECTORS[targetKey];
  if (!strategies) return [];
  const scope = root || document;
  const out = [];
  const seen = new Set();
  for (const strategy of strategies) {
    let nodes = [];
    if (typeof strategy === 'string') {
      try {
        nodes = Array.from(scope.querySelectorAll(strategy));
      } catch (err) {
        nodes = [];
      }
    } else if (strategy && strategy.buttonText) {
      const el = findButtonByText(strategy.buttonText);
      nodes = el ? [el] : [];
    } else if (strategy && strategy.text) {
      const el = findElementByText(strategy.selector || '*', strategy.text);
      nodes = el ? [el] : [];
    }
    for (const n of nodes) {
      if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
  }
  return out;
}

// Wait for an element to appear. Accepts either a target key (string in
// AUTOMATION_SELECTORS) or a predicate function returning an element-or-null.
// Resolves with the element as soon as it exists (immediate synchronous check
// first, then a MutationObserver on the subtree), or resolves with null on
// timeout. Never rejects — callers branch on a null result. (ADR-0010)
function waitForElement(predicateOrTargetKey, options) {
  const opts = options || {};
  const timeout = typeof opts.timeout === 'number' ? opts.timeout : 10000;
  const root = opts.root || document;

  const probe = typeof predicateOrTargetKey === 'function'
    ? predicateOrTargetKey
    : () => resolveElement(predicateOrTargetKey, root);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (el) => {
      if (settled) return;
      settled = true;
      try { observer.disconnect(); } catch (e) { /* no-op */ }
      clearTimeout(timer);
      resolve(el || null);
    };

    // Immediate synchronous check — avoids waiting a full tick if already present.
    let initial = null;
    try { initial = probe(); } catch (e) { initial = null; }
    if (initial) {
      resolve(initial);
      settled = true;
      return;
    }

    const observer = new MutationObserver(() => {
      let el = null;
      try { el = probe(); } catch (e) { el = null; }
      if (el) finish(el);
    });

    const timer = setTimeout(() => finish(null), timeout);

    try {
      observer.observe(root === document ? (document.body || document.documentElement) : root, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    } catch (e) {
      // If we can't observe, fall back to resolving null at the timeout.
    }
  });
}

// Wait for a streaming element's text to stop changing. Resolves with the final
// text once it has been unchanged for `quietMs` (the stream has gone quiet), or on
// `timeout`. While streaming, calls onProgress(fullText) on each observed change so
// callers can forward incremental chunks. Uses a MutationObserver and never
// rejects. (ADR-0010)
function waitForStableText(el, options) {
  const opts = options || {};
  const quietMs = typeof opts.quietMs === 'number' ? opts.quietMs : 800;
  const timeout = typeof opts.timeout === 'number' ? opts.timeout : 30000;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  return new Promise((resolve) => {
    if (!el) { resolve(''); return; }

    let settled = false;
    let lastText = el.innerText || el.textContent || '';
    let quietTimer = null;
    let hardTimer = null;
    let observer = null;

    const readText = () => el.innerText || el.textContent || '';

    const finish = () => {
      if (settled) return;
      settled = true;
      if (quietTimer) clearTimeout(quietTimer);
      if (hardTimer) clearTimeout(hardTimer);
      try { if (observer) observer.disconnect(); } catch (e) { /* no-op */ }
      resolve(readText());
    };

    const armQuiet = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    };

    const onChange = () => {
      const current = readText();
      if (current !== lastText) {
        lastText = current;
        if (onProgress) {
          try { onProgress(current); } catch (e) { /* caller error must not break us */ }
        }
        armQuiet(); // text moved — restart the quiet window
      }
    };

    observer = new MutationObserver(onChange);
    try {
      observer.observe(el, { childList: true, subtree: true, characterData: true });
    } catch (e) {
      // Can't observe — resolve with whatever we have after the quiet window.
    }

    // Emit the initial text so a response already present is forwarded, then start
    // the quiet countdown so a non-streaming / already-complete reply still settles.
    if (onProgress && lastText) {
      try { onProgress(lastText); } catch (e) { /* no-op */ }
    }
    armQuiet();
    hardTimer = setTimeout(finish, timeout);
  });
}

// -------------------------------------------------------------
// CHAT AGENT AUTOMATION (DOM-based Streamer)
// -------------------------------------------------------------
async function handleChatRequest(requestId, data) {
  const { notebookId, prompt } = data;
  console.log(`Starting chat automation for notebook: ${notebookId}, prompt: ${prompt}`);

  try {
    // 1. Check if we need to navigate
    if (!window.location.pathname.includes(`/notebook/${notebookId}`)) {
      window.location.href = `/notebook/${notebookId}`;
      // Give page time to load (websocket will reconnect and wait)
      chrome.runtime.sendMessage({
        id: requestId,
        type: 'chat_error',
        error: 'Redirecting browser page to target notebook. Please re-run prompt in a few seconds once loaded.'
      });
      return;
    }

    // 2. Locate Chat input & Send Button via the centralized selector config,
    // waiting (MutationObserver-backed) instead of fixed-count polling. (ADR-0010)
    const inputEl = await waitForElement('chatInput', { timeout: 10000 });
    if (!inputEl) {
      console.warn('NotebookLM Folderizer: chat input not found — NotebookLM UI may have changed; update AUTOMATION_SELECTORS.chatInput in content.js');
      chrome.runtime.sendMessage({
        id: requestId,
        type: 'chat_error',
        error: 'Could not find the chat input — NotebookLM UI may have changed. Update AUTOMATION_SELECTORS.chatInput in content.js.'
      });
      return;
    }

    const sendBtn = await waitForElement('sendButton', { timeout: 10000 });
    if (!sendBtn) {
      console.warn('NotebookLM Folderizer: send button not found — NotebookLM UI may have changed; update AUTOMATION_SELECTORS.sendButton in content.js');
      chrome.runtime.sendMessage({
        id: requestId,
        type: 'chat_error',
        error: 'Could not find the send button — NotebookLM UI may have changed. Update AUTOMATION_SELECTORS.sendButton in content.js.'
      });
      return;
    }

    // 3. Clear and Type the Prompt
    inputEl.focus();
    if (inputEl.tagName.toLowerCase() === 'textarea') {
      inputEl.value = prompt;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      inputEl.innerText = prompt;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 4. Click Send
    sendBtn.click();
    console.log('Clicked send button, observing streaming response...');

    // 5. Wait for the assistant response container to appear, then stream it.
    // resolveAllElements returns matches in document order; the newest bubble is
    // the last one. We wait (MutationObserver-backed) for at least one to exist.
    const bubble = await waitForElement(() => {
      const bubbles = resolveAllElements('chatResponse');
      return bubbles.length ? bubbles[bubbles.length - 1] : null;
    }, { timeout: 10000 });

    if (!bubble) {
      console.warn('NotebookLM Folderizer: assistant response container not found — NotebookLM UI may have changed; update AUTOMATION_SELECTORS.chatResponse in content.js');
      chrome.runtime.sendMessage({
        id: requestId,
        type: 'chat_error',
        error: 'Could not find the assistant response in the UI — NotebookLM UI may have changed. Update AUTOMATION_SELECTORS.chatResponse in content.js.'
      });
      return;
    }

    // Stream incremental chunks as the response grows, and finish when the text
    // has been stable (quiet) for a beat. waitForStableText forwards each change
    // via onProgress; we diff against what we've already sent and forward the
    // delta, preserving the existing chat_chunk { text, done } contract.
    let lastLength = 0;
    await waitForStableText(bubble, {
      quietMs: 2500,
      timeout: 120000,
      onProgress: (fullText) => {
        if (fullText.length > lastLength) {
          const newChunk = fullText.substring(lastLength);
          lastLength = fullText.length;
          chrome.runtime.sendMessage({
            id: requestId,
            type: 'chat_chunk',
            text: newChunk,
            done: false
          });
        }
      }
    });

    // Stream is quiet (or timed out) — signal completion.
    chrome.runtime.sendMessage({
      id: requestId,
      type: 'chat_chunk',
      text: '',
      done: true
    });

  } catch (err) {
    console.error('Chat request automation failed:', err);
    chrome.runtime.sendMessage({
      id: requestId,
      type: 'chat_error',
      error: err.message
    });
  }
}

// -------------------------------------------------------------
// PRODUCT GENERATION (DOM-based Studio Automation)
// -------------------------------------------------------------
async function handleGenerateProduct(requestId, data) {
  const { notebookId, format, description, instructions } = data;
  console.log(`Starting generate product: ${format} for notebook ${notebookId}`);

  try {
    // Navigate to notebook if not there
    if (!window.location.pathname.includes(`/notebook/${notebookId}`)) {
      window.location.href = `/notebook/${notebookId}`;
      chrome.runtime.sendMessage({
        id: requestId,
        type: 'response',
        data: { error: 'Redirecting browser page to target notebook. Please re-run generate request.' }
      });
      return;
    }

    // 1. Locate Notebook Guide button (centralized config) and click it to toggle
    // the Studio panel. Best-effort: a missing Guide button isn't fatal — the
    // format button may already be visible. (ADR-0010)
    const guideBtn = resolveElement('guideButton');
    if (guideBtn) {
      guideBtn.click();
    } else {
      console.warn('NotebookLM Folderizer: Notebook Guide button not found — NotebookLM UI may have changed; continuing to look for the format button (update AUTOMATION_SELECTORS.guideButton in content.js if needed)');
    }

    // 2. Find the specific format generator button by visible text. Wait for it to
    // appear (MutationObserver-backed) so we don't race the panel opening.
    const formatLabel = String(format || '').toLowerCase().replace(/-/g, ' '); // e.g. "study guide" or "briefing doc"

    const formatBtn = await waitForElement(() => {
      if (!formatLabel) return null;
      let match = null;
      document.querySelectorAll('button, [role="button"], .studio-button').forEach(btn => {
        const text = (btn.innerText || btn.textContent || '').toLowerCase();
        if (text.includes(formatLabel) || (formatLabel.includes('briefing') && text.includes('briefing'))) {
          match = btn;
        }
      });
      return match;
    }, { timeout: 10000 });

    if (!formatBtn) {
      console.warn(`NotebookLM Folderizer: no generation button found for format "${format}" — NotebookLM UI may have changed; update the format-button matching in handleGenerateProduct / AUTOMATION_SELECTORS in content.js`);
      chrome.runtime.sendMessage({
        id: requestId,
        type: 'response',
        data: { error: `Could not find a generation button for format "${format}" — NotebookLM UI may have changed. Update the format-button matching in content.js.` }
      });
      return;
    }

    // 3. Trigger Click to generate
    formatBtn.click();
    console.log(`Clicked generate product for ${format}. Waiting for completion...`);

    // 4. Wait for the output document to render in the Studio container. Resolve
    // the panel via the centralized config, then wait for its text to be present
    // and not a "Generating…" placeholder. (ADR-0010)
    const outputText = await new Promise((resolve) => {
      const deadline = Date.now() + 60000;
      const check = async () => {
        const studioPanel = resolveElement('studioOutput');
        if (studioPanel) {
          const text = (studioPanel.innerText || studioPanel.textContent || '').trim();
          if (text.length > 50 && !text.includes('Generating')) {
            resolve(text);
            return;
          }
        }
        if (Date.now() >= deadline) {
          resolve('');
          return;
        }
        // Re-probe shortly; resolveElement is cheap and the panel may not exist yet.
        const panel = await waitForElement('studioOutput', { timeout: Math.max(0, Math.min(2000, deadline - Date.now())) });
        if (!panel && Date.now() >= deadline) { resolve(''); return; }
        setTimeout(check, 500);
      };
      check();
    });

    if (!outputText) {
      console.warn('NotebookLM Folderizer: Studio output did not render in time — NotebookLM UI may have changed; update AUTOMATION_SELECTORS.studioOutput in content.js');
      chrome.runtime.sendMessage({
        id: requestId,
        type: 'response',
        data: { error: 'Product generation timed out waiting for the Studio output to render — NotebookLM UI may have changed. Update AUTOMATION_SELECTORS.studioOutput in content.js.' }
      });
      return;
    }

    // Return successfully
    chrome.runtime.sendMessage({
      id: requestId,
      type: 'response',
      data: {
        success: true,
        notebookId,
        format,
        content: outputText
      }
    });

  } catch (err) {
    console.error('Product generation automation failed:', err);
    chrome.runtime.sendMessage({
      id: requestId,
      type: 'response',
      data: { error: err.message }
    });
  }
}
