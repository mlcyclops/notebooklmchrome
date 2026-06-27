// Atlas client (ADR-0014). Talks only to the companion server's API and renders
// with the shared, tested AtlasView helpers. Degrades gracefully when endpoints
// are empty or the extension is offline.
(function () {
  'use strict';
  var V = window.AtlasView;
  var state = { folders: [], selected: null, watch: false, connected: false };

  function $(id) { return document.getElementById(id); }
  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var ct = r.headers.get('content-type') || '';
      return ct.indexOf('application/json') >= 0 ? r.json() : r.text();
    });
  }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---- connection status ----
  function loadStatus() {
    api('/status').then(function (s) {
      var label = V.connectionLabel(s);
      $('status-text').textContent = label + ' · ' + location.host;
      $('status').classList.toggle('off', label !== 'Connected');
      if (s && s.version) {
        var v = 'v' + s.version;
        $('help-version').textContent = v;
        $('help-version2').textContent = v;
      }
      // When no extension is connected, the library/notebooks cannot load. Tell
      // the user how to fix it instead of just showing an empty list.
      var connected = label === 'Connected';
      if (!connected && !state.folders.length) showConnectHint();
      // Auto-populate when the extension connects after Atlas opened, or whenever
      // we are connected but the library is still empty (no manual reload needed).
      if (connected && (!state.connected || !state.folders.length)) {
        loadFolders();
        loadGraph();
      }
      state.connected = connected;
    }).catch(function () {
      $('status-text').textContent = 'Server offline';
      $('status').classList.add('off');
    });
  }

  function showConnectHint() {
    $('folders').innerHTML =
      '<div class="empty-state">No extension connected.<br><br>' +
      '1. Load the <b>Folderizer</b> extension in your browser ' +
      '(<code>chrome://extensions</code> &rarr; Developer mode &rarr; Load unpacked &rarr; the <code>extension</code> folder).<br><br>' +
      '2. Open <a href="https://notebooklm.google.com/" target="_blank" rel="noopener">notebooklm.google.com</a> and keep the tab open.<br><br>' +
      'The extension connects on port <b>3000</b>, so this app must be the server running there. Then your folders and notebooks appear here.</div>';
  }

  // ---- library + folder select ----
  function loadFolders() {
    return api('/api/folders').then(function (data) {
      state.folders = (data && data.folders) || [];
      renderFolders();
      renderFolderSelect();
    }).catch(function () {
      $('folders').innerHTML = '<div class="empty-state">No folders yet. Create some in NotebookLM.</div>';
    });
  }
  function renderFolders() {
    var rows = V.buildSidebar(state.folders);
    if (!rows.length) { $('folders').innerHTML = '<div class="empty-state">No folders yet.</div>'; return; }
    $('folders').innerHTML = rows.map(function (r) {
      return '<div class="folder' + (r.count ? '' : ' empty') + (r.id === state.selected ? ' active' : '') +
        '" data-id="' + esc(r.id) + '" style="padding-left:' + (12 + r.depth * 16) + 'px">' +
        '<span>📁</span><span class="name">' + esc(r.name) + '</span><span class="count">' + r.count + '</span></div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.folder'), function (el) {
      el.addEventListener('click', function () { selectFolder(el.getAttribute('data-id')); });
    });
  }
  function renderFolderSelect() {
    var rows = V.buildSidebar(state.folders);
    $('folder-select').innerHTML = '<option value="">Select a folder...</option>' +
      rows.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.name) + ' (' + r.count + ')</option>'; }).join('');
  }

  function selectFolder(id) {
    state.selected = id;
    $('folder-select').value = id;
    renderFolders();
    $('plan-btn').disabled = !id;
    $('generate-btn').disabled = !id;
    $('studypack-btn').disabled = !id;
    if (id) { planPodcast(id); planStudy(id); }
  }

  // ---- podcast ----
  function planPodcast(id) {
    $('episode-list').innerHTML = '<div class="empty-state">Planning...</div>';
    api('/api/folders/' + encodeURIComponent(id) + '/podcast/plan').then(function (plan) {
      renderEpisodes(V.episodeRows(plan));
    }).catch(function () { $('episode-list').innerHTML = '<div class="empty-state">Could not plan.</div>'; });
  }
  function renderEpisodes(rows, results) {
    if (!rows.length) { $('episode-list').innerHTML = '<div class="empty-state">This folder has no notebooks to narrate.</div>'; return; }
    $('episode-list').innerHTML = rows.map(function (r, i) {
      var badge = '<span class="badge">' + esc(r.status) + '</span>';
      if (results && results[i]) badge = results[i].ok ? '<span class="badge ok">Generated</span>' : '<span class="badge fail">Failed</span>';
      return '<div class="queue-item"><span class="t">Ep ' + r.episode + ' · ' + esc(r.title) + '</span>' + badge + '</div>';
    }).join('');
  }
  function generatePodcast() {
    if (!state.selected) return;
    $('generate-btn').disabled = true; $('generate-btn').textContent = 'Generating...';
    api('/api/folders/' + encodeURIComponent(state.selected) + '/podcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (out) {
        renderEpisodes(V.episodeRows(out.plan), out.results);
        var s = V.summarizeResults(out.results);
        toast('Podcast: ' + s.ok + ' generated, ' + s.failed + ' failed.');
      })
      .catch(function () { toast('Generation failed (is the extension connected?).'); })
      .then(function () { $('generate-btn').disabled = false; $('generate-btn').textContent = 'Generate episodes'; });
  }

  // ---- study pack ----
  function planStudy(id) {
    api('/api/folders/' + encodeURIComponent(id) + '/study-pack/plan').then(function (plan) {
      var groups = V.studyGroups(plan);
      var byFmt = {}; groups.forEach(function (g) { byFmt[g.format] = g.count; });
      $('st-guides').textContent = byFmt['study-guide'] || 0;
      $('st-faq').textContent = (byFmt['faq'] || 0) + (byFmt['timeline'] || 0);
      $('study-chips').innerHTML = groups.length
        ? groups.map(function (g) { return '<span class="chip"><b>' + g.count + '</b> ' + esc(g.format) + '</span>'; }).join('')
        : '<span class="chip muted">No notebooks in this folder</span>';
    }).catch(function () {});
  }
  function generateStudy() {
    if (!state.selected) return;
    $('studypack-btn').disabled = true; $('studypack-btn').textContent = 'Generating...';
    api('/api/folders/' + encodeURIComponent(state.selected) + '/study-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (out) { var s = V.summarizeResults(out.results); toast('Study pack: ' + s.ok + ' generated, ' + s.failed + ' failed.'); })
      .catch(function () { toast('Generation failed (is the extension connected?).'); })
      .then(function () { $('studypack-btn').disabled = false; $('studypack-btn').textContent = 'Generate study pack'; });
  }

  // ---- watch ----
  function toggleWatch() {
    state.watch = !state.watch;
    var sw = $('watch-switch');
    sw.classList.toggle('on', state.watch);
    sw.setAttribute('aria-checked', String(state.watch));
    var req = state.watch
      ? api('/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intervalMs: 60000, autoGenerate: false }) })
      : api('/api/watch/stop', { method: 'POST' });
    req.then(function () { toast(state.watch ? 'Watch mode on (detect-only).' : 'Watch mode off.'); })
       .catch(function () { toast('Could not change watch mode.'); });
  }

  // ---- knowledge graph (concentric layout) ----
  function loadGraph() {
    api('/api/graph').then(function (env) {
      renderGraph(env && env.graph ? env.graph : env);
    }).catch(function () {});
  }
  function renderGraph(g) {
    var svg = $('graph');
    var W = 240, H = 190, cx = W / 2, cy = H / 2;
    var folders = (g.nodes || []).filter(function (n) { return n.type === 'folder'; });
    var notebooks = (g.nodes || []).filter(function (n) { return n.type === 'notebook'; });
    var parts = [];
    function ring(items, radius, r, fill, stroke) {
      return items.map(function (n, i) {
        var a = (i / Math.max(1, items.length)) * Math.PI * 2 - Math.PI / 2;
        n._x = cx + Math.cos(a) * radius; n._y = cy + Math.sin(a) * radius;
        return '<circle cx="' + n._x.toFixed(1) + '" cy="' + n._y.toFixed(1) + '" r="' + r + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="1.5"' : '') + '/>';
      }).join('');
    }
    var nbDots = ring(notebooks, 78, 3.4, '#c4b5fd', null);
    var fDots = ring(folders, 42, 6, '#7c3aed', '#c4b5fd');
    // edges folder->notebook (by id lookup)
    var pos = {}; (g.nodes || []).forEach(function (n) { pos[n.id] = n; });
    var lines = (g.edges || []).map(function (e) {
      var a = pos[e.source], b = pos[e.target];
      if (!a || !b || a._x == null || b._x == null) return '';
      var col = e.type === 'shared-topic' ? '#f472b6' : '#3b3460';
      return '<line x1="' + a._x.toFixed(1) + '" y1="' + a._y.toFixed(1) + '" x2="' + b._x.toFixed(1) + '" y2="' + b._y.toFixed(1) + '" stroke="' + col + '" stroke-width="1"/>';
    }).join('');
    var root = '<circle cx="' + cx + '" cy="' + cy + '" r="9" fill="#a78bfa"/>';
    if (!folders.length && !notebooks.length) {
      svg.innerHTML = '<text x="' + cx + '" y="' + cy + '" fill="#6f6a88" font-size="11" text-anchor="middle">Graph appears once you have folders</text>';
      return;
    }
    svg.innerHTML = lines + nbDots + fDots + root;
  }

  // ---- wire up ----
  $('folder-select').addEventListener('change', function () { selectFolder(this.value); });
  $('plan-btn').addEventListener('click', function () { if (state.selected) { planPodcast(state.selected); planStudy(state.selected); } });
  $('generate-btn').addEventListener('click', generatePodcast);
  $('studypack-btn').addEventListener('click', generateStudy);
  $('watch-switch').addEventListener('click', toggleWatch);
  $('watch-switch').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleWatch(); } });

  // ---- help / about popup ----
  function openHelp() { $('help-overlay').hidden = false; }
  function closeHelp() { $('help-overlay').hidden = true; }
  $('help-btn').addEventListener('click', openHelp);
  $('help-close').addEventListener('click', closeHelp);
  $('help-overlay').addEventListener('click', function (e) { if (e.target === this) closeHelp(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('help-overlay').hidden) closeHelp(); });

  loadStatus();
  loadFolders();
  loadGraph();
  setInterval(loadStatus, 8000);
})();
