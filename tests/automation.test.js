// Dependency-free unit tests for the hardened chat/generate automation primitives
// (ADR-0010): resolveElement, waitForElement, waitForStableText.
//
// jsdom is not available, so we load the REAL extension/content.js inside a Node
// `vm` sandbox with hand-stubbed globals. init() is guarded behind
// `document.readyState === 'loading'`, which we set so the heavy DOM bootstrap
// never runs; only the top-level function/const declarations execute, giving us
// the genuine functions to exercise.
//
// Run: node tests/automation.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log('  ok -', name);
}

// ---- Controllable stubs -------------------------------------------------

// MutationObserver registry so tests can deterministically "fire" mutations.
const observers = [];
class FakeMutationObserver {
  constructor(cb) { this.cb = cb; this.active = false; observers.push(this); }
  observe() { this.active = true; }
  disconnect() { this.active = false; }
}
function fireMutations() {
  for (const o of observers) if (o.active) { try { o.cb([], o); } catch (e) {} }
}

// Minimal fake element with mutable text.
function makeEl(text, attrs) {
  return {
    _text: text || '',
    attrs: attrs || {},
    get innerText() { return this._text; },
    get textContent() { return this._text; },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  };
}

// A query scope whose querySelector/querySelectorAll are driven by maps.
function makeScope(single, all) {
  return {
    querySelector(sel) { return single[sel] || null; },
    querySelectorAll(sel) { return all[sel] || []; }
  };
}

// document stub: 'loading' so init() does NOT run on load.
const documentStub = makeScope({}, {});
documentStub.readyState = 'loading';
documentStub.addEventListener = () => {};
documentStub.body = {};
documentStub.documentElement = {};

const sandbox = {
  document: documentStub,
  window: {},
  chrome: { runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} }, tabs: {}, storage: { local: {}, sync: {}, onChanged: { addListener: () => {} } } },
  MutationObserver: FakeMutationObserver,
  console: { log() {}, warn() {}, error(...a) { console.error(...a); } },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  fetch: () => Promise.reject(new Error('no network in test')),
  navigator: { userAgent: 'test' },
  location: { href: 'https://notebooklm.google.com/' }
};
sandbox.globalThis = sandbox;

const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'content.js' });

const { resolveElement, resolveAllElements, waitForElement, waitForStableText } = sandbox;

(async () => {
  // ---- resolveElement -------------------------------------------------
  // Priority: first two strategies miss, 'textarea' (3rd) hits → returns it.
  const textarea = makeEl('', { });
  const scope1 = makeScope({ 'textarea': textarea }, {});
  check('resolveElement returns first matching strategy in priority order',
    resolveElement('chatInput', scope1) === textarea);

  // Unknown target key → null (and warns, swallowed by stub).
  check('resolveElement returns null for an unknown target key',
    resolveElement('does-not-exist', scope1) === null);

  // Text-match fallback: all CSS sendButton strategies miss, {buttonText:'Send'}
  // resolves via findButtonByText against document.querySelectorAll.
  const sendBtn = makeEl('Send', {});
  documentStub.querySelectorAll = (sel) => (sel === 'button, [role="button"]' ? [sendBtn] : []);
  const scopeNoCss = makeScope({}, {});
  check('resolveElement falls back to a text/aria strategy when CSS misses',
    resolveElement('sendButton', scopeNoCss) === sendBtn);
  documentStub.querySelectorAll = () => [];

  // resolveAllElements de-dupes across strategies.
  const r = makeEl('a', {});
  const scopeAll = makeScope({}, { '[data-message-author="assistant"]': [r], '.message-bubble': [r] });
  check('resolveAllElements de-dupes elements matched by multiple strategies',
    resolveAllElements('chatResponse', scopeAll).length === 1);

  // ---- waitForElement -------------------------------------------------
  // Immediate synchronous hit.
  const hit = makeEl('x', {});
  check('waitForElement resolves immediately when the probe already matches',
    (await waitForElement(() => hit, { timeout: 1000 })) === hit);

  // Resolves on a later mutation.
  let appeared = null;
  const pMut = waitForElement(() => appeared, { timeout: 1000 });
  setTimeout(() => { appeared = makeEl('late', {}); fireMutations(); }, 10);
  check('waitForElement resolves once the element appears via a mutation',
    (await pMut) === appeared && appeared !== null);

  // Times out to null when nothing ever matches.
  check('waitForElement resolves null on timeout',
    (await waitForElement(() => null, { timeout: 30 })) === null);

  // ---- waitForStableText ---------------------------------------------
  // Streaming then quiet: forwards progress, resolves with final text.
  const stream = makeEl('Hel', {});
  const progress = [];
  const pStable = waitForStableText(stream, { quietMs: 40, timeout: 2000, onProgress: t => progress.push(t) });
  setTimeout(() => { stream._text = 'Hello'; fireMutations(); }, 10);
  setTimeout(() => { stream._text = 'Hello world'; fireMutations(); }, 25);
  const finalText = await pStable;
  check('waitForStableText resolves with the final text after it goes quiet',
    finalText === 'Hello world');
  check('waitForStableText forwards incremental progress while streaming',
    progress.length >= 2 && progress[progress.length - 1] === 'Hello world');

  // Already-complete (no mutations): resolves with the present text after quiet.
  const done = makeEl('Complete answer', {});
  check('waitForStableText settles a non-streaming/complete reply',
    (await waitForStableText(done, { quietMs: 30, timeout: 2000 })) === 'Complete answer');

  console.log(`\n${passed}/${passed} automation assertions passed.`);
})().catch(err => { console.error('TEST FAILURE:', err); process.exit(1); });
