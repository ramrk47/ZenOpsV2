# Maulya V1 - Standalone Deployment Guide

This document outlines the steps to deploy the Maulya V1 standalone instance on a Linux host (e.g., Hostinger VPS) using Docker Compose and Traefik for reverse proxy and SSL. All data and uploaded documents are stored locally on the server filesystem.

## 1. Domain & DNS Requirements

You need to configure DNS records for the main domain and the required subdomains. Point the following A records to your server's public IP address (replace `YOUR_SERVER_IP` with your actual Hostinger VPS IP).

### Required DNS Records

| Type | Host / Name | Value / IP Address | Purpose |
| :--- | :--- | :--- | :--- |
| **A** | `@` (or `maulya.in`) | `YOUR_SERVER_IP` | Main Landing Page (Optional) |
| **A** | `app` | `YOUR_SERVER_IP` | Production Application (`app.maulya.in`) |
| **A** | `demo` | `YOUR_SERVER_IP` | Demo/Training Environment (`demo.maulya.in`) |
| **CNAME** | `www` | `maulya.in` | Optional WWW redirect |

### Hostinger DNS Setup Steps:
1. Log in to your **Hostinger hPanel**.
2. Go to **Domains** and select `maulya.in`.
3. Select **DNS / Nameservers** on the sidebar.
4. Add the **A Records** as shown in the table above.
5. Set the **TTL** to the default (e.g., 14400) or lower (300) if you want faster propagation.


## 2. Server Preparation

1.  **SSH into your server:**
    ```bash
    ssh user@your_server_ip
    ```
2.  **Ensure Docker and Docker Compose are installed:**
    ```bash
    docker --version
    docker compose version
    ```
3.  **Navigate to the repository and update:**
    If you already have `ZenOpsV2` cloned in your home directory, navigate to it and pull the latest changes:
    ```bash
    cd ~/ZenOpsV2
    git fetch origin
    git checkout codex/v1-pilot-deploy-v1only
    git pull --ff-only
    git rev-parse --short HEAD
    ```

    *If you don't have it, clone it first:*
    `git clone --branch codex/v1-pilot-deploy-v1only --single-branch https://github.com/ramrk47/ZenOpsV2.git ~/ZenOpsV2`

4.  **Navigate to the V1 directory:**
    ```bash
    cd ~/ZenOpsV2/legacy/v1
    ```

## 3. Bootstrapping the Production Environment (`app.maulya.in`)

We provide bootstrap scripts to securely generate passwords and secrets for your `.env` files.

1.  **Run the Bootstrap Script:**
    ```bash
    ./ops/bootstrap_pilot_env.sh
    ```
    *This generates `.env` and `.env.backend` with secure random passwords, configured for `app.maulya.in`.*

2.  **Review the Generated Credentials:**
    *   Inspect `.env` for `POSTGRES_PASSWORD` and database names.
    *   Inspect `.env.backend` for `JWT_SECRET`.
    *   *Store these credentials securely in a password manager.*

3.  **Deploy the Application:**
    Create the Traefik proxy network if it doesn't exist:
    ```bash
    docker network create traefik-proxy || true
    ```
    Then, bring up the production containers:
    ```bash
    ./ops/deploy_pilot_v1.sh
    ```
    *(This script wraps `docker compose -f docker-compose.hostinger.yml -f docker-compose.pilot.yml up -d --build`)*

4.  **Verify Production Deployment:**
    Run the smoke test to ensure everything is healthy:
    ```bash
    ./ops/smoke_v1_only.sh
    ```
    Access the app in your browser at `https://app.maulya.in`.

## 4. Bootstrapping the Demo Environment (`demo.maulya.in`)

The Demo environment runs completely isolated from production, with its own database and Redis instance, but on the same host.

1.  **Run the Demo Bootstrap Script:**
    ```bash
    ./ops/bootstrap_demo_env.sh
    ```
    *This generates `.env.demo` and `.env.demo.backend` configured for `demo.maulya.in`.*

2.  **Deploy the Demo Application:**
    Ensure the main Traefik proxy is running, then start the demo stack:
    ```bash
    ./ops/demo_up.sh
    ```
    *(This script wraps `docker compose --env-file .env.demo -f docker-compose.hostinger.yml -f docker-compose.demo.yml -p maulya-demo up -d --build`)*

3.  **Verify Demo Deployment:**
    Run the demo smoke test:
    ```bash
    ./ops/demo_smoke.sh
    ```
    Access the demo app in your browser at `https://demo.maulya.in`.

## 5. Maintenance & Troubleshooting

*   **Logs:**
    ```bash
    docker compose logs -f api
    docker compose logs -f frontend
    ```
*   **Restarting:**
    ```bash
    docker compose restart
    ```
*   **Database Migrations (Alembic):**
    Migrations run automatically on startup via the `migrate` container. If you need to run them manually:
    ```bash
    docker compose run --rm migrate
    ```
