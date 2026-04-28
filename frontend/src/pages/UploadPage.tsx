import { useState } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Alert,
  CircularProgress, LinearProgress, ToggleButton, ToggleButtonGroup,
  Stack
} from '@mui/material';
import {
  Analytics as AnalyticsIcon,
  Work as WorkIcon,
  UploadFile as UploadIcon,
  Code as CodeIcon,
  ArrowForward as ArrowIcon
} from '@mui/icons-material';
import FileDropzone from '../components/upload/FileDropzone';

/* ✅ FIX: Define Props interface */
interface Props {
  resumeFile: File | null;
  jobDescription: string;
  isDragOver: boolean;
  loading: boolean;
  urlFetchLoading: boolean;
  error: string;
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
    resumeFile, jobDescription, isDragOver, loading, urlFetchLoading, error,
    onFileChange, onDrop, onDragOver, onDragLeave,
    onJobDescriptionChange, onFetchJobFromUrl, onAnalyze, onPasteLatex
  } = props;

  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [pastedLatex, setPastedLatex] = useState('');
  const [jobPostingUrl, setJobPostingUrl] = useState('');

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

      {/* MAIN GRID */}
      <Box
        sx={{
          maxWidth: 1100,
          mx: 'auto',
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
                disabled={loading || urlFetchLoading || !resumeFile || !jobDescription.trim()}
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

      </Box>
    </Box>
  );
}