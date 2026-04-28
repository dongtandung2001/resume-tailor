import { useState } from "react";
import { Box, Tabs, Tab } from "@mui/material";
import PdfPreviewPanel from "./PdfPreviewPanel";
import MatchingKeywordsPanel from "./MatchingKeywordsPanel";

interface Props {
  analysis: string;
  pdfUrl: string | null;
  previewLoading: boolean;
  compileError: string | null;
}

export default function PreviewPanel({
  analysis,
  pdfUrl,
  previewLoading,
  compileError,
}: Props) {
  const [tabIndex, setTabIndex] = useState(0);

  return (
    <Box
      sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      {/* Tab bar */}
      <Tabs
        value={tabIndex}
        onChange={(_, newValue) => setTabIndex(newValue)}
        sx={{
          borderBottom: "1px solid #e5e7eb",
          bgcolor: "#ffffff",
          "& .MuiTab-root": {
            textTransform: "none",
            fontWeight: 500,
            fontSize: "0.95rem",
            color: "#6b7280",
            "&.Mui-selected": {
              color: "#2563eb",
            },
          },
          "& .MuiTabs-indicator": {
            backgroundColor: "#2563eb",
          },
        }}
      >
        <Tab label="PDF Preview" />
        <Tab label="Matching Keywords" />
      </Tabs>

      {/* Tab content */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: tabIndex === 0 ? "flex" : "none",
          flexDirection: "column",
        }}
      >
        <PdfPreviewPanel
          pdfUrl={pdfUrl}
          previewLoading={previewLoading}
          compileError={compileError}
        />
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: tabIndex === 1 ? "flex" : "none",
          flexDirection: "column",
        }}
      >
        <MatchingKeywordsPanel analysis={analysis} />
      </Box>
    </Box>
  );
}
