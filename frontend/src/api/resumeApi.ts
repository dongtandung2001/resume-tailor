import type { ResumeData } from '../types';

export async function analyzeResume(resume: File, jobDescription: string) {
  const fd = new FormData();
  fd.append('resume', resume);
  fd.append('jobDescription', jobDescription);
  const res = await fetch('/api/analyze', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Analysis failed');
  return data as { analysis: string; resumeText: string; latexBody: string; resumeData: ResumeData };
}

export async function compilePdf(latexBody: string) {
  const fd = new FormData();
  fd.append('latexBody', latexBody);
  const res = await fetch('/api/compile-preview', { method: 'POST', body: fd });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as { detail?: string }).detail || 'Compilation failed');
  }
  const pageCount = parseInt(res.headers.get('X-Page-Count') ?? '1', 10);
  const blob = await res.blob();
  return { blob, pageCount };
}

export async function sendChatMessage(
  message: string,
  history: { role: string; content: string }[],
  resumeText: string,
  latexBody: string,
) {
  const fd = new FormData();
  fd.append('message', message);
  fd.append('history', JSON.stringify(history));
  fd.append('resumeText', resumeText);
  fd.append('latexBody', latexBody);
  const res = await fetch('/api/chat', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Chat failed');
  return data as { content: string; latexBody: string | null };
}

export async function improveBullet(bullet: string, context: string) {
  const fd = new FormData();
  fd.append('bullet', bullet);
  fd.append('context', context);
  const res = await fetch('/api/improve-bullet', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Failed to improve bullet');
  return data as { improved: string };
}

export async function applyChanges(resumeText: string, analysis: string) {
  const fd = new FormData();
  fd.append('resumeText', resumeText);
  fd.append('analysis', analysis);
  const res = await fetch('/api/apply-changes', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Failed to apply changes');
  return data as { latexBody: string; pageCount: number };
}
