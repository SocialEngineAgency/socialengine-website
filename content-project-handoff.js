(function contentProjectHandoffModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SEContentProjectHandoff = api;
})(typeof window !== 'undefined' ? window : globalThis, function buildModule() {
  'use strict';

  const destinations = Object.freeze({
    'create/reels': Object.freeze({ nav: 'animation-studio', mode: 'reel' }),
    'create/video': Object.freeze({ nav: 'creation-studio', mode: 'video' }),
    'create/post': Object.freeze({ nav: 'design-studio', mode: 'post' }),
    'create/carousel': Object.freeze({ nav: 'brand-design', mode: 'carousel', view: 'slides' }),
    'create/stories': Object.freeze({ nav: 'stories-composer', mode: 'story' }),
    animate: Object.freeze({ nav: 'animation-studio', mode: 'storyboard' }),
    'library/diagram': Object.freeze({ nav: 'ai-studio', mode: 'diagram' }),
    ads: Object.freeze({ nav: 'ad-studio', mode: 'preview' }),
    fundraise: Object.freeze({ nav: 'fundraise', mode: 'draft' }),
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function buildProjectCreateBody(action) {
    if (action?.type !== 'create_project' || !action.project?.capability_id) {
      throw new Error('A validated create_project action is required');
    }
    return clone(action.project);
  }

  function projectIdempotencyKey(action) {
    const body = buildProjectCreateBody(action);
    const stable = JSON.stringify(stableValue({
      capability_id: action.capability_id || body.capability_id,
      destination: action.destination,
      project: body,
    }));
    return `content-project:${hashString(stable)}`;
  }

  function destinationForProject(action, projectId, briefVersion) {
    const destination = String(action?.destination || '');
    const target = destinations[destination];
    if (!target) throw new Error(`Unsupported project destination: ${destination || '(empty)'}`);
    const id = String(projectId || '').trim();
    if (!id) throw new Error('project_id is required');
    if (briefVersion === undefined || briefVersion === null || String(briefVersion).trim() === '') {
      throw new Error('brief_version is required');
    }
    return { ...target, project_id: id, brief_version: briefVersion };
  }

  function resetLegacyCreationState(state) {
    state._studioReference = null;
    state.__SE_REMIX_SESSION = null;
    state.__SE_ANIM_REMIX_SESSION = null;
    state.__SE_FUNDRAISE_CONTENT_SESSION = null;
    state.__SE_COACH_CREATE_SESSION = null;
    state.__SE_STORY_COACH = null;
    state.__SE_VS_UPLOAD = null;
    state.__SE_VS_DONE = null;
    state._seCoachAttachedProduct = '';
    state._seCoachAttachedImage = '';
  }

  function sameIdentity(project, other) {
    return Boolean(
      project?.project_id
      && other?.project_id
      && String(project.project_id) === String(other.project_id)
      && project.brief_version !== undefined
      && other.brief_version !== undefined
      && String(project.brief_version) === String(other.brief_version)
    );
  }

  function activeProjectForDestination(project, destination, nav) {
    if (!sameIdentity(project, destination)) return null;
    if (String(destination.nav || '') !== String(nav || '')) return null;
    return project;
  }

  function contentProjectResearchSatisfied(project, research) {
    const mode = project?.brief?.claims_policy?.research_mode || 'off';
    if (mode !== 'required') return true;
    const evidence = Array.isArray(research?.evidence) ? research.evidence : [];
    return sameIdentity(project, research)
      && research.status === 'complete'
      && evidence.length > 0
      && evidence.every((item) => String(item?.evidence_id || '').trim());
  }

  function projectBlockReasons(project, research, supportedDurations) {
    const reasons = [];
    const duration = project?.brief?.duration_seconds;
    if (Number.isFinite(duration)) {
      const supported = Array.isArray(supportedDurations)
        && supportedDurations.some((value) => Number(value) === Number(duration));
      if (!supported) {
        reasons.push(`This tool cannot represent the required ${duration}-second duration. The project was not shortened.`);
      }
    }
    if (!contentProjectResearchSatisfied(project, research)) {
      reasons.push('Required research must complete for this exact brief version before generation.');
    }
    return reasons;
  }

  function projectPrompt(project, research) {
    const brief = project?.brief || {};
    const claims = brief.claims_policy || {};
    const lines = [
      project?.project_id && project?.brief_version !== undefined
        ? `Canonical project: ${project.project_id} · brief version ${project.brief_version}`
        : '',
      brief.topic ? `Topic: ${brief.topic}` : '',
      brief.format ? `Format: ${brief.format}` : '',
      Number.isFinite(brief.duration_seconds)
        ? `Duration: exactly ${brief.duration_seconds} seconds${Number.isFinite(brief.duration_tolerance_seconds) ? ` (tolerance ${brief.duration_tolerance_seconds} seconds)` : ''}`
        : '',
      brief.style?.preset
        ? `Style${brief.style.hard_lock ? ' (hard lock)' : ''}: ${brief.style.preset}`
        : '',
      Array.isArray(brief.required_beats) && brief.required_beats.length
        ? `Required beats: ${brief.required_beats.join('; ')}`
        : '',
      Array.isArray(brief.exclusions) && brief.exclusions.length
        ? `Exclusions: ${brief.exclusions.join('; ')}`
        : '',
      brief.script ? `Script: ${brief.script}` : '',
      brief.caption ? `Caption: ${brief.caption}` : '',
      Array.isArray(brief.hashtags) && brief.hashtags.length
        ? `Hashtags: ${brief.hashtags.join(' ')}`
        : '',
      claims.domain
        ? `Claims: ${claims.domain}; live research ${claims.research_mode || 'off'}${Array.isArray(claims.allowed_publishers) && claims.allowed_publishers.length ? `; allowed publishers: ${claims.allowed_publishers.join(', ')}` : ''}`
        : '',
    ];
    const evidence = contentProjectResearchSatisfied(project, research) ? research.evidence : [];
    if (evidence.length) {
      lines.push(
        'Retrieved evidence (cite claims; do not add unsupported facts):',
        ...evidence.map((item, index) =>
          `${index + 1}. ${item.title || 'Source'} [${item.publisher || 'publisher'}] [Evidence ID: ${item.evidence_id}]\n${item.excerpt || ''}\n${item.url || ''}`
        )
      );
    }
    return lines.filter(Boolean).join('\n');
  }

  function selectHasValue(select, value) {
    return Array.from(select?.options || []).some((option) => String(option.value) === String(value));
  }

  function hydrateStudioProject(project, documentRef, research) {
    const brief = project?.brief || {};
    const direction = documentRef?.getElementById('vs-creative-dir');
    const aspect = documentRef?.getElementById('vs-aspect');
    const duration = documentRef?.getElementById('vs-duration');

    if (direction) direction.value = projectPrompt(project, research);

    const aspectMatch = String(brief.format || '').match(/\b(9:16|16:9|1:1|4:5)\b/);
    if (aspect && aspectMatch && selectHasValue(aspect, aspectMatch[1])) {
      aspect.value = aspectMatch[1];
    }

    const supportedDurations = Array.from(duration?.options || []).map((option) => Number(option.value));
    if (duration && Number.isFinite(brief.duration_seconds)) {
      const requested = String(brief.duration_seconds);
      if (selectHasValue(duration, requested)) {
        duration.value = requested;
      }
    }
    const reasons = projectBlockReasons(project, research, supportedDurations);

    return { blocked: reasons.length > 0, reasons, warnings: reasons };
  }

  return Object.freeze({
    activeProjectForDestination,
    buildProjectCreateBody,
    contentProjectResearchSatisfied,
    destinationForProject,
    hydrateStudioProject,
    projectIdempotencyKey,
    projectBlockReasons,
    projectPrompt,
    resetLegacyCreationState,
  });
});
