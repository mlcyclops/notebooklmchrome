// NotebookLM Folderizer & Connector Content Script

let folderData = { folders: [] };
let notebooksList = [];
let isConnected = false;

// Initialize when page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  console.log('NotebookLM Folderizer Content Script Initialized');
  
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
      fetchNotebooksList().then(notebooks => {
        sendResponse({ data: notebooks }); // Extension messaging direct callback
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
      return true; // Keep message channel open
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
        <div class="nlm-sync-status" id="nlm-sync-status" title="Server Connection Status"></div>
      </div>
      <button class="nlm-btn-add" id="nlm-btn-add-folder">
        <span>➕</span> New Root Folder
      </button>
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

  // Setup Global Document Clicks for Dropdowns
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nlm-notebook-actions')) {
      document.querySelectorAll('.nlm-dropdown').forEach(d => d.classList.remove('show'));
    }
  });
}

// -------------------------------------------------------------
// METADATA SYNC (Companion Server REST Calls)
// -------------------------------------------------------------
async function checkServerStatus() {
  const statusIndicator = document.getElementById('nlm-sync-status');
  if (!statusIndicator) return;
  try {
    const res = await fetch('http://localhost:3000/status');
    if (res.ok) {
      statusIndicator.classList.add('online');
      isConnected = true;
    } else {
      statusIndicator.classList.remove('online');
      isConnected = false;
    }
  } catch (e) {
    statusIndicator.classList.remove('online');
    isConnected = false;
  }
}

async function loadFolders() {
  try {
    const res = await fetch('http://localhost:3000/api/folders');
    if (res.ok) {
      folderData = await res.json();
      renderSidebar();
    }
  } catch (e) {
    console.error('Failed to load folders configuration:', e);
  }
}

async function saveFolders() {
  try {
    await fetch('http://localhost:3000/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(folderData)
    });
    renderSidebar();
  } catch (e) {
    console.error('Failed to save folders configuration:', e);
  }
}

