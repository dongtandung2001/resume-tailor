import io
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

\section{Experience}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Undergraduate Research Assistant}{June 2020 -- Present}
      {Texas A\&M University}{College Station, TX}
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


def generate_latex_body(resume_text: str, improvements: str | None = None) -> str:
    """Convert resume text to Jake Gutierrez template body, optionally applying improvements."""
    task = (
        f"Original resume:\n\n{resume_text}\n\n"
        f"Improvements to apply:\n\n{improvements}"
        if improvements
        else f"Convert this resume to the template format:\n\n{resume_text}"
    )
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
                    "2. Target strictly 1 page — keep each bullet to one concise line.\n"
                    "3. Preserve all facts (dates, companies, technologies, metrics).\n"
                    "4. Escape special chars: & → \\&,  % → \\%,  # → \\#,  $ → \\$,  _ → \\_\n"
                    "5. Output ONLY \\begin{document} ... \\end{document}."
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

    print(f"[1/3] Extracted {len(resume_text)} chars")

    print("[2/3] Analyzing resume with DeepSeek...")
    analysis_response = deepseek.chat.completions.create(
        model="deepseek-chat",
        max_tokens=2048,
        messages=[
            {"role": "system", "content": "You are an expert career coach and resume reviewer."},
            {
                "role": "user",
                "content": (
                    f"Resume:\n\n{resume_text}\n\n---\n\nJob Description:\n{jobDescription}\n\n---\n\n"
                    "Analyze the resume against the job description:\n\n"
                    "## Overall Match Score\nRate 1–10 with explanation.\n\n"
                    "## Strengths\nKey strengths aligning with this role.\n\n"
                    "## Gaps & Missing Skills\nMissing or underrepresented skills/keywords.\n\n"
                    "## Specific Recommendations\n"
                    "- Bullet points or sections to add/modify\n"
                    "- Keywords to incorporate\n"
                    "- Experiences to highlight\n\n"
                    "## Summary\nOverall competitiveness for this role."
                ),
            },
        ],
    )
    analysis = analysis_response.choices[0].message.content or ""

    print("[3/3] Converting resume to LaTeX template...")
    latex_body = generate_latex_body(resume_text)

    return {"analysis": analysis, "resumeText": resume_text, "latexBody": latex_body}


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
# POST /api/apply-changes  — generate improved LaTeX body (1-page enforced)
# ---------------------------------------------------------------------------
@app.post("/api/apply-changes")
async def apply_changes(
    resumeText: str = Form(...),
    analysis: str = Form(...),
):
    if not resumeText.strip() or not analysis.strip():
        raise HTTPException(status_code=400, detail="resumeText and analysis are required")

    print("[1/2] Generating improved LaTeX body...")
    body = generate_latex_body(resumeText, improvements=analysis)

    # Verify page count; trim if needed
    pdf_bytes, page_count, error = try_compile_latex(RESUME_PREAMBLE + "\n" + body)

    if pdf_bytes is None:
        raise HTTPException(status_code=422, detail=f"Compilation failed:\n\n{error}")

    if page_count > 1:
        print(f"[2/2] {page_count} pages — trimming to 1...")
        trim_response = deepseek.chat.completions.create(
            model="deepseek-chat",
            max_tokens=4096,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a LaTeX resume editor. Shorten the resume body to fit exactly 1 page. "
                        "Use ONLY commands already present. Output ONLY \\begin{document} ... \\end{document}."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"This resume is {page_count} pages. Trim to 1 page by:\n"
                        "- Shortening bullets to one tight line each\n"
                        "- Removing the least relevant bullet points\n"
                        "- Never removing section headings or contact info\n\n"
                        f"Body:\n\n{body}"
                    ),
                },
            ],
        )
        body = strip_fences(trim_response.choices[0].message.content or "")
        _, page_count, _ = try_compile_latex(RESUME_PREAMBLE + "\n" + body)

    print(f"[2/2] Done — {page_count} page(s)")
    return {"latexBody": body, "pageCount": page_count}
