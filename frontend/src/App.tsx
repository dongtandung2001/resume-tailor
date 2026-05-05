import { useState, useCallback, useEffect } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { theme } from './theme';
import { type View, type ResumeData, type SavedResume, type User } from './types';
import { analyzeResume, fetchJobDescriptionFromUrl, fetchCurrentUser, fetchSavedResumes, loginUser, logoutUser, registerUser, saveResumeFile } from './api/resumeApi';
import { nanoid } from './utils/nanoid';
import { parseLatexBody } from './utils/latexParser';
import UploadPage from './pages/UploadPage';
import EditorPage from './pages/EditorPage';

const AUTH_TOKEN_KEY = 'resume-tailor-auth-token';

function normalizeResumeData(raw: ResumeData): ResumeData {
  return {
    header: {
      name: raw.header?.name ?? '',
      phone: raw.header?.phone ?? '',
      email: raw.header?.email ?? '',
      location: raw.header?.location ?? '',
      linkedin: raw.header?.linkedin ?? '',
      github: raw.header?.github ?? '',
      website: raw.header?.website ?? '',
    },
    education: (raw.education ?? []).map((e) => ({ id: nanoid(), institution: e.institution ?? '', location: e.location ?? '', degree: e.degree ?? '', startDate: e.startDate ?? '', endDate: e.endDate ?? '', gpa: e.gpa ?? '', bullets: e.bullets ?? [] })),
    experience: (raw.experience ?? []).map((e) => ({ id: nanoid(), company: e.company ?? '', title: e.title ?? '', location: e.location ?? '', startDate: e.startDate ?? '', endDate: e.endDate ?? '', bullets: e.bullets ?? [] })),
    projects: (raw.projects ?? []).map((p) => ({ id: nanoid(), name: p.name ?? '', technologies: p.technologies ?? '', startDate: p.startDate ?? '', endDate: p.endDate ?? '', bullets: p.bullets ?? [] })),
    skills: raw.skills ?? '',
  };
}

