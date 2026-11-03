'use strict';
// There is no "Design" tab any more: it is the Post tab (Joe, 2 Nov 2026). No string the owner can see
// may still call it Design (comments and internal ids such as #create/design are fine).
// The Post-tab Coach's in-tab posts and carousels carry the ContentProject each one was saved as.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const FILES = ['portal.html', 'claude-studio.js', 'design-studio-v2.js', 'analytics-cockpit.js', 'coach-create-session.js', 'content-project-handoff.js', 'design-workspace.js', 'story-builder.js'];

function visibleCode(src) {
  // Drop block comments and whole-line comments; what is left is code and copy.
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}

test('no owner-visible copy calls the Post tab "Design"', () => {
  for (const f of FILES) {
    const code = visibleCode(read(f));
    for (const bad of [/Design Studio/, /Design tab/, /Make in Design\b/, /Open (?:project )?in Design\b/, /\bthe Design\b(?! system)/]) {
      assert.doesNotMatch(code, bad, `${f} still says ${bad}`);
    }
  }
  assert.match(read('analytics-cockpit.js'), /Make in Post</);
});

test('Post-tab Coach: each in-tab post and carousel sends the ContentProject it was saved as to its maker', () => {
  const studio = read('claude-studio.js');
  assert.match(studio, /posts: list\.map\(\(p\) => \(\{ title: p\.title, brief: p\.brief, \.\.\.\(p\.content_project_id \? \{ content_project_id: p\.content_project_id, content_brief_version: p\.content_brief_version \} : \{\}\) \}\)\)/);
  assert.match(studio, /\.\.\.\(p\.content_project_id \? \{ content_project_id: p\.content_project_id \} : \{\}\)/, 'the photo maker too');
  assert.match(studio, /content_project_id: action\.content_project_id \|\| undefined,\n\s+autostart: true/);
  const carousels = read('design-studio-v2.js');
  assert.match(carousels, /state\.handoffProject = p\.content_project_id \? \{ id: String\(p\.content_project_id\), brief: brief\.value\.trim\(\) \} : null;/);
  assert.match(carousels, /content_project_id: state\.handoffProject && state\.handoffProject\.brief === brief \? state\.handoffProject\.id : undefined/, 'an edited brief is not that project any more');
});

test('Storyboard: a Coach brief is no longer cut at 1,500 characters, and the kit is linked to its ContentProject', () => {
  const sb = read('story-builder.js');
  assert.match(sb, /const STORY_IDEA_MAX = 6000;/);
  assert.match(sb, /brief: String\(h\.brief\)\.slice\(0, STORY_IDEA_MAX\)/);
  assert.match(sb, /maxlength="\$\{STORY_IDEA_MAX\}"/);
  assert.doesNotMatch(sb, /1,?500/);
  assert.match(sb, /body\.canonical_project_id = nk\.content_project_id;/);
});