// -------------------------------------------------------------
// NOTEBOOK LM API BRIDGE (LIST NOTEBOOKS)
// -------------------------------------------------------------
async function fetchNotebooksList() {
  try {
    // Call batchExecute RPC wXbhsf
    const rpcId = 'wXbhsf';
    const payload = [[[ rpcId, "[]", null, "1" ]]];
    const reqBody = 'f.req=' + encodeURIComponent(JSON.stringify(payload));
    
    const res = await fetch(`/_/LabsTailwindUi/data/batchexecute?rpcids=${rpcId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: reqBody
    });

    if (!res.ok) {
      throw new Error(`RPC list request failed with status ${res.status}`);
    }

    const text = await res.text();
    const cleaned = text.startsWith(")]}'") ? text.substring(4) : text;
    const outer = JSON.parse(cleaned);
    
    // Parse Google response structure using self-healing heuristic
    const rpcResponseStr = outer[0][0][1];
    const rpcResponseData = JSON.parse(rpcResponseStr);

    notebooksList = extractNotebooksFromRPC(rpcResponseData);
    console.log('Extracted notebooks:', notebooksList);
    return notebooksList;
  } catch (err) {
    console.warn('Failed to query list_notebooks RPC. Scraping DOM links instead.', err);
    // DOM Scraping fallback: search for links on home page
    const list = [];
    document.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || '';
      const match = href.match(/\/notebook\/([a-zA-Z0-9_-]+)/);
      if (match) {
        const id = match[1];
        const title = a.innerText.trim() || 'Untitled Notebook';
        if (id && !list.some(n => n.id === id) && title !== 'Folders') {
          list.push({ id, title });
        }
      }
    });
    notebooksList = list;
    return notebooksList;
  }
}

// Self-healing recursive parser for notebook rows in arbitrary JSON arrays
function extractNotebooksFromRPC(data) {
  const notebooks = [];
  function recurse(arr) {
    if (!Array.isArray(arr)) return;
    
    if (arr.length >= 2 &&
        typeof arr[0] === 'string' && arr[0].length >= 8 && arr[0].length <= 50 &&
        typeof arr[1] === 'string' && arr[1].trim().length > 0 &&
        !arr[0].includes(' ') && !arr[0].includes('\n') &&
        arr[0].match(/^[a-zA-Z0-9_-]+$/)) {
      
      if (!notebooks.some(n => n.id === arr[0])) {
        notebooks.push({
          id: arr[0],
          title: arr[1].trim()
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
  await fetchNotebooksList();
  await loadFolders();
}

// -------------------------------------------------------------
// SIDEBAR RENDERING & INTERACTIONS
// -------------------------------------------------------------
function renderSidebar() {
  const treeContainer = document.getElementById('nlm-folders-tree');
  const unorganizedContainer = document.getElementById('nlm-unorganized-list');
  if (!treeContainer || !unorganizedContainer) return;

  // 1. Render Folders Tree
  treeContainer.innerHTML = renderFolderNode(null, 0);

  // 2. Render Unorganized Notebooks
  const organizedIds = new Set();
  folderData.folders.forEach(f => {
    if (f.notebookIds) {
      f.notebookIds.forEach(id => organizedIds.add(id));
    }
  });

  const unorganized = notebooksList.filter(nb => !organizedIds.has(nb.id));
  if (unorganized.length === 0) {
    unorganizedContainer.innerHTML = `<div style="font-size: 12px; color: var(--nlm-text-secondary); text-align: center; padding: 12px;">No unorganized notebooks</div>`;
  } else {
    unorganizedContainer.innerHTML = unorganized.map(nb => `
      <div class="nlm-notebook-item" draggable="true" data-notebook-id="${nb.id}">
        <span class="nlm-notebook-icon">📓</span>
        <span class="nlm-notebook-link" data-notebook-id="${nb.id}">${nb.title}</span>
        <div class="nlm-notebook-actions">
          <button class="nlm-action-btn move-notebook-btn" data-notebook-id="${nb.id}">📂</button>
        </div>
      </div>
    `).join('');
  }

  // 3. Attach Listeners for buttons and Drag & Drop
  attachUIEventListeners();
}

function renderFolderNode(parentId, depth) {
  const nodes = folderData.folders.filter(f => f.parentId === parentId);
  let html = '';

  for (const node of nodes) {
    const childFoldersHtml = renderFolderNode(node.id, depth + 1);
    const notebooksInFolder = notebooksList.filter(n => node.notebookIds && node.notebookIds.includes(n.id));

    html += `
      <div class="nlm-folder" data-folder-id="${node.id}">
        <div class="nlm-folder-header" draggable="true" data-folder-id="${node.id}">
          <span class="nlm-folder-icon">📁</span>
          <span class="nlm-folder-title" title="${node.name}">${node.name}</span>
          <div class="nlm-folder-actions">
            <button class="nlm-action-btn rename-folder-btn" data-folder-id="${node.id}" title="Rename">✏️</button>
            <button class="nlm-action-btn add-subfolder-btn" data-folder-id="${node.id}" title="Add Subfolder">➕</button>
            <button class="nlm-action-btn delete-folder-btn" data-folder-id="${node.id}" title="Delete">🗑️</button>
          </div>
        </div>
        <div class="nlm-folder-children" data-folder-id="${node.id}">
          ${childFoldersHtml}
          ${notebooksInFolder.map(nb => `
            <div class="nlm-notebook-item" draggable="true" data-notebook-id="${nb.id}">
              <span class="nlm-notebook-icon">📓</span>
              <span class="nlm-notebook-link" data-notebook-id="${nb.id}">${nb.title}</span>
              <div class="nlm-notebook-actions">
                <button class="nlm-action-btn move-notebook-btn" data-notebook-id="${nb.id}">📂</button>
              </div>
            </div>
          `).join('')}
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
    notebookIds: []
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
      <div class="nlm-dropdown-item" data-folder-id="${f.id}">📁 ${f.name}</div>
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

    // 2. Locate Chat input & Send Button
    let inputEl = null;
    let sendBtn = null;
    let attempts = 0;

    // Retry checking DOM elements
    while (attempts < 10 && (!inputEl || !sendBtn)) {
      inputEl = document.querySelector('textarea, [contenteditable="true"]');
      sendBtn = document.querySelector('button[aria-label*="Send"], button[type="submit"], button svg[path*="send"]');
      if (!sendBtn) {
        // Fallback: search for buttons with specific class or icon
        document.querySelectorAll('button').forEach(btn => {
          if (btn.innerHTML.includes('send') || btn.getAttribute('aria-label') === 'Send') {
            sendBtn = btn;
          }
        });
      }
      
      if (!inputEl || !sendBtn) {
        attempts++;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!inputEl || !sendBtn) {
      throw new Error('Could not find chat input or send button in the notebook UI');
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
    console.log('Clicked send button, observing streaming bubbles...');

    // 5. Track streaming chat response
    await new Promise(r => setTimeout(r, 1000)); // wait briefly for message to append
    
    // Scan for message container and locate last bubble
    let bubble = null;
    let bubbleAttempts = 0;
    while (bubbleAttempts < 10 && !bubble) {
      const bubbles = document.querySelectorAll('.message-bubble, .chat-message, [data-message-author="assistant"], [role="presentation"] .markdown');
      if (bubbles.length > 0) {
        bubble = bubbles[bubbles.length - 1]; // Select most recent
      }
      if (!bubble) {
        bubbleAttempts++;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (!bubble) {
      throw new Error('Failed to find assistant response bubble in UI');
    }

    // Monitor InnerText of bubble
    let lastLength = 0;
    let textSent = '';
    let staleTicks = 0;

    const streamInterval = setInterval(() => {
      const fullText = bubble.innerText || bubble.textContent || '';
      
      if (fullText.length > lastLength) {
        const newChunk = fullText.substring(lastLength);
        chrome.runtime.sendMessage({
          id: requestId,
          type: 'chat_chunk',
          text: newChunk,
          done: false
        });
        lastLength = fullText.length;
        staleTicks = 0;
      } else {
        staleTicks++;
      }

      // If text stops updating for 2.5 seconds, finish stream
      if (staleTicks >= 25) { 
        clearInterval(streamInterval);
        chrome.runtime.sendMessage({
          id: requestId,
          type: 'chat_chunk',
          text: '',
          done: true
        });
      }
    }, 100);

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

    // 1. Locate Notebook Guide button and click it to toggle Studio Panel
    let guideBtn = document.querySelector('button[aria-label*="Guide"], button:contains("Guide"), .notebook-guide-button');
    if (!guideBtn) {
      // Fallback search
      document.querySelectorAll('button').forEach(btn => {
        if (btn.innerText.includes('Guide') || btn.innerText.includes('Notebook Guide')) {
          guideBtn = btn;
        }
      });
    }

    if (guideBtn) {
      guideBtn.click();
      await new Promise(r => setTimeout(r, 1000));
    }

    // 2. Find specific format generator button
    let formatBtn = null;
    let formatLabel = format.toLowerCase().replace('-', ' '); // e.g. "study guide" or "briefing doc"
    
    document.querySelectorAll('button, .studio-button').forEach(btn => {
      const text = btn.innerText.toLowerCase();
      if (text.includes(formatLabel) || (formatLabel.includes('briefing') && text.includes('briefing'))) {
        formatBtn = btn;
      }
    });

    if (!formatBtn) {
      throw new Error(`Could not find generation button in Studio Guide panel for format: ${format}`);
    }

    // 3. Trigger Click to generate
    formatBtn.click();
    console.log(`Clicked generate product for ${format}. Waiting for completion...`);

    // 4. Poll for output document to render in sidebar/modal
    let outputText = '';
    let success = false;
    let pollAttempts = 0;

    while (pollAttempts < 30 && !success) {
      await new Promise(r => setTimeout(r, 2000));
      pollAttempts++;

      // Search for rendered document text in studio container
      const studioPanel = document.querySelector('.studio-panel, .artifact-viewer, .guide-content');
      if (studioPanel) {
        const text = studioPanel.innerText.trim();
        if (text.length > 50 && !text.includes('Generating')) {
          outputText = text;
          success = true;
        }
      }
    }

    if (!success) {
      throw new Error('Product generation timed out waiting for UI render');
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

// Quick helper extension: jQuery-like contains selector
if (!Element.prototype.matches) {
  Element.prototype.matches = Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;
}
