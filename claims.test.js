const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Copy the legal/security audit flagged and the CEO approved removing:
// performance statistics with no data behind them, agency-spend replacement
// figures, a refund promise that terms.html does not back, an "NSFW" label
// for what is actually a lingerie/swimwear apparel lane, and timeline /
// traction promises. None of these may reappear in shipped pages.
// Matching is case-insensitive substring.
const BANNED_PHRASES = [
  // Trust strip stats and the counter markup that animated them
  '150K+',
  'data-count-to',
  '3.2x',
  '$2.4M',
  'Revenue Attributed',
  'Avg. Engagement Lift',
  'Posts Published',
  '&lt;48h',
  'Onboarding to First Post',
  'trust-strip',
  // "Replaces ~$Xk/mo" spend figures
  '~$8k',
  '$8k/mo',
  '~$12k',
  '$12k/mo',
  'agency spend',
  'team + tool spend',
  // Refund promise that contradicts the Terms (no prorated refunds)
  'money-back',
  'guarantee',
  // Adult-content label for the apparel lane
  'NSFW',
  // Timeline / traction promises
  'by the end of week one',
  'measurable traction within 30 days',
  'results speak for themselves',
  // Timeline promises with no data behind them (FAQ + brand-voice card)
  'within 2–3 weeks',
  'within 2-3 weeks',
  'indistinguishable from what you',
  'noticeable in month one',
  'inflection point',
  'months 2–3',
];

const MARKETING_FILES = ['index.html', 'signup.html', 'app.js'];

// The legal documents legitimately DISCLAIM guarantees ("we do not guarantee
// uninterrupted access", "accuracy is not guaranteed"). Those negated forms are
// stripped before scanning so the lint still catches an affirmative guarantee
// ("we guarantee 99.9% uptime") if one is ever added.
const LEGAL_FILES = ['privacy.html', 'terms.html'];
const NEGATED_GUARANTEE = /\b(?:do not|does not|cannot|can not|not|no|never)\s+(?:be\s+)?guarantee\w*/gi;

function readSource(fileName) {
  return fs.readFileSync(path.join(__dirname, fileName), 'utf8');
}

function findBannedPhrases(source) {
  const found = [];
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    const lowered = line.toLowerCase();
    BANNED_PHRASES.forEach((phrase) => {
      if (lowered.includes(phrase.toLowerCase())) {
        found.push(`${phrase} (line ${index + 1})`);
      }
    });
  });

  return found;
}

MARKETING_FILES.forEach((fileName) => {
  test(`${fileName} contains no unsubstantiated marketing claims`, () => {
    assert.deepEqual(findBannedPhrases(readSource(fileName)), []);
  });
});

LEGAL_FILES.forEach((fileName) => {
  test(`${fileName} contains no marketing claims or affirmative guarantees`, () => {
    const source = readSource(fileName).replace(NEGATED_GUARANTEE, '');
    assert.deepEqual(findBannedPhrases(source), []);
  });
});
