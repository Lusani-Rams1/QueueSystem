# QueueCare - Fixed Structure

## Backend
Only `backend/server.js` is used. `server1.js` and `script_reception.js` were removed.

Run:
```cmd
cd backend
npm install
node server.js
```

Backend: http://localhost:5000

## Frontend
Serve the project from XAMPP Apache, for example:
`http://localhost/livhu/Login.html`

All pages use one stylesheet: `css/index.css`.

## Demo login passwords
- admin@queuecare.co.za / Admin123!
- doctor@queuecare.co.za / Doctor123!
- reception@queuecare.co.za / Reception123!

If passwords need resetting for the local demo, POST to `/reset-demo-users`, then remove that route before real deployment.
