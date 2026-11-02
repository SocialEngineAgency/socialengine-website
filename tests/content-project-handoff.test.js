'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  activeProjectForDestination,
  buildProjectCreateBody,
  contentProjectResearchSatisfied,
  destinationForProject,
  hydrateStudioProject,
  projectIdempotencyKey,
  projectBlockReasons,
  projectPrompt,
  resetLegacyCreationState,
} = require('../content-project-handoff');

const action = {
  type: 'create_project',
  capability_id: 'reel.create',
  destination: 'create/reels',
  project: {
    capability_id: 'reel.create',
    brief: {
      topic: 'What the stomach actually does',
      format: '9:16 Reel',
      duration_seconds: 15,
      duration_tolerance_seconds: 1,
      style: { preset: 'realistic anatomical', hard_lock: true },
      required_beats: ['storage', 'mixing'],
      exclusions: ['unsupported survival claims'],
      claims_policy: {
        domain: 'medical',
        research_mode: 'required',
        allowed_publishers: ['nhs.uk', 'nice.org.uk'],
      },
      script: 'The stomach stores and mixes food.',
      caption: 'Your stomach does more than hold food.',
      hashtags: ['#DigestiveHealth'],
    },
    delivery: { destination: 'review', platforms: ['instagram'] },
    spend: { currency: 'credits', maximum: 1, approval: 'required' },
  },
};

const canonical = {
  ...action.project,
  project_id: 'cp_1',
  brief_version: 3,
};

test('buildProjectCreateBody preserves the complete Coach package without aliasing it', () => {
  const body = buildProjectCreateBody(action);
  assert.deepEqual(body, action.project);
  assert.notEqual(body, action.project);
  assert.notEqual(body.brief, action.project.brief);
});

test('project creation idempotency is stable for the same action and changes with the brief', () => {
  const first = projectIdempotencyKey(action);
  assert.equal(first, projectIdempotencyKey(structuredClone(action)));
  assert.match(first, /^content-project:/);
  assert.notEqual(first, projectIdempotencyKey({
    ...action,
    project: { ...action.project, brief: { ...action.project.brief, topic: 'Changed' } },
  }));
});

test('destinations match the current Create atelier exactly', () => {
  assert.deepEqual(destinationForProject(action, 'cp_1', 3), {
    nav: 'animation-studio', mode: 'reel', project_id: 'cp_1', brief_version: 3,
  });
  assert.deepEqual(destinationForProject({ ...action, destination: 'create/video' }, 'cp_2', 1), {
    nav: 'creation-studio', mode: 'video', project_id: 'cp_2', brief_version: 1,
  });
  assert.deepEqual(destinationForProject({ ...action, destination: 'create/post' }, 'cp_3', 1), {
    nav: 'design-studio', mode: 'post', project_id: 'cp_3', brief_version: 1,
  });
  assert.deepEqual(destinationForProject({ ...action, destination: 'create/carousel' }, 'cp_4', 2), {
    nav: 'brand-design', mode: 'carousel', view: 'slides', project_id: 'cp_4', brief_version: 2,
  });
  assert.deepEqual(destinationForProject({ ...action, destination: 'create/stories' }, 'cp_5', 2), {
    nav: 'stories-composer', mode: 'story', project_id: 'cp_5', brief_version: 2,
  });
});

test('unknown destinations and incomplete canonical identity fail closed', () => {
  assert.throws(() => destinationForProject({ ...action, destination: 'somewhere' }, 'cp_1', 1), /Unsupported/);
  assert.throws(() => destinationForProject(action, '', 1), /project_id/);
  assert.throws(() => destinationForProject(action, 'cp_1', null), /brief_version/);
});

test('reset clears stale creation sessions but preserves Coach workspace state', () => {
  const workspace = { projectId: 'coach-workspace' };
  const state = {
    _studioReference: { url: 'old' },
    __SE_REMIX_SESSION: { id: 'old' },
    __SE_ANIM_REMIX_SESSION: { id: 'old' },
    __SE_FUNDRAISE_CONTENT_SESSION: { id: 'old' },
    __SE_COACH_CREATE_SESSION: { prompt: 'old' },
    __SE_STORY_COACH: { brief: 'old' },
    __SE_VS_UPLOAD: { videoUrl: 'old' },
    __SE_VS_DONE: { id: 'old' },
    _seCoachAttachedProduct: 'old product',
    _seCoachAttachedImage: 'old image',
    __SE_WORKSPACE_ACTIVE: workspace,
  };

  resetLegacyCreationState(state);

  assert.equal(state._studioReference, null);
  assert.equal(state.__SE_REMIX_SESSION, null);
  assert.equal(state.__SE_ANIM_REMIX_SESSION, null);
  assert.equal(state.__SE_FUNDRAISE_CONTENT_SESSION, null);
  assert.equal(state.__SE_COACH_CREATE_SESSION, null);
  assert.equal(state.__SE_STORY_COACH, null);
  assert.equal(state.__SE_VS_UPLOAD, null);
  assert.equal(state.__SE_VS_DONE, null);
  assert.equal(state._seCoachAttachedProduct, '');
  assert.equal(state._seCoachAttachedImage, '');
  assert.equal(state.__SE_WORKSPACE_ACTIVE, workspace);
});

