// NotebookLM Companion Server Verification Client
const http = require('http');

const SERVER_URL = 'http://localhost:3000';

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SERVER_URL}${path}`);
    const postData = body ? JSON.stringify(body) : null;
    
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Accept': 'application/json'
      }
    };

    if (postData) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${responseBody}`));
        } else {
          try {
            resolve(JSON.parse(responseBody));
          } catch (e) {
            resolve(responseBody);
          }
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

function streamChat(notebookId, prompt) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ prompt });
    const url = new URL(`${SERVER_URL}/api/notebooks/${notebookId}/chat`);
    
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'text/event-stream'
      }
    };

    const req = http.request(options, (res) => {
      console.log(`\n======================================================`);
      console.log(`  Streaming Assistant Chat Response`);
      console.log(`  Prompt: "${prompt}"`);
      console.log(`======================================================\n`);

      res.on('data', (chunk) => {
        const chunkStr = chunk.toString();
        const lines = chunkStr.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataPayload = line.substring(6).trim();
            
            if (dataPayload === '[DONE]') {
              console.log(`\n\n======================================================`);
              console.log(`  Stream Finished Successfully`);
              console.log(`======================================================\n`);
              resolve();
              return;
            }

            try {
              const parsed = JSON.parse(dataPayload);
              if (parsed.text) {
                process.stdout.write(parsed.text);
              } else if (parsed.error) {
                console.error(`\n[Stream Error] ${parsed.error}`);
                reject(new Error(parsed.error));
              }
            } catch (e) {
              // Ignore parsing errors for empty or malformed ticks
            }
          }
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

// Main Runner
async function runTests() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  try {
    switch (command) {
      case 'status':
        console.log('Fetching server status...');
        const status = await makeRequest('/status');
        console.log('Status:', status);
        break;

      case 'folders':
        console.log('Fetching custom folder structure metadata...');
        const folders = await makeRequest('/api/folders');
        console.log('Folders Config:', JSON.stringify(folders, null, 2));
        break;

      case 'notebooks':
        console.log('Querying extension to list notebooks...');
        const notebooks = await makeRequest('/api/notebooks');
        console.log('\n--- Active NotebookLM Notebooks ---');
        notebooks.forEach((nb, index) => {
          console.log(`[${index + 1}] Title: "${nb.title}"\n    ID: ${nb.id}\n`);
        });
        break;

      case 'chat':
        const notebookId = args[1];
        const prompt = args[2];
        if (!notebookId || !prompt) {
          console.log('Usage: node test-api.js chat <notebook_id> "<prompt>"');
          return;
        }
        await streamChat(notebookId, prompt);
        break;

      case 'graph': {
        const fmt = (args[1] || 'json').toLowerCase();
        const isGraphml = fmt === 'graphml' || fmt === 'xml';
        console.log(`Exporting knowledge graph (${isGraphml ? 'GraphML' : 'JSON'})...`);
        const graph = await makeRequest(`/api/graph${isGraphml ? '?format=graphml' : ''}`);
        if (isGraphml) {
          console.log(typeof graph === 'string' ? graph : JSON.stringify(graph));
        } else {
          console.log(`Nodes: ${graph.counts.nodes} (folders ${graph.counts.folders}, notebooks ${graph.counts.notebooks}), Edges: ${graph.counts.edges}`);
          console.log(JSON.stringify(graph, null, 2));
        }
        break;
      }

      case 'generate':
        const nbId = args[1];
        const format = args[2]; // e.g. study-guide
        if (!nbId || !format) {
          console.log('Usage: node test-api.js generate <notebook_id> <format>');
          return;
        }
        console.log(`Triggering product generation for: ${format}...`);
        const result = await makeRequest(`/api/notebooks/${nbId}/generate-product`, 'POST', { format });
        console.log('\nResult:', result);
        break;

      default:
        console.log('NotebookLM API Test CLI Helper');
        console.log('-------------------------------');
        console.log('Usage:');
        console.log('  node test-api.js status                  - Check if companion server is active');
        console.log('  node test-api.js folders                 - Retrieve custom folder configurations');
        console.log('  node test-api.js notebooks               - List user\'s active notebooks (via extension)');
        console.log('  node test-api.js chat <id> "<prompt>"    - Stream real-time chat with notebook agent');
        console.log('  node test-api.js generate <id> <format>  - Trigger guide product generation (study-guide, briefing-doc, etc.)');
        console.log('  node test-api.js graph [graphml]         - Export the library as a knowledge graph (JSON, or GraphML)');
        break;
    }
  } catch (err) {
    console.error('Test Command Failed:', err.message);
  }
}

runTests();
