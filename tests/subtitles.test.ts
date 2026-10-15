import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSubtitleLines,
  findActiveWord,
  estimateWordTimings,
  formatTimestampSrt,
  exportToSrt,
} from '../src/utils/subtitles.ts';

test('buildSubtitleLines breaks into readable chunks with max word threshold', () => {
  const words = [
    { word: 'The', startMs: 0, endMs: 200, confidence: 1 },
    { word: 'universe', startMs: 250, endMs: 600, confidence: 1 },
    { word: 'is', startMs: 650, endMs: 800, confidence: 1 },
    { word: 'far', startMs: 850, endMs: 1100, confidence: 1 },
    { word: 'older', startMs: 1150, endMs: 1500, confidence: 1 },
    { word: 'than', startMs: 1550, endMs: 1750, confidence: 1 },
    { word: 'you', startMs: 1800, endMs: 2000, confidence: 1 },
    { word: 'think.', startMs: 2050, endMs: 2400, confidence: 1 },
  ];

  const lines = buildSubtitleLines(words, 4);
  assert.equal(lines.length >= 2, true);
  assert.equal(lines[0].words.length <= 4, true);
  assert.equal(lines[0].startMs, 0);
  assert.equal(lines[lines.length - 1].endMs, 2400);
});

test('findActiveWord locates the exact spoken word at timestamp', () => {
  const subtitles = [
    {
      id: 'line-1',
      text: 'Look at the stars.',
      startMs: 1000,
      endMs: 2500,
      words: [
        { word: 'Look', startMs: 1000, endMs: 1300, confidence: 1 },
        { word: 'at', startMs: 1350, endMs: 1550, confidence: 1 },
        { word: 'the', startMs: 1600, endMs: 1800, confidence: 1 },
        { word: 'stars.', startMs: 1850, endMs: 2400, confidence: 1 },
      ],
    },
  ];

  // At 1400ms, "at" should be active
  const result1 = findActiveWord(subtitles, 1400);
  assert.ok(result1.activeLine);
  assert.equal(result1.activeWord?.word, 'at');
  assert.equal(result1.activeWordIndex, 1);

  // At 2000ms, "stars." should be active
  const result2 = findActiveWord(subtitles, 2000);
  assert.ok(result2.activeLine);
  assert.equal(result2.activeWord?.word, 'stars.');
  assert.equal(result2.activeWordIndex, 3);

  // Before speech (500ms), nothing should be active
  const result3 = findActiveWord(subtitles, 500);
  assert.equal(result3.activeLine, null);
  assert.equal(result3.activeWord, null);
});

test('estimateWordTimings scales monotonically across available duration', () => {
  const text = 'Why does time move forward and never backward?';
  const timings = estimateWordTimings(text, 5000, 200);

  assert.equal(timings.length, 8);
  for (let i = 0; i < timings.length - 1; i++) {
    assert.equal(timings[i].startMs < timings[i].endMs, true);
    assert.equal(timings[i].endMs <= timings[i + 1].startMs, true);
  }
  assert.equal(timings[timings.length - 1].endMs <= 5000, true);
});

test('formatTimestampSrt and exportToSrt generate compliant SRT timestamps', () => {
  const formatted = formatTimestampSrt(65432); // 1m 5s 432ms
  assert.equal(formatted, '00:01:05,432');

  const subtitles = [
    {
      id: 'line-1',
      text: 'First line',
      startMs: 0,
      endMs: 1500,
      words: [{ word: 'First', startMs: 0, endMs: 700, confidence: 1 }, { word: 'line', startMs: 750, endMs: 1500, confidence: 1 }],
    },
  ];

  const srt = exportToSrt(subtitles);
  assert.ok(srt.includes('1'));
  assert.ok(srt.includes('00:00:00,000 --> 00:00:01,500'));
  assert.ok(srt.includes('First line'));
});
