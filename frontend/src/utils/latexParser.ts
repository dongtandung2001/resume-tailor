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

// ── Section extractor ─────────────────────────────────────────────────────
function extractSection(latex: string, ...names: string[]): string {
  for (const name of names) {
    const flexName = name
      .replace(/[.*+?^$()|[\]]/g, '\\$&')
      .replace(/&/g, '(?:&|\\\\&)');
    const re = new RegExp(
      `\\\\section\\{\\s*${flexName}\\s*\\}([\\s\\S]*?)(?=\\\\section\\{|\\\\end\\{document\\})`,
      'i',
    );
    const m = latex.match(re);
    if (m) return m[1];
  }
  return '';
}

// ── Resume items (bullets) inside a chunk ────────────────────────────────
function extractItems(chunk: string): string[] {
  const items: string[] = [];
  const re = /\\resumeItem\{/g;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    const args = getArgs(chunk, m.index + m[0].length - 1, 1);
    if (args[0] !== undefined) items.push(unesc(args[0]));
  }
  return items;
}

// ── Header ────────────────────────────────────────────────────────────────
function parseHeader(latex: string): ResumeHeader {
  const h: ResumeHeader = { name: '', phone: '', email: '', location: '', linkedin: '', github: '', website: '' };

  const centerM = latex.match(/\\begin\{center\}([\s\S]*?)\\end\{center\}/);
  if (!centerM) return h;
  const center = centerM[1];

  const nameM = center.match(/\\textbf\{\\Huge \\scshape ([^}]+)\}/);
  if (nameM) h.name = unesc(nameM[1]);

  const contactM = center.match(/\\small\s+([\s\S]*?)(?=\n\s*\\end|\n\s*$)/m)
    ?? center.match(/\\small\s+([\s\S]+)/);
  if (!contactM) return h;

  const parts = contactM[1].split(/\s*\$\|\$\s*/);
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;

    const emailM = p.match(/\\href\{mailto:([^}]+)\}/);
    if (emailM) { h.email = unesc(emailM[1]); continue; }

    const hrefM = p.match(/\\href\{https?:\/\/([^}]+)\}/);
    if (hrefM) {
      const url = unesc(hrefM[1]);
      if (url.includes('linkedin.com') && !h.linkedin) { h.linkedin = url; continue; }
      if (url.includes('github.com') && !h.github)    { h.github = url; continue; }
      if (!h.website) { h.website = url; continue; }
    }

    // Strip all remaining LaTeX commands to get plain text
    const plain = unesc(p.replace(/\\[a-zA-Z]+(\{[^}]*\})?/g, '').replace(/[{}]/g, '').trim());
    if (!plain) continue;
    if (/[\d()+-]{6,}/.test(plain) && !h.phone) { h.phone = plain; continue; }
    if (!h.location) { h.location = plain; }
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
    if (args.length < 4) continue;
    // New format: {institution}{date} / {degree}{GPA or empty}
    const [inst, dateStr, degree, gpaRaw] = args.map(unesc);
    const [startDate = '', endDate = ''] = dateStr.split(/\s*--\s*/).map(s => s.trim());
    const gpa = unesc(gpaRaw).replace(/^GPA:\s*/i, '').trim();

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
    // New format: {company}{location} / {title}{date}
    const [company, location, title, dateRange] = args.map(unesc);
    const [startDate = '', endDate = ''] = dateRange.split(/\s*--\s*/).map(s => s.trim());
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

    // If arg4 is non-empty → arg2 is location, arg4 is date range
    // If arg4 is empty     → arg2 is date range, no location
    const arg4 = unesc(arg4Raw).trim();
    const arg2 = unesc(arg2Raw).trim();
    const location   = arg4 ? arg2 : '';
    const dateStr    = arg4 ? arg4 : arg2;
    const [startDate = '', endDate = ''] = dateStr.split(/\s*--\s*/).map(s => s.trim());

    entries.push({ id: nanoid(), name, location, technologies, startDate, endDate, bullets: extractItems(chunk) });
  }
  return entries;
}

// ── Skills ────────────────────────────────────────────────────────────────
function parseSkills(latex: string): string {
  const section = extractSection(latex, 'Skills', 'Technical Skills', 'SKILLS');
  if (!section) return '';
  // Collect ALL \textbf{Category}{: values} pairs (AI may generate multiple categories)
  const pattern = /\\textbf\{[^}]*\}\{:\s*([^}]+)\}/g;
  const values: string[] = [];
  let m;
  while ((m = pattern.exec(section)) !== null) {
    const v = unesc(m[1]).trim();
    if (v) values.push(v);
  }
  if (values.length > 0) return values.join(', ');
  // Fallback: grab everything after the last colon in the itemize block
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
