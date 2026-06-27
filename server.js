const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { buildGraph, toJSON, toGraphML } = require('./lib/knowledge-graph');
const pipeline = require('./lib/automation-pipeline');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());

// Atlas: the Research & Podcast Studio web app (ADR-0014). Open http://localhost:3000/atlas
app.use('/atlas', express.static(path.join(__dirname, 'atlas')));

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

// Shared snapshot helpers (used by the graph + automation endpoints). Folders
// come from folders.json; notebooks are fetched live from a connected extension,
// falling back to an empty list when none is connected.
function getFoldersFromDisk() {
  return new Promise((resolve) => {
    fs.readFile(path.join(__dirname, 'folders.json'), 'utf8', (err, data) => {
      if (err) return resolve([]);
      try {
        const parsed = JSON.parse(data);
        resolve(Array.isArray(parsed.folders) ? parsed.folders : []);
      } catch (e) { resolve([]); }
    });
  });
}
async function getNotebooksLive() {
  try {
    const resp = await sendRequestToExtension('list_notebooks', {});
    if (Array.isArray(resp)) return resp;
    if (resp && Array.isArray(resp.notebooks)) return resp.notebooks;
    return [];
  } catch (e) { return []; }
}
async function getSnapshot() {
  const [folders, notebooks] = await Promise.all([getFoldersFromDisk(), getNotebooksLive()]);
  return { folders, notebooks };
}
// Run one generate-product job against the connected extension.
function runGenerateJob(job) {
  return sendRequestToExtension('generate_product', { notebookId: job.notebookId, format: job.format });
}

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

// Export the whole library as a knowledge graph (ADR-0011).
// Folders come from folders.json; notebooks are fetched live from the extension
// when one is connected, otherwise the graph is built from the folder structure
// alone (folder-referenced notebooks still appear as nodes). Use
// `?format=graphml` for GraphML (yEd / Gephi / Cytoscape), default is JSON.
app.get('/api/graph', (req, res) => {
  const dbPath = path.join(__dirname, 'folders.json');

  const readFolders = () => new Promise((resolve) => {
    fs.readFile(dbPath, 'utf8', (err, data) => {
      if (err) return resolve([]); // no folders.json yet => empty structure
      try {
        const parsed = JSON.parse(data);
        resolve(Array.isArray(parsed.folders) ? parsed.folders : []);
      } catch (e) { resolve([]); }
    });
  });

  const readNotebooks = async () => {
    try {
      const resp = await sendRequestToExtension('list_notebooks', {});
      if (Array.isArray(resp)) return resp;
      if (resp && Array.isArray(resp.notebooks)) return resp.notebooks;
      return [];
    } catch (e) {
      return []; // extension offline: build from folders alone
    }
  };

  Promise.all([readFolders(), readNotebooks()]).then(([folders, notebooks]) => {
    const graph = buildGraph({ folders, notebooks });
    const meta = { generatedAt: new Date().toISOString() };
    const format = String(req.query.format || '').toLowerCase();

    if (format === 'graphml' || format === 'xml') {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="knowledge-graph.graphml"');
      return res.send(toGraphML(graph, meta));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(toJSON(graph, meta));
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
});

// ---- Automation: podcast pipeline + study packs (ADR-0013) ----
// Plan endpoints are pure dry-runs (no extension needed). Execute endpoints drive
// the experimental generate-product automation and need a connected extension;
// each job's outcome is captured, never thrown.

app.get('/api/folders/:id/podcast/plan', async (req, res) => {
  const snapshot = await getSnapshot();
  res.json(pipeline.planPodcast(req.params.id, snapshot, { format: req.query.format }));
});

app.post('/api/folders/:id/podcast', async (req, res) => {
  const snapshot = await getSnapshot();
  const plan = pipeline.planPodcast(req.params.id, snapshot, { format: (req.body && req.body.format) });
  if (req.query.dryRun) return res.json({ plan, results: null, dryRun: true });
  const results = await pipeline.runPlan(plan.episodes, runGenerateJob, { concurrency: 1, retries: 1 });
  res.json({ plan, results });
});

app.get('/api/folders/:id/study-pack/plan', async (req, res) => {
  const snapshot = await getSnapshot();
  const formats = req.query.formats ? String(req.query.formats).split(',') : undefined;
  res.json(pipeline.planStudyPack(req.params.id, snapshot, { formats }));
});

app.post('/api/folders/:id/study-pack', async (req, res) => {
  const snapshot = await getSnapshot();
  const formats = (req.body && Array.isArray(req.body.formats)) ? req.body.formats : undefined;
  const plan = pipeline.planStudyPack(req.params.id, snapshot, { formats });
  if (req.query.dryRun) return res.json({ plan, results: null, dryRun: true });
  const results = await pipeline.runPlan(plan.jobs, runGenerateJob, { concurrency: 1, retries: 1 });
  res.json({ plan, results });
});

// ---- Watch mode (ADR-0013) ----
// Polls the snapshot on an interval; when a folder gains notebooks it computes a
// regen plan. With autoGenerate on it executes that plan (best-effort), otherwise
// it just records the pending changes for GET /api/watch/plan to surface.
const watchState = {
  active: false,
  intervalMs: 60000,
  autoGenerate: false,
  timer: null,
  baseline: null,        // snapshot at last check
  lastCheckedAt: null,
  lastChanges: [],
  generating: false
};

async function watchTick() {
  if (watchState.generating) return; // don't overlap a long generation run
  const current = await getSnapshot();
  const changes = pipeline.diffForWatch(watchState.baseline || { folders: [] }, current);
  watchState.lastCheckedAt = new Date().toISOString();
  watchState.baseline = current;
  if (changes.length === 0) return;
  watchState.lastChanges = changes;
  console.log(`Watch: ${changes.length} folder change(s) detected.`);
  if (watchState.autoGenerate) {
    const jobs = pipeline.planRegen(changes, current, {});
    watchState.generating = true;
    try {
      await pipeline.runPlan(jobs, runGenerateJob, { concurrency: 1, retries: 1 });
    } finally {
      watchState.generating = false;
    }
  }
}

app.post('/api/watch', async (req, res) => {
  const intervalMs = Math.max(5000, Number(req.body && req.body.intervalMs) || 60000);
  watchState.intervalMs = intervalMs;
  watchState.autoGenerate = !!(req.body && req.body.autoGenerate);
  watchState.baseline = await getSnapshot(); // baseline = now, so only future changes fire
  watchState.lastChanges = [];
  if (watchState.timer) clearInterval(watchState.timer);
  watchState.timer = setInterval(() => { watchTick().catch(() => {}); }, intervalMs);
  watchState.active = true;
  res.json({ active: true, intervalMs, autoGenerate: watchState.autoGenerate });
});

app.post('/api/watch/stop', (req, res) => {
  if (watchState.timer) clearInterval(watchState.timer);
  watchState.timer = null;
  watchState.active = false;
  res.json({ active: false });
});

app.get('/api/watch', (req, res) => {
  res.json({
    active: watchState.active,
    intervalMs: watchState.intervalMs,
    autoGenerate: watchState.autoGenerate,
    lastCheckedAt: watchState.lastCheckedAt,
    pendingChanges: watchState.lastChanges
  });
});

// Dry-run: what would watch regenerate right now, given the current state vs the
// baseline captured when watch started (or an empty baseline if not started)?
app.get('/api/watch/plan', async (req, res) => {
  const current = await getSnapshot();
  const changes = pipeline.diffForWatch(watchState.baseline || { folders: [] }, current);
  const jobs = pipeline.planRegen(changes, current, {});
  res.json({ changes, jobs });
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
