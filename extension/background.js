let ws = null;
let reconnectTimer = null;
let keepAliveTimer = null;

function connect() {
  console.log('Attempting to connect to NotebookLM companion server...');
  
  if (ws) {
    try {
      ws.close();
    } catch (e) {}
  }

  ws = new WebSocket('ws://localhost:3000');

  ws.onopen = () => {
    console.log('Connected to companion server successfully');
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
    console.log('WebSocket closed. Retrying connection in 5 seconds...');
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
    if (!reconnectTimer) {
      reconnectTimer = setInterval(connect, 5000);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket connection error:', err);
  };
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
