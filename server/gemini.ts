import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import type { ScriptData, VideoStyle, VoiceId } from '../src/types/pipeline.ts';

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

/**
 * Generates an educational/entertaining short-form script & scene plan.
 * strictly under 60 seconds (target 20-55s), paced at ~2.5 to 3 words per second.
 */
export async function generateScriptWithAi(params: {
  topic: string;
  creativePrompt?: string;
  targetDurationSec: number;
  style: VideoStyle;
  voiceId: VoiceId;
}): Promise<ScriptData> {
  const { topic, creativePrompt, targetDurationSec, style } = params;
  const targetWords = Math.round(targetDurationSec * 2.6); // ~130-140 words for 50s
  const ai = getAiClient();

  if (ai) {
    try {
      const systemInstruction = `You are SISYPHUS: an elite short-form video architect creating high-retention, educational, mind-bending, and existential 9:16 vertical infographic scripts.
Rules:
1. Target length: strictly under 60 seconds (approx ${targetWords} words total narration, targeting ${targetDurationSec} seconds).
2. Pacing: Punchy hook in the first 2 seconds, followed by 3-5 distinct scenes with kinetic visual cues, diagrams, counters, or paradox comparisons, ending with a lingering thought or call to action.
3. Tone: Factually responsible, engaging, captivating, suitable for high-tempo infographic motion.
4. Output: Valid JSON matching the requested schema.`;

      const prompt = `Topic: "${topic}"
User Creative Direction: "${creativePrompt || 'Create a captivating, fact-based breakdown that surprises the viewer.'}"
Visual Style: "${style}"
Target Duration: ${targetDurationSec} seconds (MUST BE UNDER 59 SECONDS)

Provide a complete storyboard with narration for each scene, kinetic visual descriptions, title, description, and hashtags.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              topic: { type: Type.STRING },
              hook: { type: Type.STRING },
              callToAction: { type: Type.STRING },
              description: { type: Type.STRING },
              hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              targetDurationSec: { type: Type.INTEGER },
              estimatedDurationSec: { type: Type.NUMBER },
              fullNarration: { type: Type.STRING },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    sceneNumber: { type: Type.INTEGER },
                    title: { type: Type.STRING },
                    narration: { type: Type.STRING },
                    startMs: { type: Type.INTEGER },
                    endMs: { type: Type.INTEGER },
                    visualType: {
                      type: Type.STRING,
                      description: 'One of: kinetic-hook, diagram-chart, data-counter, metaphor-concept, split-comparison, punchline-conclusion',
                    },
                    visualElements: {
                      type: Type.OBJECT,
                      properties: {
                        primaryShape: { type: Type.STRING },
                        accentColor: { type: Type.STRING },
                        headlineText: { type: Type.STRING },
                        subText: { type: Type.STRING },
                        kineticWords: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                        counterTarget: { type: Type.NUMBER },
                        counterPrefix: { type: Type.STRING },
                        counterSuffix: { type: Type.STRING },
                        metaphorIcon: { type: Type.STRING },
                      },
                    },
                  },
                  required: ['sceneNumber', 'title', 'narration', 'visualType', 'visualElements'],
                },
              },
            },
            required: ['title', 'topic', 'hook', 'fullNarration', 'scenes', 'hashtags', 'description'],
          },
        },
      });

      if (response.text) {
        const parsed = JSON.parse(response.text.trim()) as ScriptData;
        if (parsed.scenes && parsed.scenes.length > 0) {
          // Normalize timestamps across scenes if not filled
          let runningMs = 0;
          const totalSec = Math.min(58, Math.max(20, targetDurationSec));
          const perSceneMs = Math.round((totalSec * 1000) / parsed.scenes.length);

          parsed.scenes.forEach((sc, idx) => {
            sc.id = sc.id || `scene-${idx + 1}`;
            sc.sceneNumber = idx + 1;
            sc.startMs = runningMs;
            sc.endMs = runningMs + perSceneMs;
            runningMs += perSceneMs;
            if (!sc.visualElements) {
              sc.visualElements = { primaryShape: 'nodes', accentColor: '#ff2a85' };
            }
          });

          parsed.targetDurationSec = totalSec;
          parsed.estimatedDurationSec = Math.round((runningMs / 1000) * 10) / 10;
          return parsed;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini script generation failed; no unverified procedural script will be substituted. ${message}`);
    }
  }

  if (process.env.SISYPHUS_ALLOW_DEMO_FALLBACK === 'true') {
    return generateProceduralScript(topic, creativePrompt, targetDurationSec, style);
  }
  throw new Error('GEMINI_API_KEY is required. Script fallback is disabled unless SISYPHUS_ALLOW_DEMO_FALLBACK=true is explicitly set for local demos.');
}

