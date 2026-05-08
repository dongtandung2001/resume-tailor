import { useState } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Alert,
  CircularProgress, LinearProgress, ToggleButton, ToggleButtonGroup, Stack, MenuItem,
} from '@mui/material';
import {
  Analytics as AnalyticsIcon,
  Work as WorkIcon,
  UploadFile as UploadIcon,
  Code as CodeIcon,
  ArrowForward as ArrowIcon,
  AccountCircle as AccountIcon, Logout as LogoutIcon, FolderOpen as SavedIcon,
} from '@mui/icons-material';
import FileDropzone from '../components/upload/FileDropzone';
import type { SavedResume, User } from '../types';

/* ✅ FIX: Define Props interface */
interface Props {
  currentUser: User | null;
  authLoading: boolean;
  savedResumes: SavedResume[];
  selectedSavedResumeId: number | null;
  resumeFile: File | null;
  jobDescription: string;
  isDragOver: boolean;
  loading: boolean;
  urlFetchLoading: boolean;
  error: string;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (name: string, email: string, password: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onSaveResume: () => Promise<void>;
  onOpenSavedResume: (resumeId: number) => Promise<void>;
  onSavedResumeChange: (id: number | null) => void;
  onFileChange: (file: File | null) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onJobDescriptionChange: (value: string) => void;
  onFetchJobFromUrl: (url: string) => void | Promise<void>;
  onAnalyze: () => void;
  onPasteLatex: (latex: string) => void;
}

export default function UploadPage(props: Props) {
  const {
    currentUser, authLoading, savedResumes, selectedSavedResumeId,
  resumeFile, jobDescription, isDragOver, loading, urlFetchLoading, error,
    onLogin, onRegister, onLogout, onSaveResume, onOpenSavedResume, onSavedResumeChange,
  onFileChange, onDrop, onDragOver, onDragLeave,
    onJobDescriptionChange, onFetchJobFromUrl, onAnalyze, onPasteLatex
  } = props;

  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [pastedLatex, setPastedLatex] = useState('');
  const [jobPostingUrl, setJobPostingUrl] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const handleAuthSubmit = async () => {
    setAuthError('');
    try {
      if (authMode === 'register') {
        await onRegister(name, email, password);
      } else {
        await onLogin(email, password);
      }
      setPassword('');
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  const handleSaveResume = async () => {
    setAuthError('');
    setSaveMessage('');
    setSaveLoading(true);
    try {
      await onSaveResume();
      setSaveMessage('Resume saved successfully.');
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Failed to save resume');
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)',
      py: 6,
      px: 2
    }}>

      {/* HERO */}
      <Box textAlign="center" mb={6}>
        <Typography variant="h3" fontWeight={700} mb={1}>
          Tailor Your Resume with AI
        </Typography>
        <Typography color="text.secondary" maxWidth={600} mx="auto">
          Upload your resume, paste a job description, and instantly generate
          a version optimized for ATS and recruiters.
        </Typography>
      </Box>

      {/* CONTENT WRAPPER */}
      <Box sx={{ maxWidth: 1100, mx: 'auto' }}>

        <Paper elevation={0} sx={{ border: '1px solid', borderColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden', mb: 3 }}>
          <Box sx={{ p: 3, borderBottom: currentUser ? '1px solid #e2e8f0' : 'none' }}>
            <Box display="flex" alignItems="center" gap={1.5} mb={2}>
              <AccountIcon color="primary" />
              <Typography variant="h6">Login & Resume Storage</Typography>
            </Box>

            {currentUser ? (
              <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
                <Box>
                  <Typography variant="body1" fontWeight={600}>{currentUser.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{currentUser.email}</Typography>
                </Box>
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<LogoutIcon />}
                  onClick={onLogout}
                  disabled={authLoading}
                >
                  Log out
                </Button>
              </Box>
            ) : (
              <Stack spacing={2}>
                <ToggleButtonGroup
                  exclusive value={authMode}
                  onChange={(_, v) => v && setAuthMode(v)}
                  size="small"
                  sx={{
                    alignSelf: 'flex-start',
                    '& .MuiToggleButton-root': {
                      px: 2, py: 0.75, fontSize: '0.85rem', textTransform: 'none',
                    },
                  }}
                >
                  <ToggleButton value="login">Login</ToggleButton>
                  <ToggleButton value="register">Create account</ToggleButton>
                </ToggleButtonGroup>

                {authMode === 'register' && (
                  <TextField
                    label="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    fullWidth
                  />
                )}
                <TextField
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                />
                {authError && <Alert severity="error">{authError}</Alert>}
                <Button
                  variant="contained"
                  onClick={handleAuthSubmit}
                  disabled={authLoading || !email.trim() || !password.trim() || (authMode === 'register' && !name.trim())}
                  startIcon={authLoading ? <CircularProgress size={18} color="inherit" /> : <AccountIcon />}
                  sx={{
                    alignSelf: 'flex-start',
                    background: 'linear-gradient(90deg, #2563eb 0%, #7c3aed 100%)',
                    '&:hover': { background: 'linear-gradient(90deg, #1d4ed8 0%, #6d28d9 100%)' },
                  }}
                >
                  {authMode === 'register' ? 'Create Account' : 'Login'}
                </Button>
              </Stack>
            )}
          </Box>

          {currentUser && (
            <Box sx={{ p: 3 }}>
              <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                <SavedIcon color="secondary" />
                <Typography variant="subtitle1" fontWeight={600}>Saved Resumes</Typography>
              </Box>
              <TextField
                select
                fullWidth
                value={selectedSavedResumeId ?? ''}
                onChange={(e) => onSavedResumeChange(e.target.value ? Number(e.target.value) : null)}
                SelectProps={{ displayEmpty: true }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: '#f8fafc',
                  },
                }}
              >
                <MenuItem value="">
                  <em>Upload a new PDF for this analysis</em>
                </MenuItem>
                {savedResumes.map((savedResume) => (
                  <MenuItem key={savedResume.id} value={savedResume.id}>
                    {savedResume.filename}
                  </MenuItem>
                ))}
              </TextField>
              <Typography variant="caption" color="text.secondary" mt={1} display="block">
                {savedResumes.length > 0
                  ? 'Choose a saved resume to skip re-uploading, or leave this empty to use a new PDF.'
                  : 'Your saved resumes will show up here after you analyze an uploaded PDF while logged in.'}
              </Typography>

              {selectedSavedResumeId && (
                <Box mt={2}>
                  <Button
                    variant="outlined"
                    startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SavedIcon />}
                    disabled={loading}
                    onClick={() => onOpenSavedResume(selectedSavedResumeId)}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                  >
                    {loading ? 'Opening…' : 'Open in Editor'}
                  </Button>
                  <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                    Opens without analysis — add a job description inside the editor
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </Paper>

      {/* MAIN GRID — only shown when logged in */}
      {currentUser && <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' },
          gap: 4
        }}
      >

        {/* LEFT */}
        <Paper sx={{ p: 4, borderRadius: 4 }} elevation={3}>

          <ToggleButtonGroup
            exclusive value={mode}
            onChange={(_, v) => v && setMode(v)}
            fullWidth
            sx={{ mb: 3 }}
          >
            <ToggleButton value="upload">
              <UploadIcon sx={{ mr: 1 }} /> Upload PDF
            </ToggleButton>
            <ToggleButton value="paste">
              <CodeIcon sx={{ mr: 1 }} /> Paste LaTeX
            </ToggleButton>
          </ToggleButtonGroup>

          {mode === 'upload' && (
            <>
              <Typography fontWeight={600} mb={1}>
                Upload Resume
              </Typography>

              <FileDropzone
                file={resumeFile}
                isDragOver={isDragOver}
                onFileChange={onFileChange}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
              />
              {currentUser && (
                <Box mt={2}>
                  <Button
                    variant="outlined"
                    onClick={handleSaveResume}
                    disabled={saveLoading || !resumeFile}
                    startIcon={saveLoading ? <CircularProgress size={16} color="inherit" /> : <SavedIcon />}
                  >
                    {saveLoading ? 'Saving...' : 'Save Resume'}
                  </Button>
                  {saveMessage && (
                    <Typography variant="caption" color="success.main" display="block" mt={1}>
                      {saveMessage}
                    </Typography>
                  )}
                </Box>
              )}

              <Typography variant="caption" color="text.secondary">
                PDF only • Max 5MB
              </Typography>

              <Box mt={3}>
                <Typography fontWeight={600} mb={1}>
                  Job Description
                </Typography>

                <TextField
                  fullWidth multiline rows={6}
                  placeholder="Paste job description here..."
                  value={jobDescription}
                  onChange={(e) => onJobDescriptionChange(e.target.value)}
                />

                <Typography variant="caption" color="text.secondary">
                  {jobDescription.length} characters
                </Typography>
              </Box>
              <Box display="flex" gap={1} alignItems="flex-start" mb={2}>
                <TextField
                  fullWidth
                  size="small"
                  label="Job URL"
                  placeholder="https://…"
                  value={jobPostingUrl}
                  onChange={(e) => setJobPostingUrl(e.target.value)}
                  variant="outlined"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      bgcolor: '#f8fafc', fontSize: '0.9rem',
                      '&:hover fieldset': { borderColor: 'primary.main' },
                    },
                  }}
                />
                <Button
                  variant="outlined"
                  size="medium"
                  disabled={!jobPostingUrl.trim() || urlFetchLoading || loading}
                  onClick={() => { void onFetchJobFromUrl(jobPostingUrl.trim()); }}
                  sx={{ flexShrink: 0, py: 1, px: 2, textTransform: 'none' }}
                >
                  {urlFetchLoading ? <CircularProgress size={18} color="inherit" /> : 'Load'}
                </Button>
              </Box>
            </>
          )}

          {mode === 'paste' && (
            <>
              <Typography fontWeight={600} mb={1}>
                Paste LaTeX Resume
              </Typography>

              <TextField
                fullWidth multiline rows={12}
                value={pastedLatex}
                onChange={(e) => setPastedLatex(e.target.value)}
              />

              <Button
                fullWidth
                sx={{ mt: 2 }}
                onClick={() => onPasteLatex(pastedLatex)}
                disabled={!pastedLatex.trim()}
                endIcon={<ArrowIcon />}
              >
                Open Editor
              </Button>
            </>
          )}

          {mode === 'upload' && (
            <Box mt={4}>
              {error && <Alert severity="error">{error}</Alert>}

              <Button
                fullWidth
                size="large"
                variant="contained"
                onClick={onAnalyze}
                disabled={loading || urlFetchLoading || (!resumeFile && !selectedSavedResumeId) || !jobDescription.trim()}
                startIcon={
                  loading
                    ? <CircularProgress size={18} color="inherit" />
                    : <AnalyticsIcon />
                }
                sx={{
                  py: 1.6,
                  fontWeight: 600,
                  fontSize: '1rem',
                  background: 'linear-gradient(90deg, #2563eb, #7c3aed)'
                }}
              >
                {loading ? 'Analyzing...' : 'Generate Tailored Resume'}
              </Button>

              {loading && (
                <Box mt={2}>
                  <LinearProgress />
                </Box>
              )}
            </Box>
          )}
        </Paper>

        {/* RIGHT */}
        <Box>
          <Paper sx={{ p: 4, borderRadius: 4, mb: 3 }} elevation={2}>
            <Typography fontWeight={700} mb={2}>
              How it works
            </Typography>

            <Stack spacing={2}>
              <Box display="flex" gap={2}>
                <UploadIcon color="primary" />
                <Typography>Upload your resume</Typography>
              </Box>
              <Box display="flex" gap={2}>
                <WorkIcon color="secondary" />
                <Typography>Paste job description</Typography>
              </Box>
              <Box display="flex" gap={2}>
                <AnalyticsIcon color="success" />
                <Typography>Get optimized resume</Typography>
              </Box>
            </Stack>
          </Paper>

          <Paper sx={{ p: 4, borderRadius: 4 }} elevation={2}>
            <Typography fontWeight={700} mb={2}>
              Why use this?
            </Typography>

            <Box component="ul" sx={{ pl: 3, m: 0 }}>
              <li><Typography variant="body2" color="text.secondary">Improves ATS match score</Typography></li>
              <li><Typography variant="body2" color="text.secondary">Highlights relevant skills</Typography></li>
              <li><Typography variant="body2" color="text.secondary">Saves hours of manual editing</Typography></li>
              <li><Typography variant="body2" color="text.secondary">Increases interview chances</Typography></li>
            </Box>
          </Paper>
        </Box>

      </Box>} {/* end MAIN GRID */}

      </Box> {/* end CONTENT WRAPPER */}
    </Box>
  );
}