import type { ResumeData, SavedResume, User } from '../types';

function apiErrorMessage(data: unknown, fallback: string): string {
  const d = data as { detail?: unknown };
  const detail = d?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (item && typeof item === 'object' && 'msg' in item) {
        return String((item as { msg: unknown }).msg);
      }
      return typeof item === 'string' ? item : JSON.stringify(item);
    });
    const joined = parts.filter(Boolean).join(' ');
    if (joined) return joined;
  }
  return fallback;
}

export async function fetchJobDescriptionFromUrl(jobUrl: string) {
  const fd = new FormData();
  fd.append('jobUrl', jobUrl);
  const res = await fetch('/api/fetch-job-url', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, `Request failed (${res.status})`));
  return data as { jobDescription: string; resolvedUrl: string };
}

function authHeaders(token?: string | null) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function analyzeResume(
  resume: File | null,
  jobDescription: string,
  options?: { token?: string | null; savedResumeId?: number | null; saveResume?: boolean },
) {
  const fd = new FormData();
  if (resume) fd.append('resume', resume);
  fd.append('jobDescription', jobDescription);
  if (options?.savedResumeId) fd.append('savedResumeId', String(options.savedResumeId));
  if (options?.saveResume) fd.append('saveResume', 'true');
  const res = await fetch('/api/analyze', {
    method: 'POST',
    body: fd,
    headers: authHeaders(options?.token),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(apiErrorMessage(data, 'Analysis failed'));
  return data as {
    analysis: string;
    resumeText: string;
    latexBody: string;
    resumeData: ResumeData;
    savedResumeId?: number | null;
  };
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
  jobDescription = '',
) {
  const fd = new FormData();
  fd.append('message', message);
  fd.append('history', JSON.stringify(history));
  fd.append('resumeText', resumeText);
  fd.append('latexBody', latexBody);
  if (jobDescription) fd.append('jobDescription', jobDescription);
  const res = await fetch('/api/chat', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Chat failed');
  return data as { content: string; latexBody: string | null; newAnalysis: string | null };
}

export async function improveBullet(bullet: string, context: string, jobDescription = '') {
  const fd = new FormData();
  fd.append('bullet', bullet);
  fd.append('context', context);
  if (jobDescription) fd.append('jobDescription', jobDescription);
  const res = await fetch('/api/improve-bullet', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Failed to improve bullet');
  return data as { improved: string };
}

export async function reanalyzeResume(latexBody: string, jobDescription: string) {
  const fd = new FormData();
  fd.append('latexBody', latexBody);
  fd.append('jobDescription', jobDescription);
  const res = await fetch('/api/reanalyze', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(apiErrorMessage(data, 'Re-analysis failed'));
  return data as { analysis: string };
}

export async function applyChanges(latexBody: string, analysis: string, jobDescription = '') {
  const fd = new FormData();
  fd.append('latexBody', latexBody);
  fd.append('analysis', analysis);
  if (jobDescription) fd.append('jobDescription', jobDescription);
  const res = await fetch('/api/apply-changes', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Failed to apply changes');
  return data as { latexBody: string; pageCount: number };
}

export async function registerUser(name: string, email: string, password: string) {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('email', email);
  fd.append('password', password);
  const res = await fetch('/api/auth/register', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Registration failed');
  return data as { token: string; user: User };
}

export async function loginUser(email: string, password: string) {
  const fd = new FormData();
  fd.append('email', email);
  fd.append('password', password);
  const res = await fetch('/api/auth/login', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Login failed');
  return data as { token: string; user: User };
}

export async function fetchCurrentUser(token: string) {
  const res = await fetch('/api/auth/me', {
    method: 'GET',
    headers: authHeaders(token),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Failed to load user');
  return data as { user: User };
}

export async function logoutUser(token: string) {
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: authHeaders(token),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail || 'Logout failed');
  return data as { success: boolean };
}

export async function fetchSavedResumes(token: string) {
  const res = await fetch('/api/resumes', {
    method: 'GET',
    headers: authHeaders(token),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Failed to load saved resumes');
  return data as { resumes: SavedResume[] };
}

export async function saveResumeFile(resume: File, token: string) {
  const fd = new FormData();
  fd.append('resume', resume);
  const res = await fetch('/api/resumes', {
    method: 'POST',
    body: fd,
    headers: authHeaders(token),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Failed to save resume');
  return data as { id: number; filename: string };
}

export async function saveEditorResume(latexBody: string, resumeName: string, token: string) {
  const { blob } = await compilePdf(latexBody);
  const filename = `${resumeName}_RESUME.pdf`;
  const file = new File([blob], filename, { type: 'application/pdf' });
  return saveResumeFile(file, token);
}

export async function openSavedResume(resumeId: number, token: string) {
  const res = await fetch(`/api/resumes/${resumeId}/open`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(apiErrorMessage(data, 'Failed to open resume'));
  return data as { latexBody: string; resumeText: string; resumeData: ResumeData };
}
