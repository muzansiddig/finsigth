# FinSight

### Clearer financial operations and more organized invoice reviews

A development platform for managing and reviewing documents and invoices within an isolated workspace for each organization.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-43853D?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

[![React](https://img.shields.io/badge/React-18-149ECA?logo=react&logoColor=white)](https://react.dev/)

[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

![FinSight interface preview](docs/preview.svg)

</div>

## About the Project

FinSight is a prototype for managing the invoice-review lifecycle: upload a document, extract its text locally, suggest some fields based on the text, review and correct them manually, then record the review or approval decision in an audit log.

> **Current status: a prototype for local development, not a production service.** Invoice and document metadata are stored in PostgreSQL, while files are stored on the API server's local disk. The project supports login sessions, roles, organization-level isolation, local OCR in English and Arabic, and field suggestions based on simple label-matching rules. These suggestions are not an AI model and do not constitute financial validation or proof that a document is genuine; they are never approved automatically. Do not upload sensitive financial documents to the development version.

## Contents

- [Current Features](#المزايا-الحالية)

- [How Document Extraction Works](#كيف-يعمل-استخراج-المستند)

- [Technology Stack](#Technology Stack)

- [Requirements](#Requirements)

- [Running on Windows](#التشغيل-on-windows)

- [Database and Migrations](#قاعدة-البيانات-والترحيلات)

- [Testing and Build](#الاختبارات-والبناء)

- [API Endpoints](#واجهات-api)

- [Environment Configuration](#إعدادات-البيئة)

- [Project Structure](#البنية-والمجلدات)

- [Security and Privacy](#الأمان-والخصوصية)

- [Limitations and Roadmap](#القيود-وخطة-العمل)

- [Troubleshooting](#استكشاف-الأخطاء)

- [Contributing and License](#المساهمة-والترخيص)

## Current Features

- Create a dedicated workspace for an organization; the first user in the organization becomes an administrator.

- Sign in using a signed session stored in an HttpOnly cookie with appropriate SameSite settings.

- Administrator, reviewer, and viewer roles, with permissions enforced by the API.

- Isolate invoice records, document records, and downloads according to the organization associated with the session.

- Server-side validation of invoice fields, dates, line-item totals, tax, and grand total.

- PostgreSQL storage for invoices, line items, document metadata, review history, and audit logs.

- A history of edits and status transitions, including the reason for approval or rejection.

- Upload PDF, JPEG, PNG, and WebP files up to 12 MiB, with file-signature validation.

- Local OCR using Tesseract for English and Arabic, supporting PDFs of up to 20 pages and saving text, word coordinates, and OCR confidence scores.

- Suggest invoice header fields from extracted text, including supporting text and page numbers.

- A web interface for reviewing invoices, fields, OCR results, and workflow status.

- Unit and HTTP tests, plus optional PostgreSQL integration tests.

## How Document Extraction Works

1. The user uploads a document through the interface.

2. The API validates the file type, size, and signature, then saves it to a dedicated local directory.

3. The API sends the file to the local OCR service running in Docker; document contents are not sent to a cloud OCR service.

4. The OCR result, page text, and word information are saved in PostgreSQL.

5. Local rules attempt to match known labels, such as invoice number, date, and total, in English and with some Arabic labels.

6. The interface displays suggested fields with their sources. The reviewer can transfer values into the invoice form, then review and edit them manually.

7. Running OCR does not automatically create an invoice record or approve an invoice.

**Suggestion limitations:** There is currently no AI processing or confidence-score calibration. The current confidence value is only a rough indicator of how well a field label matched, not an accuracy percentage. The rules may fail with unfamiliar formats or complex RTL layouts. Line items are not extracted automatically. Always review the original document and financial values manually.

## Technology Stack

| Component | التقنية |

| --- | --- |

| Frontend | React 18، TypeScript، Vite |

| API | Node.js، Express، TypeScript |

| Input validation | Zod |

| Database | PostgreSQL 16، Drizzle ORM |

| OCR | Python، FastAPI، Tesseract، Poppler |

| الاختبارات | Node.js Test Runner، Supertest |

| Local services environment | Docker Compose |

## Requirements

- Windows 10/11 or a compatible environment.

- Node.js 20 أو أحدث وnpm.

- Docker Desktop with Docker Compose.

- An internet connection is required initially to build the OCR image and download dependencies; after the images are built, OCR runs locally.

## Running on Windows

### 1. Extract the archive or clone the project

If you downloaded a ZIP file, extract it and open PowerShell in the `FinSight`. directory. Alternatively, clone the repository:

```powershell

git clone https://github.com/muzansiddig/finsigth.git

Set-Location finsigth

```

### 2. Install dependencies

```powershell

npm install

npm --prefix apps/api install

npm --prefix apps/web install

```

### 3. Configure the environment file

```powershell

Copy-Item .env.example apps/api/.env

```

Open `apps/api/.env` and change `SESSION_SECRET` to a unique random value. To generate a suitable value:

```powershell

node -p "require('node:crypto').randomBytes(32).toString('base64url')"

```

Do not share the secret or place real documents in development data. Do not add `.env` files to Git.

### 4. Start PostgreSQL and OCR

```powershell

docker compose up -d postgres ocr

docker compose ps

```

Wait until the services show a `healthy`. الDefault local ports:

- PostgreSQL: `127.0.0.1:55432`

- OCR: `127.0.0.1:58000`

The current Compose passwords are for local development only and are not suitable for deployment.

### 5. Run migrations

The `DATABASE_URL` in `apps/api/.env` should point to the Compose database on port `55432`. After verifying the value, run:

```powershell

npm --prefix apps/api run db:migrate

```

### 6. Run the application

```powershell

npm run dev

```

- Frontend: <http://localhost:5173>

- API: <http://localhost:3001>

- API health check: <http://localhost:3001/api/health>

- Database connection check: <http://localhost:3001/api/db/health>

Create a workspace from the login page to get started. The interface displays the login screen when no session exists; this is expected behavior.

To stop the local services:

```powershell

docker compose stop postgres ocr

```

PostgreSQL data remains in the Docker volume named `postgres_data`. Do not use `docker compose down -v` unless you intend to permanently delete the development database data.

## Database and Migrations

The Drizzle schema is located at `apps/api/src/db/schema.ts`، and the migration files are located in `apps/api/drizzle`.

Generate a migration after changing the schema:

```powershell

npm --prefix apps/api run db:generate

```

Run migrations:

```powershell

npm --prefix apps/api run db:migrate

```

Production deployment requires a properly configured `DATABASE_URL` appropriate for the environment. Do not use default PostgreSQL credentials or the Compose password in deployment.

## Testing and Build

Run API and unit tests:

```powershell

npm test

```

Run PostgreSQL integration tests against a disposable local test database. Set the database URL before testing:

```powershell

docker exec finsight-postgres createdb -U postgres finsight_test

Env: Database URL = "postgresql://postgres:postgres@127.0.0.1:55432/finsight_test"

Env: Run Db Integration Tests = "1"

npm test

Remove-Item Env:RUN_DB_INTEGRATION_TESTS

docker exec finsight-postgres dropdb -U postgres finsight_test

```

> Use a disposable test database and never point integration tests at your own data. The tests create and delete temporary records.

Build the API and frontend for production:

```powershell

npm run build

```

GitHub Actions CI includes build tests, integration tests against temporary PostgreSQL, and production dependency auditing.

## API Endpoints

Private data endpoints require a logged-in session via a cookie named `finsight_session`. The API determines the organization from the authenticated session and does not trust an organization ID supplied in the request body.

| Method | Path | Description |

| --- | --- | --- |

| `GET` | `/api/health` | API health check |

| `GET` | `/api/db/health` | PostgreSQL connection check |

| `POST` | `/api/auth/register` | Create an organization and its first administrator account |

| `POST` | `/api/auth/login` | Log in |

| `POST` | `/api/auth/logout` | Log out |

| `GET` | `/api/auth/me` | Current account information |

| `POST` | `/api/invoices/parse` | Validate submitted invoice fields; does not read a file |

| `GET` / `POST` | `/api/invoices` | List organization invoices / create an invoice for review |

| `PUT` | `/api/invoices/:id` | Update an invoice and return it to review |

| `PATCH` | `/api/invoices/:id/status` | Change invoice status with a reason |

| `GET` | `/api/invoices/:id/history` | View invoice review history |

| `GET` / `POST` | `/api/documents` | List document metadata / upload a document |

| `GET` | `/api/documents/:id/file` | Authorized document download |

| `POST` | `/api/documents/:id/ocr` | Run local OCR and save candidate fields |

| `GET` | `/api/documents/:id/extraction` | Read OCR results, fields, and supporting evidence |

Detailed specifications and response codes are available in [عقد OpenAPI](docs/api/openapi.yaml).

## Environment Configuration

Copy `.env.example` to `apps/api/.env`. Do not store real secrets in the repository.

| Variable | Purpose |

| --- | --- |

| `DATABASE_URL` | PostgreSQL connection string; use `55432` with local Compose |

| `SESSION_SECRET` | Session-signing key; use a strong random value and never use the example value |

| `PORT` | API port; default `3001` |

| `NODE_ENV` | Environment type؛ `development` locally, and`production` for deployment |

| `UPLOAD_DIR` | Local file directory; default `uploads` |

| `WEB_ORIGIN` | Allowed web origin; default `http://localhost:5173` |

| `VITE_API_URL` | Optional API origin; in development, Vite uses a proxy when this is left empty |

| `OCR_SERVICE_URL` | Local OCR service URL; default `http://127.0.0.1:58000` |

## Project Structure

```text

apps/

  api/

    drizzle/          # migrations Database

    src/

      db/             # PostgreSQL schema and data access layer

      services/       # Authentication, validation, OCR provider, and field extraction

  web/

    src/              # React interface and CSS

services/

  ocr/                # Local Python/Tesseract service

docs/

  ai/                 # OCR and Extraction Evaluation Plan

  api/                # عقد OpenAPI

  security/           # Threat Model and Release Blockers

  testing/            # Test Plan

  roadmap.md          # Remaining work

docker-compose.yml    # PostgreSQL وOCR للتطوير المحلي

```

## Security and Privacy

- Uploaded files are stored on the API server's local disk, not in private, encrypted, production-ready object storage.

- The current OCR runs locally and does not send files to a cloud provider.

- There is currently no complete malware protection, upload quotas, retention and deletion policy, or rate limiting for login and registration attempts.

- The current version does not include member invitations, email verification, or MFA.

- OCR results and field suggestions are untrusted data and must be reviewed manually before financial use.

- Do not expose the application to the internet or use real financial documents until the security and operational blockers described in the [threat model](docs/security/threat-model.md).

## Limitations and Roadmap

Key tasks remaining before production include:

1. Process OCR and extraction through a durable background queue that supports recovery and retries.

2. Production-ready private file storage with malware scanning and a retention and deletion policy.

3. Add quotas, rate limiting, email verification or invitations, and expanded authorization tests.

4. Complete line-item extraction and evaluate accuracy using a documented synthetic dataset in English and Arabic.

5. Add search, pagination, filtering, secure exports, and financial analytics dashboards.

6. Improve operational logging, monitoring, backups, and deployment and recovery plans.

Status details and acceptance criteria are in [Roadmap](docs/roadmap.md).

## Troubleshooting

### فشل Log in أو رسالة `401`

Verify that login succeeded and the cookie has not expired. `401` on `/api/auth/me` before login is expected.

### خطأ API `500` أو فشل اتصال Database

1. Check that PostgreSQL is running: `docker compose ps`.

2. Check `DATABASE_URL` in `apps/api/.env` and confirm the port matches Compose (`55432` افتراضيًا).

3. Run migrations: `npm --prefix apps/api run db:migrate`.

4. Test `/api/db/health`.

### فشل OCR أو ظهور `503`

Check that the `ocr` service in Compose has status `healthy` and that `OCR_SERVICE_URL` points to `http://127.0.0.1:58000`. OCR requires the Docker image to be built and the PDF/Tesseract utilities to be available inside it.

### تعذّر تحميل الاعتماديات أو بناء صورة OCR

An internet connection is required during initial installation and build. Check Docker Desktop and network settings, then retry the relevant command. Cloud connectivity is not required to process documents once local OCR is running.

## Contributing and License

راجع التوثيق قبل إضافة مزوّد استخراج أو تغيير تدفق المستندات. أضف اختبارات للترحيلات والصلاحيات والبيانات المالية، ولا تضع ملفات مستخدمين أو أسرارًا in الاختبارات أو السجلات.

The project does not yet have a license. Do not assume redistribution or commercial use is permitted until an explicit license is added.

## Engineering Documentation

- [Architecture and Data Flow](docs/architecture.md)

- [Functional Requirements](docs/requirements/functional.md)

- [Non-Functional Requirements](docs/requirements/non-functional.md)

- [Roadmap](docs/roadmap.md)

- [عقد OpenAPI](docs/api/openapi.yaml)

- [Test Plan](docs/testing/test-plan.md)

- [OCR and Extraction Evaluation Plan](docs/ai/evaluation.md)

- [Threat Model and Release Blockers](docs/security/threat-model.md)

- [Architecture Decision](docs/adr/0001-modular-monolith-and-provider-boundaries.md)

- [GitHub Actions CI](.github/workflows/ci.yml)
