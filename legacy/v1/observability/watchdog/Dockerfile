FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY watchdog.py .
COPY frontend_endpoints.json .

# Run as non-root
RUN useradd -m -u 1000 watchdog
USER watchdog

EXPOSE 8080

CMD ["python", "watchdog.py"]
