import type { ResumeData } from '../types';

function esc(str: string): string {
  return str
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\$/g, '\\$')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_');
}

function hrefOrPlain(raw: string, display?: string): string {
  if (!raw) return '';
  const url = raw.startsWith('http') ? raw : `https://${raw}`;
  const label = esc(display ?? raw);
  return `\\href{${url}}{${label}}`;
}

export function generateLatexBody(data: ResumeData): string {
  const lines: string[] = [];

  lines.push('\\begin{document}', '');

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push('\\begin{center}');
  lines.push(`  {\\fontsize{30}{36}\\selectfont\\bfseries ${esc(data.header.name)}}\\par\\vspace{1.3pt}`);

  const contacts: string[] = [];
  if (data.header.phone)    contacts.push(esc(data.header.phone));
  if (data.header.email)    contacts.push(hrefOrPlain(`mailto:${data.header.email}`, data.header.email));
  if (data.header.location) contacts.push(esc(data.header.location));
  if (data.header.linkedin) contacts.push(hrefOrPlain(data.header.linkedin));
  if (data.header.github)   contacts.push(hrefOrPlain(data.header.github));
  if (data.header.website)  contacts.push(hrefOrPlain(data.header.website));

  if (contacts.length) {
    // Split into two lines after the 4th item (mirrors user's template style)
    const sep = ' \\ | \\ ';
    const line1 = contacts.slice(0, 4).join(sep);
    const line2 = contacts.slice(4).join(sep);
    lines.push(`  {\\fontsize{10}{16}\\selectfont`);
    if (line2) {
      lines.push(`  ${line1} \\ | \\\\[4.6pt]`);
      lines.push(`  ${line2}`);
    } else {
      lines.push(`  ${line1}`);
    }
    lines.push(`  }`);
  }
  lines.push('\\end{center}');
  lines.push('\\vspace{-10pt}', '');

  // ── Education ────────────────────────────────────────────────────────────
  if (data.education.length > 0) {
    lines.push('\\sectionHeading{EDUCATION}');
    for (let i = 0; i < data.education.length; i++) {
      const edu = data.education[i];
      const dateField = edu.endDate ? `${esc(edu.startDate)} - ${esc(edu.endDate)}` : esc(edu.startDate);
      const gpaField  = edu.gpa ? `GPA: ${esc(edu.gpa)}` : '';
      lines.push(`\\resumeSubheading{${esc(edu.institution)}}{${dateField}}{${esc(edu.degree)}}{${gpaField}}`);
      if (edu.bullets.length > 0) {
        lines.push('\\begin{resumeItemize}');
        for (const b of edu.bullets) lines.push(`  \\item ${esc(b)}`);
        lines.push('\\end{resumeItemize}');
      }
      if (i < data.education.length - 1) lines.push('\\vspace{11.4pt}');
    }
    lines.push('');
  }

  // ── Experience ───────────────────────────────────────────────────────────
  if (data.experience.length > 0) {
    lines.push('\\sectionHeading{PROFESSIONAL EXPERIENCE}');
    for (let i = 0; i < data.experience.length; i++) {
      const exp = data.experience[i];
      const dateField = exp.endDate ? `${esc(exp.startDate)} - ${esc(exp.endDate)}` : esc(exp.startDate);
      lines.push(`\\resumeSubheading{${esc(exp.company)}}{${esc(exp.location)}}{${esc(exp.title)}}{${dateField}}`);
      if (exp.bullets.length > 0) {
        lines.push('\\begin{resumeItemize}');
        for (const b of exp.bullets) lines.push(`  \\item ${esc(b)}`);
        lines.push('\\end{resumeItemize}');
      }
      if (i < data.experience.length - 1) lines.push('\\vspace{11.4pt}');
    }
    lines.push('');
  }

  // ── Projects ─────────────────────────────────────────────────────────────
  if (data.projects.length > 0) {
    lines.push('\\sectionHeading{PROJECTS \\& OUTSIDE EXPERIENCE}');
    for (let i = 0; i < data.projects.length; i++) {
      const proj = data.projects[i];
      const dateField = proj.endDate ? `${esc(proj.startDate)} - ${esc(proj.endDate)}` : esc(proj.startDate);
      // With location: {name}{location}{tech}{date}
      // Without location: {name}{date}{tech}{}
      const arg2 = proj.location ? esc(proj.location) : dateField;
      const arg4 = proj.location ? dateField : '';
      lines.push(`\\resumeProjectHeading{${esc(proj.name)}}{${arg2}}{${esc(proj.technologies ?? '')}}{${arg4}}`);
      if (proj.bullets.length > 0) {
        lines.push('\\begin{resumeItemize}');
        for (const b of proj.bullets) lines.push(`  \\item ${esc(b)}`);
        lines.push('\\end{resumeItemize}');
      }
      if (i < data.projects.length - 1) lines.push('\\vspace{11.4pt}');
    }
    lines.push('');
  }

  // ── Skills ───────────────────────────────────────────────────────────────
  if (data.skills) {
    lines.push('\\sectionHeading{SKILLS}');
    lines.push(`\\textbf{Skills:} ${esc(data.skills)}`);
    lines.push('');
  }

  lines.push('\\end{document}');
  return lines.join('\n');
}
