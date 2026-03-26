import { useState, useCallback } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { theme } from './theme';
import { type View, type ResumeData } from './types';
import { analyzeResume } from './api/resumeApi';
import { nanoid } from './utils/nanoid';
import { parseLatexBody } from './utils/latexParser';
import UploadPage from './pages/UploadPage';
import EditorPage from './pages/EditorPage';

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
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [initialLatexBody, setInitialLatexBody] = useState<string | null>(null);

  const handleFileChange = useCallback((file: File | null) => {
    if (file && file.type !== 'application/pdf') {
      setError('Please upload a PDF file only.');
      return;
    }
    setResumeFile(file);
    setError('');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileChange(e.dataTransfer.files[0] ?? null);
  }, [handleFileChange]);

  const handleAnalyze = async () => {
    if (!resumeFile || !jobDescription.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await analyzeResume(resumeFile, jobDescription);
      setAnalysis(data.analysis ?? '');
      setResumeText(data.resumeText ?? '');
      setInitialLatexBody(data.latexBody ?? null);
      setResumeData(normalizeResumeData(data.resumeData ?? {} as ResumeData));
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

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {view === 'upload' ? (
        <UploadPage
          resumeFile={resumeFile}
          jobDescription={jobDescription}
          isDragOver={isDragOver}
          loading={loading}
          error={error}
          onFileChange={handleFileChange}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onJobDescriptionChange={setJobDescription}
          onAnalyze={handleAnalyze}
          onPasteLatex={handlePasteLatex}
        />
      ) : resumeData ? (
        <EditorPage
          resumeData={resumeData}
          resumeText={resumeText}
          analysis={analysis}
          initialLatexBody={initialLatexBody ?? undefined}
          onReset={handleReset}
        />
      ) : null}
    </ThemeProvider>
  );
}
