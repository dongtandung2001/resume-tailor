import { useState, useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { compilePdf, applyChanges } from "../api/resumeApi";
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
  onReset: () => void;
}

export default function EditorPage({
  resumeData: initialData,
  resumeText,
  analysis,
  initialLatexBody,
  onReset,
}: Props) {
  const [activeTab, setActiveTab] = useState(0);
  const [data, setData] = useState<ResumeData>(initialData);
  const [latexBody, setLatexBody] = useState(
    () => initialLatexBody ?? generateLatexBody(initialData),
  );
  const [downloading, setDownloading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const { pdfUrl, pageCount, setPageCount, previewLoading, compileError } =
    usePdfPreview(latexBody);

  // ── Bidirectional sync guards ──────────────────────────────────────────
  // Prevents the form→latex effect from firing when latex was the edit source
  const fromLatexRef = useRef(false);
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Form → LaTeX (skip when data was just set from a latex parse)
  useEffect(() => {
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
    setLatexBody(newLatex);
    try {
      const parsed = parseLatexBody(newLatex);
      fromLatexRef.current = true;
      setData(parsed);
    } catch {
      /* keep form as-is if parse fails */
    }
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
        resumeText,
        analysis,
      );
      handleAiLatexUpdate(improved);
      setPageCount(count);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
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
        hasAnalysis={!!analysis && !!resumeText}
        error={error}
        onReset={onReset}
        onTabChange={setActiveTab}
        onDownload={handleDownload}
        onApplyChanges={handleApplyChanges}
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
              initialAnalysis={analysis}
              latexBody={latexBody}
              onLatexChange={handleAiLatexUpdate}
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
    </Box>
  );
}
