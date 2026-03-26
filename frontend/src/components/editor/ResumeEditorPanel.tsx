import { useState } from 'react';
import {
  Box, Typography, Collapse, Divider, Button, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import {
  Person as PersonIcon,
  School as SchoolIcon,
  Work as WorkIcon,
  FolderOpen as FolderIcon,
  Build as BuildIcon,
  ChevronRight as ChevronRightIcon,
  DragIndicator as DragIcon,
  Add as AddIcon,
  EditNote as FormIcon,
  Code as CodeIcon,
} from '@mui/icons-material';
import MonacoEditor from '@monaco-editor/react';
import type { ResumeData } from '../../types';
import HeaderSection from './sections/HeaderSection';
import EducationSection from './sections/EducationSection';
import ExperienceSection from './sections/ExperienceSection';
import ProjectsSection from './sections/ProjectsSection';
import SkillsSection from './sections/SkillsSection';

interface SectionDef { id: string; label: string; icon: React.ReactNode; }

const SECTIONS: SectionDef[] = [
  { id: 'header',     label: 'Resume Header',              icon: <PersonIcon fontSize="small" /> },
  { id: 'education',  label: 'Education',                  icon: <SchoolIcon fontSize="small" /> },
  { id: 'experience', label: 'Professional Experience',     icon: <WorkIcon fontSize="small" /> },
  { id: 'projects',   label: 'Projects & Outside Experience', icon: <FolderIcon fontSize="small" /> },
  { id: 'skills',     label: 'Skills',                     icon: <BuildIcon fontSize="small" /> },
];

interface Props {
  data: ResumeData;
  latexBody: string;
  onDataChange: (data: ResumeData) => void;
  onLatexChange: (latex: string) => void;
}

export default function ResumeEditorPanel({ data, latexBody, onDataChange, onLatexChange }: Props) {
  const [mode, setMode] = useState<'form' | 'latex'>('form');
  const [openSection, setOpenSection] = useState<string | null>('header');

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#f8f9fa', overflow: 'hidden' }}>

      {/* ── Mode toggle ────────────────────────────────────────────────── */}
      <Box sx={{ px: 2, py: 1, borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_, v) => v && setMode(v)}
          sx={{
            '& .MuiToggleButton-root': {
              px: 1.5, py: 0.4, fontSize: '0.78rem', textTransform: 'none',
              border: '1px solid #d1d5db', color: '#6b7280',
              '&.Mui-selected': { bgcolor: '#4f46e5', color: '#fff', borderColor: '#4f46e5' },
              '&.Mui-selected:hover': { bgcolor: '#4338ca' },
            },
          }}
        >
          <ToggleButton value="form">
            <FormIcon sx={{ fontSize: 15, mr: 0.5 }} /> Form
          </ToggleButton>
          <ToggleButton value="latex">
            <CodeIcon sx={{ fontSize: 15, mr: 0.5 }} /> LaTeX
          </ToggleButton>
        </ToggleButtonGroup>
        {mode === 'latex' && (
          <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto' }}>
            edits sync to form
          </Typography>
        )}
      </Box>

      {/* ── Form view ──────────────────────────────────────────────────── */}
      {mode === 'form' && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ flex: 1, overflowY: 'auto' }}>
            {SECTIONS.map((sec, idx) => (
              <Box key={sec.id}>
                <Box
                  onClick={() => setOpenSection(prev => prev === sec.id ? null : sec.id)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5,
                    px: 2, py: 1.5, cursor: 'pointer',
                    bgcolor: openSection === sec.id ? '#eef2ff' : 'transparent',
                    borderLeft: openSection === sec.id ? '3px solid #4f46e5' : '3px solid transparent',
                    transition: 'all 0.15s',
                    '&:hover': { bgcolor: openSection === sec.id ? '#eef2ff' : '#f0f0f0' },
                  }}
                >
                  <DragIcon sx={{ color: '#d1d5db', fontSize: 18, flexShrink: 0 }} />
                  <Box sx={{ color: openSection === sec.id ? '#4f46e5' : '#6b7280', display: 'flex', alignItems: 'center' }}>
                    {sec.icon}
                  </Box>
                  <Typography variant="body2" sx={{ flex: 1, fontWeight: openSection === sec.id ? 600 : 500, color: openSection === sec.id ? '#1e1b4b' : '#374151', fontSize: '0.875rem' }}>
                    {sec.label}
                  </Typography>
                  <ChevronRightIcon sx={{ fontSize: 18, color: '#9ca3af', transform: openSection === sec.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                </Box>

                <Collapse in={openSection === sec.id} unmountOnExit>
                  <Box sx={{ bgcolor: '#fff', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                    {sec.id === 'header'     && <HeaderSection     data={data.header}     onChange={h  => onDataChange({ ...data, header:     h  })} />}
                    {sec.id === 'education'  && <EducationSection  data={data.education}  onChange={ed => onDataChange({ ...data, education:  ed })} />}
                    {sec.id === 'experience' && <ExperienceSection data={data.experience} onChange={ex => onDataChange({ ...data, experience: ex })} />}
                    {sec.id === 'projects'   && <ProjectsSection   data={data.projects}   onChange={pr => onDataChange({ ...data, projects:   pr })} />}
                    {sec.id === 'skills'     && <SkillsSection     data={data.skills}     onChange={sk => onDataChange({ ...data, skills:     sk })} />}
                  </Box>
                </Collapse>

                {idx < SECTIONS.length - 1 && <Divider sx={{ borderColor: '#e5e7eb' }} />}
              </Box>
            ))}
          </Box>

          <Divider />
          <Box sx={{ p: 2 }}>
            <Button fullWidth size="small" startIcon={<AddIcon />}
              sx={{ color: '#6b7280', fontSize: '0.82rem', py: 0.75, border: '1px dashed #d1d5db', borderRadius: 1.5 }}>
              Add Custom Section
            </Button>
          </Box>
        </Box>
      )}

      {/* ── LaTeX view ─────────────────────────────────────────────────── */}
      {mode === 'latex' && (
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <MonacoEditor
            height="100%"
            language="latex"
            value={latexBody}
            onChange={(val) => onLatexChange(val ?? '')}
            options={{
              fontSize: 12,
              lineHeight: 18,
              minimap: { enabled: false },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              renderLineHighlight: 'gutter',
              theme: 'vs',
              padding: { top: 12 },
              overviewRulerLanes: 0,
            }}
          />
        </Box>
      )}
    </Box>
  );
}
