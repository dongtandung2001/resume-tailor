import { useMemo, useState } from "react";
import { Box, Typography, CircularProgress, Button } from "@mui/material";
import {
  CheckCircle as CheckIcon,
  Cancel as CancelIcon,
  WarningAmber as WarningIcon,
} from "@mui/icons-material";

interface KeywordMatch {
  indicator: "✅" | "❌" | "⚠️";
  keyword: string;
  description: string;
}

interface Props {
  analysis: string;
}

const INDICATOR_ICONS: Record<"✅" | "❌" | "⚠️", React.ComponentType> = {
  "✅": CheckIcon,
  "❌": CancelIcon,
  "⚠️": WarningIcon,
};

const INDICATOR_COLORS: Record<
  "✅" | "❌" | "⚠️",
  { bg: string; border: string; icon: string }
> = {
  "✅": { bg: "#ecfdf5", border: "#d1fae5", icon: "#059669" },
  "❌": { bg: "#fef2f2", border: "#fee2e2", icon: "#dc2626" },
  "⚠️": { bg: "#fffbeb", border: "#fef3c7", icon: "#d97706" },
};

function parseKeywords(analysis: string): KeywordMatch[] {
  // Find the "Keyword Match Analysis" section - simplified for consistent backend format
  const keywordSectionMatch = analysis.match(
    /Keyword Match Analysis\n([\s\S]*?)(?=\n##|$)/i,
  );

  if (!keywordSectionMatch) {
    console.debug("No Keyword Match Analysis section found");
    return [];
  }

  const section = keywordSectionMatch[1];
  const keywords: KeywordMatch[] = [];

  // Parse each line with format: "[emoji] keyword: description"
  // Each keyword should be on its own line: ✅ keyword: description
  const lineRegex = /^(✅|❌|⚠️)\s+([^:]+?):\s*(.*)$/gm;
  let match;

  while ((match = lineRegex.exec(section)) !== null) {
    const indicator = match[1] as "✅" | "❌" | "⚠️";
    const keyword = match[2].trim().replace(/\*\*/g, "").trim(); // Remove markdown bold
    const description = match[3].trim();

    if (keyword.length > 0) {
      keywords.push({
        indicator,
        keyword,
        description,
      });
    }
  }

  console.debug(`Parsed ${keywords.length} keywords from analysis`);
  return keywords;
}

export default function MatchingKeywordsPanel({ analysis }: Props) {
  const keywords = useMemo(() => parseKeywords(analysis), [analysis]);
  const [activeFilters, setActiveFilters] = useState<Set<"✅" | "❌" | "⚠️">>(
    new Set(["✅", "❌", "⚠️"]),
  );

  if (!analysis) {
    return (
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#9ca3af",
        }}
      >
        <CircularProgress size={40} sx={{ color: "#d1d5db", mb: 2 }} />
        <Typography variant="body2">Loading analysis...</Typography>
      </Box>
    );
  }

  if (keywords.length === 0) {
    return (
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#9ca3af",
        }}
      >
        <Typography variant="body2">No keywords found in analysis</Typography>
      </Box>
    );
  }

  // Count by indicator
  const counts = {
    "✅": keywords.filter((k) => k.indicator === "✅").length,
    "❌": keywords.filter((k) => k.indicator === "❌").length,
    "⚠️": keywords.filter((k) => k.indicator === "⚠️").length,
  };

  // Filter keywords based on active filters
  const filteredKeywords = keywords.filter((k) =>
    activeFilters.has(k.indicator),
  );

  // Toggle filter
  const toggleFilter = (indicator: "✅" | "❌" | "⚠️") => {
    const newFilters = new Set(activeFilters);
    if (newFilters.has(indicator)) {
      newFilters.delete(indicator);
    } else {
      newFilters.add(indicator);
    }
    setActiveFilters(newFilters);
  };

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        bgcolor: "#f8fafc",
        overflow: "hidden",
      }}
    >
      {/* Filter buttons */}
      <Box
        sx={{
          px: 3,
          py: 2,
          bgcolor: "#ffffff",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <Button
          size="small"
          onClick={() => toggleFilter("✅")}
          variant={activeFilters.has("✅") ? "contained" : "outlined"}
          startIcon={<CheckIcon sx={{ fontSize: 16 }} />}
          sx={{
            color: activeFilters.has("✅") ? "white" : "#059669",
            borderColor: "#059669",
            backgroundColor: activeFilters.has("✅")
              ? "#059669"
              : "transparent",
            textTransform: "none",
            fontWeight: 600,
            "&:hover": {
              backgroundColor: activeFilters.has("✅") ? "#047857" : "#ecfdf5",
            },
          }}
        >
          {counts["✅"]} Matched
        </Button>

        <Button
          size="small"
          onClick={() => toggleFilter("❌")}
          variant={activeFilters.has("❌") ? "contained" : "outlined"}
          startIcon={<CancelIcon sx={{ fontSize: 16 }} />}
          sx={{
            color: activeFilters.has("❌") ? "white" : "#dc2626",
            borderColor: "#dc2626",
            backgroundColor: activeFilters.has("❌")
              ? "#dc2626"
              : "transparent",
            textTransform: "none",
            fontWeight: 600,
            "&:hover": {
              backgroundColor: activeFilters.has("❌") ? "#b91c1c" : "#fef2f2",
            },
          }}
        >
          {counts["❌"]} Missing
        </Button>

        <Button
          size="small"
          onClick={() => toggleFilter("⚠️")}
          variant={activeFilters.has("⚠️") ? "contained" : "outlined"}
          startIcon={<WarningIcon sx={{ fontSize: 16 }} />}
          sx={{
            color: activeFilters.has("⚠️") ? "white" : "#d97706",
            borderColor: "#d97706",
            backgroundColor: activeFilters.has("⚠️")
              ? "#d97706"
              : "transparent",
            textTransform: "none",
            fontWeight: 600,
            "&:hover": {
              backgroundColor: activeFilters.has("⚠️") ? "#b45309" : "#fffbeb",
            },
          }}
        >
          {counts["⚠️"]} Partial
        </Button>
      </Box>

      {/* Scrollable keywords list */}
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          px: 3,
          py: 2,
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
          "&::-webkit-scrollbar": {
            width: "8px",
          },
          "&::-webkit-scrollbar-track": {
            background: "#f3f4f6",
          },
          "&::-webkit-scrollbar-thumb": {
            background: "#d1d5db",
            borderRadius: "4px",
            "&:hover": {
              background: "#9ca3af",
            },
          },
        }}
      >
        {filteredKeywords.map((k, idx) => {
          const colors = INDICATOR_COLORS[k.indicator];
          const IconComponent = INDICATOR_ICONS[k.indicator];

          return (
            <Box
              key={idx}
              sx={{
                display: "flex",
                alignItems: "flex-start",
                gap: 2,
                p: 1.5,
                bgcolor: colors.bg,
                border: `1px solid ${colors.border}`,
                borderRadius: 1.5,
                transition: "background-color 0.2s",
                "&:hover": {
                  bgcolor: colors.border,
                },
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  flexShrink: 0,
                  mt: 0.25,
                  color: colors.icon,
                  fontSize: 20,
                }}
              >
                <IconComponent />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{
                    color: "#0f172a",
                    wordBreak: "break-word",
                  }}
                >
                  {k.keyword}
                </Typography>
                {k.description && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: "#475569",
                      marginTop: 0.5,
                      display: "block",
                      wordBreak: "break-word",
                      lineHeight: 1.5,
                    }}
                  >
                    {k.description}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
        {filteredKeywords.length === 0 && (
          <Box
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#9ca3af",
            }}
          >
            <Typography variant="body2">
              No keywords match the selected filters
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
