# Notices

Buddy Standalone is the independent (no-Odoo) edition of *Buddy IA for Odoo* (same authors). The retrieval, chunking,
provider and streaming engine was ported from that project; the application around it (accounts, roles, admin console,
web interface, packaging) is new. It is released under the MIT license (see `LICENSE`).

## Third-party software

Installed from the package registries at build time, under their own licenses (verify before redistributing commercially):

| Component | Use | License |
|---|---|---|
| FastAPI, Starlette, Pydantic, Uvicorn | Web server | MIT / BSD-3-Clause |
| SQLAlchemy, psycopg | Database access | MIT / LGPL-3 (psycopg, used as an unmodified library) |
| argon2-cffi | Password hashing | MIT |
| cryptography | Encryption of secrets at rest | Apache-2.0 or BSD |
| pypdf | PDF text extraction | BSD-3-Clause |
| PyJWT, requests | Google Drive access, HTTP | MIT / Apache-2.0 |
| Preact | Web interface | MIT |
| Newsreader, Instrument Sans, Pixelify Sans (via Fontsource) | Typefaces, bundled locally | SIL OFL 1.1 |
| PostgreSQL | Database (separate container) | PostgreSQL License |

## External services

The AI provider you configure (Google Gemini, OpenAI, Anthropic or any OpenAI-compatible server) and Google Drive are
third-party services with their own terms and prices. They are not bundled or represented by this project.

## Artwork

The Mochi character was drawn for the Buddy project and ships under the same MIT license.
