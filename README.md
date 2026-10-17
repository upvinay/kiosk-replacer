# Kiosk Replacer — Full-stack starter

Full-stack QR ordering and outlet management starter using HTML/CSS/vanilla JS, Node.js, Express REST APIs, and MySQL.

## Included
- Customer menu scoped to outlet, cart, customer name and phone capture
- Demo checkout that creates a persistent order (payment is explicitly marked `demo`)
- Admin login with bcrypt password hashes and JWT bearer tokens
- Role-based access: `admin`, `sub_admin`, `chef`
- Admin dashboard, date-range order filtering, outlet/menu/staff CRUD
- Kitchen order workflow: pending → accepted → preparing → ready → completed
- Order status history and API-based refresh in dashboard
- SQL schema and seed script

## Requirements
- Node.js 18+
- MySQL 8+

## Run locally
1. Create a MySQL database or let the schema create it:
   ```bash
   mysql -u root -p < sql/schema.sql
   ```
2. Copy `.env.example` to `.env` and enter your MySQL credentials and a strong `JWT_SECRET`.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Seed demo data and a first admin:
   ```bash
   npm run db:seed
   ```
5. Start the server:
   ```bash
   npm run dev
   ```
6. Open http://localhost:3000

Seeded demo admin:
- Email: `admin@kiosk.local`
- Password: `ChangeMe123!`

Change this password immediately before any shared or deployed use. Seed command will not overwrite an existing user with the same email.

## Demo ordering
Open `http://localhost:3000/?outlet=1`, choose items, enter customer name and phone, then choose "Place demo order". This creates an order with payment status `demo_unpaid`; it does NOT charge money.

## Main REST endpoints
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/outlets`
- `GET /api/menu?outletId=1`
- `POST /api/orders` (customer checkout, demo payment)
- `GET /api/orders?from=YYYY-MM-DD&to=YYYY-MM-DD&outletId=1` (authenticated)
- `GET /api/dashboard/summary?from=...&to=...`
- `GET/POST/PUT/DELETE /api/admin/outlets`
- `GET/POST/PUT/DELETE /api/admin/menu`
- `GET/POST/PUT/DELETE /api/admin/users`
- `GET /api/kitchen/orders`
- `PATCH /api/kitchen/orders/:id/status`

Authenticated API calls use `Authorization: Bearer <token>`.

## Payment integration
The checkout in this starter is deliberately a demo. For real payments, create a server-side payment order with a provider, verify its signed webhook/signature on the backend, and only then mark the order paid/confirmed. Never accept a client-supplied "payment successful" flag. Do not store card numbers, CVVs, UPI PINs, or banking credentials.

## Before production
- Replace the seeded password and JWT secret
- Use HTTPS, strict CORS, secure token/session strategy, backups and monitoring
- Add CSRF protection if switching to cookie authentication
- Add provider payment integration and webhook verification
- Add phone OTP only if needed, consent/privacy notice, retention policy and appropriate access logging
- Add pagination, stronger audit logging, and automated tests
- Consider real-time updates with WebSockets/SSE; current panels poll the REST API
