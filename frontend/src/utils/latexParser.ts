import type { ResumeData, ResumeHeader, EducationEntry, ExperienceEntry, ProjectEntry } from '../types';
import { nanoid } from './nanoid';

// ── Unescape LaTeX special characters back to plain text ─────────────────
function unesc(s: string): string {
  return s
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\\$/g, '$')
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textless\{\}/g, '<')
    .replace(/\\textgreater\{\}/g, '>')
    .trim();
}

/**
 * Starting at `pos` in `s`, extract `count` consecutive brace-delimited
 * arguments: {arg1}{arg2}...  Returns array of the inner strings.
 */
function getArgs(s: string, pos: number, count: number): string[] {
  const args: string[] = [];
  let i = pos;
  while (args.length < count && i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== '{') break;
    let depth = 0;
    const start = i;
    while (i < s.length) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') { depth--; if (depth === 0) { args.push(s.slice(start + 1, i)); i++; break; } }
      i++;
    }
  }
  return args;
}

// ── Section extractor — supports both \section{} and \sectionHeading{} ───
function extractSection(latex: string, ...names: string[]): string {
  for (const name of names) {
    const flexName = name
      .replace(/[.*+?^$()|[\]]/g, '\\$&')
      .replace(/&/g, '(?:&|\\\\&)');
    const re = new RegExp(
      `\\\\(?:section|sectionHeading)\\{\\s*${flexName}\\s*\\}([\\s\\S]*?)(?=\\\\(?:section|sectionHeading)\\{|\\\\end\\{document\\})`,
      'i',
    );
    const m = latex.match(re);
    if (m) return m[1];
  }
  return '';
}

// ── Bullets: handles both \resumeItem{} (old) and \item (new) ────────────
function extractItems(chunk: string): string[] {
  const items: string[] = [];

  // Old template: \resumeItem{text}
  const oldRe = /\\resumeItem\{/g;
  let m;
  while ((m = oldRe.exec(chunk)) !== null) {
    const args = getArgs(chunk, m.index + m[0].length - 1, 1);
    if (args[0] !== undefined) items.push(unesc(args[0]));
  }
  if (items.length > 0) return items;

  // New template: \item text inside resumeItemize
  const itemRe = /\\item\s+([\s\S]*?)(?=\\item\s|\\end\{resumeItemize\}|$)/g;
  while ((m = itemRe.exec(chunk)) !== null) {
    const text = m[1]
      .replace(/\\\\\s*/g, ' ')  // collapse \\ line breaks
      .replace(/\s+/g, ' ')
      .trim();
    if (text) items.push(unesc(text));
  }
  return items;
}

// ── Parse date string: handles both " - " and " -- " separators ──────────
function parseDateRange(dateStr: string): [string, string] {
  const parts = dateStr.split(/\s*--?\s*/).map(s => s.trim());
  return [parts[0] ?? '', parts[1] ?? ''];
}

// ── Header ────────────────────────────────────────────────────────────────
function parseHeader(latex: string): ResumeHeader {
  const h: ResumeHeader = { name: '', phone: '', email: '', location: '', linkedin: '', github: '', website: '' };

  const centerM = latex.match(/\\begin\{center\}([\s\S]*?)\\end\{center\}/);
  if (!centerM) return h;
  const center = centerM[1];

  // New template: {\fontsize{30}{36}\selectfont\bfseries FIRST LAST}
  const newNameM = center.match(/\\bfseries\s+([A-Z][A-Z\s]+?)(?=\s*}|\s*\\par)/);
  if (newNameM) {
    h.name = newNameM[1].trim();
  } else {
    // Old template: \textbf{\Huge \scshape Name}
    const oldNameM = center.match(/\\textbf\{\\Huge\s+(?:\\scshape\s+)?([^}]+)\}/);
    if (oldNameM) h.name = unesc(oldNameM[1]);
  }

  // Extract the contact line block — new template wraps in {\fontsize{10}{16}\selectfont ...}
  // Old template uses \small ...
  const contactBlock =
    center.match(/\\fontsize\{10\}\{[^}]+\}\\selectfont\s*([\s\S]*?)(?=\s*\}\s*$)/)?.[1] ??
    center.match(/\\small\s+([\s\S]*?)(?=\n\s*\\end|\n\s*$)/m)?.[1] ??
    center.match(/\\small\s+([\s\S]+)/)?.[1] ??
    '';

  // Extract all \href{url}{display} directly — avoids separator-split consuming leading backslash
  const hrefRe = /\\href\{([^}]+)\}\{([^}]*)\}/g;
  let hm: RegExpExecArray | null;
  while ((hm = hrefRe.exec(contactBlock)) !== null) {
    const url   = hm[1].trim();
    const label = unesc(hm[2].trim());
    if (url.startsWith('mailto:')) {
      if (!h.email) h.email = url.slice('mailto:'.length);
    } else if (url.includes('linkedin.com') && !h.linkedin) {
      h.linkedin = label || url.replace(/^https?:\/\//, '');
    } else if (url.includes('github.com') && !h.github) {
      h.github = label || url.replace(/^https?:\/\//, '');
    } else if (!h.website) {
      h.website = label || url.replace(/^https?:\/\//, '');
    }
  }

  // Extract phone and location from plain text (with hrefs removed).
  // Convert \ | \ separators to double-space FIRST so they act as split points.
  const plainText = contactBlock
    .replace(/\\href\{[^}]+\}\{[^}]*\}/g, '')
    .replace(/\\\\\s*\[.*?\]/g, '  ')        // \\[4.6pt] line break → separator
    .replace(/\s*\\\s*\|\s*\\\s*/g, '  ')    // \ | \ contact separator → separator
    .replace(/\\[a-zA-Z]+(\{[^}]*\})?/g, ' ')
    .replace(/[{}\\|]/g, ' ');               // strip remaining \ { } |

  for (const part of plainText.split(/\s{2,}/).map(s => s.trim()).filter(Boolean)) {
    if (/[\d()+-]{6,}/.test(part) && !h.phone) { h.phone = part; continue; }
    if (!h.location && part.length > 2) h.location = part;
  }

  return h;
}

