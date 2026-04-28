import io
import json
import os
import re
import subprocess
import tempfile

import fitz  # PyMuPDF
import pytesseract
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from openai import OpenAI
from PIL import Image

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CORS_ORIGIN", "http://localhost:5173")],
    allow_methods=["POST"],
    allow_headers=["*"],
    expose_headers=["X-Page-Count"],
)

deepseek = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
)

MAX_PDF_BYTES = 20 * 1024 * 1024  # 20 MB

# ---------------------------------------------------------------------------
# Jake Gutierrez SWE resume template preamble (fixed — never sent to LLM)
# ---------------------------------------------------------------------------
RESUME_PREAMBLE = r"""\documentclass[letterpaper,11pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.5in}
\addtolength{\textheight}{1.0in}

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\pdfgentounicode=1

\newcommand{\resumeItem}[1]{
  \item\small{{#1 \vspace{-2pt}}}
}
\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}
\newcommand{\resumeSubSubheading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \textit{\small#1} & \textit{\small #2} \\
    \end{tabular*}\vspace{-7pt}
}
\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & #2 \\
    \end{tabular*}\vspace{-7pt}
}
\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-4pt}}
\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}
"""

# One-shot example body shown to LLM — it must ONLY use commands visible here
RESUME_BODY_EXAMPLE = r"""
\begin{document}

\begin{center}
    \textbf{\Huge \scshape Jake Ryan} \\ \vspace{1pt}
    \small 123-456-7890 $|$ \href{mailto:jake@su.edu}{\underline{jake@su.edu}} $|$
    \href{https://linkedin.com/in/jake}{\underline{linkedin.com/in/jake}} $|$
    \href{https://github.com/jake}{\underline{github.com/jake}}
\end{center}

\section{Education}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Southwestern University}{Georgetown, TX}
      {Bachelor of Arts in Computer Science, Minor in Business}{Aug. 2018 -- May 2021}
  \resumeSubHeadingListEnd

\section{Professional Experience}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Texas A\&M University}{June 2020 -- Present}
      {Undergraduate Research Assistant}{College Station, TX}
      \resumeItemListStart
        \resumeItem{Developed a REST API using FastAPI and PostgreSQL to store data from learning management systems}
        \resumeItem{Developed a full-stack web application using Flask, React, PostgreSQL and Docker}
      \resumeItemListEnd
  \resumeSubHeadingListEnd

\section{Projects}
    \resumeSubHeadingListStart
      \resumeProjectHeading
          {\textbf{Gitlytics} $|$ \emph{Python, Flask, React, PostgreSQL, Docker}}{June 2020 -- Present}
          \resumeItemListStart
            \resumeItem{Developed a full-stack web application using Flask serving a REST API with React as the frontend}
            \resumeItem{Implemented GitHub OAuth to get data from user's repositories}
          \resumeItemListEnd
    \resumeSubHeadingListEnd

\section{Technical Skills}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
     \textbf{Languages}{: Java, Python, C/C++, SQL (Postgres), JavaScript, HTML/CSS} \\
     \textbf{Frameworks}{: React, Node.js, Flask, FastAPI} \\
     \textbf{Developer Tools}{: Git, Docker, Google Cloud Platform, VS Code} \\
     \textbf{Libraries}{: pandas, NumPy, Matplotlib}
    }}
 \end{itemize}

\end{document}
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def strip_fences(raw: str) -> str:
    cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", raw.strip())
    return re.sub(r"\n?```$", "", cleaned.strip()).strip()


def extract_text(pdf_bytes: bytes) -> str:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_texts: list[str] = []
    for page_num, page in enumerate(doc, start=1):
        text = page.get_text().strip()
        if len(text) > 20:
            print(f"  Page {page_num}: direct extraction ({len(text)} chars)")
            page_texts.append(f"--- Page {page_num} ---\n{text}")
        else:
            print(f"  Page {page_num}: no embedded text, running OCR...")
            mat = fitz.Matrix(2.0, 2.0)
            pix = page.get_pixmap(matrix=mat)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            ocr_text = pytesseract.image_to_string(img).strip()
            page_texts.append(f"--- Page {page_num} (OCR) ---\n{ocr_text}")
    doc.close()
    return "\n\n".join(page_texts)


def try_compile_latex(latex_source: str) -> tuple[bytes | None, int, str | None]:
    """Returns (pdf_bytes, page_count, None) on success or (None, 0, error) on failure."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tex_path = os.path.join(tmpdir, "resume.tex")
        pdf_path = os.path.join(tmpdir, "resume.pdf")

        with open(tex_path, "w", encoding="utf-8") as f:
            f.write(latex_source)

        cmd = ["pdflatex", "-interaction=nonstopmode", "-halt-on-error",
               "-output-directory", tmpdir, tex_path]

        for run in (1, 2):
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=tmpdir)
            if result.returncode != 0:
                return None, 0, (result.stdout + result.stderr)[-3000:]

        if not os.path.exists(pdf_path):
            return None, 0, "pdflatex produced no PDF."

        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = doc.page_count
        doc.close()
        print(f"  Compiled OK — {page_count} page(s)")
        return pdf_bytes, page_count, None


