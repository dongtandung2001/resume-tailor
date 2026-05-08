import { useState, useEffect, useRef } from "react";
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Alert as MuiAlert,
} from "@mui/material";
import { compilePdf, applyChanges, reanalyzeResume, saveEditorResume, updateSavedResume } from "../api/resumeApi";
import { generateLatexBody } from "../utils/latexGenerator";
import { parseLatexBody } from "../utils/latexParser";
import { usePdfPreview } from "../hooks/usePdfPreview";
import EditorTopBar from "../components/editor/EditorTopBar";
import ResumeEditorPanel from "../components/editor/ResumeEditorPanel";
import PreviewPanel from "../components/editor/PreviewPanel";
import ChatPanel from "../components/editor/ChatPanel";
import type { ResumeData } from "../types";

interface Props {
  resumeData: ResumeData;
  resumeText: string;
  analysis: string;
  initialLatexBody?: string;
  jobDescription?: string;
  authToken?: string | null;
  openedResumeId?: number | null;
  onReset: () => void;
}

export default function EditorPage({
  resumeData: initialData,
  resumeText,
  analysis: initialAnalysis,
  initialLatexBody,
  jobDescription,
  authToken,
  openedResumeId,
  onReset,
}: Props) {
  const [activeTab, setActiveTab] = useState(0);
  const [data, setData] = useState<ResumeData>(initialData);
  const [latexBody, setLatexBody] = useState(
    () => initialLatexBody ?? generateLatexBody(initialData),
  );
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [localJobDescription, setLocalJobDescription] = useState(jobDescription ?? '');
  const [downloading, setDownloading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [jdDialogOpen, setJdDialogOpen] = useState(false);
  const [jdDraft, setJdDraft] = useState('');
  const [reanalyzing, setReanalyzing] = useState(false);
  const [refreshedAnalysis, setRefreshedAnalysis] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");
  const { pdfUrl, pageCount, setPageCount, previewLoading, compileError } =
    usePdfPreview(latexBody);

  // ── Bidirectional sync guards ──────────────────────────────────────────
  // Prevents the form→latex effect from firing when latex was the edit source
  const fromLatexRef = useRef(false);
  // Skip the very first effect run so initialLatexBody is not overwritten on mount
  const isFirstDataRender = useRef(true);
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Form → LaTeX (skip when data was just set from a latex parse, or on first mount)
  useEffect(() => {
    if (isFirstDataRender.current) {
      isFirstDataRender.current = false;
      return;
    }
    if (fromLatexRef.current) {
      fromLatexRef.current = false;
      return;
    }
    setLatexBody(generateLatexBody(data));
  }, [data]);

  // LaTeX editor changed (user typing) → debounce parse → update form data
  const handleLatexChange = (newLatex: string) => {
    setLatexBody(newLatex);
    clearTimeout(parseTimerRef.current);
    parseTimerRef.current = setTimeout(() => {
      try {
        const parsed = parseLatexBody(newLatex);
        fromLatexRef.current = true; // skip next form→latex effect
        setData(parsed);
      } catch {
        /* ignore parse errors — form keeps its last valid state */
      }
    }, 800);
  };

  // AI agent returned new latex → apply immediately (no debounce)
  const handleAiLatexUpdate = (newLatex: string) => {
    // Cancel any pending debounce so it doesn't overwrite the updated data
    clearTimeout(parseTimerRef.current);
    setLatexBody(newLatex);
    const parsed = parseLatexBody(newLatex);
    fromLatexRef.current = true;
    setData(parsed);
  };

  // ── Horizontal split (left % of total width) ──────────────────────────
  const [leftPct, setLeftPct] = useState(50);
  const isDraggingH = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Vertical split inside left panel (editor top %) ───────────────────
  const [editorPct, setEditorPct] = useState(55);
  const isDraggingV = useRef(false);
  const leftPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isDraggingH.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        setLeftPct(Math.min(Math.max(pct, 25), 75));
      }
      if (isDraggingV.current && leftPanelRef.current) {
        const rect = leftPanelRef.current.getBoundingClientRect();
        const pct = ((e.clientY - rect.top) / rect.height) * 100;
        setEditorPct(Math.min(Math.max(pct, 20), 80));
      }
    };
    const onUp = () => {
      isDraggingH.current = false;
      isDraggingV.current = false;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleApplyChanges = async () => {
    setApplying(true);
    setError("");
    try {
      const { latexBody: improved, pageCount: count } = await applyChanges(
        latexBody,
        analysis,
        localJobDescription,
      );
      handleAiLatexUpdate(improved);
      setPageCount(count);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const handleReanalyze = async () => {
    setReanalyzing(true);
    setError("");
    try {
      const { analysis: newAnalysis } = await reanalyzeResume(latexBody, localJobDescription);
      setAnalysis(newAnalysis);
      setRefreshedAnalysis(newAnalysis);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Re-analysis failed");
    } finally {
      setReanalyzing(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError("");
    try {
      const { blob, pageCount: count } = await compilePdf(latexBody);
      setPageCount(count);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "resume.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenSaveDialog = () => {
    setSaveName('');
    setSaveError('');
    setSaveDialogOpen(true);
  };

  const handleConfirmSave = async () => {
    const trimmed = saveName.trim();
    if (!trimmed) {
      setSaveError('Please enter a name.');
      return;
    }
    if (!authToken) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveEditorResume(latexBody, trimmed, authToken);
      setSaveDialogOpen(false);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveUpdate = async () => {
    if (!authToken || !openedResumeId) return;
    setUpdating(true);
    setError("");
    try {
      await updateSavedResume(openedResumeId, latexBody, authToken);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setUpdating(false);
    }
  };

  const handleOpenJdDialog = () => {
    setJdDraft(localJobDescription);
    setJdDialogOpen(true);
  };

  const handleSaveJd = () => {
    setLocalJobDescription(jdDraft);
    setJdDialogOpen(false);
  };

  const handleSaveAndAnalyzeJd = async () => {
    setLocalJobDescription(jdDraft);
    setJdDialogOpen(false);
    setReanalyzing(true);
    setError("");
    try {
      const { analysis: newAnalysis } = await reanalyzeResume(latexBody, jdDraft);
      setAnalysis(newAnalysis);
      setRefreshedAnalysis(newAnalysis);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Re-analysis failed");
    } finally {
      setReanalyzing(false);
    }
  };

  const dividerH = {
    width: 5,
    flexShrink: 0,
    cursor: "col-resize",
    bgcolor: "#e5e7eb",
    transition: "background 0.15s",
    "&:hover, &:active": { bgcolor: "#4f46e5" },
  };
  const dividerV = {
    height: 5,
    flexShrink: 0,
    cursor: "row-resize",
    bgcolor: "#e5e7eb",
    transition: "background 0.15s",
    "&:hover, &:active": { bgcolor: "#4f46e5" },
  };

  return (
    <Box
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        bgcolor: "#f3f4f6",
        overflow: "hidden",
      }}
    >
      <EditorTopBar
        activeTab={activeTab}
        pageCount={pageCount}
        downloading={downloading}
        applying={applying}
        saving={saving}
        updating={updating}
        hasAnalysis={!!analysis && !!resumeText}
        isAuthenticated={!!authToken}
        openedResumeId={openedResumeId}
        jobDescription={localJobDescription}
        error={error}
        onReset={onReset}
        onTabChange={setActiveTab}
        onDownload={handleDownload}
        onApplyChanges={handleApplyChanges}
        onSave={handleOpenSaveDialog}
        onSaveUpdate={handleSaveUpdate}
        onOpenJdDialog={handleOpenJdDialog}
      />

      <Box
        ref={containerRef}
        sx={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}
      >
        {/* ── LEFT PANEL ───────────────────────────────────────────────── */}
        <Box
          ref={leftPanelRef}
          sx={{
            width: `${leftPct}%`,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
            borderRight: "1px solid #e5e7eb",
          }}
        >
          {/* Top: form / latex editor */}
          <Box
            sx={{
              height: `${editorPct}%`,
              minHeight: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {activeTab === 0 && (
              <ResumeEditorPanel
                data={data}
                latexBody={latexBody}
                jobDescription={localJobDescription}
                onDataChange={setData}
                onLatexChange={handleLatexChange}
              />
            )}
            {activeTab === 1 && (
              <Box sx={{ p: 3, overflowY: "auto" }}>
                <Typography variant="subtitle2" fontWeight={700} mb={1}>
                  Layout Settings
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Layout customisation coming soon.
                </Typography>
              </Box>
            )}
          </Box>

          {/* Vertical drag handle */}
          <Box
            sx={dividerV}
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingV.current = true;
            }}
          />

          {/* Bottom: chat */}
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <ChatPanel
              resumeText={resumeText}
              initialAnalysis={initialAnalysis}
              latexBody={latexBody}
              jobDescription={localJobDescription}
              refreshedAnalysis={refreshedAnalysis}
              reanalyzing={reanalyzing}
              onLatexChange={handleAiLatexUpdate}
              onNewAnalysis={(a) => { setAnalysis(a); setRefreshedAnalysis(a); }}
              onReanalyze={handleReanalyze}
            />
          </Box>
        </Box>

        {/* ── HORIZONTAL DRAG HANDLE ───────────────────────────────────── */}
        <Box
          sx={dividerH}
          onMouseDown={(e) => {
            e.preventDefault();
            isDraggingH.current = true;
          }}
        />

        {/* ── RIGHT PANEL: PDF preview ─────────────────────────────────── */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <PreviewPanel
            analysis={analysis}
            pdfUrl={pdfUrl}
            previewLoading={previewLoading}
            compileError={compileError}
          />
        </Box>
      </Box>

      <Dialog
        open={saveDialogOpen}
        onClose={() => !saving && setSaveDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: '1rem', pb: 1 }}>
          Save Resume
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Resume name"
            value={saveName}
            onChange={(e) => { setSaveName(e.target.value); setSaveError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmSave(); }}
            helperText={saveName.trim() ? `Will be saved as "${saveName.trim()}_RESUME"` : 'e.g. AI → AI_RESUME'}
            disabled={saving}
            sx={{ mt: 1 }}
          />
          {saveError && (
            <MuiAlert severity="error" sx={{ mt: 1.5, fontSize: '0.8rem', py: 0.5 }}>
              {saveError}
            </MuiAlert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setSaveDialogOpen(false)}
            disabled={saving}
            sx={{ textTransform: 'none', color: '#6b7280' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmSave}
            disabled={saving || !saveName.trim()}
            variant="contained"
            sx={{
              textTransform: 'none', fontWeight: 600,
              background: 'linear-gradient(90deg, #059669, #047857)',
              '&:hover': { background: 'linear-gradient(90deg, #047857, #065f46)' },
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={jdDialogOpen}
        onClose={() => setJdDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: '1rem', pb: 1 }}>
          Job Description
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={10}
            size="small"
            label="Job Description"
            placeholder="Paste the job description here…"
            value={jdDraft}
            onChange={(e) => setJdDraft(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setJdDialogOpen(false)}
            sx={{ textTransform: 'none', color: '#6b7280' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveJd}
            variant="outlined"
            sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#6b7280', color: '#374151' }}
          >
            Save
          </Button>
          <Button
            onClick={handleSaveAndAnalyzeJd}
            disabled={!jdDraft.trim() || reanalyzing}
            variant="contained"
            sx={{
              textTransform: 'none', fontWeight: 600,
              background: 'linear-gradient(90deg, #4f46e5, #7c3aed)',
              '&:hover': { background: 'linear-gradient(90deg, #4338ca, #6d28d9)' },
            }}
          >
            {reanalyzing ? 'Analyzing…' : 'Save & Analyze'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
