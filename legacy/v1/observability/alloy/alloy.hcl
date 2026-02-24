// Grafana Alloy configuration for Zen Ops observability
// Collects logs, metrics, and traces from all services

logging {
  level  = "info"
  format = "logfmt"
}

// ============================================================================
// DISCOVERY - Find Docker containers
// ============================================================================

discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
  refresh_interval = "30s"
}

// Relabel discovered containers
discovery.relabel "containers" {
  targets = discovery.docker.containers.targets

  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/(.*)"
    target_label  = "container"
  }

  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    target_label  = "service"
  }

  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_project"]
    target_label  = "project"
  }
}

// ============================================================================
// LOGS - Collect Docker container logs
// ============================================================================

loki.source.docker "containers" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.relabel.containers.output
  forward_to = [loki.process.containers.receiver]
  refresh_interval = "5s"
}

loki.process "containers" {
  forward_to = [loki.write.loki.receiver]

  // Parse JSON logs from FastAPI
  stage.json {
    expressions = {
      level     = "level",
      message   = "message",
      timestamp = "timestamp",
      request_id = "request_id",
      path      = "path",
      method    = "method",
      status_code = "status_code",
      latency_ms = "latency_ms",
      user_id   = "user_id",
    }
  }

  // Set log level label
  stage.labels {
    values = {
      level = "",
    }
  }

  // Extract request_id for correlation
  stage.labels {
    values = {
      request_id = "",
    }
  }
}

loki.write "loki" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}

// ============================================================================
// TRACES - Receive OTLP and forward to Tempo
// ============================================================================

otelcol.receiver.otlp "default" {
  grpc {
    endpoint = "0.0.0.0:4317"
  }
  http {
    endpoint = "0.0.0.0:4318"
  }
  output {
    traces  = [otelcol.processor.batch.default.input]
  }
}

otelcol.processor.batch "default" {
  timeout = "5s"
  send_batch_size = 1000
  output {
    traces = [otelcol.exporter.otlp.tempo.input]
  }
}

otelcol.exporter.otlp "tempo" {
  client {
    endpoint = "tempo:4317"
    tls {
      insecure = true
    }
  }
}

// ============================================================================
// METRICS - Self-monitoring
// ============================================================================

prometheus.scrape "alloy" {
  targets = [{
    __address__ = "127.0.0.1:12345",
  }]
  forward_to = [prometheus.remote_write.prometheus.receiver]
}

prometheus.remote_write "prometheus" {
  endpoint {
    url = "http://prometheus:9090/api/v1/write"
  }
}