def analyze_resume_standalone(resume_text: str) -> str:
    """Stage 1A — profile the resume independently, no JD context."""
    response = deepseek.chat.completions.create(
        model="deepseek-reasoner",
        max_tokens=2048,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert technical recruiter performing a standalone resume audit. "
                    "Analyze this resume independently, without any job description context. "
                    "Be exhaustive and specific."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"RESUME TEXT:\n\n{resume_text}\n\n"
                    "Produce a structured resume profile with EXACTLY these sections:\n\n"
                    "## Candidate Profile\n"
                    "Inferred role/seniority level and core technical identity (primary languages, frameworks, domain).\n\n"
                    "## Explicit Skills Inventory\n"
                    "Every technical skill, tool, framework, language, and platform mentioned. "
                    "Group by category: Languages | Frameworks | Cloud/Infra | Databases | Other\n\n"
                    "## Implicit/Inferable Skills\n"
                    "Skills strongly implied by the described work but not explicitly stated "
                    "(e.g. if they built a REST API in Go, imply 'HTTP/REST API design').\n\n"
                    "## Experience Quality Assessment\n"
                    "For each experience entry, score bullet quality 1–5 on: "
                    "action verb strength, metric/quantification presence, technical specificity. "
                    "Identify the 3 weakest bullets verbatim.\n\n"
                    "## Structural Completeness\n"
                    "Check for each section (✓/✗): Contact info, Summary, Education, Experience, "
                    "Projects, Skills section, Dates on all entries.\n\n"
                    "## ATS Formatting Signals\n"
                    "Flag any ATS-hostile patterns: non-standard section names, dense skill blocks, "
                    "inconsistent date formats, missing keywords in section headers.\n\n"
                    "## Standalone Baseline Score\n"
                    "Score 1–100 purely on resume quality, ignoring any specific job. "
                    "Explain in 2 sentences."
                ),
            },
        ],
    )
    return response.choices[0].message.content or ""


