import { Box, TextField, Typography, Button, IconButton } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, DragIndicator as DragIcon } from '@mui/icons-material';
import type { EducationEntry } from '../../../types';
import { nanoid } from '../../../utils/nanoid';

interface Props {
  data: EducationEntry[];
  onChange: (data: EducationEntry[]) => void;
}

function BulletList({ bullets, onChange }: { bullets: string[]; onChange: (b: string[]) => void }) {
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.68rem' }}>
        Notes / Coursework
      </Typography>
      {bullets.map((b, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75 }}>
          <TextField
            fullWidth size="small" value={b} placeholder="e.g. Relevant Coursework: ..."
            onChange={(e) => { const arr = [...bullets]; arr[i] = e.target.value; onChange(arr); }}
            sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fafafa', fontSize: '0.85rem' } }}
          />
          <IconButton size="small" onClick={() => onChange(bullets.filter((_, j) => j !== i))} sx={{ color: 'text.disabled', flexShrink: 0 }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...bullets, ''])} sx={{ mt: 0.75, fontSize: '0.78rem', color: 'text.secondary' }}>
        Add note
      </Button>
    </Box>
  );
}

function EntryCard({ entry, onChange, onDelete }: { entry: EducationEntry; onChange: (e: EducationEntry) => void; onDelete: () => void }) {
  const set = (key: keyof EducationEntry) => (val: string | string[]) => onChange({ ...entry, [key]: val });

  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 2, mb: 2, bgcolor: '#fff' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <DragIcon sx={{ color: '#ccc', cursor: 'grab', fontSize: 18 }} />
          <Typography variant="body2" fontWeight={600} color="text.primary">
            {entry.institution || 'New Education Entry'}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onDelete} sx={{ color: 'text.disabled' }}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 1.5 }}>
        {([
          ['institution', 'Institution', 'e.g. Stanford University'],
          ['degree', 'Degree / Field', 'e.g. B.S. Computer Science'],
          ['gpa', 'GPA', 'e.g. 3.8'],
          ['startDate', 'Start Date', 'e.g. Aug 2020'],
          ['endDate', 'End Date', 'e.g. May 2024'],
        ] as [keyof EducationEntry, string, string][]).map(([k, label, ph]) => (
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

      <BulletList bullets={entry.bullets} onChange={(b) => set('bullets')(b)} />
    </Box>
  );
}

export default function EducationSection({ data, onChange }: Props) {
  const addEntry = () => onChange([...data, { id: nanoid(), institution: '', location: '', degree: '', startDate: '', endDate: '', gpa: '', bullets: [] }]);
  const updateEntry = (i: number, e: EducationEntry) => { const arr = [...data]; arr[i] = e; onChange(arr); };
  const deleteEntry = (i: number) => onChange(data.filter((_, j) => j !== i));

  return (
    <Box sx={{ p: 2.5 }}>
      {data.map((entry, i) => (
        <EntryCard key={entry.id} entry={entry} onChange={(e) => updateEntry(i, e)} onDelete={() => deleteEntry(i)} />
      ))}
      <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={addEntry}
        sx={{ borderStyle: 'dashed', color: 'text.secondary', borderColor: '#ccc', fontSize: '0.8rem', width: '100%', py: 1 }}>
        Add Education
      </Button>
    </Box>
  );
}