test('projectPrompt carries every constraint and retrieved evidence id', () => {
  const prompt = projectPrompt(canonical, {
    project_id: 'cp_1',
    brief_version: 3,
    status: 'complete',
    evidence: [{
      evidence_id: 'ev_digest',
      title: 'How digestion works',
      publisher: 'nhs.uk',
      url: 'https://www.nhs.uk/live-well/eat-well/digestive-health/',
      excerpt: 'Digestion breaks down food into nutrients.',
    }],
  });

  assert.match(prompt, /Canonical project: cp_1 · brief version 3/);
  assert.match(prompt, /Duration: exactly 15 seconds \(tolerance 1 seconds\)/);
  assert.match(prompt, /Style \(hard lock\): realistic anatomical/);
  assert.match(prompt, /Required beats: storage; mixing/);
  assert.match(prompt, /Exclusions: unsupported survival claims/);
  assert.match(prompt, /Caption: Your stomach does more than hold food\./);
  assert.match(prompt, /Claims: medical; live research required; allowed publishers: nhs\.uk, nice\.org\.uk/);
  assert.match(prompt, /Evidence ID: ev_digest/);
});

test('required research only satisfies the exact project version with evidence ids', () => {
  const complete = {
    project_id: 'cp_1',
    brief_version: 3,
    status: 'complete',
    evidence: [{ evidence_id: 'ev_1', excerpt: 'Supported.' }],
  };
  assert.equal(contentProjectResearchSatisfied(canonical, complete), true);
  assert.equal(contentProjectResearchSatisfied(canonical, { ...complete, brief_version: 2 }), false);
  assert.equal(contentProjectResearchSatisfied(canonical, { ...complete, project_id: 'cp_old' }), false);
  assert.equal(contentProjectResearchSatisfied(canonical, { ...complete, evidence: [{ excerpt: 'No id' }] }), false);
  assert.equal(contentProjectResearchSatisfied({ ...canonical, brief: { claims_policy: { research_mode: 'off' } } }, null), true);
});

test('active project rejects stale destination identity and version', () => {
  const destination = destinationForProject(action, 'cp_1', 3);
  assert.equal(activeProjectForDestination(canonical, destination, 'animation-studio'), canonical);
  assert.equal(activeProjectForDestination({ ...canonical, brief_version: 2 }, destination, 'animation-studio'), null);
  assert.equal(activeProjectForDestination(canonical, { ...destination, project_id: 'cp_old' }, 'animation-studio'), null);
  assert.equal(activeProjectForDestination(canonical, destination, 'design-studio'), null);
});

test('still surfaces fail closed when a duration is required', () => {
  assert.deepEqual(projectBlockReasons(canonical, null, []), [
    'This tool cannot represent the required 15-second duration. The project was not shortened.',
    'Required research must complete for this exact brief version before generation.',
  ]);
  assert.deepEqual(projectBlockReasons(canonical, {
    project_id: 'cp_1',
    brief_version: 3,
    status: 'complete',
    evidence: [{ evidence_id: 'ev_1' }],
  }, [15]), []);
});

test('video hydration fills compatible controls and fails closed on duration or research', () => {
  const elements = {
    'vs-creative-dir': { value: '' },
    'vs-aspect': { value: '1:1', options: [{ value: '9:16' }, { value: '1:1' }] },
    'vs-duration': { value: '5', options: [{ value: '5' }, { value: '10' }] },
  };
  const document = { getElementById: (id) => elements[id] || null };

  const result = hydrateStudioProject(canonical, document, null);

  assert.match(elements['vs-creative-dir'].value, /Canonical project: cp_1/);
  assert.equal(elements['vs-aspect'].value, '9:16');
  assert.equal(elements['vs-duration'].value, '5');
  assert.equal(result.blocked, true);
  assert.deepEqual(result.reasons, [
    'This tool cannot represent the required 15-second duration. The project was not shortened.',
    'Required research must complete for this exact brief version before generation.',
  ]);
});
