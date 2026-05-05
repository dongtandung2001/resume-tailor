import concurrent.futures
import io
import ipaddress
import json
import os
import re
import socket
import secrets
import sqlite3
import subprocess
import tempfile
from html import unescape as _html_unescape
from urllib.parse import parse_qs, urlparse
from base64 import b64decode, b64encode
from datetime import datetime, timezone
from hashlib import pbkdf2_hmac
from pathlib import Path

import fitz  # PyMuPDF
import httpx
import pytesseract
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
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
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
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
DATA_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_DIR / "app.db"

# ---------------------------------------------------------------------------
# SWE resume template preamble — injected into LLM system prompts
# so the model knows exactly which commands are available and their signatures.
# ---------------------------------------------------------------------------
RESUME_PREAMBLE = r"""\documentclass[letterpaper,10pt]{article}

\usepackage[margin=40pt,top=46.5pt,bottom=30pt]{geometry}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{mathptmx}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}
\usepackage{array}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\setlength{\tabcolsep}{0pt}
\renewcommand{\arraystretch}{1.0}
\urlstyle{same}

\newcommand{\sectionHeading}[1]{%
  \vspace{11pt}%
  {\fontsize{12}{14.4}\selectfont\bfseries #1}\par\vspace{3.5pt}%
  \hrule height 1pt\vspace{10.9pt}%
}

\newcommand{\resumeSubheading}[4]{%
  \noindent\begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    \textbf{#1} & \textbf{#2}\\
    \textit{#3} & \textit{#4}
  \end{tabular*}\par
}

\newcommand{\resumeProjectHeading}[4]{%
  \noindent\begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    \textbf{#1} & \textit{#2}\\
    \textit{#3} & \textit{#4}
  \end{tabular*}\par
}

\newenvironment{resumeItemize}{%
  \begin{itemize}[leftmargin=16.5pt,labelsep=5pt,labelwidth=3.5pt,itemsep=0pt,parsep=0pt,topsep=0pt,partopsep=0pt,label=\textbullet]
}{\end{itemize}}
"""

