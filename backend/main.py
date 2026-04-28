import io
import ipaddress
import json
import os
import re
import socket
import subprocess
import tempfile
from html import unescape as _html_unescape
from urllib.parse import parse_qs, urlparse

import fitz  # PyMuPDF
import httpx
import pytesseract
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from openai import OpenAI
from PIL import Image
from bs4 import BeautifulSoup

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
MAX_JOB_FETCH_BYTES = 2 * 1024 * 1024  # 2 MB

_BLOCKED_HOSTS = frozenset(
    {
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "::1",
        "metadata.google.internal",
        "metadata.goog",
    }
)


_LINKEDIN_LOGIN_REQUIRED = (
    "LinkedIn requires you to be signed in to view this job. "
    "Open the job in your browser, copy the full description, and paste it instead."
)


def _normalize_job_url(url: str) -> str:
    """Convert provider-specific collection/search URLs to canonical job-detail URLs."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()

    # LinkedIn: /jobs/collections/...?currentJobId=123  →  /jobs/view/123/
    if "linkedin.com" in host and "/jobs/view/" not in parsed.path:
        job_id = parse_qs(parsed.query).get("currentJobId", [None])[0]
        if job_id and job_id.isdigit():
            return f"https://www.linkedin.com/jobs/view/{job_id}/"

    return url


def _assert_safe_public_job_url(url: str) -> None:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http and https URLs are allowed")
    host = (parsed.hostname or "").lower()
    if not host or host in _BLOCKED_HOSTS:
        raise HTTPException(status_code=400, detail="Invalid or disallowed URL host")

    try:
        ip = ipaddress.ip_address(host)
        if not ip.is_global:
            raise HTTPException(status_code=400, detail="Private or non-public addresses are not allowed")
        return
    except ValueError:
        pass

    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise HTTPException(status_code=400, detail=f"Could not resolve host: {e}") from e

    for info in infos:
        sockaddr = info[4]
        addr = sockaddr[0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if not ip.is_global:
            raise HTTPException(status_code=400, detail="Host resolves to a non-public address")


def _html_to_plain_text(html: str) -> str:
    # Decode &lt; &amp; etc. so entity-encoded markup becomes real tags for BeautifulSoup.
    html = _html_unescape(html)
    soup = BeautifulSoup(html, "html.parser")

    # Remove non-content tags (scripts, media, chrome layout elements).
    for tag in soup(["script", "style", "noscript", "svg", "nav", "header", "footer", "aside"]):
        tag.decompose()

    # Remove elements whose ARIA role marks them as navigation/chrome rather than content.
    _NOISE_ROLES = {"navigation", "banner", "contentinfo", "complementary", "search", "toolbar"}
    for el in soup.find_all(attrs={"role": True}):
        if el.get("role", "").lower() in _NOISE_ROLES:
            el.decompose()

    # Prefer the semantic main-content container when one exists; fall back to full page.
    main = (
        soup.find("main")
        or soup.find(attrs={"role": "main"})
        or soup.find("article")
    )
    target = main if main else soup

    text = target.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _looks_like_bot_or_login_wall(html: str) -> bool:
    lower = html.lower()
    return any(
        m in lower
        for m in (
            "bot-detection",
            "cf-challenge",
            "cdn-cgi/challenge",
            "just a moment",
            "authenticating...",
            "authwall",           # LinkedIn auth-wall redirect
        )
    )


def _extract_jd_with_llm(text: str) -> str:
    """
    Use LLM to isolate the job description from noisy scraped page text.
    Falls back to the original text if the call fails.
    """
    # Cap input to avoid large token usage; real JDs fit comfortably in 12k chars.
    truncated = text[:12000]
    try:
        resp = deepseek.chat.completions.create(
            model="deepseek-chat",
            max_tokens=2048,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a job description extractor. "
                        "You receive raw text scraped from a job-posting web page — it may contain "
                        "navigation menus, sign-in prompts, similar-job listings, ads, and other "
                        "unrelated page content mixed with the actual posting.\n\n"
                        "Return ONLY the job description content: job title, company, location, "
                        "role summary, responsibilities, qualifications/requirements, and any "
                        "'about the company' section. Preserve the original wording and structure. "
                        "Output plain text only — no extra commentary."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Raw scraped text:\n\n{truncated}",
                },
            ],
        )
        extracted = (resp.choices[0].message.content or "").strip()
        return extracted if len(extracted) >= 80 else text
    except Exception:
        return text


_FETCH_URL_FAILED = "Could not load text from that URL. Paste the job description instead."

_FETCH_BROWSER_HEADERS = (
    {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    },
    {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    },
)


def _jsonld_job_field_to_plain(value) -> str:
    """Turn schema.org JobPosting JSON values (HTML strings, lists, PostalAddress, etc.) into plain text."""
    if value is None:
        return ""
    if isinstance(value, str):
        v = _html_unescape(value.strip())
        if not v:
            return ""
        if "<" in v:
            return _html_to_plain_text(v)
        return v
    if isinstance(value, list):
        return "\n".join(_jsonld_job_field_to_plain(x) for x in value if x is not None).strip()
    if isinstance(value, dict):
        if value.get("name"):
            return str(value["name"]).strip()
        if "address" in value:
            return _jsonld_job_field_to_plain(value["address"])
        if any(value.get(k) for k in ("streetAddress", "addressLocality", "addressRegion", "addressCountry")):
            parts = [
                value.get("streetAddress"),
                value.get("addressLocality"),
                value.get("addressRegion"),
                value.get("addressCountry"),
            ]
            return ", ".join(str(p) for p in parts if p)
        return ""
    return _html_unescape(str(value).strip())


_LDJSON_JOBPOSTING_SECTIONS = (
    ("employmentType", "Employment type"),
    ("datePosted", "Posted"),
    ("description", "Description"),
    ("responsibilities", "Responsibilities"),
    ("qualifications", "Qualifications"),
    ("skills", "Skills"),
    ("educationRequirements", "Education"),
    ("experienceRequirements", "Experience"),
    ("incentiveCompensation", "Compensation"),
    ("occupationalCategory", "Category"),
    ("industry", "Industry"),
    ("benefits", "Benefits"),
)


def _ldjson_job_posting_text(html: str) -> str | None:
    """schema.org JobPosting in <script type=\"application/ld+json\"> (e.g. Meta includes extra fields beyond description)."""
    soup = BeautifulSoup(html, "html.parser")
    blocks: list[str] = []
    for sc in soup.find_all("script", attrs={"type": True}):
        if "ld+json" not in sc.get("type", "").lower().replace(" ", ""):
            continue
        raw = (sc.string or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            tp = item.get("@type")
            types = tp if isinstance(tp, list) else [tp]
            if "JobPosting" not in types:
                continue
            parts: list[str] = []
            title = _jsonld_job_field_to_plain(item.get("title"))
            if title:
                parts.append(title)
            ho = item.get("hiringOrganization")
            if isinstance(ho, dict):
                org = _jsonld_job_field_to_plain(ho.get("name"))
                if org:
                    parts.append(f"Organization\n{org}")
            jl = item.get("jobLocation")
            if jl is not None:
                loc = _jsonld_job_field_to_plain(jl)
                if loc:
                    parts.append(f"Location\n{loc}")
            for key, label in _LDJSON_JOBPOSTING_SECTIONS:
                if key not in item:
                    continue
                body = _jsonld_job_field_to_plain(item[key])
                if body:
                    parts.append(f"{label}\n{body}")
            combined = "\n\n".join(parts).strip()
            if combined:
                blocks.append(combined)
    if not blocks:
        return None
    return "\n\n".join(blocks).strip()


def _collect_strings_from_json(value, out: list[str]) -> None:
    if isinstance(value, str):
        s = _jsonld_job_field_to_plain(value)
        if s and len(s) >= 40:
            out.append(s)
        return
    if isinstance(value, list):
        for item in value:
            _collect_strings_from_json(item, out)
        return
    if isinstance(value, dict):
        for item in value.values():
            _collect_strings_from_json(item, out)


def _embedded_job_json_text(html: str) -> str | None:
    """
    Fallback for SPA career sites where meaningful job text is in hydration JSON.
    """
    soup = BeautifulSoup(html, "html.parser")
    candidates: list[str] = []

    for sc in soup.find_all("script"):
        raw = (sc.string or sc.get_text() or "").strip()
        if not raw:
            continue
        low = raw.lower()
        if "job" not in low and "description" not in low and "qualification" not in low:
            continue

        payload = raw
        eq = raw.find("=")
        if eq != -1 and ("{" in raw[eq + 1:] or "[" in raw[eq + 1:]):
            payload = raw[eq + 1:].strip()
        payload = payload.rstrip(";").strip()

        for maybe_json in (payload, _html_unescape(payload)):
            if not maybe_json or maybe_json[:1] not in ("{", "["):
                continue
            try:
                parsed = json.loads(maybe_json)
            except json.JSONDecodeError:
                continue
            found: list[str] = []
            _collect_strings_from_json(parsed, found)
            if found:
                joined = "\n\n".join(dict.fromkeys(found))
                if len(joined) >= 200:
                    candidates.append(joined)
                break

    if not candidates:
        return None
    return max(candidates, key=len).strip()


async def _verify_httpx_request_url(request: httpx.Request) -> None:
    _assert_safe_public_job_url(str(request.url))


async def _fetch_url_as_plain_text(url: str) -> tuple[str, str]:
    url = _normalize_job_url(url)
    is_linkedin = "linkedin.com" in (urlparse(url).hostname or "")

    for i, hdr in enumerate(_FETCH_BROWSER_HEADERS):
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=httpx.Timeout(25.0),
                headers=hdr,
                event_hooks={"request": [_verify_httpx_request_url]},
            ) as client:
                response = await client.get(url)
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Could not reach URL ({type(e).__name__}).") from e

        sc = response.status_code
        # LinkedIn returns 999 for bot-detected requests.
        if is_linkedin and sc == 999:
            raise HTTPException(status_code=422, detail=_LINKEDIN_LOGIN_REQUIRED)
        if sc in (401, 403, 429):
            detail = _LINKEDIN_LOGIN_REQUIRED if is_linkedin else _FETCH_URL_FAILED
            raise HTTPException(status_code=422, detail=detail)
        if sc == 404:
            raise HTTPException(status_code=422, detail="Page not found (404).")
        if sc == 400 and i + 1 < len(_FETCH_BROWSER_HEADERS):
            continue
        if response.is_error:
            raise HTTPException(
                status_code=422,
                detail=f"HTTP {sc}. Paste the job description instead.",
            )

        if len(response.content) > MAX_JOB_FETCH_BYTES:
            raise HTTPException(status_code=413, detail="Page too large (max 2 MB).")

        final_url = str(response.url)
        ctype = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
        raw_text = response.text

        # Detect auth walls (Cloudflare, LinkedIn authwall redirect, etc.)
        if "html" in ctype or not ctype or ctype == "application/octet-stream":
            if _looks_like_bot_or_login_wall(raw_text):
                detail = _LINKEDIN_LOGIN_REQUIRED if is_linkedin else _FETCH_URL_FAILED
                raise HTTPException(status_code=422, detail=detail)

        if ctype in ("text/plain", "text/markdown") or (ctype.startswith("text/") and "html" not in ctype):
            text = raw_text
        else:
            text = _html_to_plain_text(raw_text)

        # Prefer clean structured JobPosting data (schema.org LD+JSON) when available.
        ld = _ldjson_job_posting_text(raw_text)
        if ld and len(ld) >= 200:
            # Structured data is already clean — no LLM extraction needed.
            text = ld
        elif ld and len(text) < 80:
            text = ld
        else:
            embedded = _embedded_job_json_text(raw_text)
            if embedded and len(embedded) > len(text):
                text = embedded
            # No clean structured source: let LLM isolate the JD from page noise.
            text = _extract_jd_with_llm(text)

        if len(text) >= 80:
            return text, final_url
        if i + 1 < len(_FETCH_BROWSER_HEADERS):
            continue

    raise HTTPException(status_code=422, detail=_FETCH_URL_FAILED)

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
# POST /api/fetch-job-url  — download a job posting page and extract plain text
# ---------------------------------------------------------------------------
@app.post("/api/fetch-job-url")
async def fetch_job_description_from_url(jobUrl: str = Form(...)):
    raw_url = jobUrl.strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="URL is required")
    _assert_safe_public_job_url(raw_url)
    text, resolved_url = await _fetch_url_as_plain_text(raw_url)
    return {"jobDescription": text, "resolvedUrl": resolved_url}


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
