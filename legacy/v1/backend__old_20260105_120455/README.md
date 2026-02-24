# Zen Ops Backend (Rebuilt)

This directory contains a complete rewrite of the **Zen Ops** backend for **Pinnacle Consultants**.  The goals of this redesign are to provide a solid foundation for the firm's internal work operating system and to support future extensions such as invoicing, rich reporting and calendar‑aware leave scheduling.

## Overview

The backend is built with **Python 3**, **FastAPI** and **SQLAlchemy 2.x**.  It exposes a RESTful API under the `/api` prefix and stores data in **PostgreSQL** via an SQLAlchemy ORM layer.  Pydantic v2 models are used to validate request and response payloads, and JWT tokens implement stateless authentication.  Role‑based access control (RBAC) is implemented centrally to keep permissions consistent across endpoints.

### Key Features

* **Assignments as the core entity** – All work for the firm revolves around assignments.  Each assignment tracks its lifecycle (pending → site visit → processing → submitted → completed) and collects related tasks, messages, documents and approvals.
* **Comprehensive master data** – Banks, branches, clients and property types live in dedicated tables.  Bank records include account details and invoice notes that feed into the invoicing module.
* **Invoicing** – Every assignment may generate an invoice.  Invoice numbers derive from the assignment code (e.g. `VAL/2025/0012` → `INV/2025/0012`).  Each invoice can contain multiple line items, track taxes and discounts, and records when it is issued or paid.  Finance users can mark invoices as paid and fetch outstanding balances.
* **Calendar integration** – Calendar events support site visits, report deadlines, meetings and leave.  Leave requests automatically create `LEAVE` events so that workload views correctly account for staff absence.
* **RBAC and Capabilities** – Users receive one of several roles (ADMIN, OPS_MANAGER, HR, FINANCE, ASSISTANT_VALUER, FIELD_VALUER, EMPLOYEE).  Each role unlocks a set of capabilities returned via `/api/auth/capabilities`; the frontend should show or hide controls based on these.
* **Extensible approval engine** – Sensitive actions (mark invoice paid, reassign work, delete assignments) create approval requests.  HR/Ops/Admin users can approve or reject these requests via `/api/approvals` endpoints.
* **Seeding script** – A `seed.py` file creates demo users, banks, branches and sample assignments/invoices.  Run it after the first migration to populate your development database.

## Setup on macOS

Follow these steps to spin up the backend locally.  The instructions assume you have Python 3.11 installed and that PostgreSQL is available on your machine.

1. **Clone or extract the repo** – Place this `backend` directory alongside the existing `frontend` folder inside your `zen-ops` project root.

2. **Create and activate a virtual environment** (optional but recommended):

   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies**:

   ```bash
   pip install -r requirements.txt
   ```

4. **Prepare the database** – Create a PostgreSQL database named `zenops`.  For example:

   ```bash
   createdb zenops
   ```

5. **Configure environment variables** – Copy `.env.example` to `.env` and set the values for your environment.  At a minimum you need a `DATABASE_URL` (e.g. `postgresql://postgres:postgres@localhost:5432/zenops`) and a `SECRET_KEY` for JWT signing.

6. **Run migrations** – Initialise Alembic and apply the initial migration:

   ```bash
   alembic upgrade head
   ```

   The `alembic` configuration points at the models in `app/db.py` so that migrations detect schema changes automatically.

7. **Seed the database (optional)** – To add demo data and users, run:

   ```bash
   python -m app.seed
   ```

8. **Start the development server**:

   ```bash
   uvicorn app.main:app --reload
   ```

   The API will be available at `http://127.0.0.1:8000/api`.  Interactive documentation is served at `/docs` and `/redoc` by FastAPI.

## Directory Layout

```
backend/
├── alembic/               # Migration environment & scripts
├── app/                   # Application code
│   ├── main.py            # FastAPI app and router registration
│   ├── db.py              # Database engine & session management
│   ├── dependencies.py    # Common FastAPI dependencies
│   ├── models/            # SQLAlchemy models
│   ├── schemas/           # Pydantic request/response models
│   ├── routers/           # API endpoints organised by resource
│   ├── utils/             # Utilities (security, RBAC, SLA, etc.)
│   └── seed.py            # Script to populate demo data
├── requirements.txt       # Python package requirements
├── .env.example           # Example environment file
└── README.md              # This file
```

## Next Steps / TODOs

This rebuild lays a strong foundation but leaves space for future growth.  Areas to consider improving:

* **Validation and unit tests** – Only minimal validation is in place.  Writing thorough tests will ensure endpoints behave correctly as you iterate.
* **Task templates & reminders** – The `template_type` field on tasks is unused.  Implement automatic task generation and reminder notifications based on assignment status.
* **Audit trail** – Activities are captured but not yet surfaced in the API.  Expose `/api/activities` endpoints and integrate the timeline view in the frontend.
* **Files storage** – Uploaded documents are currently stored on disk under `storage/`.  You may want to plug in an S3 or Azure blob backend for production.
* **Payment gateways** – Once invoices are generated, integrate with payment gateways to accept online payments from clients.