# One-shot example body shown to LLM — exact format to replicate, just replace content
RESUME_BODY_EXAMPLE = r"""
\begin{document}

\begin{center}
  {\fontsize{30}{36}\selectfont\bfseries JAKE RYAN}\par\vspace{1.3pt}
  {\fontsize{10}{16}\selectfont
  123-456-7890 \ | \ \href{mailto:jake@su.edu}{jake@su.edu} \ | \ San Jose, CA, USA \ | \ \href{https://linkedin.com/in/jake}{linkedin.com/in/jake} \ | \\[4.6pt]
  \href{https://github.com/jake}{github.com/jake} \ | \ \href{https://jakesite.dev}{jakesite.dev}
  }
\end{center}
\vspace{-10pt}

\sectionHeading{EDUCATION}
\resumeSubheading{Southwestern University}{August 2018 - May 2021}{Bachelor of Arts in Computer Science, Minor in Business}{}
\begin{resumeItemize}
  \item Relevant Coursework: Algorithms, Operating Systems, Software Engineering.
\end{resumeItemize}
\vspace{11.4pt}
\resumeSubheading{Another University}{August 2016 - May 2018}{Associate Degree in Mathematics}{GPA: 3.9}

\sectionHeading{PROFESSIONAL EXPERIENCE}
\resumeSubheading{Acme Corp}{New York, NY, USA}{Software Engineer Intern}{June 2020 - August 2020}
\begin{resumeItemize}
  \item Developed a REST API using FastAPI and PostgreSQL to store data from learning management systems.
  \item Built a full-stack web application using Flask, React, PostgreSQL and Docker, reducing onboarding time by 20\%.
  \item Automated CI/CD pipeline with GitHub Actions, cutting release cycle from 2 weeks to 3 days.
\end{resumeItemize}
\vspace{11.4pt}
\resumeSubheading{Beta Systems}{Remote}{Backend Engineer Intern}{January 2019 - May 2019}
\begin{resumeItemize}
  \item Built microservices in Go deployed on AWS ECS, reducing p99 latency by 30\%.
  \item Improved median LCP by 40\% through asset pruning and CDN caching.
\end{resumeItemize}

\sectionHeading{PROJECTS \& OUTSIDE EXPERIENCE}
\resumeProjectHeading{Open Source CLI Tool}{January 2023 - March 2023}{Go, Cobra, GitHub Actions}{}
\begin{resumeItemize}
  \item Built a command-line tool to automate deployment workflows with zero downtime.
  \item Published to GitHub with 200+ stars; integrated automated release via GitHub Actions.
\end{resumeItemize}
\vspace{11.4pt}
\resumeProjectHeading{Analytics Dashboard}{San Francisco, CA}{Python, Flask, React, PostgreSQL, Docker}{June 2020 - August 2020}
\begin{resumeItemize}
  \item Developed a full-stack web application using Flask serving a REST API with React as the frontend.
  \item Implemented OAuth to get data from user repositories and render charts with D3.js.
\end{resumeItemize}

\sectionHeading{SKILLS}
\textbf{Skills:} Java, Python, C/C++, SQL, JavaScript, HTML/CSS, React, Node.js, Flask, Git, Docker, AWS, PostgreSQL

\end{document}
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def strip_fences(raw: str) -> str:
    cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", raw.strip())
    return re.sub(r"\n?```$", "", cleaned.strip()).strip()


_MONTH = r'(?:January|February|March|April|May|June|July|August|September|October|November|December)'
_SAME_DATE_RE = re.compile(rf'({_MONTH}\s+\d{{4}})\s*[-–]\s*\1')

def dedup_same_dates(body: str) -> str:
    """Replace 'Month YYYY - Month YYYY' with 'Month YYYY' when both sides are identical."""
    return _SAME_DATE_RE.sub(r'\1', body)


def remove_item_linebreaks(body: str) -> str:
    """Remove \\ line-continuation breaks inside \\item content to prevent page overflow."""
    # Replace \\<newline><spaces> inside item text with a single space
    return re.sub(r'\\\\\n[ \t]*', ' ', body)


def normalize_latex_body(body: str) -> str:
    body = strip_fences(body)
    body = dedup_same_dates(body)
    body = remove_item_linebreaks(body)
    return body


def latex_to_text(latex: str) -> str:
    """Strip LaTeX markup from a body string, returning readable plain text."""
    text = re.sub(r'%.*?$', '', latex, flags=re.MULTILINE)
    text = re.sub(r'\\(?:begin|end)\{[^}]*\}', '', text)
    for _ in range(4):
        text = re.sub(r'\\[a-zA-Z]+\*?\{([^{}]*)\}', r'\1 ', text)
    text = re.sub(r'\\[a-zA-Z]+\*?', ' ', text)
    text = re.sub(r'[{}]', ' ', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


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
                    "Check for each section (✓/✗): Contact info, Education, Experience, "
                    "Projects, Skills section, Dates on all entries. "
                    "Do NOT check for or penalize a missing Summary/Objective — it is not expected on SWE resumes.\n\n"
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
    msg = response.choices[0].message
    return msg.content or getattr(msg, "reasoning_content", None) or ""


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
        max_tokens=8000,
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
                    "and apply penalties for structural issues. "
                    "Do NOT penalize for a missing Summary/Objective/Profile section — SWE resumes do not use them. "
                    "Show your working: "
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
                    "Add JD-specific section recommendations where relevant. "
                    "IMPORTANT: Do NOT recommend adding a Professional Summary, Objective, or Profile section — "
                    "these are not used on SWE resumes and waste space.\n\n"
                    "## Priority Action List\n"
                    "Numbered list of the top 5 highest-impact changes, ordered by combined impact on "
                    "ATS score and recruiter impression. Cross-reference keyword gaps and bullet quality findings."
                ),
            },
        ],
    )
    msg = response.choices[0].message
    return msg.content or getattr(msg, "reasoning_content", None) or ""


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
                    '  "projects": [ { "name": "", "location": "", "technologies": "", "startDate": "", "endDate": "", "bullets": [] } ],\n'
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
                    "You are an expert SWE resume writer.\n\n"
                    f"Template preamble (defines every available command and its argument signature):\n\n{RESUME_PREAMBLE}\n\n"
                    "Output ONLY \\begin{document} ... \\end{document}. "
                    "Use ONLY commands defined in the preamble above. No additional \\usepackage, no markdown fences."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Replicate this EXACT format — same commands, same structure, same spacing. Only replace the content:\n\n{RESUME_BODY_EXAMPLE}\n\n"
                    "---\n\n"
                    f"{task}\n\n"
                    "Rules:\n"
                    "1. Preserve all facts (dates, companies, technologies, metrics).\n"
                    "2. Escape special chars: & → \\&,  % → \\%,  # → \\#,  $ → \\$,  _ → \\_\n"
                    "3. Output ONLY \\begin{document} ... \\end{document}. No markdown fences.\n"
                    "4. STRICT 1-PAGE LIMIT — shorten bullets if needed, never drop an entry.\n"
                    "5. SKILLS FORMAT: single \\textbf{Skills:} line with a flat comma-separated list — no category groups.\n"
                    f"{improvement_rules}"
                ),
            },
        ],
    )
    return dedup_same_dates(strip_fences(response.choices[0].message.content or ""))


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


def get_db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS resumes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                pdf_base64 TEXT NOT NULL,
                extracted_text TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, filename),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str, salt: bytes) -> bytes:
    return pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)


def parse_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def serialize_user(user: sqlite3.Row | dict) -> dict:
    return {
        "id": int(user["id"]),
        "name": str(user["name"]),
        "email": str(user["email"]),
    }


def get_authenticated_user(authorization: str | None) -> sqlite3.Row:
    token = parse_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    with get_db() as conn:
        row = conn.execute(
            """
            SELECT users.id, users.name, users.email, users.created_at
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ?
            """,
            (token,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return row


def get_optional_authenticated_user(authorization: str | None) -> sqlite3.Row | None:
    token = parse_bearer_token(authorization)
    if not token:
        return None

    with get_db() as conn:
        row = conn.execute(
            """
            SELECT users.id, users.name, users.email, users.created_at
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ?
            """,
            (token,),
        ).fetchone()

    return row


def upsert_resume_for_user(
    *,
    user_id: int,
    filename: str,
    content_type: str,
    pdf_bytes: bytes,
    extracted_text: str,
) -> int:
    encoded_pdf = b64encode(pdf_bytes).decode("ascii")
    now = utc_now_iso()
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM resumes WHERE user_id = ? AND filename = ?",
            (user_id, filename),
        ).fetchone()
        if existing is None:
            cur = conn.execute(
                """
                INSERT INTO resumes (
                    user_id, filename, content_type, pdf_base64, extracted_text, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, filename, content_type, encoded_pdf, extracted_text, now, now),
            )
            return int(cur.lastrowid)

        conn.execute(
            """
            UPDATE resumes
            SET content_type = ?, pdf_base64 = ?, extracted_text = ?, updated_at = ?
            WHERE id = ?
            """,
            (content_type, encoded_pdf, extracted_text, now, int(existing["id"])),
        )
        return int(existing["id"])


