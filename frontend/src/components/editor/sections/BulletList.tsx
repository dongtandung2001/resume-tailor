import { useState } from 'react';
import {
  Box, TextField, Typography, Button, IconButton, Tooltip, CircularProgress,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, AutoFixHigh as SparkleIcon } from '@mui/icons-material';
import { improveBullet } from '../../../api/resumeApi';

interface Props {
  bullets: string[];
  context?: string;
  placeholder?: string;
  label?: string;
  onChange: (bullets: string[]) => void;
}

export default function BulletList({
  bullets,
  context = '',
  placeholder = 'Describe your achievement with measurable impact...',
  label = 'Bullet Points',
  onChange,
}: Props) {
  const [improvingIdx, setImprovingIdx] = useState<number | null>(null);

  const handleImprove = async (i: number) => {
    const text = bullets[i].trim();
    if (!text || improvingIdx !== null) return;
    setImprovingIdx(i);
    try {
      const { improved } = await improveBullet(text, context);
      const arr = [...bullets];
      arr[i] = improved;
      onChange(arr);
    } catch { /* keep original on failure */ } finally {
      setImprovingIdx(null);
    }
  };

  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem' }}>
        {label}
      </Typography>
      {bullets.map((b, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 0.75 }}>
          <Box sx={{ mt: 1, color: '#aaa', fontSize: 18, flexShrink: 0 }}>•</Box>
          <TextField
            fullWidth size="small" multiline value={b} placeholder={placeholder}
            onChange={(e) => { const arr = [...bullets]; arr[i] = e.target.value; onChange(arr); }}
            sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fafafa', fontSize: '0.85rem' } }}
          />
          <Tooltip title="AI improve" placement="top">
            <span>
              <IconButton
                size="small"
                onClick={() => handleImprove(i)}
                disabled={improvingIdx !== null || !b.trim()}
                sx={{
                  flexShrink: 0, mt: 0.5, color: '#7c3aed',
                  '&:hover': { bgcolor: '#ede9fe' },
                  '&.Mui-disabled': { color: '#d1d5db' },
                }}
              >
                {improvingIdx === i
                  ? <CircularProgress size={14} sx={{ color: '#7c3aed' }} />
                  : <SparkleIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </span>
          </Tooltip>
          <IconButton size="small" onClick={() => onChange(bullets.filter((_, j) => j !== i))} sx={{ color: 'text.disabled', flexShrink: 0, mt: 0.5 }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...bullets, ''])} sx={{ mt: 0.75, fontSize: '0.78rem', color: 'text.secondary' }}>
        Add bullet
      </Button>
    </Box>
  );
}