// ── Education ─────────────────────────────────────────────────────────────
function parseEducation(latex: string): EducationEntry[] {
  const section = extractSection(latex, 'Education', 'EDUCATION');
  if (!section) return [];

  const entries: EducationEntry[] = [];
  const re = /\\resumeSubheading/g;
  const positions: number[] = [];
  let m;
  while ((m = re.exec(section)) !== null) positions.push(m.index);

  for (let i = 0; i < positions.length; i++) {
    const chunk = section.slice(positions[i], positions[i + 1] ?? section.length);
    const args = getArgs(chunk, '\\resumeSubheading'.length, 4);
    if (args.length < 2) continue;
    const [inst, dateStr, degree = '', gpaRaw = ''] = args.map(unesc);
    const [startDate, endDate] = parseDateRange(dateStr);
    const gpa = gpaRaw.replace(/^GPA:\s*/i, '').trim();
    entries.push({ id: nanoid(), institution: inst, location: '', degree, startDate, endDate, gpa, bullets: extractItems(chunk) });
  }
  return entries;
}

// ── Experience ────────────────────────────────────────────────────────────
function parseExperience(latex: string): ExperienceEntry[] {
  const section = extractSection(latex, 'Professional Experience', 'Experience', 'PROFESSIONAL EXPERIENCE');
  if (!section) return [];

  const entries: ExperienceEntry[] = [];
  const re = /\\resumeSubheading/g;
  const positions: number[] = [];
  let m;
  while ((m = re.exec(section)) !== null) positions.push(m.index);

  for (let i = 0; i < positions.length; i++) {
    const chunk = section.slice(positions[i], positions[i + 1] ?? section.length);
    const args = getArgs(chunk, '\\resumeSubheading'.length, 4);
    if (args.length < 4) continue;
    const [company, location, title, dateRange] = args.map(unesc);
    const [startDate, endDate] = parseDateRange(dateRange);
    entries.push({ id: nanoid(), company, title, location, startDate, endDate, bullets: extractItems(chunk) });
  }
  return entries;
}

// ── Projects ──────────────────────────────────────────────────────────────
function parseProjects(latex: string): ProjectEntry[] {
  const section = extractSection(
    latex,
    'Projects & Outside Experience',
    'Projects',
    'PROJECTS & OUTSIDE EXPERIENCE',
  );
  if (!section) return [];

  const entries: ProjectEntry[] = [];
  const re = /\\resumeProjectHeading/g;
  const positions: number[] = [];
  let m;
  while ((m = re.exec(section)) !== null) positions.push(m.index);

  for (let i = 0; i < positions.length; i++) {
    const chunk = section.slice(positions[i], positions[i + 1] ?? section.length);
    const args = getArgs(chunk, '\\resumeProjectHeading'.length, 4);
    if (args.length < 2) continue;
    const [nameRaw, arg2Raw, techRaw = '', arg4Raw = ''] = args;

    const name = unesc(nameRaw);
    const technologies = unesc(techRaw);
    const arg4 = unesc(arg4Raw).trim();
    const arg2 = unesc(arg2Raw).trim();
    const location = arg4 ? arg2 : '';
    const dateStr  = arg4 ? arg4 : arg2;
    const [startDate, endDate] = parseDateRange(dateStr);

    entries.push({ id: nanoid(), name, location, technologies, startDate, endDate, bullets: extractItems(chunk) });
  }
  return entries;
}

// ── Skills ────────────────────────────────────────────────────────────────
function parseSkills(latex: string): string {
  const section = extractSection(latex, 'Skills', 'Technical Skills', 'SKILLS');
  if (!section) return '';

  // New template: \textbf{Skills:} comma, separated, list
  const newM = section.match(/\\textbf\{[^}]*\}\s+([\s\S]+)/);
  if (newM) {
    return unesc(newM[1].replace(/\\\\\s*/g, ' ').replace(/\s+/g, ' ')).trim();
  }

  // Old template: \textbf{Category}{: values}
  const oldPattern = /\\textbf\{[^}]*\}\{:\s*([^}]+)\}/g;
  const values: string[] = [];
  let m;
  while ((m = oldPattern.exec(section)) !== null) {
    const v = unesc(m[1]).trim();
    if (v) values.push(v);
  }
  if (values.length > 0) return values.join(', ');

  // Fallback
  const raw = section.replace(/\\[a-zA-Z]+(\{[^}]*\})?|\{|\}/g, ' ').replace(/\s+/g, ' ');
  const colon = raw.lastIndexOf(':');
  return colon >= 0 ? raw.slice(colon + 1).trim() : raw.trim();
}

// ── Public entry point ────────────────────────────────────────────────────
export function parseLatexBody(latex: string): ResumeData {
  return {
    header:     parseHeader(latex),
    education:  parseEducation(latex),
    experience: parseExperience(latex),
    projects:   parseProjects(latex),
    skills:     parseSkills(latex),
  };
}
