FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy server source
COPY server.py .

# Copy compiled front-end (build your front-end first: npm run build → dist/)
COPY dist/ ./dist/

EXPOSE 8080 8765

ENV HTTP_HOST=0.0.0.0 \
    HTTP_PORT=8080 \
    WS_HOST=0.0.0.0 \
    WS_PORT=8765 \
    LOG_LEVEL=INFO

CMD ["python", "server.py"]