async def resolve_resume_for_analysis(
    *,
    resume: UploadFile | None,
    saved_resume_id_raw: str,
    current_user: sqlite3.Row | None,
) -> tuple[bytes, str, str, str]:
    pdf_bytes: bytes | None = None
    resume_filename = "resume.pdf"
    resume_content_type = "application/pdf"
    cached_resume_text = ""

    if saved_resume_id_raw.strip():
        if current_user is None:
            raise HTTPException(status_code=401, detail="Please log in to use saved resumes")
        try:
            saved_resume_id = int(saved_resume_id_raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid saved resume id") from exc

        with get_db() as conn:
            saved_resume = conn.execute(
                """
                SELECT id, filename, content_type, pdf_base64, extracted_text
                FROM resumes
                WHERE id = ? AND user_id = ?
                """,
                (saved_resume_id, int(current_user["id"])),
            ).fetchone()

        if saved_resume is None:
            raise HTTPException(status_code=404, detail="Saved resume not found")

        pdf_bytes = b64decode(saved_resume["pdf_base64"])
        resume_filename = str(saved_resume["filename"])
        resume_content_type = str(saved_resume["content_type"] or "application/pdf")
        cached_resume_text = str(saved_resume["extracted_text"] or "")
    else:
        pdf_bytes, resume_filename, resume_content_type = await read_uploaded_resume(resume)

    if pdf_bytes is None:
        raise HTTPException(status_code=400, detail="Resume PDF is required")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 20 MB)")

    return pdf_bytes, resume_filename, resume_content_type, cached_resume_text


async def read_uploaded_resume(
    resume: UploadFile | None,
) -> tuple[bytes, str, str]:
    if resume is None:
        raise HTTPException(status_code=400, detail="Please upload a resume PDF or choose a saved resume")
    if resume.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    pdf_bytes = await resume.read()
    return pdf_bytes, resume.filename or "resume.pdf", resume.content_type or "application/pdf"


