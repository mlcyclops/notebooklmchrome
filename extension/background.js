let ws = null;
let reconnectTimer = null;
let keepAliveTimer = null;

// Tracks whether we have ever connected, so we only log a single calm notice
// when the optional server is offline rather than spamming the console on
// every 5-second reconnect attempt.
let hasLoggedOffline = false;

function connect() {
  if (ws) {
    try {
      ws.close();
    } catch (e) {}
  }

  try {
    ws = new WebSocket('ws://localhost:3000');
  } catch (e) {
    // Constructing the socket can throw in some environments; treat as offline.
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('Connected to companion server successfully');
    hasLoggedOffline = false;
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }

    // Keep extension service worker alive and WebSocket open using periodic ping
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'ping') return;

      console.log('Relaying request from server to content script:', message.type);

      // Find any NotebookLM tabs
      chrome.tabs.query({ url: "https://notebooklm.google.com/*" }, (tabs) => {
        if (tabs && tabs.length > 0) {
          // Prefer active/selected tab, fallback to first
          const targetTab = tabs.find(t => t.active) || tabs[0];
          chrome.tabs.sendMessage(targetTab.id, message, (response) => {
            // Check for errors sending message (e.g. content script not fully loaded yet)
            if (chrome.runtime.lastError) {
              console.warn('Could not communicate with tab content script:', chrome.runtime.lastError.message);
              if (message.id) {
                ws.send(JSON.stringify({
                  id: message.id,
                  type: 'response',
                  data: { error: 'NotebookLM tab is loading. Please refresh the page and try again.' }
                }));
              }
            }
          });
        } else {
          console.warn('No NotebookLM tabs are currently open.');
          if (message.id) {
            ws.send(JSON.stringify({
              id: message.id,
              type: 'response',
              data: { error: 'No NotebookLM tab is open in the browser. Please open https://notebooklm.google.com/' }
            }));
          }
        }
      });
    } catch (err) {
      console.error('Error handling server message:', err);
    }
  };

  ws.onclose = () => {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    // The companion server is optional. When it is absent we get an error on
    // every attempt — log a single calm, non-error notice instead of spamming
    // console.error. Folder functionality works fully without the server.
    if (!hasLoggedOffline) {
      console.log('NotebookLM companion server offline (optional). Folder features work without it; will retry in the background.');
      hasLoggedOffline = true;
    }
    // Errors are typically followed by onclose, which schedules the reconnect.
  };
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setInterval(connect, 5000);
  }
}

// Initial connection trigger
connect();

// Listen for response packets or event streams from the content scripts and send them back to the server
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    console.warn('Message discarded: Connection to companion server is not active');
  }
});
