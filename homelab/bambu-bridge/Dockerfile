FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY app.py bambu_client.py ./

ENV PORT=8080
EXPOSE 8080

# Run as non-root user
RUN groupadd -r bridge && useradd -r -g bridge bridge \
    && chown -R bridge:bridge /app

USER bridge

# Health check (root endpoint is unauthenticated)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-8080}/')" || exit 1

# Honor PORT so the container listens where docker-compose publishes it.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080}"]