def store_resume_if_needed(
    *,
    current_user: sqlite3.Row | None,
    saved_resume_id_raw: str,
    save_resume_raw: str,
    resume_filename: str,
    resume_content_type: str,
    pdf_bytes: bytes,
    resume_text: str,
) -> int | None:
    if current_user is None:
        return None
    if not (saved_resume_id_raw.strip() or save_resume_raw.strip().lower() == "true"):
        return None

    return upsert_resume_for_user(
        user_id=int(current_user["id"]),
        filename=resume_filename,
        content_type=resume_content_type,
        pdf_bytes=pdf_bytes,
        extracted_text=resume_text,
    )


init_db()


# ---------------------------------------------------------------------------
# POST /api/analyze
# ---------------------------------------------------------------------------
@app.post("/api/analyze")
async def analyze_resume(
    resume: UploadFile | None = File(default=None),
    jobDescription: str = Form(...),
    savedResumeId: str = Form(default=""),
    saveResume: str = Form(default="false"),
    authorization: str | None = Header(default=None),
):
    if not jobDescription.strip():
        raise HTTPException(status_code=400, detail="Job description is required")

    current_user = get_optional_authenticated_user(authorization)
    pdf_bytes, resume_filename, resume_content_type, cached_resume_text = await resolve_resume_for_analysis(
        resume=resume,
        saved_resume_id_raw=savedResumeId,
        current_user=current_user,
    )

    if cached_resume_text.strip():
        print("[1/3] Using stored resume text...")
        resume_text = cached_resume_text
    else:
        print("[1/3] Extracting text from PDF...")
        try:
            resume_text = extract_text(pdf_bytes)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Failed to read PDF: {e}") from e

    if not resume_text.strip():
        raise HTTPException(status_code=422, detail="Could not extract text from the PDF.")

    print(f"[stage0] Extracted {len(resume_text)} chars")

    print("[stage1] Profiling resume and JD independently (parallel)...")
    with concurrent.futures.ThreadPoolExecutor() as executor:
        f_resume_profile = executor.submit(analyze_resume_standalone, resume_text)
        f_jd_profile     = executor.submit(analyze_jd_standalone, jobDescription)
        resume_profile = f_resume_profile.result()
        jd_profile     = f_jd_profile.result()
    print("[stage1] Profiles complete")

    print("[stage2] Synthesizing ATS analysis + generating LaTeX + extracting data (parallel)...")
    with concurrent.futures.ThreadPoolExecutor() as executor:
        f_analysis  = executor.submit(synthesize_ats_analysis, resume_profile, jd_profile, resume_text)
        f_latex     = executor.submit(generate_latex_body, resume_text)
        f_struct    = executor.submit(extract_structured_data, resume_text)
        analysis    = f_analysis.result()
        latex_body  = f_latex.result()
        resume_data = f_struct.result()
    print("[stage2] Done")

    saved_resume_id = store_resume_if_needed(
        current_user=current_user,
        saved_resume_id_raw=savedResumeId,
        save_resume_raw=saveResume,
        resume_filename=resume_filename,
        resume_content_type=resume_content_type,
        pdf_bytes=pdf_bytes,
        resume_text=resume_text,
    )

    return {
        "analysis": analysis,
        "resumeText": resume_text,
        "latexBody": latex_body,
        "resumeData": resume_data,
        "savedResumeId": saved_resume_id,
    }


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


_REANALYZE_CHAT_RE = re.compile(
    r're-?analyz|analyz.*again|run.*analys|fresh.*analys|new.*analys|ats.*again|score.*again',
    re.IGNORECASE,
)


