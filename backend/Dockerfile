FROM python:3.12-slim

WORKDIR /app

# tesseract-ocr includes English language data by default
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    texlive-latex-base \
    texlive-fonts-recommended \
    texlive-latex-extra \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 3001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3001"]
