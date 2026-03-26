import {
  Box, Button, IconButton, Tooltip, Chip, Alert, CircularProgress, Tabs, Tab,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Download as DownloadIcon,
  Edit as EditIcon,
  GridView as LayoutIcon,
  CheckCircle as CheckIcon,
  WarningAmber as WarnIcon,
  AutoAwesome as ApplyIcon,
} from '@mui/icons-material';

interface Props {
  activeTab: number;
  pageCount: number;
  downloading: boolean;
  applying: boolean;
  hasAnalysis: boolean;
  error: string;
  onReset: () => void;
  onTabChange: (tab: number) => void;
  onDownload: () => void;
  onApplyChanges: () => void;
}

export default function EditorTopBar({
  activeTab, pageCount, downloading, applying, hasAnalysis, error,
  onReset, onTabChange, onDownload, onApplyChanges,
}: Props) {
  return (
    <Box sx={{
      flexShrink: 0,
      display: 'flex', alignItems: 'center',
      bgcolor: '#ffffff',
      borderBottom: '1px solid #e5e7eb',
      px: 1, height: 48, gap: 0.5,
    }}>
      <Tooltip title="Back to upload">
        <IconButton size="small" onClick={onReset} sx={{ color: 'text.secondary' }}>
          <BackIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Tabs
        value={activeTab}
        onChange={(_, v) => onTabChange(v)}
        sx={{
          minHeight: 48,
          '& .MuiTabs-indicator': { height: 2, bgcolor: '#4f46e5' },
          '& .MuiTab-root': {
            minHeight: 48, fontSize: '0.82rem', fontWeight: 500,
            color: '#6b7280', textTransform: 'none', px: 1.5, minWidth: 80,
          },
          '& .Mui-selected': { color: '#4f46e5', fontWeight: 600 },
        }}
      >
        <Tab icon={<EditIcon sx={{ fontSize: 15 }} />} iconPosition="start" label="Editor" />
        <Tab icon={<LayoutIcon sx={{ fontSize: 15 }} />} iconPosition="start" label="Layout" />
      </Tabs>

      <Box flex={1} />

      {error && (
        <Alert severity="error" sx={{ py: 0, px: 1.5, fontSize: '0.73rem', borderRadius: 1.5, maxWidth: 360 }}>
          {error}
        </Alert>
      )}

      {pageCount > 0 && (
        <Chip
          size="small"
          icon={pageCount > 1 ? <WarnIcon style={{ fontSize: 13 }} /> : <CheckIcon style={{ fontSize: 13 }} />}
          label={pageCount === 1 ? '1 page' : `${pageCount} pages`}
          color={pageCount > 1 ? 'warning' : 'success'}
          variant="filled"
          sx={{ fontWeight: 600, fontSize: '0.72rem', height: 24 }}
        />
      )}

      {hasAnalysis && (
        <Tooltip title="Re-generate resume applying all AI suggestions (enforces 1 page)">
          <span>
            <Button
              size="small" variant="outlined"
              onClick={onApplyChanges}
              disabled={applying || downloading}
              startIcon={applying ? <CircularProgress size={12} color="inherit" /> : <ApplyIcon sx={{ fontSize: '14px !important' }} />}
              sx={{
                px: 1.5, height: 32, fontSize: '0.78rem', borderRadius: 1.5,
                textTransform: 'none', fontWeight: 600,
                borderColor: '#4f46e5', color: '#4f46e5',
                '&:hover': { bgcolor: '#eef2ff', borderColor: '#4338ca' },
              }}
            >
              {applying ? 'Applying…' : 'Apply Changes'}
            </Button>
          </span>
        </Tooltip>
      )}

      <Button
        size="small" variant="contained"
        onClick={onDownload} disabled={downloading || applying}
        startIcon={downloading ? <CircularProgress size={13} color="inherit" /> : <DownloadIcon sx={{ fontSize: '15px !important' }} />}
        sx={{
          px: 2, height: 32, fontSize: '0.8rem', borderRadius: 1.5, textTransform: 'none',
          background: 'linear-gradient(90deg, #4f46e5, #7c3aed)',
          '&:hover': { background: 'linear-gradient(90deg, #4338ca, #6d28d9)' },
        }}
      >
        {downloading ? 'Building…' : 'Download PDF'}
      </Button>
    </Box>
  );
}