@app.post("/api/chat")
async def chat(
    message: str = Form(...),
    history: str = Form(...),   # JSON array of {role, content}
    resumeText: str = Form(...),
    latexBody: str = Form(default=""),
    jobDescription: str = Form(default=""),
):
    try:
        history_list = json.loads(history)
    except Exception:
        history_list = []

    # ── Re-analyze intent: run full ATS pipeline and return as chat message ──
    if _REANALYZE_CHAT_RE.search(message) and jobDescription.strip() and latexBody.strip():
        print("[chat/reanalyze] Re-analyze intent detected — running analysis pipeline...")
        resume_text = latex_to_text(latexBody)
        with concurrent.futures.ThreadPoolExecutor() as executor:
            f_r = executor.submit(analyze_resume_standalone, resume_text)
            f_j = executor.submit(analyze_jd_standalone, jobDescription)
            resume_profile, jd_profile = f_r.result(), f_j.result()
        new_analysis = synthesize_ats_analysis(resume_profile, jd_profile, resume_text)
        print("[chat/reanalyze] Done")
        return {"content": new_analysis, "latexBody": None, "newAnalysis": new_analysis}

    system_prompt = (
        "You are an expert career coach and LaTeX resume editor.\n\n"
        f"Template preamble:\n\n{RESUME_PREAMBLE}\n\n"
        f"Canonical body format — always follow this exact structure when editing:\n\n{RESUME_BODY_EXAMPLE}\n\n"
        "Rules:\n"
        "- When the user asks to modify, improve, rewrite, add, or remove anything on their resume "
        "→ call `update_latex` with the FULL updated body.\n"
        "- When answering questions, giving advice, or explaining without editing → reply in markdown text only.\n"
        "- Use ONLY commands defined in the preamble. Never introduce new \\usepackage commands.\n"
        "- Escape special chars: & → \\&, % → \\%, # → \\#, $ → \\$, _ → \\_\n"
        "- Output ONLY \\begin{document} ... \\end{document}. No markdown fences.\n\n"
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
            return {"content": explanation, "latexBody": new_latex, "newAnalysis": None}

    # ── Plain text response ───────────────────────────────────────────────
    return {"content": msg.content or "", "latexBody": None, "newAnalysis": None}


# ---------------------------------------------------------------------------
# POST /api/improve-bullet  — AI-rewrite a single bullet point
# ---------------------------------------------------------------------------
@app.post("/api/improve-bullet")
async def improve_bullet(
    bullet: str = Form(...),
    context: str = Form(default=""),
    jobDescription: str = Form(default=""),
):
    if not bullet.strip():
        raise HTTPException(status_code=400, detail="bullet is required")

    ctx_hint = f" for someone who is '{context}'" if context.strip() else ""
    jd_block = (
        f"\n\nTarget job description (tailor the bullet to match its keywords and tone):\n{jobDescription.strip()}"
        if jobDescription.strip() else ""
    )

    response = deepseek.chat.completions.create(
        model="deepseek-chat",
        max_tokens=256,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert resume writer. Rewrite the given resume bullet point "
                    "to be more impactful using the format: [Action verb] [X — what was built/done] "
                    "by [Y — how/approach/technology] resulting in [Z — measurable outcome or impact]. "
                    "Use strong action verbs, keep all specific technologies and tool names, "
                    "and keep it to one concise line. Return ONLY the improved bullet text — no explanation, "
                    "no formatting, no leading dash or bullet character."
                ),
            },
            {
                "role": "user",
                "content": f"Improve this bullet point{ctx_hint}:\n\n{bullet}{jd_block}",
            },
        ],
    )
    improved = (response.choices[0].message.content or bullet).strip()
    return {"improved": improved}


