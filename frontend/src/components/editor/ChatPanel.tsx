import { useState, useRef, useEffect } from 'react';
import {
  Box, Typography, TextField, IconButton, CircularProgress, Avatar, Chip,
} from '@mui/material';
import {
  Send as SendIcon,
  AutoFixHigh as AiIcon,
  Person as PersonIcon,
  EditNote as EditedIcon,
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import { sendChatMessage } from '../../api/resumeApi';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  resumeUpdated?: boolean; // true when this message also modified the latex
}

interface Props {
  resumeText: string;
  initialAnalysis: string;
  latexBody: string;
  onLatexChange: (latex: string) => void;
}

export default function ChatPanel({ resumeText, initialAnalysis, latexBody, onLatexChange }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: initialAnalysis },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const userMsg: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await sendChatMessage(text, history, resumeText, latexBody);

      const resumeUpdated = !!res.latexBody;
      if (res.latexBody) onLatexChange(res.latexBody);

      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: res.content,
        resumeUpdated,
      }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: '#ffffff' }}>

      {/* Header */}
      <Box sx={{ px: 2, py: 1, borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <AiIcon sx={{ fontSize: 15, color: '#4f46e5' }} />
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: '0.06em' }}>
          AI ASSISTANT
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto' }}>
          can edit your resume directly
        </Typography>
      </Box>

      {/* Messages */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {messages.map((msg, i) => (
          <Box key={i} sx={{ display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', gap: 1, alignItems: 'flex-start' }}>

            <Avatar sx={{ width: 26, height: 26, flexShrink: 0, bgcolor: msg.role === 'assistant' ? '#4f46e5' : '#e5e7eb' }}>
              {msg.role === 'assistant'
                ? <AiIcon sx={{ fontSize: 14, color: '#fff' }} />
                : <PersonIcon sx={{ fontSize: 14, color: '#6b7280' }} />}
            </Avatar>

            <Box sx={{ maxWidth: '88%', display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {msg.role === 'assistant' ? (
                <Box sx={{
                  bgcolor: '#f9fafb', border: '1px solid #e5e7eb',
                  borderRadius: '4px 12px 12px 12px', px: 1.5, py: 1,
                  fontSize: '0.8rem', color: '#1f2937', lineHeight: 1.6,
                  '& p': { m: 0, mb: 0.75 }, '& p:last-child': { mb: 0 },
                  '& ul, & ol': { pl: 2, mt: 0.25, mb: 0.75 },
                  '& li': { mb: 0.25 },
                  '& h2, & h3': { fontSize: '0.85rem', fontWeight: 700, mt: 1, mb: 0.25 },
                  '& strong': { fontWeight: 700 },
                  '& code': { bgcolor: '#e5e7eb', px: 0.5, borderRadius: 0.5, fontSize: '0.75rem' },
                }}>
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </Box>
              ) : (
                <Box sx={{ bgcolor: '#4f46e5', borderRadius: '12px 4px 12px 12px', px: 1.5, py: 1 }}>
                  <Typography variant="body2" sx={{ color: '#fff', fontSize: '0.82rem', lineHeight: 1.5 }}>
                    {msg.content}
                  </Typography>
                </Box>
              )}

              {/* Badge shown on AI messages that modified the resume */}
              {msg.resumeUpdated && (
                <Chip
                  size="small"
                  icon={<EditedIcon style={{ fontSize: 13 }} />}
                  label="Resume updated"
                  sx={{
                    height: 20, fontSize: '0.7rem', fontWeight: 600,
                    bgcolor: '#ecfdf5', color: '#059669',
                    border: '1px solid #a7f3d0',
                    '& .MuiChip-icon': { color: '#059669' },
                  }}
                />
              )}
            </Box>
          </Box>
        ))}

        {/* Typing indicator */}
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Avatar sx={{ width: 26, height: 26, bgcolor: '#4f46e5' }}>
              <AiIcon sx={{ fontSize: 14, color: '#fff' }} />
            </Avatar>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, bgcolor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '4px 12px 12px 12px', px: 1.5, py: 1 }}>
              <CircularProgress size={10} thickness={5} sx={{ color: '#9ca3af' }} />
              <Typography variant="caption" color="text.disabled">Thinking…</Typography>
            </Box>
          </Box>
        )}

        <div ref={bottomRef} />
      </Box>

      {/* Input */}
      <Box sx={{ p: 1.5, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 1, alignItems: 'flex-end', flexShrink: 0 }}>
        <TextField
          fullWidth multiline maxRows={4} size="small"
          value={input}
          placeholder='e.g. "Improve the bullet points in my AWS experience"'
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.83rem', borderRadius: 2, bgcolor: '#f9fafb' } }}
        />
        <IconButton
          onClick={send}
          disabled={loading || !input.trim()}
          size="small"
          sx={{
            bgcolor: '#4f46e5', color: '#fff', borderRadius: 2, width: 36, height: 36, flexShrink: 0,
            '&:hover': { bgcolor: '#4338ca' },
            '&.Mui-disabled': { bgcolor: '#e5e7eb', color: '#9ca3af' },
          }}
        >
          <SendIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
    </Box>
  );
}
