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
  return `\\href{${url}}{\\underline{${label}}}`;
}

export function generateLatexBody(data: ResumeData): string {
  const lines: string[] = [];

  lines.push('\\begin{document}', '');

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push('\\begin{center}');
  lines.push(`    \\textbf{\\Huge \\scshape ${esc(data.header.name)}} \\\\ \\vspace{1pt}`);

  const contacts: string[] = [];
  if (data.header.phone)    contacts.push(esc(data.header.phone));
  if (data.header.email)    contacts.push(hrefOrPlain(`mailto:${data.header.email}`, data.header.email));
  if (data.header.location) contacts.push(esc(data.header.location));
  if (data.header.linkedin) contacts.push(hrefOrPlain(data.header.linkedin));
  if (data.header.github)   contacts.push(hrefOrPlain(data.header.github));
  if (data.header.website)  contacts.push(hrefOrPlain(data.header.website));

  if (contacts.length) {
    lines.push(`    \\small ${contacts.join(' $|$ ')}`);
  }
  lines.push('\\end{center}', '');

  // ── Education ────────────────────────────────────────────────────────────
  if (data.education.length > 0) {
    lines.push('\\section{EDUCATION}');
    lines.push('  \\resumeSubHeadingListStart');
    for (const edu of data.education) {
      const dateField = `${esc(edu.startDate)} -- ${esc(edu.endDate)}`;
      const gpaField  = edu.gpa ? `GPA: ${esc(edu.gpa)}` : '';
      lines.push('    \\resumeSubheading');
      lines.push(`      {${esc(edu.institution)}}{${dateField}}`);
      lines.push(`      {${esc(edu.degree)}}{${gpaField}}`);
      if (edu.bullets.length > 0) {
        lines.push('      \\resumeItemListStart');
        for (const b of edu.bullets) lines.push(`        \\resumeItem{${esc(b)}}`);
        lines.push('      \\resumeItemListEnd');
      }
    }
    lines.push('  \\resumeSubHeadingListEnd', '');
  }

  // ── Experience ───────────────────────────────────────────────────────────
  if (data.experience.length > 0) {
    lines.push('\\section{PROFESSIONAL EXPERIENCE}');
    lines.push('  \\resumeSubHeadingListStart');
    for (const exp of data.experience) {
      lines.push('    \\resumeSubheading');
      lines.push(`      {${esc(exp.company)}}{${esc(exp.location)}}`);
      lines.push(`      {${esc(exp.title)}}{${esc(exp.startDate)} -- ${esc(exp.endDate)}}`);
      if (exp.bullets.length > 0) {
        lines.push('      \\resumeItemListStart');
        for (const b of exp.bullets) lines.push(`        \\resumeItem{${esc(b)}}`);
        lines.push('      \\resumeItemListEnd');
      }
    }
    lines.push('  \\resumeSubHeadingListEnd', '');
  }

  // ── Projects ─────────────────────────────────────────────────────────────
  if (data.projects.length > 0) {
    lines.push('\\section{PROJECTS \\& OUTSIDE EXPERIENCE}');
    lines.push('    \\resumeSubHeadingListStart');
    for (const proj of data.projects) {
      const dateRange = `${esc(proj.startDate)} -- ${esc(proj.endDate)}`;
      // If location present: line1={name}{location}, line2={tech}{date}
      // If no location: line1={name}{date}, line2={tech}{}
      const arg2 = proj.location ? esc(proj.location) : dateRange;
      const arg4 = proj.location ? dateRange : '';
      lines.push('      \\resumeProjectHeading');
      lines.push(`          {${esc(proj.name)}}{${arg2}}`);
      lines.push(`          {${esc(proj.technologies ?? '')}}{${arg4}}`);
      if (proj.bullets.length > 0) {
        lines.push('          \\resumeItemListStart');
        for (const b of proj.bullets) lines.push(`            \\resumeItem{${esc(b)}}`);
        lines.push('          \\resumeItemListEnd');
      }
    }
    lines.push('    \\resumeSubHeadingListEnd', '');
  }

  // ── Skills ───────────────────────────────────────────────────────────────
  if (data.skills) {
    lines.push('\\section{SKILLS}');
    lines.push(' \\begin{itemize}[leftmargin=0.15in, label={}]');
    lines.push('    \\small{\\item{');
    lines.push(`     \\textbf{Skills}{: ${esc(data.skills)}}`);
    lines.push('    }}');
    lines.push(' \\end{itemize}', '');
  }

  lines.push('\\end{document}');
  return lines.join('\n');
}
