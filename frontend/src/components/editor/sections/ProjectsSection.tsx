import { Box, TextField, Typography, Button, IconButton } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, DragIndicator as DragIcon } from '@mui/icons-material';
import type { ProjectEntry } from '../../../types';
import { nanoid } from '../../../utils/nanoid';
import BulletList from './BulletList';

interface Props {
  data: ProjectEntry[];
  onChange: (data: ProjectEntry[]) => void;
}

function EntryCard({ entry, onChange, onDelete }: { entry: ProjectEntry; onChange: (e: ProjectEntry) => void; onDelete: () => void }) {
  const set = (key: keyof ProjectEntry) => (val: string | string[]) => onChange({ ...entry, [key]: val });

  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 2, mb: 2, bgcolor: '#fff' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <DragIcon sx={{ color: '#ccc', cursor: 'grab', fontSize: 18 }} />
          <Typography variant="body2" fontWeight={600} color="text.primary">
            {entry.name || 'New Project'}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onDelete} sx={{ color: 'text.disabled' }}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 0.5 }}>
        {([
          ['name', 'Project Name', 'e.g. My Awesome App'],
          ['technologies', 'Technologies', 'e.g. React, Node.js, PostgreSQL'],
          ['startDate', 'Start Date', 'e.g. Jan 2024'],
          ['endDate', 'End Date', 'e.g. Mar 2024'],
        ] as [keyof ProjectEntry, string, string][]).map(([k, label, ph]) => (
          <Box key={k}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem', display: 'block', mb: 0.4 }}>
              {label}
            </Typography>
            <TextField
              fullWidth size="small"
              value={entry[k] as string}
              placeholder={ph}
              onChange={(e) => set(k)(e.target.value)}
              sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fafafa', fontSize: '0.85rem' } }}
            />
          </Box>
        ))}
      </Box>

      <BulletList
        bullets={entry.bullets}
        context={entry.name || 'project'}
        placeholder="Describe what you built or accomplished..."
        onChange={(b) => set('bullets')(b)}
      />
    </Box>
  );
}

export default function ProjectsSection({ data, onChange }: Props) {
  const addEntry = () => onChange([...data, { id: nanoid(), name: '', technologies: '', startDate: '', endDate: '', bullets: [] }]);
  const updateEntry = (i: number, e: ProjectEntry) => { const arr = [...data]; arr[i] = e; onChange(arr); };
  const deleteEntry = (i: number) => onChange(data.filter((_, j) => j !== i));

  return (
    <Box sx={{ p: 2.5 }}>
      {data.map((entry, i) => (
        <EntryCard key={entry.id} entry={entry} onChange={(e) => updateEntry(i, e)} onDelete={() => deleteEntry(i)} />
      ))}
      <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={addEntry}
        sx={{ borderStyle: 'dashed', color: 'text.secondary', borderColor: '#ccc', fontSize: '0.8rem', width: '100%', py: 1 }}>
        Add Project
      </Button>
    </Box>
  );
}