/**
 * Fallback deterministic high-retention script generator
 */
export function generateProceduralScript(
  topic: string,
  creativePrompt = '',
  targetDurationSec = 35,
  style: VideoStyle = 'cyber_brutalist_pink'
): ScriptData {
  const duration = Math.min(58, Math.max(22, targetDurationSec));
  const sceneDuration = Math.round((duration * 1000) / 4);

  return {
    title: `The Truth About ${topic}`,
    topic,
    hook: `Stop scrolling. What you know about ${topic} is completely backwards.`,
    description: `A fast-paced infographic deconstructing ${topic}. Made with Aurora.ai code-driven video engine.`,
    callToAction: 'Hit follow if this broke your intuition.',
    hashtags: ['#AuroraAI', '#MindBlowing', '#Science', '#Facts', '#Shorts'],
    targetDurationSec: duration,
    estimatedDurationSec: duration,
    fullNarration: `Stop scrolling. What you know about ${topic} is completely backwards. In reality, modern evidence reveals an unexpected counter-intuitive mechanism. Over 84 percent of traditional assumptions collapse under scrutiny. Which leads to one haunting question: what else are we miscalculating?`,
    scenes: [
      {
        id: 'scene-1',
        sceneNumber: 1,
        title: 'The Paradox Hook',
        narration: `Stop scrolling. What you know about ${topic} is completely backwards.`,
        startMs: 0,
        endMs: sceneDuration,
        visualType: 'kinetic-hook',
        visualElements: {
          primaryShape: 'helix',
          accentColor: '#ff2a85',
          headlineText: 'THE PARADOX',
          subText: topic.toUpperCase(),
          kineticWords: ['STOP', 'QUESTION', 'EVERYTHING'],
        },
      },
      {
        id: 'scene-2',
        sceneNumber: 2,
        title: 'The Hidden Ratio',
        narration: 'In reality, modern evidence reveals an unexpected counter-intuitive mechanism.',
        startMs: sceneDuration,
        endMs: sceneDuration * 2,
        visualType: 'diagram-chart',
        visualElements: {
          primaryShape: 'waveform',
          accentColor: '#38bdf8',
          headlineText: 'OBSERVED VARIANCE',
          subText: 'Systemic divergence',
          diagramData: [
            { label: 'Assumption', value: 34, color: '#64748b' },
            { label: 'Actual Data', value: 89, color: '#ff2a85' },
            { label: 'Variance', value: 55, color: '#38bdf8' },
          ],
        },
      },
      {
        id: 'scene-3',
        sceneNumber: 3,
        title: 'The Critical Metric',
        narration: 'Over 84 percent of traditional assumptions collapse under scrutiny.',
        startMs: sceneDuration * 2,
        endMs: sceneDuration * 3,
        visualType: 'data-counter',
        visualElements: {
          primaryShape: 'nodes',
          accentColor: '#fde047',
          headlineText: 'FAILURE RATE',
          counterTarget: 84,
          counterPrefix: '',
          counterSuffix: '%',
          subText: 'Confidence threshold',
        },
      },
      {
        id: 'scene-4',
        sceneNumber: 4,
        title: 'The Final Takeaway',
        narration: 'Which leads to one haunting question: what else are we miscalculating?',
        startMs: sceneDuration * 3,
        endMs: duration * 1000,
        visualType: 'punchline-conclusion',
        visualElements: {
          primaryShape: 'orbit',
          accentColor: '#a855f7',
          headlineText: 'WHAT REMAINS?',
          subText: 'Think about it.',
          kineticWords: ['QUESTION', 'REALITY'],
        },
      },
    ],
  };
}

/**
 * Generates narration audio via Gemini 3.8 Flash Lite TTS model or creates a valid WAV file.
 */