export default function App() {
  const [view, setView] = useState<View>('upload');
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem(AUTH_TOKEN_KEY));
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [savedResumes, setSavedResumes] = useState<SavedResume[]>([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [savedResumeId, setSavedResumeId] = useState<number | null>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [urlFetchLoading, setUrlFetchLoading] = useState(false);
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [initialLatexBody, setInitialLatexBody] = useState<string | null>(null);

  const persistSession = useCallback((token: string | null, user: User | null) => {
    setAuthToken(token);
    setCurrentUser(user);
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  }, []);

  const loadSavedResumes = useCallback(async (token: string) => {
    const data = await fetchSavedResumes(token);
    setSavedResumes(data.resumes ?? []);
  }, []);

  useEffect(() => {
    if (!authToken) {
      setCurrentUser(null);
      setSavedResumes([]);
      setSavedResumeId(null);
      return;
    }

    let cancelled = false;
    setAuthLoading(true);
    Promise.all([fetchCurrentUser(authToken), fetchSavedResumes(authToken)])
      .then(([me, resumes]) => {
        if (cancelled) return;
        setCurrentUser(me.user);
        setSavedResumes(resumes.resumes ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        persistSession(null, null);
        setSavedResumes([]);
        setSavedResumeId(null);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });

    return () => { cancelled = true; };
  }, [authToken, persistSession]);

  const handleFileChange = useCallback((file: File | null) => {
    if (file && file.type !== 'application/pdf') {
      setError('Please upload a PDF file only.');
      return;
    }
    setResumeFile(file);
    if (file) setSavedResumeId(null);
    setError('');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileChange(e.dataTransfer.files[0] ?? null);
  }, [handleFileChange]);

  const handleFetchJobFromUrl = async (url: string) => {
    setUrlFetchLoading(true);
    setError('');
    try {
      const { jobDescription: text } = await fetchJobDescriptionFromUrl(url);
      setJobDescription(text);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load job posting');
    } finally {
      setUrlFetchLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if ((!resumeFile && !savedResumeId) || !jobDescription.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await analyzeResume(resumeFile, jobDescription, {
        token: authToken,
        savedResumeId,
        saveResume: !!currentUser && !!resumeFile,
      });
      setAnalysis(data.analysis ?? '');
      setResumeText(data.resumeText ?? '');
      setInitialLatexBody(data.latexBody ?? null);
      setResumeData(normalizeResumeData(data.resumeData ?? {} as ResumeData));
      if (authToken) await loadSavedResumes(authToken);
      setView('editor');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  const handlePasteLatex = useCallback((latexBody: string) => {
    // Extract body if full document was pasted
    const bodyMatch = latexBody.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
    const body = bodyMatch ? `\\begin{document}${bodyMatch[1]}\\end{document}` : latexBody;
    try {
      const parsed = parseLatexBody(body);
      setResumeData(normalizeResumeData(parsed));
    } catch {
      setResumeData(normalizeResumeData({} as ResumeData));
    }
    setInitialLatexBody(body);
    setResumeText('');
    setAnalysis('');
    setView('editor');
  }, []);

  const handleReset = useCallback(() => {
    setView('upload');
    setResumeFile(null);
    setJobDescription('');
    setResumeData(null);
    setResumeText('');
    setAnalysis('');
    setInitialLatexBody(null);
    setError('');
  }, []);

  const handleRegister = useCallback(async (name: string, email: string, password: string) => {
    setAuthLoading(true);
    try {
      const data = await registerUser(name, email, password);
      persistSession(data.token, data.user);
      await loadSavedResumes(data.token);
      setError('');
    } finally {
      setAuthLoading(false);
    }
  }, [loadSavedResumes, persistSession]);

  const handleLogin = useCallback(async (email: string, password: string) => {
    setAuthLoading(true);
    try {
      const data = await loginUser(email, password);
      persistSession(data.token, data.user);
      await loadSavedResumes(data.token);
      setError('');
    } finally {
      setAuthLoading(false);
    }
  }, [loadSavedResumes, persistSession]);

  const handleLogout = useCallback(async () => {
    const token = authToken;
    persistSession(null, null);
    setSavedResumes([]);
    setSavedResumeId(null);
    if (token) {
      try {
        await logoutUser(token);
      } catch {
        // Ignore logout failures after local session clear
      }
    }
  }, [authToken, persistSession]);

  const handleSaveResume = useCallback(async () => {
    if (!authToken || !resumeFile) {
      throw new Error('Please log in and choose a PDF first');
    }
    await saveResumeFile(resumeFile, authToken);
    await loadSavedResumes(authToken);
    setSavedResumeId(null);
    setError('');
  }, [authToken, loadSavedResumes, resumeFile]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {view === 'upload' ? (
        <UploadPage
          currentUser={currentUser}
          authLoading={authLoading}
          savedResumes={savedResumes}
          selectedSavedResumeId={savedResumeId}
          resumeFile={resumeFile}
          jobDescription={jobDescription}
          isDragOver={isDragOver}
          loading={loading}
          urlFetchLoading={urlFetchLoading}
          error={error}
          onLogin={handleLogin}
          onRegister={handleRegister}
          onLogout={handleLogout}
          onSaveResume={handleSaveResume}
          onSavedResumeChange={(id) => {
            setSavedResumeId(id);
            if (id) setResumeFile(null);
          }}
          onFileChange={handleFileChange}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onJobDescriptionChange={setJobDescription}
          onFetchJobFromUrl={handleFetchJobFromUrl}
          onAnalyze={handleAnalyze}
          onPasteLatex={handlePasteLatex}
        />
      ) : resumeData ? (
        <EditorPage
          resumeData={resumeData}
          resumeText={resumeText}
          analysis={analysis}
          initialLatexBody={initialLatexBody ?? undefined}
          jobDescription={jobDescription}
          onReset={handleReset}
        />
      ) : null}
    </ThemeProvider>
  );
}
