# Frenzo — Where Social Meets Smart

> **Official Repository:** [https://github.com/harshpal8447-star/CodeAlpha_Frenzo.git](https://github.com/harshpal8447-star/CodeAlpha_Frenzo.git)  
> **Tagline:** Where Social Meets Smart  
> **AI Companion:** Bunni  

Frenzo is a modern, premium, general-purpose social media web application designed for genuine community connection, media sharing, and expressive thought leadership. It is enhanced by **Bunni**, a friendly, intelligent AI companion that assists with post ideation, draft reviews, creative challenge streaks, and digital safety.

> **Platform Boundary:** Frenzo is strictly a consumer social platform. It is **not** a LinkedIn clone, career recruitment portal, resume screening tool, or job board.

---

## Architecture & Locked Technology Stack

- **Frontend:**
  - Modern Semantic HTML5
  - Modular CSS3 with Custom Design Tokens
  - Vanilla JavaScript (Native ES Modules, zero build-step requirement)
  - HTML5 History API for SPA navigation
- **Backend:**
  - Node.js (v24+)
  - Express.js REST API
  - Helmet (HTTP Header Hardening)
  - Strict Environment-Driven CORS Allowlisting
  - Centralized Error Handling & Rate Limiting
- **Database (Phase 2+):**
  - PostgreSQL 16 hosted on Supabase
- **Storage (Phase 3+):**
  - Supabase Storage (Public CDN Buckets for Avatars & Post Images)
- **Version Control:**
  - Git & GitHub (`main` branch)

---

## Project Structure

```
Frenzo/
├── .gitignore                      # Git exclusion rules
├── README.md                       # Platform documentation & execution manual
├── backend/                        # Node.js & Express REST API
│   ├── .env.example                # Environment variables template
│   ├── package.json                # Backend dependencies & run scripts
│   ├── src/
│   │   ├── app.js                  # Express middleware assembly & route registration
│   │   ├── server.js               # Server listener & graceful process termination
│   │   ├── config/
│   │   │   └── env.js              # Environment variable loader & validator
│   │   ├── controllers/
│   │   │   └── healthController.js # Canonical health check controller
│   │   ├── middleware/
│   │   │   ├── corsConfig.js       # Strict CORS origin validation
│   │   │   ├── errorHandler.js     # Centralized error mapping
│   │   │   ├── notFoundHandler.js  # 404 handler for undefined endpoints
│   │   │   └── rateLimiter.js      # Global API rate limiting
│   │   ├── routes/
│   │   │   └── healthRoutes.js     # GET /api/v1/health registration
│   │   ├── db/                     # Database migrations & schemas (Phase 2+)
│   │   ├── scripts/                # Administrative maintenance scripts (Phase 2+)
│   │   └── services/               # Core business logic & adapters (Phase 2+)
│
└── frontend/                       # Vanilla SPA Client Application
    ├── css/
    │   ├── tokens.css              # Design tokens (Colors, Typography, Radii, Shadows)
    │   ├── reset.css               # Modern CSS box-sizing reset
    │   ├── typography.css          # Typography scales & styles
    │   ├── layout.css              # Responsive 3-column layout grid & media queries
    │   └── components/
    │       ├── sidebar.css         # Left navigation sidebar styles
    │       ├── rail.css            # Right information rail styles
    │       └── diagnostics.css     # Live connection diagnostic card styles
    ├── js/
    │   ├── app.js                  # Client entry point & foundation event wiring
    │   ├── api/
    │   │   ├── config.js           # Dynamic API base URL resolver
    │   │   ├── client.js           # Resilient fetch wrapper with timeout
    │   │   └── healthApi.js        # Health check endpoint consumer
    │   └── components/
    │       └── Diagnostics.js      # Live health diagnostic widget
    └── public/
        └── index.html              # Single HTML5 application shell
```

---

## Design System Tokens

Frenzo features a distinctive, high-contrast, modern palette:
- **Primary Violet:** `#6366F1` (Action elements, brand highlights, hover states)
- **Midnight Navy:** `#0F172A` (Text headings, dark accents, contrast headers)
- **Porcelain:** `#F8FAFC` (App background surface, calm neutral canvas)
- **Warm Peach:** `#FF8A65` (Bunni companion badge, energetic warm highlights)

---

## Quickstart & Local Execution Guide

### Prerequisites
- Node.js (v18.x or v20.x+)
- npm (v9.x+)

### 1. Backend Setup

```bash
# Navigate to the backend directory
cd backend

# Install dependencies (express, cors, helmet, etc.)
npm install

# Create environment configuration from template
cp .env.example .env

# Start the Express server
npm start
```

The backend starts at: **`http://localhost:5000`**  
Canonical Health Check: **`http://localhost:5000/api/v1/health`**

### 2. Frontend Execution

Because the Express backend is pre-configured with static asset hosting, you can view the application directly in your browser:

- **Via Express Server (Recommended):**  
  Open: **`http://localhost:5000/public/index.html`**

- **Via Independent Dev Server (Optional):**  
  If serving frontend separately on port 3000 (e.g. `npx serve frontend` or VS Code Live Server):  
  Open: **`http://localhost:3000/public/index.html`**  
  The frontend client automatically detects the port and routes API calls to the Express backend at `http://localhost:5000/api/v1`.

---

## Canonical Health Check Endpoint

```http
GET /api/v1/health
```

#### Response Example (`200 OK`):
```json
{
  "status": "ok",
  "timestamp": "2026-10-31T02:30:00.000Z",
  "uptime": 45.12,
  "version": "1.0.0"
}
```

---

## Phase 1 Verification Status

- [x] Project structure initialized with separated backend and frontend.
- [x] Express backend configured with Helmet, CORS allowlist, and rate limiting.
- [x] Canonical `GET /api/v1/health` endpoint created and verified.
- [x] Vanilla HTML5/CSS3 frontend shell created with responsive 3-column layout.
- [x] Design token system established with verified brand palette.
- [x] Frontend-backend communication verified via live diagnostic widget.
- [x] Sensitive files (`.env`, `node_modules`) excluded from version control.
- [x] Git repository configured with remote `https://github.com/harshpal8447-star/CodeAlpha_Frenzo.git`.