def analyze_jd_standalone(job_description: str) -> str:
    """Stage 1B — decompose the job description into a structured intelligence profile."""
    response = deepseek.chat.completions.create(
        model="deepseek-chat",
        max_tokens=1024,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert technical recruiter. Parse this job description into a structured "
                    "intelligence report. Be exhaustive — extract every keyword, skill, and signal."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"JOB DESCRIPTION:\n\n{job_description}\n\n"
                    "Produce a structured JD profile with EXACTLY these sections:\n\n"
                    "## Role Classification\n"
                    "Title, seniority level, primary domain.\n\n"
                    "## Hard Requirements\n"
                    "Every non-negotiable technical requirement — languages, frameworks, tools, "
                    "degree requirements. Use exact phrasing from the JD.\n\n"
                    "## Preferred Qualifications\n"
                    "Every 'preferred', 'bonus', or 'nice-to-have' item.\n\n"
                    "## ATS Keyword Master List\n"
                    "ALL technical terms, tools, frameworks, buzzwords, and domain-specific vocabulary "
                    "an ATS would scan for. Comma-separated, exhaustive — include every technical term.\n\n"
                    "## Responsibilities Summary\n"
                    "3–5 bullets summarising the actual day-to-day work.\n\n"
                    "## Implicit Expectations\n"
                    "Skills strongly implied but not explicitly stated.\n\n"
                    "## Seniority Signals\n"
                    "Phrases signalling expected ownership, scope, or leadership.\n\n"
                    "## Culture/Soft Skill Signals\n"
                    "Collaboration, communication, and cross-functional expectations."
                ),
            },
        ],
    )
    return response.choices[0].message.content or ""


def synthesize_ats_analysis(resume_profile: str, jd_profile: str, resume_text: str) -> str:
    """Stage 2A — deep gap synthesis using pre-analyzed profiles."""
    response = deepseek.chat.completions.create(
        model="deepseek-reasoner",
        max_tokens=4096,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert ATS specialist and career coach performing a cross-document gap analysis. "
                    "You have been given pre-analyzed profiles of both a resume and a job description. "
                    "Use the profiles as your primary source — reference the raw resume text only for exact quoting."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"RESUME PROFILE (pre-analyzed):\n{resume_profile}\n\n"
                    "---\n\n"
                    f"JOB DESCRIPTION PROFILE (pre-analyzed):\n{jd_profile}\n\n"
                    "---\n\n"
                    f"RAW RESUME TEXT (for exact quoting only):\n{resume_text}\n\n"
                    "---\n\n"
                    "Using the profiles above, produce the following ATS analysis:\n\n"
                    "## ATS Compatibility Score\n"
                    "Score 1–100. Ground the score in arithmetic: start from the Standalone Baseline Score "
                    "in the Resume Profile, adjust for keyword coverage (matched / total ATS keywords from JD Profile), "
                    "and apply penalties for structural issues. Show your working: "
                    "e.g. 'Baseline 72 → keyword coverage 8/15 (53%) → -8 pts → structural penalties -5 → final 59'.\n\n"
                    "## Keyword Match Analysis\n"
                    "Use the ATS Keyword Master List from the JD Profile. For EACH keyword, check against "
                    "the Explicit Skills Inventory and Implicit Skills from the Resume Profile.\n"
                    "OUTPUT FORMAT: Each keyword on its own line, exactly as shown:\n"
                    "✅ keyword name: exact quote from resume or brief explanation\n"
                    "❌ keyword name: brief explanation of why it's missing\n"
                    "⚠️ keyword name: brief explanation of why it's partial/weakly implied\n\n"
                    "CRITICAL RULES:\n"
                    "1. ONE keyword per line (never group multiple keywords on one line)\n"
                    "2. Always use format: [emoji] keyword: description\n"
                    "3. Keep descriptions concise (1-2 sentences max)\n"
                    "4. Do NOT use subsections or groupings like 'Present (Explicit/Strongly Implied):'\n"
                    "5. List all keywords in one continuous stream, sorted by indicator (✅ first, then ⚠️, then ❌)\n\n"
                    "## Skills Gap\n"
                    "From Hard Requirements and Preferred Qualifications in the JD Profile, list what is "
                    "absent or weak. Split into:\n"
                    "- Critical gaps (hard requirements not met)\n"
                    "- Improvement areas (preferred qualifications missing)\n\n"
                    "## Strengths\n"
                    "What aligns well between the candidate and this specific role. Be concise.\n\n"
                    "## Bullet Point Rewrites\n"
                    "Use the 3 weakest bullets from the Resume Profile's Experience Quality Assessment. "
                    "Rewrite each using: Action Verb + Task + Measurable Result. "
                    "Where natural, incorporate missing ATS keywords from the JD.\n\n"
                    "## Section & Format Recommendations\n"
                    "Use Structural Completeness and ATS Formatting Signals from the Resume Profile. "
                    "Add JD-specific section recommendations where relevant.\n\n"
                    "## Priority Action List\n"
                    "Numbered list of the top 5 highest-impact changes, ordered by combined impact on "
                    "ATS score and recruiter impression. Cross-reference keyword gaps and bullet quality findings."
                ),
            },
        ],
    )
    return response.choices[0].message.content or ""


