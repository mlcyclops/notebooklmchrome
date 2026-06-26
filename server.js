const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let clients = [];
const pendingRequests = new Map();
const pendingStreams = new Map();

// Helper function to send requests to the Chrome extension
function sendRequestToExtension(type, data) {
  return new Promise((resolve, reject) => {
    if (clients.length === 0) {
      return reject(new Error('No active Chrome extension client connected to companion server'));
    }
    const id = Math.random().toString(36).substring(2, 9);
    const message = { id, type, data };
    
    // Route to the most recently active connection
    const client = clients[clients.length - 1];
    
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Timeout: Extension took too long to respond (30s)'));
    }, 30000);

    pendingRequests.set(id, { resolve, reject, timeout });
    client.send(JSON.stringify(message));
  });
}

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  console.log('Client extension connected to WebSocket server');
  clients.push(ws);

  ws.on('close', () => {
    console.log('Client extension disconnected');
    clients = clients.filter(c => c !== ws);
  });

  ws.on('message', (messageStr) => {
    try {
      const message = JSON.parse(messageStr);
      
      if (message.type === 'response') {
        const pending = pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingRequests.delete(message.id);
          pending.resolve(message.data);
        }
      } else if (message.type === 'chat_chunk') {
        const stream = pendingStreams.get(message.id);
        if (stream) {
          if (message.done) {
            stream.res.write(`data: [DONE]\n\n`);
            stream.res.end();
            pendingStreams.delete(message.id);
          } else {
            stream.res.write(`data: ${JSON.stringify({ text: message.text })}\n\n`);
          }
        }
      } else if (message.type === 'chat_error') {
        const stream = pendingStreams.get(message.id);
        if (stream) {
          stream.res.write(`data: ${JSON.stringify({ error: message.error })}\n\n`);
          stream.res.end();
          pendingStreams.delete(message.id);
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });
});

// REST Endpoints
app.get('/api/folders', (req, res) => {
  const dbPath = path.join(__dirname, 'folders.json');
  fs.readFile(dbPath, 'utf8', (err, data) => {
    if (err) {
      // The folders.json file is created lazily on first POST. If it does not
      // exist yet (first run), return a sensible empty default instead of 500.
      if (err.code === 'ENOENT') {
        return res.json({ folders: [] });
      }
      return res.status(500).json({ error: 'Failed to read folders list database' });
    }
    try {
      res.json(JSON.parse(data));
    } catch (e) {
      res.status(500).json({ error: 'Malformed folders database file' });
    }
  });
});

app.post('/api/folders', (req, res) => {
  const dbPath = path.join(__dirname, 'folders.json');
  const foldersData = req.body;
  
  if (!foldersData || !Array.isArray(foldersData.folders)) {
    return res.status(400).json({ error: 'Invalid payload: folders must be an array' });
  }

  fs.writeFile(dbPath, JSON.stringify(foldersData, null, 2), 'utf8', (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to write folders data' });
    }
    res.json({ success: true });
  });
});

app.get('/api/notebooks', async (req, res) => {
  try {
    const response = await sendRequestToExtension('list_notebooks', {});
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notebooks/:id/chat', (req, res) => {
  const notebookId = req.params.id;
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  if (clients.length === 0) {
    return res.status(503).json({ error: 'No active extension client connected to server' });
  }

  // Set HTTP headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const streamId = Math.random().toString(36).substring(2, 9);
  pendingStreams.set(streamId, { res });

  // Instruct active client extension to trigger chat stream
  const client = clients[clients.length - 1];
  client.send(JSON.stringify({
    id: streamId,
    type: 'chat_request',
    data: { notebookId, prompt }
  }));

  // Clean up stream if request is terminated by client/caller
  req.on('close', () => {
    pendingStreams.delete(streamId);
    if (clients.length > 0) {
      clients[clients.length - 1].send(JSON.stringify({
        id: streamId,
        type: 'cancel_stream'
      }));
    }
  });
});

app.post('/api/notebooks/:id/generate-product', async (req, res) => {
  const notebookId = req.params.id;
  const { format, description, instructions } = req.body;

  if (!format) {
    return res.status(400).json({ error: 'Product format (e.g. briefing-doc, study-guide, faq, timeline) is required' });
  }

  try {
    const result = await sendRequestToExtension('generate_product', {
      notebookId,
      format,
      description,
      instructions
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback status check endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    connectedClients: clients.length,
    activeRequests: pendingRequests.size,
    activeStreams: pendingStreams.size
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  NotebookLM Companion Server running on port ${PORT}`);
  console.log(`  WebSocket Server attached to Express Server`);
  console.log(`====================================================`);
});
