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

  /**
   * How the portal gets the project behind a Coach create_project action. A project the Coach already persisted
   * (action.project_id) is loaded by ID; only an unpersisted action is created here, with its idempotency key.
   */
  function projectRequestFor(action) {
    const body = buildProjectCreateBody(action);
    const id = String(action.project_id || '').trim();
    if (action.persisted === true && id) {
      return { method: 'GET', path: `/api/content-runtime/projects/${encodeURIComponent(id)}`, project_id: id };
    }
    return {
      method: 'POST',
      path: '/api/content-runtime/projects',
      idempotency_key: action.idempotency_key || projectIdempotencyKey(action),
      body,
    };
  }

  /** The project the server returned must be the one the action names: same ID and the same capability. */
  function checkLoadedProject(action, project) {
    if (!project?.project_id || project.brief_version === undefined) throw new Error('Project could not be loaded');
    if (action.project_id && String(project.project_id) !== String(action.project_id)) {
      throw new Error('The server returned a different project');
    }
    const capability = action.capability_id || action.project?.capability_id;
    if (capability && project.capability_id && project.capability_id !== capability) {
      throw new Error('The project is for a different tool');
    }
    return project;
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
      brief.product_name ? `Subject: ${brief.product_name}` : '',
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
      brief.full_brief ? `Coach brief (follow the constraints above where they differ):\n${brief.full_brief}` : '',
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

  // Design and Storyboard open the project by ID, then fill their own form from it (the project carries
  // the tool's session). Reels and Video hydrate from the project directly.
  const TOOL_NAVS = Object.freeze({ design: 'design-studio', storyboard: 'storyboard' });

  function projectTool(action, project) {
    const tool = String(project?.brief?.tool_session?.tool || action?.open_in || '');
    return TOOL_NAVS[tool] ? tool : '';
  }

  /**
   * The legacy create session a Design or Storyboard project opens with: the persisted brief word for word
   * (brief.full_brief), the tool fields saved with it, and the project's identity. Null for other tools.
   */
  function toolSessionForProject(action, project) {
    const tool = projectTool(action, project);
    if (!tool) return null;
    const brief = project?.brief || {};
    const saved = brief.tool_session || {};
    const prompt = String(brief.full_brief || brief.script || brief.topic || '').trim();
    if (!prompt) return null;
    const session = {
      type: 'create',
      destination: tool,
      prompt,
      product_name: String(brief.product_name || saved.product_name || ''),
      mode: saved.mode === 'video' ? 'video' : 'image',
      aspect_ratio: saved.aspect_ratio || ((String(brief.format || '').match(/\b(9:16|16:9|1:1|4:5)\b/) || [])[1]) || '9:16',
      aspect_explicit: saved.aspect_explicit === true,
      attached_image_url: saved.attached_image_url || '',
      look: brief.style?.preset || saved.look || '',
      references: Array.isArray(saved.references) ? clone(saved.references) : (Array.isArray(brief.references) ? clone(brief.references) : []),
      ref_image_urls: Array.isArray(saved.ref_image_urls) ? saved.ref_image_urls.slice() : [],
    };
    if (saved.collection) session.collection = saved.collection;
    return {
      nav: TOOL_NAVS[tool],
      tool,
      session,
      identity: { content_project_id: project.project_id, content_brief_version: project.brief_version },
    };
  }

  /**
   * What a Reels project needs beyond the prompt: a voiceover-first reel opens on the Voiceover entry with
   * the script word for word; its outro card and music bed come with it.
   */
  function reelExtrasForProject(project) {
    const brief = project?.brief || {};
    const https = (value) => (/^https:\/\//i.test(String(value || '')) ? String(value) : '');
    const vo = brief.entry === 'vo' && String(brief.script || brief.full_brief || '').trim();
    return {
      entry: vo ? 'vo' : 'prompt',
      script: vo ? String(brief.script || brief.full_brief) : '',
      outro_url: https(brief.outro?.url),
      outro_asset_id: String(brief.outro?.asset_id || ''),
      music_bed_url: https(brief.music_bed?.url),
      music_asset_id: String(brief.music_bed?.asset_id || ''),
      missing_outro: String(brief.missing_outro || ''),
      format_template_id: String(brief.format_template_id || ''),
    };
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
    checkLoadedProject,
    contentProjectResearchSatisfied,
    destinationForProject,
    hydrateStudioProject,
    projectIdempotencyKey,
    projectBlockReasons,
    projectPrompt,
    projectTool,
    reelExtrasForProject,
    toolSessionForProject,
    projectRequestFor,
    resetLegacyCreationState,
  });
});