# ---------------------------------------------------------------------------
# POST /api/apply-changes  — apply ATS recommendations to the current LaTeX body
# ---------------------------------------------------------------------------
def apply_improvements_to_latex(latex_body: str, improvements: str, job_description: str = "") -> str:
    """Apply ATS analysis recommendations directly to the current LaTeX body."""
    jd_block = (
        f"Target job description (use EXACT terminology from this — ATS matches strings, not synonyms):\n\n{job_description.strip()}\n\n---\n\n"
        if job_description.strip() else ""
    )
    response = deepseek.chat.completions.create(
        model="deepseek-chat",
        max_tokens=4096,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert SWE resume writer.\n\n"
                    f"Template preamble:\n\n{RESUME_PREAMBLE}\n\n"
                    f"Canonical body format — replicate this EXACT structure, same commands, same spacing:\n\n{RESUME_BODY_EXAMPLE}\n\n"
                    "Edit the given LaTeX body to maximise ATS score. "
                    "Output ONLY \\begin{document} ... \\end{document}. No additional \\usepackage, no markdown fences. "
                    "STRICT 1-PAGE LIMIT — shorten bullets if needed, never drop an entry."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"{jd_block}"
                    f"Current LaTeX resume body:\n\n{latex_body}\n\n"
                    "---\n\n"
                    f"ATS Analysis & Recommended Improvements:\n\n{improvements}\n\n"
                    "---\n\n"
                    "INSTRUCTIONS — apply in this order:\n\n"
                    "Step 1 — SKILLS SECTION (zero space cost, highest ATS impact):\n"
                    "  Find '## Keyword Match Analysis' in the analysis above. For every ❌ missing keyword "
                    "that is a skill, tool, language, or framework the candidate can honestly claim, "
                    "add it to the Skills field. Use the EXACT term from the job description.\n\n"
                    "Step 2 — BULLET REWRITES (apply the precomputed rewrites from the analysis):\n"
                    "  Find '## Bullet Point Rewrites' in the analysis. Apply those EXACT rewrites to the "
                    "matching bullets. Do not invent your own rewrites unless a bullet has no precomputed version.\n"
                    "  CRITICAL: if the precomputed rewrite drops a specific tool/technology that the ORIGINAL "
                    "bullet contained (e.g. 'OpenAI GPT-4', 'Langchain', 'Tesseract OCR'), keep the original "
                    "bullet instead and only apply keyword additions on top of it.\n\n"
                    "Step 3 — WEAVE REMAINING ❌ KEYWORDS INTO EXISTING BULLETS:\n"
                    "  For ❌ keywords that are not pure skills (e.g. domain concepts, methodologies), "
                    "rephrase an existing bullet to incorporate the exact term naturally. "
                    "Shorten the bullet to keep it one tight line.\n\n"
                    "Step 4 — PRIORITY ACTION LIST:\n"
                    "  Find '## Priority Action List' in the analysis. Apply any remaining items not "
                    "already covered by Steps 1–3.\n\n"
                    "Hard constraints:\n"
                    "- STRICT 1-PAGE LIMIT: Every bullet must be one concise line. Never add a new line "
                    "without removing or shortening another. Skills additions are exempt from the page limit.\n"
                    "- NO Professional Summary / Profile / Objective section — HR skips it; it wastes space.\n"
                    "- Every rewritten bullet must follow: [Action verb] [X — what] by [Y — how/technology] resulting in [Z — measurable impact]. Include Z only when a real metric exists; do not fabricate numbers.\n"
                    "- NEVER remove or replace existing specific technologies, tools, or product names "
                    "(e.g. 'OpenAI GPT-4', 'yt_dlp', 'Tesseract OCR', 'Langchain', 'Docker Compose'). "
                    "You may only ADD new keywords alongside them, never substitute generic phrases for them.\n"
                    "- Preserve all facts (dates, companies, metrics, and every named technology).\n"
                    "- SKILLS FORMAT: The Skills section must be a single \\textbf{Skills:} line followed by a "
                    "flat comma-separated list — exactly as shown in the canonical format. "
                    "Do NOT split into category groups (no 'Languages:', 'Frameworks:', etc.).\n"
                    "- SECTION ORDER: must be exactly Education → Professional Experience → Projects & Outside Experience → Skills. "
                    "Do NOT reorder sections regardless of ATS recommendations.\n"
                    "- Use ONLY commands defined in the preamble — no new \\usepackage, no \\faPhone.\n"
                    "- Escape special chars: & → \\&,  % → \\%,  # → \\#,  $ → \\$,  _ → \\_\n"
                    "- Output ONLY \\begin{document} ... \\end{document}.\n"
                ),
            },
        ],
    )
    return dedup_same_dates(strip_fences(response.choices[0].message.content or ""))


@app.post("/api/apply-changes")
async def apply_changes(
    latexBody: str = Form(...),
    analysis: str = Form(...),
    jobDescription: str = Form(default=""),
):
    if not latexBody.strip() or not analysis.strip():
        raise HTTPException(status_code=400, detail="latexBody and analysis are required")

    print("[1/1] Applying ATS improvements to current LaTeX body (1-page enforced)...")
    body = apply_improvements_to_latex(latexBody, improvements=analysis, job_description=jobDescription)

    pdf_bytes, page_count, error = try_compile_latex(RESUME_PREAMBLE + "\n" + body)
    if pdf_bytes is None:
        raise HTTPException(status_code=422, detail=f"Compilation failed:\n\n{error}")

    print(f"[1/1] Done — {page_count} page(s)")
    return {"latexBody": body, "pageCount": page_count}