export async function generateSpeechAudio(
  text: string,
  voiceIdentifier: string,
  outputWavPath: string
): Promise<{ durationMs: number; wavPath: string }> {
  const ai = getAiClient();

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text,
                speechMetadata: {
                  style: 'Crisp, punchy, engaging short-form video narration',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceIdentifier || 'Zephyr' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioBytes = Buffer.from(base64Audio, 'base64');
        // Gemini may return raw PCM rather than a WAV container. Wrap raw 24 kHz,
        // 16-bit mono PCM so downstream FFmpeg receives a valid WAV file.
        const isWav = audioBytes.length >= 12 && audioBytes.toString('ascii', 0, 4) === 'RIFF'
          && audioBytes.toString('ascii', 8, 12) === 'WAVE';
        let wavBytes = audioBytes;
        let pcmBytes = audioBytes;
        if (!isWav) {
          const header = Buffer.alloc(44);
          header.write('RIFF', 0);
          header.writeUInt32LE(36 + audioBytes.length, 4);
          header.write('WAVE', 8);
          header.write('fmt ', 12);
          header.writeUInt32LE(16, 16);
          header.writeUInt16LE(1, 20);
          header.writeUInt16LE(1, 22);
          header.writeUInt32LE(24000, 24);
          header.writeUInt32LE(48000, 28);
          header.writeUInt16LE(2, 32);
          header.writeUInt16LE(16, 34);
          header.write('data', 36);
          header.writeUInt32LE(audioBytes.length, 40);
          wavBytes = Buffer.concat([header, audioBytes]);
        } else {
          pcmBytes = audioBytes.subarray(44);
        }
        fs.mkdirSync(path.dirname(outputWavPath), { recursive: true });
        fs.writeFileSync(outputWavPath, wavBytes);
        const durationMs = Math.round((pcmBytes.length / 48000) * 1000);
        if (durationMs < 250 || durationMs > 60000) {
          throw new Error(`Gemini returned invalid narration duration: ${durationMs}ms.`);
        }
        return { durationMs, wavPath: outputWavPath };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini speech generation failed. Synthetic tone fallback is disabled. ${message}`);
    }
  }

  throw new Error('GEMINI_API_KEY is required for real narration. Synthetic tone fallback is disabled.');
}

/**
 * Creates a valid PCM 16-bit WAV file with gentle rhythmic harmonic carrier
 * so downstream FFmpeg and video players receive genuine audio streams!
 */
export function createSynthesizedAudioFile(
  text: string,
  outputWavPath: string
): { durationMs: number; wavPath: string } {
  const words = text.trim().split(/\s+/).length;
  // Natural speech cadence ~2.6 words/sec + 1.2s padding
  const durationSec = Math.min(58, Math.max(16, words / 2.6 + 1.2));
  const durationMs = Math.round(durationSec * 1000);

  const sampleRate = 24000;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataByteLength = numSamples * 2; // 16-bit mono = 2 bytes per sample

  const buffer = Buffer.alloc(44 + dataByteLength);

  // WAV Header (RIFF)
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk1 size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // audio format (1 = PCM)
  buffer.writeUInt16LE(1, 22); // num channels (1 = mono)
  buffer.writeUInt32LE(sampleRate, 24); // sample rate
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate (sampleRate * numChannels * bitsPerSample/8)
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataByteLength, 40);

  // Generate pleasant harmonic chord tones with speech-like rhythmic envelope
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Rhythmic syllable envelope at ~4.5 Hz (natural human speech syllabic rate)
    const speechPulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.2 * t);
    // Harmonic frequencies
    const f1 = 220; // A3
    const f2 = 330; // E4
    const f3 = 440; // A4
    const wave =
      (Math.sin(2 * Math.PI * f1 * t) * 0.4 +
        Math.sin(2 * Math.PI * f2 * t) * 0.3 +
        Math.sin(2 * Math.PI * f3 * t) * 0.2) *
      speechPulse;

    // Fade in and out
    const fadeIn = Math.min(1, t / 0.1);
    const fadeOut = Math.min(1, (durationSec - t) / 0.5);
    const sample = Math.round(wave * fadeIn * fadeOut * 9000); // comfortable volume

    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), 44 + i * 2);
  }

  const dir = path.dirname(outputWavPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputWavPath, buffer);

  return { durationMs, wavPath: outputWavPath };
}
