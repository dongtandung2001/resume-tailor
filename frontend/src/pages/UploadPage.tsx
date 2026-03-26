import { useState } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Alert, CircularProgress, LinearProgress,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import {
  Analytics as AnalyticsIcon, Work as WorkIcon,
  UploadFile as UploadIcon, Code as CodeIcon, ArrowForward as ArrowIcon,
} from '@mui/icons-material';
import FileDropzone from '../components/upload/FileDropzone';

interface Props {
  resumeFile: File | null;
  jobDescription: string;
  isDragOver: boolean;
  loading: boolean;
  error: string;
  onFileChange: (file: File | null) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onJobDescriptionChange: (value: string) => void;
  onAnalyze: () => void;
  onPasteLatex: (latex: string) => void;
}

export default function UploadPage({
  resumeFile, jobDescription, isDragOver, loading, error,
  onFileChange, onDrop, onDragOver, onDragLeave,
  onJobDescriptionChange, onAnalyze, onPasteLatex,
}: Props) {
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [pastedLatex, setPastedLatex] = useState('');

  return (
    <Box sx={{
      minHeight: '100vh', bgcolor: 'background.default',
      display: 'flex', alignItems: 'center', justifyContent: 'center', py: 6,
    }}>
      <Box sx={{ width: '100%', maxWidth: 640, px: 2 }}>

        <Box textAlign="center" mb={5}>
          <Box sx={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64, borderRadius: '50%',
            background: 'linear-gradient(135deg, #2563eb, #7c3aed)', mb: 2,
          }}>
            <AnalyticsIcon sx={{ fontSize: 32, color: 'white' }} />
          </Box>
          <Typography variant="h4" color="text.primary">Resume Analyzer</Typography>
          <Typography variant="body1" color="text.secondary" mt={1}>
            Upload your resume and job description for AI-powered recommendations
          </Typography>
        </Box>

        {/* Mode toggle */}
        <Box display="flex" justifyContent="center" mb={3}>
          <ToggleButtonGroup
            exclusive value={mode}
            onChange={(_, v) => v && setMode(v)}
            size="small"
            sx={{
              '& .MuiToggleButton-root': {
                px: 2.5, py: 0.75, fontSize: '0.85rem', textTransform: 'none',
                border: '1px solid #d1d5db', color: '#6b7280', gap: 0.75,
                '&.Mui-selected': { bgcolor: '#4f46e5', color: '#fff', borderColor: '#4f46e5' },
                '&.Mui-selected:hover': { bgcolor: '#4338ca' },
              },
            }}
          >
            <ToggleButton value="upload">
              <UploadIcon sx={{ fontSize: 17 }} /> Upload PDF
            </ToggleButton>
            <ToggleButton value="paste">
              <CodeIcon sx={{ fontSize: 17 }} /> Paste LaTeX
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {mode === 'upload' && (
          <Paper elevation={0} sx={{ border: '1px solid', borderColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>

            {/* Step 1 */}
            <Box sx={{ p: 3, borderBottom: '1px solid #e2e8f0' }}>
              <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                <Box sx={{
                  width: 26, height: 26, borderRadius: '50%', bgcolor: 'primary.main',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Typography sx={{ color: 'white', fontSize: 12, fontWeight: 700 }}>1</Typography>
                </Box>
                <Typography variant="h6">Upload Your Resume</Typography>
              </Box>
              <FileDropzone
                file={resumeFile}
                isDragOver={isDragOver}
                onFileChange={onFileChange}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
              />
            </Box>

            {/* Step 2 */}
            <Box sx={{ p: 3 }}>
              <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                <Box sx={{
                  width: 26, height: 26, borderRadius: '50%', bgcolor: 'secondary.main',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
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
                onChange={(e) => onJobDescriptionChange(e.target.value)}
                variant="outlined"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: '#f8fafc', fontSize: '0.9rem',
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
                onClick={onAnalyze}
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
                    Extracting text → Profiling resume &amp; JD → Synthesizing ATS analysis...
                  </Typography>
                </Box>
              )}
            </Box>
          </Paper>
        )}

        {mode === 'paste' && (
          <Paper elevation={0} sx={{ border: '1px solid', borderColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
            <Box sx={{ p: 3 }}>
              <Typography variant="h6" mb={0.5}>Paste Your LaTeX Resume</Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Paste a full LaTeX document or just the <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>\begin&#123;document&#125;...\end&#123;document&#125;</code> body.
              </Typography>
              <TextField
                fullWidth multiline rows={14}
                placeholder={'\\begin{document}\n\n% paste your resume LaTeX here\n\n\\end{document}'}
                value={pastedLatex}
                onChange={(e) => setPastedLatex(e.target.value)}
                variant="outlined"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: '#f8fafc', fontSize: '0.82rem', fontFamily: 'monospace',
                    '&:hover fieldset': { borderColor: 'primary.main' },
                  },
                }}
              />
              <Typography variant="caption" color="text.disabled" mt={0.5} display="block">
                {pastedLatex.length} characters
              </Typography>
            </Box>
            <Box sx={{ px: 3, pb: 3 }}>
              <Button
                variant="contained" fullWidth size="large"
                onClick={() => onPasteLatex(pastedLatex)}
                disabled={!pastedLatex.trim()}
                endIcon={<ArrowIcon />}
                sx={{
                  py: 1.5, fontSize: '1rem',
                  background: 'linear-gradient(90deg, #2563eb 0%, #7c3aed 100%)',
                  '&:hover': { background: 'linear-gradient(90deg, #1d4ed8 0%, #6d28d9 100%)' },
                }}
              >
                Open in Editor
              </Button>
            </Box>
          </Paper>
        )}

      </Box>
    </Box>
  );
}
