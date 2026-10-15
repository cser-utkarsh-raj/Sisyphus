import type { SubtitleLine, WordTiming } from '../types/pipeline.ts';

/**
 * Splits plain text and word-level timings into clean, readable karaoke subtitle lines.
 * Short-form platforms need 4 to 8 words per line so words stay large and readable.
 */
export function buildSubtitleLines(
  words: WordTiming[],
  maxWordsPerLine = 6
): SubtitleLine[] {
  if (!words || words.length === 0) return [];

  const lines: SubtitleLine[] = [];
  let currentWords: WordTiming[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    currentWords.push(word);

    // Natural punctuation breaks (periods, question marks, exclamation marks, commas if long)
    const endsWithTerminal = /[.!?]$/.test(word.word.trim());
    const endsWithComma = /[,;:]$/.test(word.word.trim());
    const isMaxWords = currentWords.length >= maxWordsPerLine;

    const shouldBreak =
      endsWithTerminal ||
      (endsWithComma && currentWords.length >= 3) ||
      isMaxWords ||
      i === words.length - 1;

    if (shouldBreak && currentWords.length > 0) {
      const lineText = currentWords.map((w) => w.word).join(' ');
      const startMs = currentWords[0].startMs;
      const endMs = currentWords[currentWords.length - 1].endMs;

      lines.push({
        id: `line-${lines.length + 1}`,
        text: lineText,
        startMs,
        endMs,
        words: [...currentWords],
      });
      currentWords = [];
    }
  }

  // Pick up any leftover words
  if (currentWords.length > 0) {
    const lineText = currentWords.map((w) => w.word).join(' ');
    lines.push({
      id: `line-${lines.length + 1}`,
      text: lineText,
      startMs: currentWords[0].startMs,
      endMs: currentWords[currentWords.length - 1].endMs,
      words: [...currentWords],
    });
  }

  return lines;
}

/**
 * Accurately finds which subtitle line and which individual word is active at current audio playback time.
 */
export function findActiveWord(
  subtitles: SubtitleLine[],
  currentMs: number
): {
  activeLine: SubtitleLine | null;
  activeLineIndex: number;
  activeWordIndex: number;
  activeWord: WordTiming | null;
} {
  if (!subtitles || subtitles.length === 0) {
    return { activeLine: null, activeLineIndex: -1, activeWordIndex: -1, activeWord: null };
  }

  // Find line that encapsulates currentMs (or slight lookahead of 50ms)
  let activeLineIndex = -1;
  for (let i = 0; i < subtitles.length; i++) {
    const line = subtitles[i];
    // Keep active slightly after line end if before next line start to prevent blinking
    const nextLine = subtitles[i + 1];
    const lineEndWithMargin = nextLine ? Math.min(line.endMs + 150, nextLine.startMs) : line.endMs + 300;

    if (currentMs >= line.startMs && currentMs <= lineEndWithMargin) {
      activeLineIndex = i;
      break;
    }
  }

  if (activeLineIndex === -1) {
    return { activeLine: null, activeLineIndex: -1, activeWordIndex: -1, activeWord: null };
  }

  const activeLine = subtitles[activeLineIndex];
  let activeWordIndex = -1;
  let activeWord: WordTiming | null = null;

  for (let w = 0; w < activeLine.words.length; w++) {
    const word = activeLine.words[w];
    if (currentMs >= word.startMs && currentMs <= word.endMs + 80) {
      activeWordIndex = w;
      activeWord = word;
      break;
    }
  }

  // If time is between words in the same line, stick to the nearest preceding word
  if (activeWordIndex === -1) {
    for (let w = activeLine.words.length - 1; w >= 0; w--) {
      if (currentMs >= activeLine.words[w].startMs) {
        activeWordIndex = w;
        activeWord = activeLine.words[w];
        break;
      }
    }
  }

  return { activeLine, activeLineIndex, activeWordIndex, activeWord };
}

/**
 * Produces word-level timestamps with speech-cadence weighting
 * for deterministic fallback alignment matching total audio duration.
 */
export function estimateWordTimings(
  fullText: string,
  totalDurationMs: number,
  startOffsetMs = 400
): WordTiming[] {
  const tokens = fullText
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (tokens.length === 0) return [];

  // Speech weighting: longer words and words with punctuation take longer
  const weights = tokens.map((w) => {
    let weight = Math.max(1, w.length);
    if (/[,;:]$/.test(w)) weight += 3;
    if (/[.!?]$/.test(w)) weight += 6;
    return weight;
  });

  const totalWeight = weights.reduce((acc, curr) => acc + curr, 0);
  const availableSpeechMs = Math.max(1000, totalDurationMs - startOffsetMs - 500);

  let currentMs = startOffsetMs;
  const wordTimings: WordTiming[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const duration = Math.round((weights[i] / totalWeight) * availableSpeechMs);
    const startMs = currentMs;
    const endMs = startMs + Math.max(120, duration);

    wordTimings.push({
      word,
      startMs,
      endMs,
      confidence: 0.98,
    });

    // Micro pause between words, longer pause on sentences
    const isPunctuation = /[.!?]$/.test(word);
    const pause = isPunctuation ? 250 : /[,;:]$/.test(word) ? 140 : 40;
    currentMs = endMs + pause;
  }

  return wordTimings;
}

/**
 * Format milliseconds to standard SRT timestamp (00:00:00,000)
 */
export function formatTimestampSrt(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = Math.floor(ms % 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(milliseconds, 3)}`;
}

/**
 * Export subtitle lines to standard SRT format
 */
export function exportToSrt(subtitles: SubtitleLine[]): string {
  return subtitles
    .map((line, index) => {
      return `${index + 1}\n${formatTimestampSrt(line.startMs)} --> ${formatTimestampSrt(line.endMs)}\n${line.text}\n`;
    })
    .join('\n');
}
