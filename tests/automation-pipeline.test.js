// Tests for lib/automation-pipeline.js (ADR-0013). Dependency-free.
// Run: node tests/automation-pipeline.test.js

const assert = require('assert');
const {
  planPodcast, planStudyPack, runPlan, diffForWatch, planRegen,
  DEFAULT_STUDY_FORMATS, PODCAST_FORMAT
} = require('../lib/automation-pipeline');

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed++; console.log('  ok -', name); }

const snapshot = {
  folders: [
    { id: 'f1', name: 'Compliance', parentId: null, notebookIds: ['n1', 'n2'] },
    { id: 'f2', name: 'Empty', parentId: null, notebookIds: [] }
  ],
  notebooks: [
    { id: 'n1', title: 'SOC 2' },
    { id: 'n2', title: 'Evidence' }
  ]
};

// ---- planPodcast ----
const pod = planPodcast('f1', snapshot);
check('planPodcast makes one episode per notebook, numbered in order',
  pod.episodes.length === 2 && pod.episodes[0].episode === 1 && pod.episodes[1].episode === 2);
check('planPodcast uses the audio-overview format',
  pod.episodes.every(e => e.format === PODCAST_FORMAT));
check('planPodcast titles include folder + notebook title',
  pod.episodes[0].title.includes('Compliance') && pod.episodes[0].title.includes('SOC 2'));
check('planPodcast on a missing folder returns empty episodes',
  planPodcast('nope', snapshot).episodes.length === 0);
check('planPodcast on an empty folder returns no episodes',
  planPodcast('f2', snapshot).episodes.length === 0);

// ---- planStudyPack ----
const sp = planStudyPack('f1', snapshot);
check('planStudyPack default = each notebook x 4 formats',
  sp.jobs.length === 2 * DEFAULT_STUDY_FORMATS.length);
check('planStudyPack respects a custom format list',
  planStudyPack('f1', snapshot, { formats: ['faq'] }).jobs.length === 2 &&
  planStudyPack('f1', snapshot, { formats: ['faq'] }).jobs.every(j => j.format === 'faq'));

// ---- runPlan ----
(async () => {
  // All succeed.
  const calls = [];
  const okRes = await runPlan(
    [{ notebookId: 'n1', format: 'faq' }, { notebookId: 'n2', format: 'faq' }],
    async (job) => { calls.push(job.notebookId); return { success: true, content: 'x' }; }
  );
  check('runPlan runs every job and marks them ok', okRes.length === 2 && okRes.every(r => r.ok));
  check('runPlan with concurrency 1 preserves order', calls.join(',') === 'n1,n2');

  // Retry then succeed.
  let tries = 0;
  const retryRes = await runPlan(
    [{ notebookId: 'n1', format: 'faq' }],
    async () => { tries++; if (tries < 2) throw new Error('transient'); return { success: true }; },
    { retries: 1 }
  );
  check('runPlan retries a failing job and records attempts',
    retryRes[0].ok && retryRes[0].attempts === 2);

  // Permanent failure is captured, never thrown.
  const failRes = await runPlan(
    [{ notebookId: 'n1', format: 'faq' }],
    async () => { throw new Error('extension offline'); },
    { retries: 1 }
  );
  check('runPlan captures a permanent failure without throwing',
    failRes[0].ok === false && failRes[0].error === 'extension offline' && failRes[0].attempts === 2);

  // Concurrency: pool runs all jobs.
  const conc = await runPlan(
    [1, 2, 3, 4, 5].map(n => ({ notebookId: 'n' + n, format: 'faq' })),
    async () => ({ ok: true }),
    { concurrency: 3 }
  );
  check('runPlan with a concurrency pool completes all jobs', conc.length === 5 && conc.every(r => r.ok));

  // ---- diffForWatch ----
  const prev = { folders: [{ id: 'f1', notebookIds: ['n1'] }] };
  const curr = {
    folders: [
      { id: 'f1', name: 'Compliance', notebookIds: ['n1', 'n2'] }, // gained n2
      { id: 'f3', name: 'New', notebookIds: ['n9'] },              // brand new with content
      { id: 'f4', name: 'NewEmpty', notebookIds: [] }              // new but empty: ignored
    ]
  };
  const changes = diffForWatch(prev, curr);
  const byId = Object.fromEntries(changes.map(c => [c.folderId, c]));
  check('diffForWatch detects a folder that gained a notebook',
    byId.f1 && byId.f1.addedNotebookIds.join(',') === 'n2');
  check('diffForWatch detects a brand-new non-empty folder',
    byId.f3 && byId.f3.isNew === true && byId.f3.addedNotebookIds.join(',') === 'n9');
  check('diffForWatch ignores a new empty folder', !byId.f4);
  check('diffForWatch reports no change when nothing moved',
    diffForWatch(curr, curr).length === 0);

  // ---- planRegen ----
  const regen = planRegen(changes, { notebooks: [{ id: 'n2', title: 'Evidence' }] }, { kinds: ['podcast', 'study-pack'], formats: ['faq'] });
  // f1 added n2 (1 podcast + 1 faq), f3 added n9 (1 podcast + 1 faq) = 4 jobs
  check('planRegen turns a diff into podcast + study-pack jobs', regen.length === 4);
  check('planRegen podcast jobs use audio-overview',
    regen.filter(j => j.format === PODCAST_FORMAT).length === 2);
  check('planRegen carries folderId + resolved title',
    regen.some(j => j.folderId === 'f1' && j.notebookId === 'n2' && j.title === 'Evidence'));

  console.log(`\n${passed}/${passed} automation-pipeline assertions passed.`);
})().catch(err => { console.error('TEST FAILURE:', err); process.exit(1); });
