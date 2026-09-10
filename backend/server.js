// QueueCare - Single Node/Express Backend
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = 5000;
const JWT_SECRET = process.env.JWT_SECRET || "queuecare_secret_key_2026";

app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "clinic_db"
});

function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

async function setupDatabase() {
    await query(`
        CREATE TABLE IF NOT EXISTS patients (
            id INT AUTO_INCREMENT PRIMARY KEY,
            queue_number INT NOT NULL,
            patient_name VARCHAR(150) NOT NULL,
            email VARCHAR(255) NOT NULL,
            phone VARCHAR(30) NOT NULL,
            walk_in VARCHAR(10) DEFAULT 'No',
            notes TEXT,
            status VARCHAR(30) DEFAULT 'Waiting',
            registration_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            delay_minutes INT DEFAULT 0
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS doctors (
            doctor_id INT AUTO_INCREMENT PRIMARY KEY,
            doctor_name VARCHAR(150) NOT NULL,
            specialization VARCHAR(150) DEFAULT 'Doctor',
            status VARCHAR(30) DEFAULT 'Available'
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS appointments (
            appointment_id INT AUTO_INCREMENT PRIMARY KEY,
            patient_id INT NULL,
            doctor_name VARCHAR(150),
            appointment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(30) DEFAULT 'Scheduled'
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            log_id INT AUTO_INCREMENT PRIMARY KEY,
            action VARCHAR(255) NOT NULL,
            details VARCHAR(500),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Existing patients tables from older versions may not have this column.
    const cols = await query(`
        SELECT COUNT(*) AS total
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'patients'
          AND column_name = 'delay_minutes'
    `);
    if (cols[0].total === 0) {
        await query(`ALTER TABLE patients ADD COLUMN delay_minutes INT DEFAULT 0`);
    }

    const doctorCount = await query("SELECT COUNT(*) AS total FROM doctors");
    if (doctorCount[0].total === 0) {
        await query(`
            INSERT INTO doctors (doctor_name, specialization, status)
            VALUES
            ('Dr John Smith', 'General Practitioner', 'Available'),
            ('Dr Sarah Mokoena', 'Family Medicine', 'Available')
        `);
    }
}

async function logActivity(action, details = "") {
    try {
        await query(
            "INSERT INTO activity_logs (action, details) VALUES (?, ?)",
            [action, details]
        );
    } catch (err) {
        console.error("Activity log error:", err.message);
    }
}

app.get("/", (req, res) => {
    res.json({ success: true, message: "QueueCare API is running" });
});

// ================= AUTHENTICATION =================
app.post("/login", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required." });
        }

        const results = await query(`
            SELECT user_id, full_name, email, password_hash, role, phone, status
            FROM users
            WHERE LOWER(email) = ?
            LIMIT 1
        `, [email]);

        if (!results.length) {
            return res.status(401).json({ success: false, message: "Invalid email or password." });
        }

        const user = results[0];
        if (user.status !== "Active") {
            return res.status(403).json({ success: false, message: "This account is inactive." });
        }

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, message: "Invalid email or password." });
        }

        const token = jwt.sign(
            { user_id: user.user_id, role: user.role, email: user.email },
            JWT_SECRET,
            { expiresIn: "8h" }
        );

        res.json({
            success: true,
            message: "Login successful.",
            token,
            user: {
                user_id: user.user_id,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                phone: user.phone
            }
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ success: false, message: "Database error." });
    }
});

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;

    if (!token) return res.status(401).json({ message: "Access denied." });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: "Invalid or expired token." });
        req.user = user;
        next();
    });
}

app.get("/profile", authenticateToken, async (req, res) => {
    try {
        const results = await query(`
            SELECT user_id, full_name, email, role, phone, status, created_at
            FROM users WHERE user_id = ?
        `, [req.user.user_id]);

        if (!results.length) return res.status(404).json({ message: "User not found." });
        res.json(results[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Database error." });
    }
});

// Temporary demo helper. Remove before real deployment.
app.post("/reset-demo-users", async (req, res) => {
    try {
        const users = [
            ["admin@queuecare.co.za", "Admin123!"],
            ["doctor@queuecare.co.za", "Doctor123!"],
            ["reception@queuecare.co.za", "Reception123!"]
        ];

        for (const [email, password] of users) {
            const hash = await bcrypt.hash(password, 10);
            await query("UPDATE users SET password_hash = ? WHERE email = ?", [hash, email]);
        }

        res.json({ success: true, message: "Demo user passwords updated successfully." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to update passwords." });
    }
});

// ================= PATIENTS =================
app.get("/patients", async (req, res) => {
    try {
        const patients = await query(`
            SELECT id, queue_number, patient_name, email, phone, walk_in, notes,
                   status, registration_time, COALESCE(delay_minutes, 0) AS delay_minutes
            FROM patients
            ORDER BY queue_number ASC
        `);
        res.json(patients);
    } catch (err) {
        console.error("Patients error:", err);
        res.status(500).json({ success: false, message: "Failed to load patients." });
    }
});

app.post("/register-patient", async (req, res) => {
    try {
        const { patient_name, email, phone, notes, walk_in } = req.body;
        if (!patient_name || !email || !phone) {
            return res.status(400).json({ success: false, message: "Patient name, email and phone are required." });
        }

        const next = await query(`SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_number FROM patients`);
        const queueNumber = next[0].next_number;

        const result = await query(`
            INSERT INTO patients
            (queue_number, patient_name, email, phone, walk_in, notes, status, registration_time, delay_minutes)
            VALUES (?, ?, ?, ?, ?, ?, 'Waiting', NOW(), 0)
        `, [queueNumber, patient_name.trim(), email.trim(), phone.trim(), walk_in || "No", notes || ""]);

        await logActivity("Patient registered", `${patient_name} assigned queue ${queueNumber}`);

        res.json({
            success: true,
            message: "Patient registered successfully.",
            queue_number: queueNumber,
            patient_id: result.insertId
        });
    } catch (err) {
        console.error("Register patient error:", err);
        res.status(500).json({ success: false, message: "Failed to register patient." });
    }
});

app.put("/update-status/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { status } = req.body;
        const allowed = ["Waiting", "In Consultation", "Completed", "No Show"];
        if (!allowed.includes(status)) return res.status(400).json({ success: false, message: "Invalid status." });

        const result = await query("UPDATE patients SET status = ? WHERE id = ?", [status, id]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: "Patient not found." });

        await logActivity("Patient status updated", `Patient ID ${id} changed to ${status}`);
        res.json({ success: true, message: "Status updated." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to update status." });
    }
});

// ================= QUEUE =================
app.get("/current-patient", async (req, res) => {
    try {
        const results = await query(`
            SELECT * FROM patients
            WHERE status = 'In Consultation'
            ORDER BY id ASC LIMIT 1
        `);
        res.json(results[0] || null);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load current patient." });
    }
});

app.get("/upcoming-patients", async (req, res) => {
    try {
        const results = await query(`
            SELECT id, queue_number, patient_name, status, registration_time, walk_in
            FROM patients
            WHERE status = 'Waiting'
            ORDER BY queue_number ASC
        `);
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load upcoming patients." });
    }
});

app.post("/call-next", async (req, res) => {
    try {
        const current = await query(`SELECT id FROM patients WHERE status = 'In Consultation' ORDER BY id ASC LIMIT 1`);
        if (current.length) {
            return res.json({ success: false, message: "Complete the current patient before calling the next patient." });
        }

        const next = await query(`SELECT * FROM patients WHERE status = 'Waiting' ORDER BY queue_number ASC LIMIT 1`);
        if (!next.length) return res.json({ success: false, message: "No patients are waiting." });

        await query("UPDATE patients SET status = 'In Consultation' WHERE id = ?", [next[0].id]);
        await logActivity("Patient called", `${next[0].patient_name} (Queue ${next[0].queue_number})`);

        res.json({ success: true, message: `Calling Queue ${next[0].queue_number}`, patient: { ...next[0], status: "In Consultation" } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to call next patient." });
    }
});

app.post("/complete-patient", async (req, res) => {
    try {
        const current = await query(`SELECT * FROM patients WHERE status = 'In Consultation' ORDER BY id ASC LIMIT 1`);
        if (!current.length) return res.json({ success: false, message: "There is no patient currently in consultation." });

        await query("UPDATE patients SET status = 'Completed' WHERE id = ?", [current[0].id]);
        await logActivity("Patient completed", `${current[0].patient_name} (Queue ${current[0].queue_number})`);
        res.json({ success: true, message: "Patient consultation completed." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to complete patient." });
    }
});

app.post("/add-delay", async (req, res) => {
    try {
        const minutes = Math.max(1, Number(req.body.minutes) || 5);
        const current = await query(`SELECT * FROM patients WHERE status = 'In Consultation' ORDER BY id ASC LIMIT 1`);
        if (!current.length) return res.json({ success: false, message: "There is no patient currently in consultation." });

        await query("UPDATE patients SET delay_minutes = COALESCE(delay_minutes, 0) + ? WHERE id = ?", [minutes, current[0].id]);
        await logActivity("Queue delay added", `${minutes} minutes for ${current[0].patient_name}`);
        res.json({ success: true, message: `${minutes} minute delay added.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to add delay." });
    }
});

