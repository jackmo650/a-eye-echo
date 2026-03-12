// ============================================================================
// Export Service — Convert transcript sessions to various formats
// Supports: TXT, SRT, VTT, JSON, Markdown
// Key use case: User runs transcripts through ChatGPT for summaries,
// so JSON format includes structured metadata for AI processing.
// ============================================================================

import type {
  ExportFormat,
  TranscriptSegment,
  TranscriptSession,
  Speaker,
} from '../types';

/** Format milliseconds as HH:MM:SS,mmm (SRT format) */
function formatSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return (
    String(hours).padStart(2, '0') + ':' +
    String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + ',' +
    String(millis).padStart(3, '0')
  );
}

/** Format milliseconds as HH:MM:SS.mmm (VTT format) */
function formatVttTime(ms: number): string {
  return formatSrtTime(ms).replace(',', '.');
}

/** Format milliseconds as MM:SS for display */
function formatDisplayTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface ExportData {
  session: TranscriptSession;
  segments: TranscriptSegment[];
  speakers: Speaker[];
}

// ── Format Exporters ────────────────────────────────────────────────────────

function exportTxt(data: ExportData): string {
  const { session, segments, speakers } = data;
  const speakerMap = new Map(speakers.map(s => [s.id, s.label]));

  let output = `${session.title}\n`;
  output += `${session.startedAt}\n`;
  output += `Duration: ${formatDisplayTime(session.durationMs)}\n`;
  output += '─'.repeat(50) + '\n\n';

  for (const seg of segments) {
    const speaker = seg.speakerId ? speakerMap.get(seg.speakerId) : null;
    const time = formatDisplayTime(seg.startMs);
    const prefix = speaker ? `[${time}] ${speaker}: ` : `[${time}] `;
    output += prefix + seg.text + '\n';
  }

  return output;
}

function exportSrt(data: ExportData): string {
  const { segments, speakers } = data;
  const speakerMap = new Map(speakers.map(s => [s.id, s.label]));

  return segments
    .map((seg, i) => {
      const speaker = seg.speakerId ? speakerMap.get(seg.speakerId) : null;
      const text = speaker ? `<b>${speaker}:</b> ${seg.text}` : seg.text;
      return `${i + 1}\n${formatSrtTime(seg.startMs)} --> ${formatSrtTime(seg.endMs)}\n${text}`;
    })
    .join('\n\n') + '\n';
}

function exportVtt(data: ExportData): string {
  const { segments, speakers } = data;
  const speakerMap = new Map(speakers.map(s => [s.id, s.label]));

  let output = 'WEBVTT\n\n';

  for (const seg of segments) {
    const speaker = seg.speakerId ? speakerMap.get(seg.speakerId) : null;
    const text = speaker ? `<v ${speaker}>${seg.text}` : seg.text;
    output += `${formatVttTime(seg.startMs)} --> ${formatVttTime(seg.endMs)}\n${text}\n\n`;
  }

  return output;
}

function exportJson(data: ExportData): string {
  const { session, segments, speakers } = data;

  return JSON.stringify({
    captioncast: {
      version: '0.1.0',
      exportedAt: new Date().toISOString(),
    },
    session: {
      title: session.title,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: session.durationMs,
      modelUsed: session.modelUsed,
      segmentCount: session.segmentCount,
    },
    speakers: speakers.map(s => ({
      id: s.id,
      label: s.label,
    })),
    transcript: segments.map(seg => ({
      text: seg.text,
      startMs: seg.startMs,
      endMs: seg.endMs,
      speaker: seg.speakerId,
      confidence: seg.confidence,
    })),
    // Plain text version for easy AI processing (ChatGPT, etc.)
    plainText: segments.map(s => s.text).join(' '),
  }, null, 2);
}

function exportMarkdown(data: ExportData): string {
  const { session, segments, speakers } = data;
  const speakerMap = new Map(speakers.map(s => [s.id, s.label]));

  let output = `# ${session.title}\n\n`;
  output += `**Date:** ${session.startedAt}  \n`;
  output += `**Duration:** ${formatDisplayTime(session.durationMs)}  \n`;
  output += `**Model:** ${session.modelUsed}  \n\n`;
  output += '---\n\n';

  let lastSpeaker: string | null = null;

  for (const seg of segments) {
    const speaker = seg.speakerId ? speakerMap.get(seg.speakerId) : null;

    if (speaker && speaker !== lastSpeaker) {
      output += `\n### ${speaker}\n\n`;
      lastSpeaker = speaker ?? null;
    }

    const time = formatDisplayTime(seg.startMs);
    output += `\`${time}\` ${seg.text}\n\n`;
  }

  return output;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function exportTranscript(
  format: ExportFormat,
  data: ExportData,
): { content: string; filename: string; mimeType: string } {
  const timestamp = new Date().toISOString().slice(0, 10);
  const safeTitle = data.session.title
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50);

  const base = `${safeTitle}_${timestamp}`;

  switch (format) {
    case 'txt':
      return { content: exportTxt(data), filename: `${base}.txt`, mimeType: 'text/plain' };
    case 'srt':
      return { content: exportSrt(data), filename: `${base}.srt`, mimeType: 'application/x-subrip' };
    case 'vtt':
      return { content: exportVtt(data), filename: `${base}.vtt`, mimeType: 'text/vtt' };
    case 'json':
      return { content: exportJson(data), filename: `${base}.json`, mimeType: 'application/json' };
    case 'md':
      return { content: exportMarkdown(data), filename: `${base}.md`, mimeType: 'text/markdown' };
    case 'pdf':
      // TODO: Phase 4 — PDF generation with styled text
      return { content: exportTxt(data), filename: `${base}.txt`, mimeType: 'text/plain' };
    default:
      return { content: exportTxt(data), filename: `${base}.txt`, mimeType: 'text/plain' };
  }
}

/** Get file extension for export format */
export function getFormatExtension(format: ExportFormat): string {
  return format === 'pdf' ? 'pdf' : format;
}

/** Get human-readable format label */
export function getFormatLabel(format: ExportFormat): string {
  switch (format) {
    case 'txt': return 'Plain Text';
    case 'srt': return 'SRT Subtitles';
    case 'vtt': return 'WebVTT Subtitles';
    case 'json': return 'JSON (for AI/ChatGPT)';
    case 'md': return 'Markdown';
    case 'pdf': return 'PDF';
  }
}
