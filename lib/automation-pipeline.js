// Automation orchestration: podcast pipeline, study packs, and watch mode
// (ADR-0013).
//
// Pure and dependency-injected. Planning turns a folder + the library snapshot
// into an ordered list of `generate-product` jobs; execution runs a plan against
// an injected `runJob` (the server passes one that calls the extension); watch
// diffing turns "what changed" into "what to (re)generate". Nothing here touches
// the network, the filesystem, or the DOM, so it is fully unit-testable. The
// actual generation it drives is experimental/best-effort (ADR-0010).

'use strict';

const DEFAULT_STUDY_FORMATS = ['study-guide', 'briefing-doc', 'faq', 'timeline'];
const PODCAST_FORMAT = 'audio-overview';

function asArray(v) { return Array.isArray(v) ? v : []; }
function str(v) { return v == null ? '' : String(v); }

function findFolder(folders, folderId) {
  const id = str(folderId);
  return asArray(folders).find(f => f && str(f.id) === id) || null;
}

function notebookTitle(notebooks, id) {
  const nb = asArray(notebooks).find(n => n && str(n.id) === str(id));
  return nb && nb.title ? str(nb.title) : str(id);
}

// Plan a podcast series for a folder: one episode per notebook, in order.
function planPodcast(folderId, snapshot, options) {
  const opts = options || {};
  const folders = asArray(snapshot && snapshot.folders);
  const notebooks = asArray(snapshot && snapshot.notebooks);
  const folder = findFolder(folders, folderId);
  if (!folder) return { folderId: str(folderId), folderName: null, episodes: [] };

  const ids = asArray(folder.notebookIds);
  const episodes = ids.map((nbId, i) => ({
    episode: i + 1,
    notebookId: str(nbId),
    title: `${str(folder.name)} · Ep ${i + 1}: ${notebookTitle(notebooks, nbId)}`,
    format: opts.format || PODCAST_FORMAT
  }));
  return { folderId: str(folder.id), folderName: str(folder.name), episodes };
}

// Plan a study pack for a folder: each notebook x each requested format.
function planStudyPack(folderId, snapshot, options) {
  const opts = options || {};
  const formats = asArray(opts.formats).length ? opts.formats : DEFAULT_STUDY_FORMATS;
  const folders = asArray(snapshot && snapshot.folders);
  const notebooks = asArray(snapshot && snapshot.notebooks);
  const folder = findFolder(folders, folderId);
  if (!folder) return { folderId: str(folderId), folderName: null, jobs: [] };

  const jobs = [];
  for (const nbId of asArray(folder.notebookIds)) {
    for (const format of formats) {
      jobs.push({ notebookId: str(nbId), title: notebookTitle(notebooks, nbId), format: str(format) });
    }
  }
  return { folderId: str(folder.id), folderName: str(folder.name), jobs };
}

// Execute a list of jobs against an injected async runJob(job) -> result.
// Sequential by default (NotebookLM realistically generates one product at a
// time); concurrency>1 uses a simple pool. Retries failed jobs up to `retries`
// extra attempts. Never throws: each job yields { job, ok, attempts, result|error }.
async function runPlan(jobs, runJob, options) {
  const opts = options || {};
  const concurrency = Math.max(1, opts.concurrency || 1);
  const retries = Math.max(0, opts.retries == null ? 1 : opts.retries);
  const list = asArray(jobs);
  const results = new Array(list.length);

  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      const job = list[i];
      let attempt = 0;
      let lastErr = null;
      while (attempt <= retries) {
        attempt++;
        try {
          const result = await runJob(job);
          results[i] = { job, ok: true, attempts: attempt, result };
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) {
        results[i] = { job, ok: false, attempts: attempt, error: str(lastErr && lastErr.message || lastErr) };
      }
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(concurrency, list.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// Snapshot helper: map of folderId -> Set(notebookIds).
function folderMembership(folders) {
  const m = new Map();
  for (const f of asArray(folders)) {
    if (!f || f.id == null) continue;
    m.set(str(f.id), new Set(asArray(f.notebookIds).map(str)));
  }
  return m;
}

// Watch diff: compare a previous snapshot to the current one and report folders
// that are new or that gained notebooks. Returns
// [{ folderId, folderName, addedNotebookIds, isNew }].
function diffForWatch(prevSnapshot, currSnapshot) {
  const prev = folderMembership(prevSnapshot && prevSnapshot.folders);
  const currFolders = asArray(currSnapshot && currSnapshot.folders);
  const changes = [];
  for (const f of currFolders) {
    if (!f || f.id == null) continue;
    const id = str(f.id);
    const currIds = asArray(f.notebookIds).map(str);
    const prevSet = prev.get(id);
    const isNew = !prevSet;
    const added = currIds.filter(nb => !prevSet || !prevSet.has(nb));
    if (isNew && currIds.length === 0) continue; // new but empty folder: nothing to do
    if (added.length > 0) {
      changes.push({ folderId: id, folderName: str(f.name), addedNotebookIds: added, isNew: !!isNew });
    }
  }
  return changes;
}

// Turn a watch diff into concrete jobs to (re)generate. By default builds a
// podcast episode for each added notebook plus a study pack across the requested
// formats for those notebooks.
function planRegen(changes, snapshot, options) {
  const opts = options || {};
  const formats = asArray(opts.formats).length ? opts.formats : DEFAULT_STUDY_FORMATS;
  const kinds = asArray(opts.kinds).length ? opts.kinds : ['podcast', 'study-pack'];
  const notebooks = asArray(snapshot && snapshot.notebooks);
  const jobs = [];
  for (const change of asArray(changes)) {
    for (const nbId of asArray(change.addedNotebookIds)) {
      if (kinds.includes('podcast')) {
        jobs.push({ folderId: change.folderId, notebookId: str(nbId), title: notebookTitle(notebooks, nbId), format: PODCAST_FORMAT });
      }
      if (kinds.includes('study-pack')) {
        for (const format of formats) {
          jobs.push({ folderId: change.folderId, notebookId: str(nbId), title: notebookTitle(notebooks, nbId), format: str(format) });
        }
      }
    }
  }
  return jobs;
}

module.exports = {
  planPodcast,
  planStudyPack,
  runPlan,
  diffForWatch,
  planRegen,
  folderMembership,
  DEFAULT_STUDY_FORMATS,
  PODCAST_FORMAT
};
