import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateVideoDuration,
  validateScriptStructure,
  validatePlatformMetadata,
} from '../src/utils/validation.ts';
import { formatPlatformMetadata } from '../src/utils/platforms.ts';

test('validateVideoDuration enforces strictly under 60-second rule and min duration', () => {
  // Valid duration
  assert.equal(validateVideoDuration(45).valid, true);
  assert.equal(validateVideoDuration(59.4).valid, true);

  // Exactly 60 or above must fail
  const tooLong = validateVideoDuration(60);
  assert.equal(tooLong.valid, false);
  assert.ok(tooLong.error?.includes('exceeds strict 60-second limit'));

  const wayTooLong = validateVideoDuration(75);
  assert.equal(wayTooLong.valid, false);

  // Too short
  const tooShort = validateVideoDuration(10);
  assert.equal(tooShort.valid, false);
  assert.ok(tooShort.error?.includes('too short'));
});

test('validateScriptStructure catches malformed AI payloads', () => {
  const invalid = validateScriptStructure({ title: '' });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.length > 0, true);

  const valid = validateScriptStructure({
    title: 'The Paradox of Choice',
    topic: 'Psychology',
    fullNarration: 'More choices actually make us less happy because each option introduces regret.',
    targetDurationSec: 30,
    estimatedDurationSec: 28,
    scenes: [
      {
        id: 's1',
        sceneNumber: 1,
        title: 'Hook',
        narration: 'More choices actually make us less happy.',
        startMs: 0,
        endMs: 3000,
        visualType: 'kinetic-hook',
        visualElements: { primaryShape: 'nodes', accentColor: '#ff2a85' },
      },
    ],
    hook: 'Why options paralyze you',
    callToAction: 'Follow for mind shifts',
    hashtags: ['#psychology', '#decisionmaking'],
    description: 'An exploration of modern cognitive overload.',
  });

  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);
});

test('formatPlatformMetadata appends #Shorts for YouTube and enforces title limits', () => {
  const yt = formatPlatformMetadata(
    'Why Black Holes Sing at 57 Octaves Below Middle C',
    'Fascinating astrophysics frequency discovery.',
    ['#space', '#science'],
    'youtube'
  );

  assert.ok(yt.title.includes('#Shorts'));
  assert.ok(yt.title.length <= 100);
  assert.ok(yt.tags.includes('#Shorts'));

  const validation = validatePlatformMetadata(yt.title, yt.caption, yt.tags, 'youtube');
  assert.equal(validation.valid, true);
});