# ---------------------------------------------------------------------------
# POST /api/reanalyze  — re-run ATS analysis on the current LaTeX body
# ---------------------------------------------------------------------------
@app.post("/api/reanalyze")
async def reanalyze_resume(
    latexBody: str = Form(...),
    jobDescription: str = Form(...),
):
    if not latexBody.strip():
        raise HTTPException(status_code=400, detail="latexBody is required")
    if not jobDescription.strip():
        raise HTTPException(status_code=400, detail="jobDescription is required")

    resume_text = latex_to_text(latexBody)
    if len(resume_text.strip()) < 50:
        raise HTTPException(status_code=422, detail="Could not extract enough text from latexBody")

    print("[reanalyze 1/2] Profiling resume and JD in parallel...")
    with concurrent.futures.ThreadPoolExecutor() as executor:
        f_r = executor.submit(analyze_resume_standalone, resume_text)
        f_j = executor.submit(analyze_jd_standalone, jobDescription)
        resume_profile, jd_profile = f_r.result(), f_j.result()

    print("[reanalyze 2/2] Synthesizing ATS analysis...")
    analysis = synthesize_ats_analysis(resume_profile, jd_profile, resume_text)
    print("[reanalyze] Done")
    return {"analysis": analysis}


# ---------------------------------------------------------------------------
# Auth + Resume Storage
# ---------------------------------------------------------------------------
@app.post("/api/auth/register")
async def register(
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
):
    normalized_name = name.strip()
    normalized_email = email.strip().lower()
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not normalized_email:
        raise HTTPException(status_code=400, detail="Email is required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    password_salt = secrets.token_bytes(16)
    password_hash = hash_password(password, password_salt)
    now = utc_now_iso()

    try:
        with get_db() as conn:
            cur = conn.execute(
                """
                INSERT INTO users (name, email, password_salt, password_hash, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    normalized_name,
                    normalized_email,
                    password_salt.hex(),
                    password_hash.hex(),
                    now,
                ),
            )
            user_id = int(cur.lastrowid)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="An account with that email already exists") from exc

    token = secrets.token_urlsafe(32)
    with get_db() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, user_id, now),
        )

    return {
        "token": token,
        "user": {
            "id": user_id,
            "name": normalized_name,
            "email": normalized_email,
        },
    }


@app.post("/api/auth/login")
async def login(
    email: str = Form(...),
    password: str = Form(...),
):
    normalized_email = email.strip().lower()
    if not normalized_email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    with get_db() as conn:
        row = conn.execute(
            """
            SELECT id, name, email, password_salt, password_hash
            FROM users
            WHERE email = ?
            """,
            (normalized_email,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    expected_hash = bytes.fromhex(str(row["password_hash"]))
    supplied_hash = hash_password(password, bytes.fromhex(str(row["password_salt"])))
    if supplied_hash != expected_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = secrets.token_urlsafe(32)
    now = utc_now_iso()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, int(row["id"]), now),
        )

    return {
        "token": token,
        "user": {
            "id": int(row["id"]),
            "name": str(row["name"]),
            "email": str(row["email"]),
        },
    }


@app.get("/api/auth/me")
async def me(authorization: str | None = Header(default=None)):
    user = get_authenticated_user(authorization)
    return {
        "user": {
            "id": int(user["id"]),
            "name": str(user["name"]),
            "email": str(user["email"]),
        }
    }


@app.post("/api/auth/logout")
async def logout(authorization: str | None = Header(default=None)):
    token = parse_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    with get_db() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    return {"success": True}


@app.get("/api/resumes")
async def list_resumes(authorization: str | None = Header(default=None)):
    user = get_authenticated_user(authorization)
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, filename, created_at, updated_at
            FROM resumes
            WHERE user_id = ?
            ORDER BY updated_at DESC, id DESC
            """,
            (int(user["id"]),),
        ).fetchall()

    return {
        "resumes": [
            {
                "id": int(row["id"]),
                "filename": str(row["filename"]),
                "createdAt": str(row["created_at"]),
                "updatedAt": str(row["updated_at"]),
            }
            for row in rows
        ]
    }


@app.post("/api/resumes")
async def save_resume(
    resume: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    user = get_authenticated_user(authorization)
    if resume.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    pdf_bytes = await resume.read()
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 20 MB)")

    try:
        extracted_text = extract_text(pdf_bytes)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to read PDF: {e}") from e

    resume_id = upsert_resume_for_user(
        user_id=int(user["id"]),
        filename=resume.filename or "resume.pdf",
        content_type=resume.content_type or "application/pdf",
        pdf_bytes=pdf_bytes,
        extracted_text=extracted_text,
    )

    return {"id": resume_id, "filename": resume.filename or "resume.pdf"}
