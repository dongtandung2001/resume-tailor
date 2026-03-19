import { useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Box,
  Typography,
  Button,
  TextField,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  LinearProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  Work as WorkIcon,
  Analytics as AnalyticsIcon,
  PictureAsPdf as PdfIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  AutoFixHigh as AutoFixIcon,
  ArrowBack as BackIcon,
  WarningAmber as WarnIcon,
  CheckCircle as CheckIcon,
  Description as DescriptionIcon,
} from '@mui/icons-material';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2563eb' },
    secondary: { main: '#7c3aed' },
    success: { main: '#16a34a' },
    warning: { main: '#d97706' },
    error: { main: '#dc2626' },
    background: { default: '#f8fafc', paper: '#ffffff' },
    text: { primary: '#0f172a', secondary: '#475569' },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", sans-serif',
    h4: { fontWeight: 700 },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
  },
});

type View = 'upload' | 'editor';

export default function App() {
  // Upload state
  const [view, setView] = useState<View>('upload');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  // Shared
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Editor state
  const [latexBody, setLatexBody] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [applying, setApplying] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // ── Upload handlers ────────────────────────────────────────────────────────
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
      const fd = new FormData();
      fd.append('resume', resumeFile);
      fd.append('jobDescription', jobDescription);
      const res = await fetch('/api/analyze', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Analysis failed');
      setAnalysis(data.analysis ?? '');
      setResumeText(data.resumeText ?? '');
      setLatexBody(data.latexBody ?? '');
      setPageCount(0);
      setView('editor');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  // ── Editor handlers ────────────────────────────────────────────────────────
  const handleApplyChanges = async () => {
    setApplying(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('resumeText', resumeText);
      fd.append('analysis', analysis);
      const res = await fetch('/api/apply-changes', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to apply changes');
      setLatexBody(data.latexBody ?? '');
      setPageCount(data.pageCount ?? 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setApplying(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('latexBody', latexBody);
      const res = await fetch('/api/compile-preview', { method: 'POST', body: fd });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail || 'Compilation failed');
      }
      const count = parseInt(res.headers.get('X-Page-Count') ?? '1', 10);
      setPageCount(count);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'resume.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleReset = () => {
    setView('upload');
    setResumeFile(null);
    setJobDescription('');
    setLatexBody('');
    setResumeText('');
    setAnalysis('');
    setPageCount(0);
    setError('');
  };

  // ── Upload view ────────────────────────────────────────────────────────────
  if (view === 'upload') {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{
          minHeight: '100vh',
          bgcolor: 'background.default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 6,
        }}>
          <Box sx={{ width: '100%', maxWidth: 640, px: 2 }}>

            {/* Header */}
            <Box textAlign="center" mb={5}>
              <Box sx={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 64, height: 64, borderRadius: '50%',
                background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                mb: 2,
              }}>
                <AnalyticsIcon sx={{ fontSize: 32, color: 'white' }} />
              </Box>
              <Typography variant="h4" color="text.primary">Resume Analyzer</Typography>
              <Typography variant="body1" color="text.secondary" mt={1}>
                Upload your resume and job description for AI-powered recommendations
              </Typography>
            </Box>

            <Paper elevation={0} sx={{
              border: '1px solid', borderColor: '#e2e8f0',
              borderRadius: 3, overflow: 'hidden',
            }}>
              {/* Step 1 */}
              <Box sx={{ p: 3, borderBottom: '1px solid #e2e8f0' }}>
                <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                  <Box sx={{
                    width: 26, height: 26, borderRadius: '50%',
                    bgcolor: 'primary.main', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Typography sx={{ color: 'white', fontSize: 12, fontWeight: 700 }}>1</Typography>
                  </Box>
                  <Typography variant="h6">Upload Your Resume</Typography>
                </Box>

                {!resumeFile ? (
                  <Box
                    onDrop={handleDrop}
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onClick={() => document.getElementById('resume-input')?.click()}
                    sx={{
                      border: '2px dashed',
                      borderColor: isDragOver ? 'primary.main' : '#cbd5e1',
                      borderRadius: 2, p: 4, textAlign: 'center', cursor: 'pointer',
                      bgcolor: isDragOver ? '#eff6ff' : '#f8fafc',
                      transition: 'all 0.2s',
                      '&:hover': { borderColor: 'primary.main', bgcolor: '#eff6ff' },
                    }}
                  >
                    <CloudUploadIcon sx={{ fontSize: 40, color: 'primary.main', mb: 1 }} />
                    <Typography fontWeight={600} color="text.primary">Drag & drop your PDF</Typography>
                    <Typography variant="body2" color="text.secondary">or click to browse</Typography>
                    <input id="resume-input" type="file" accept=".pdf,application/pdf" hidden
                      onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} />
                  </Box>
                ) : (
                  <Box sx={{
                    display: 'flex', alignItems: 'center', gap: 2, p: 2,
                    border: '1px solid #bbf7d0', borderRadius: 2, bgcolor: '#f0fdf4',
                  }}>
                    <PdfIcon sx={{ color: '#dc2626', fontSize: 32 }} />
                    <Box flex={1}>
                      <Typography fontWeight={600} color="text.primary">{resumeFile.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(resumeFile.size / 1024).toFixed(1)} KB
                      </Typography>
                    </Box>
                    <IconButton size="small" color="error" onClick={() => setResumeFile(null)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                )}
              </Box>

              {/* Step 2 */}
              <Box sx={{ p: 3 }}>
                <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                  <Box sx={{
                    width: 26, height: 26, borderRadius: '50%',
                    bgcolor: 'secondary.main', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Typography sx={{ color: 'white', fontSize: 12, fontWeight: 700 }}>2</Typography>
                  </Box>
                  <WorkIcon fontSize="small" color="secondary" />
                  <Typography variant="h6">Job Description</Typography>
                </Box>
                <TextField
                  fullWidth multiline rows={7}
                  placeholder="Paste the full job description here — responsibilities, requirements, preferred qualifications..."
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  variant="outlined"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      bgcolor: '#f8fafc',
                      fontSize: '0.9rem',
                      '&:hover fieldset': { borderColor: 'primary.main' },
                    },
                  }}
                />
                <Typography variant="caption" color="text.disabled" mt={0.5} display="block">
                  {jobDescription.length} characters
                </Typography>
              </Box>

              {/* Action */}
              <Box sx={{ px: 3, pb: 3 }}>
                {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}
                <Button
                  variant="contained" fullWidth size="large"
                  onClick={handleAnalyze}
                  disabled={loading || !resumeFile || !jobDescription.trim()}
                  startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <AnalyticsIcon />}
                  sx={{
                    py: 1.5, fontSize: '1rem',
                    background: 'linear-gradient(90deg, #2563eb 0%, #7c3aed 100%)',
                    '&:hover': { background: 'linear-gradient(90deg, #1d4ed8 0%, #6d28d9 100%)' },
                  }}
                >
                  {loading ? 'Analyzing Resume...' : 'Analyze My Resume'}
                </Button>

                {loading && (
                  <Box mt={2}>
                    <LinearProgress sx={{ borderRadius: 2 }} />
                    <Typography variant="caption" color="text.secondary" display="block" textAlign="center" mt={1}>
                      Extracting text → Analyzing → Converting to LaTeX template...
                    </Typography>
                  </Box>
                )}
              </Box>
            </Paper>
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

  // ── Editor view ────────────────────────────────────────────────────────────
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>

        {/* Top bar */}
        <Box sx={{
          flexShrink: 0,
          height: 56,
          px: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          bgcolor: 'white',
          borderBottom: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          <Tooltip title="Start over">
            <IconButton size="small" onClick={handleReset}>
              <BackIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Box sx={{
            width: 30, height: 30, borderRadius: '8px',
            background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <DescriptionIcon sx={{ fontSize: 16, color: 'white' }} />
          </Box>
          <Typography variant="subtitle1" fontWeight={700} color="text.primary">
            Resume Editor
          </Typography>

          <Box flex={1} />

          {error && (
            <Alert severity="error" sx={{ py: 0, px: 1.5, fontSize: '0.78rem', borderRadius: 2, maxWidth: 400 }}>
              {error}
            </Alert>
          )}

          {pageCount > 0 && (
            <Chip
              size="small"
              icon={pageCount > 1
                ? <WarnIcon style={{ fontSize: 14 }} />
                : <CheckIcon style={{ fontSize: 14 }} />}
              label={pageCount === 1 ? '1 page ✓' : `${pageCount} pages — over limit`}
              color={pageCount > 1 ? 'error' : 'success'}
              variant="filled"
              sx={{ fontWeight: 600 }}
            />
          )}

          <Button
            size="small"
            variant="contained"
            color="secondary"
            onClick={handleApplyChanges}
            disabled={applying}
            startIcon={applying ? <CircularProgress size={14} color="inherit" /> : <AutoFixIcon />}
            sx={{ px: 2 }}
          >
            {applying ? 'Applying...' : 'Apply AI Changes'}
          </Button>

          <Button
            size="small"
            variant="contained"
            color="success"
            onClick={handleDownload}
            disabled={downloading}
            startIcon={downloading ? <CircularProgress size={14} color="inherit" /> : <DownloadIcon />}
            sx={{ px: 2 }}
          >
            {downloading ? 'Building PDF...' : 'Download PDF'}
          </Button>
        </Box>

        {/* Split pane */}
        <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>

          {/* Left — LaTeX editor */}
          <Box sx={{
            width: '55%',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #e2e8f0',
          }}>
            {/* Editor header */}
            <Box sx={{
              flexShrink: 0,
              px: 2, py: 1,
              bgcolor: '#f1f5f9',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex', alignItems: 'center', gap: 1,
            }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#fc5c65' }} />
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#fd9644' }} />
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#26de81' }} />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1, fontFamily: 'monospace' }}>
                resume.tex
              </Typography>
            </Box>

            <Box sx={{ flex: 1, minHeight: 0 }}>
              <Editor
                height="100%"
                language="latex"
                theme="vs"
                value={latexBody}
                onChange={(val) => setLatexBody(val ?? '')}
                options={{
                  fontSize: 13,
                  fontFamily: '"Fira Code", "Cascadia Code", monospace',
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  lineNumbers: 'on',
                  renderLineHighlight: 'line',
                  padding: { top: 12, bottom: 12 },
                  smoothScrolling: true,
                }}
              />
            </Box>
          </Box>

          {/* Right — Analysis panel */}
          <Box sx={{
            width: '45%',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'white',
          }}>
            {/* Panel header */}
            <Box sx={{
              flexShrink: 0,
              px: 3, py: 1.5,
              bgcolor: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex', alignItems: 'center', gap: 1.5,
            }}>
              <AnalyticsIcon fontSize="small" color="primary" />
              <Typography variant="subtitle2" fontWeight={700} color="text.primary">
                Analysis Results
              </Typography>
            </Box>

            {/* Analysis content */}
            <Box sx={{
              flex: 1,
              overflow: 'auto',
              px: 3,
              py: 2,
              '& h2': {
                fontSize: '0.95rem',
                fontWeight: 700,
                color: '#1e40af',
                mt: 2.5,
                mb: 0.75,
                pb: 0.5,
                borderBottom: '2px solid #dbeafe',
                '&:first-of-type': { mt: 0 },
              },
              '& p': { fontSize: '0.875rem', lineHeight: 1.75, color: '#334155', mb: 1 },
              '& ul, & ol': { pl: 2.5, mb: 1.5 },
              '& li': { fontSize: '0.875rem', lineHeight: 1.7, color: '#334155', mb: 0.25 },
              '& strong': { color: '#0f172a', fontWeight: 600 },
            }}>
              {applying ? (
                <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100%" gap={2}>
                  <CircularProgress size={36} />
                  <Typography variant="body2" color="text.secondary">
                    Applying improvements to your resume...
                  </Typography>
                </Box>
              ) : (
                <ReactMarkdown>{analysis}</ReactMarkdown>
              )}
            </Box>

            {/* Bottom tip */}
            <Box sx={{
              flexShrink: 0,
              px: 3, py: 1.5,
              bgcolor: '#fffbeb',
              borderTop: '1px solid #fef3c7',
              display: 'flex', alignItems: 'flex-start', gap: 1,
            }}>
              <WarnIcon sx={{ fontSize: 16, color: '#d97706', mt: 0.1 }} />
              <Typography variant="caption" color="#92400e" lineHeight={1.5}>
                Edit the LaTeX directly, then click <strong>Download PDF</strong> to compile and export.
                Use <strong>Apply AI Changes</strong> to automatically incorporate the recommendations above.
              </Typography>
            </Box>
          </Box>

        </Box>
      </Box>
    </ThemeProvider>
  );
}
