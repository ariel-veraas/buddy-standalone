# --- 1) Interfaz ---
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Vite escribe en ../backend/static
RUN mkdir -p /backend && npm run build

# --- 2) Servidor ---
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 BUDDY_DATA_DIR=/data
RUN useradd --system --uid 10001 --home-dir /app buddy && mkdir -p /data && chown buddy /data
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=web /backend/static ./static
USER buddy
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=4).status == 200 else 1)"
# Un solo proceso: el planificador de sincronizaciones y los límites en memoria viven acá. Los pedidos concurrentes
# los atiende el pool de hilos de FastAPI (suficiente para cientos de personas).
# Solo se confía en X-Forwarded-For si viene de un proxy listado (FORWARDED_ALLOW_IPS, ver docker-compose.yml).
ENV FORWARDED_ALLOW_IPS=127.0.0.1
CMD ["uvicorn", "app.main:get_app", "--factory", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