// ================= ADMIN =================
app.get("/stats", async (req, res) => {
    try {
        const rows = await query(`
            SELECT
                COUNT(*) AS total,
                SUM(status = 'Waiting') AS waiting,
                SUM(status = 'In Consultation') AS consultation,
                SUM(status = 'Completed') AS completed,
                SUM(status = 'No Show') AS no_show
            FROM patients
            WHERE DATE(registration_time) = CURDATE()
        `);
        res.json({
            total: Number(rows[0].total || 0),
            waiting: Number(rows[0].waiting || 0),
            consultation: Number(rows[0].consultation || 0),
            completed: Number(rows[0].completed || 0),
            no_show: Number(rows[0].no_show || 0)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load statistics." });
    }
});

app.get("/doctors", async (req, res) => {
    try {
        const doctors = await query("SELECT doctor_id, doctor_name, specialization, status FROM doctors ORDER BY doctor_name ASC");
        res.json(doctors);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load doctors." });
    }
});

app.get("/activity-logs", async (req, res) => {
    try {
        const logs = await query(`
            SELECT log_id, action, details, created_at
            FROM activity_logs
            ORDER BY created_at DESC
            LIMIT 50
        `);
        res.json(logs);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load activity logs." });
    }
});

app.get("/appointments", async (req, res) => {
    try {
        const appointments = await query(`
            SELECT appointment_id, patient_id, doctor_name, appointment_date, status
            FROM appointments
            ORDER BY appointment_date DESC
            LIMIT 100
        `);
        res.json(appointments);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load appointments." });
    }
});

// Optional patient delete endpoint from older version.
app.delete("/patient/:id", async (req, res) => {
    try {
        const result = await query("DELETE FROM patients WHERE id = ?", [Number(req.params.id)]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: "Patient not found." });
        res.json({ success: true, message: "Patient removed." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to remove patient." });
    }
});

// ================= START =================
db.connect(async (err) => {
    if (err) {
        console.error("Database connection failed:", err.message);
        return;
    }

    console.log("Connected to MySQL");
    try {
        await setupDatabase();
        console.log("QueueCare database checked.");
    } catch (setupError) {
        console.error("Database setup error:", setupError.message);
    }
});

app.listen(PORT, () => {
    console.log(`QueueCare API running on http://localhost:${PORT}`);
});