def extract_structured_data(resume_text: str) -> dict:
    """Extract structured resume data as JSON using LLM."""
    response = deepseek.chat.completions.create(
        model="deepseek-chat",
        max_tokens=2048,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a resume parser. Extract structured data from the resume text and return ONLY valid JSON. "
                    "No markdown fences, no explanation — just the JSON object."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Extract this resume into a JSON object with exactly these fields:\n"
                    "{\n"
                    '  "header": { "name": "", "phone": "", "email": "", "location": "", "linkedin": "", "github": "", "website": "" },\n'
                    '  "education": [ { "institution": "", "location": "", "degree": "", "startDate": "", "endDate": "", "gpa": "", "bullets": [] } ],\n'
                    '  "experience": [ { "company": "", "title": "", "location": "", "startDate": "", "endDate": "", "bullets": [] } ],\n'
                    '  "projects": [ { "name": "", "technologies": "", "startDate": "", "endDate": "", "bullets": [] } ],\n'
                    '  "skills": ""\n'
                    "}\n\n"
                    "Rules:\n"
                    "- linkedin: just the path like 'linkedin.com/in/username' (no https://)\n"
                    "- github: just 'github.com/username' (no https://)\n"
                    "- website: personal site if present (no https://)\n"
                    "- skills: comma-separated string of all skills\n"
                    "- bullets: array of bullet point strings (no leading dashes)\n"
                    "- gpa: empty string if not present\n"
                    "- Use empty string for missing fields, empty array for missing lists\n\n"
                    f"Resume:\n\n{resume_text}"
                ),
            },
        ],
    )
    raw = strip_fences(response.choices[0].message.content or "{}")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {"header": {"name": "", "phone": "", "email": "", "location": "", "linkedin": "", "github": "", "website": ""}, "education": [], "experience": [], "projects": [], "skills": ""}
    return data


def generate_latex_body(resume_text: str, improvements: str | None = None) -> str:
    """Convert resume text to Jake Gutierrez template body, optionally applying improvements."""
    if improvements:
        task = (
            f"Original resume:\n\n{resume_text}\n\n"
            f"---\n\nATS Analysis & Recommended Improvements:\n\n{improvements}"
        )
        improvement_rules = (
            "6. Apply the highest-impact improvements from the analysis above — "
            "especially missing keywords, stronger bullet rewrites, and skills gaps.\n"
            "7. STRICT 1-PAGE LIMIT: You must fit everything in 1 page. "
            "Because you are adding new content (keywords, rewritten bullets), "
            "you must simultaneously tighten existing bullets to make room. "
            "Never add a new line without removing or shortening another. "
            "Do NOT add a Summary/Profile section — there is no space for it. "
            "Prioritise the highest-impact keyword and bullet changes; skip low-impact suggestions if space is tight.\n"
        )
    else:
        task = f"Convert this resume to the template format:\n\n{resume_text}"
        improvement_rules = ""

    response = deepseek.chat.completions.create(
        model="deepseek-chat",
        max_tokens=4096,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert SWE resume writer using the Jake Gutierrez LaTeX template. "
                    "Output ONLY \\begin{document} ... \\end{document}. "
                    "Use ONLY commands shown in the example. No \\usepackage, no markdown fences."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Follow this EXACT format — use ONLY these commands:\n\n{RESUME_BODY_EXAMPLE}\n\n"
                    "---\n\n"
                    f"{task}\n\n"
                    "Rules:\n"
                    "1. Use ONLY commands from the example above — no \\faPhone, no \\hspace, nothing else.\n"
                    "2. Strictly 1 page — every bullet must be one tight line.\n"
                    "3. Preserve all facts (dates, companies, technologies, metrics).\n"
                    "4. Escape special chars: & → \\&,  % → \\%,  # → \\#,  $ → \\$,  _ → \\_\n"
                    "5. Output ONLY \\begin{document} ... \\end{document}.\n"
                    f"{improvement_rules}"
                ),
            },
        ],
    )
    return strip_fences(response.choices[0].message.content or "")


