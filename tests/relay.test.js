// Regression test for the background.js relay (ADR-0018).
//
// The content script replies asynchronously (its listener returns false), which
// makes chrome.tabs.sendMessage's callback fire with lastError
// "The message port closed before a response was received." That is NOT a failure
// and must be ignored, or the real reply is dropped and callers always see
// "tab is loading". Only a genuine missing receiver should report an error.
//
// We load the real background.js in a vm with stubbed chrome / WebSocket and
// drive an inbound relay message under each lastError scenario.
// Run: node tests/relay.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed++; console.log('  ok -', name); }

function runScenario(lastErrorMessage) {
  let wsInstance = null;
  const sent = [];
  let sendMessageLastError = lastErrorMessage; // applied inside sendMessage cb

  const chrome = {
    tabs: {
      query: (q, cb) => cb([{ id: 1, active: true, status: 'complete' }]),
      sendMessage: (tabId, msg, cb) => {
        chrome.runtime.lastError = sendMessageLastError ? { message: sendMessageLastError } : undefined;
        cb();
        chrome.runtime.lastError = undefined;
      }
    },
    runtime: { onMessage: { addListener: () => {} }, lastError: undefined }
  };

  class FakeWebSocket {
    constructor() { wsInstance = this; this.readyState = 1; }
    send(x) { sent.push(JSON.parse(x)); }
    close() {}
  }
  FakeWebSocket.OPEN = 1;

  const sandbox = {
    chrome, WebSocket: FakeWebSocket, console: { log() {}, warn() {}, error() {} },
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8'), sandbox, { filename: 'background.js' });

  // Simulate the server asking the extension for notebooks.
  wsInstance.onmessage({ data: JSON.stringify({ id: 'req1', type: 'list_notebooks' }) });

  return sent;
}

// 1. Async-reply case: "message port closed" must be ignored (no error sent),
//    so the real reply (arriving later via runtime.sendMessage) is not pre-empted.
const portClosed = runScenario('The message port closed before a response was received.');
check('a "message port closed" ack does NOT send an error response',
  !portClosed.some(m => m.id === 'req1' && m.data && m.data.error));

// 2. Genuine missing content script: must report the helpful error.
const noReceiver = runScenario('Could not establish connection. Receiving end does not exist.');
check('a missing content script DOES report "tab is loading"',
  noReceiver.some(m => m.id === 'req1' && m.data && /tab is loading/i.test(m.data.error)));

// 3. No error at all: nothing is sent from the relay callback.
const clean = runScenario(null);
check('a clean ack sends nothing from the relay callback (real reply comes separately)',
  !clean.some(m => m.id === 'req1'));

console.log(`\n${passed}/${passed} relay assertions passed.`);