# ---------------------------------------------------------------------------
# POST /api/analyze
# ---------------------------------------------------------------------------
@app.post("/api/analyze")
async def analyze_resume(
    resume: UploadFile = File(...),
    jobDescription: str = Form(...),
):
    if resume.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    if not jobDescription.strip():
        raise HTTPException(status_code=400, detail="Job description is required")

    pdf_bytes = await resume.read()
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 20 MB)")

    print("[1/3] Extracting text from PDF...")
    try:
        resume_text = extract_text(pdf_bytes)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to read PDF: {e}") from e

    if not resume_text.strip():
        raise HTTPException(status_code=422, detail="Could not extract text from the PDF.")

    print(f"[stage0] Extracted {len(resume_text)} chars")

    print("[stage1] Profiling resume and JD independently (parallel)...")
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor() as executor:
        f_resume_profile = executor.submit(analyze_resume_standalone, resume_text)
        f_jd_profile     = executor.submit(analyze_jd_standalone, jobDescription)
        resume_profile = f_resume_profile.result()
        jd_profile     = f_jd_profile.result()
    print("[stage1] Profiles complete")

    print("[stage2] Synthesizing ATS analysis + generating LaTeX + extracting data (parallel)...")
    with concurrent.futures.ThreadPoolExecutor() as executor:
        f_analysis  = executor.submit(synthesize_ats_analysis, resume_profile, jd_profile, resume_text)
        f_latex     = executor.submit(generate_latex_body, resume_text, resume_profile)
        f_struct    = executor.submit(extract_structured_data, resume_text)
        analysis    = f_analysis.result()
        latex_body  = f_latex.result()
        resume_data = f_struct.result()
    print("[stage2] Done")

    return {"analysis": analysis, "resumeText": resume_text, "latexBody": latex_body, "resumeData": resume_data}


# ---------------------------------------------------------------------------
# POST /api/compile-preview  — compile LaTeX body, return PDF
# ---------------------------------------------------------------------------
@app.post("/api/compile-preview")
async def compile_preview(latexBody: str = Form(...)):
    if not latexBody.strip():
        raise HTTPException(status_code=400, detail="latexBody is required")

    latex_source = RESUME_PREAMBLE + "\n" + latexBody
    pdf_bytes, page_count, error = try_compile_latex(latex_source)

    if pdf_bytes is None:
        raise HTTPException(status_code=422, detail=f"Compilation failed:\n\n{error}")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"X-Page-Count": str(page_count)},
    )


# ---------------------------------------------------------------------------
# POST /api/chat  — AI agent: answers questions OR edits the LaTeX directly
# ---------------------------------------------------------------------------

_UPDATE_LATEX_TOOL = {
    "type": "function",
    "function": {
        "name": "update_latex",
        "description": (
            "Call this whenever the user asks to modify, rewrite, improve, add, remove, "
            "or change any part of their resume content or wording. "
            "Return the COMPLETE updated LaTeX body (\\begin{document}...\\end{document})."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "latex_body": {
                    "type": "string",
                    "description": (
                        "The complete updated LaTeX body from \\begin{document} to \\end{document}. "
                        "Must be valid Jake Gutierrez template LaTeX."
                    ),
                },
                "explanation": {
                    "type": "string",
                    "description": "A short, friendly explanation of what was changed and why.",
                },
            },
            "required": ["latex_body", "explanation"],
        },
    },
}


@app.post("/api/chat")
async def chat(
    message: str = Form(...),
    history: str = Form(...),   # JSON array of {role, content}
    resumeText: str = Form(...),
    latexBody: str = Form(default=""),
):
    try:
        history_list = json.loads(history)
    except Exception:
        history_list = []

    system_prompt = (
        "You are an expert career coach and LaTeX resume editor using the Jake Gutierrez template.\n\n"
        "Rules:\n"
        "- When the user asks to modify, improve, rewrite, add, or remove anything on their resume "
        "→ call `update_latex` with the FULL updated body.\n"
        "- When answering questions, giving advice, or explaining without editing → reply in markdown text only.\n"
        "- Keep all LaTeX commands from the original template. Never introduce new \\usepackage commands.\n"
        "- Escape special chars: & → \\&, % → \\%, # → \\#, $ → \\$, _ → \\_\n\n"
        f"Current LaTeX body:\n```latex\n{latexBody}\n```\n\n"
        f"Original resume text:\n{resumeText}"
    )

    response = deepseek.chat.completions.create(
        model="deepseek-chat",
        max_tokens=4096,
        messages=[
            {"role": "system", "content": system_prompt},
            *history_list,
            {"role": "user", "content": message},
        ],
        tools=[_UPDATE_LATEX_TOOL],
        tool_choice="auto",
    )

    msg = response.choices[0].message

    # ── Tool call: AI wants to edit the resume ────────────────────────────
    if msg.tool_calls:
        tool_call = msg.tool_calls[0]
        if tool_call.function.name == "update_latex":
            args = json.loads(tool_call.function.arguments)
            new_latex = strip_fences(args.get("latex_body", ""))
            explanation = args.get("explanation", "I've updated your resume.")
            return {"content": explanation, "latexBody": new_latex}

    # ── Plain text response ───────────────────────────────────────────────
    return {"content": msg.content or "", "latexBody": None}


# ---------------------------------------------------------------------------
# POST /api/improve-bullet  — AI-rewrite a single bullet point
# ---------------------------------------------------------------------------
@app.post("/api/improve-bullet")
async def improve_bullet(
    bullet: str = Form(...),
    context: str = Form(default=""),
):
    if not bullet.strip():
        raise HTTPException(status_code=400, detail="bullet is required")

    ctx_hint = f" for someone who is '{context}'" if context.strip() else ""

    response = deepseek.chat.completions.create(
        model="deepseek-chat",
        max_tokens=256,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert resume writer. Rewrite the given resume bullet point "
                    "to be more impactful: use strong action verbs, add measurable results where possible, "
                    "and keep it to one concise line. Return ONLY the improved bullet text — no explanation, "
                    "no formatting, no leading dash or bullet character."
                ),
            },
            {
                "role": "user",
                "content": f"Improve this bullet point{ctx_hint}:\n\n{bullet}",
            },
        ],
    )
    improved = (response.choices[0].message.content or bullet).strip()
    return {"improved": improved}


# ---------------------------------------------------------------------------
# POST /api/apply-changes  — generate improved LaTeX body (1-page enforced)
# ---------------------------------------------------------------------------
@app.post("/api/apply-changes")
async def apply_changes(
    resumeText: str = Form(...),
    analysis: str = Form(...),
):
    if not resumeText.strip() or not analysis.strip():
        raise HTTPException(status_code=400, detail="resumeText and analysis are required")

    print("[1/1] Generating improved LaTeX body (1-page guided)...")
    body = generate_latex_body(resumeText, improvements=analysis)

    pdf_bytes, page_count, error = try_compile_latex(RESUME_PREAMBLE + "\n" + body)
    if pdf_bytes is None:
        raise HTTPException(status_code=422, detail=f"Compilation failed:\n\n{error}")

    print(f"[1/1] Done — {page_count} page(s)")
    return {"latexBody": body, "pageCount": page_count}
