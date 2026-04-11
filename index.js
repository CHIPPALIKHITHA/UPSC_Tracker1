require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const path = require("path");
const session = require("express-session");
const Parser = require("rss-parser");
const axios = require("axios");
const bcrypt = require("bcryptjs");
const OpenAI = require("openai");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const multer = require("multer");
const fs = require("fs");
const app = express();

const {
  DB_USER,
  DB_HOST,
  DB_NAME,
  DB_PASSWORD,
  DB_PORT,
  OPENAI_API_KEY,
  GNEWS_API_KEY,
  EMAIL_USER,
  EMAIL_PASS,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  SESSION_SECRET,
  NODE_ENV,
  PORT
} = process.env;


if (NODE_ENV !== "production") {
  console.log(
    "ENV keys loaded:",
    Object.keys(process.env).filter(
      (k) =>
        k.includes("DATABASE") ||
        k.includes("DB") ||
        k.includes("OPENAI") ||
        k.includes("GNEWS") ||
        k.includes("SESSION") ||
        k.includes("EMAIL") ||
        k.includes("GOOGLE")
    )
  );
}

// ================= OPENAI =================
let openai = null;

if (OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: OPENAI_API_KEY
  });
} else {
  console.warn("OPENAI_API_KEY is missing. Using fallback analysis only.");
}

// ================= POSTGRESQL CONNECTION =================
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: Number(process.env.DB_PORT),
      ssl: false
    });

// Test DB
pool.connect((err, client, release) => {
  if (err) {
    console.error("DB connection error:", err);
  } else {
    console.log("Connected to PostgreSQL");
    release();
  }
});

// ================= NODEMAILER =================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

// ================= EXPRESS MIDDLEWARE =================
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/styles", express.static(path.join(__dirname, "styles")));

app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(
  session({
    secret: SESSION_SECRET || "temporary_local_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

// ================= RSS PARSER =================
const parser = new Parser({
  timeout: 10000,
  customFields: {
    item: ["description", "content", "contentSnippet", "category"]
  }
});

// ================= FILE UPLOAD SETUP =================
const notesUploadPath = path.join(__dirname, "public", "pdfs", "uploaded_notes");

if (!fs.existsSync(notesUploadPath)) {
  fs.mkdirSync(notesUploadPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, notesUploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname.replace(/\s+/g, "_");
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }
    cb(null, true);
  }
});

// ================= GOOGLE OAUTH =================
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

// ================= DEBUG LOGS =================
if (!GNEWS_API_KEY) {
  console.warn("GNEWS_API_KEY is missing in .env");
}

console.log("GNEWS_API_KEY exists:", !!GNEWS_API_KEY);
console.log("GNEWS_API_KEY length:", GNEWS_API_KEY ? GNEWS_API_KEY.length : 0);

function checkAuth(req, res, next) {
  if (!req.session.email) {
    return res.redirect("/login");
  }
  next();
}

function isStrongPassword(password) {
  const minLength = 8;
  const strongPasswordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#!^()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

  return password.length >= minLength && strongPasswordRegex.test(password);
}

const essayTopics = [
  "Role of women in nation building",
  "Climate change and sustainable development",
  "Education as a tool for social transformation",
  "Digital India and inclusive governance",
  "Agriculture and the future of rural India",
  "Ethics in public administration",
  "Democracy and citizen participation",
  "Artificial Intelligence and employment",
  "Media and democracy",
  "Urbanization: opportunity or challenge?",
  "Self-reliance and economic growth",
  "Water crisis in India",
  "Youth as agents of social change",
  "Federalism and cooperative governance",
  "Social justice and inclusive development",
  "Technology in education",
  "Public health and national development",
  "Indian democracy and electoral reforms",
  "Disaster management in India",
  "Importance of civil services in democracy"
];

async function getNextEssayTopic(email) {
  const result = await pool.query(
    `SELECT last_essay_topic_index, last_essay_sent_date
     FROM details
     WHERE email = $1`,
    [email]
  );

  if (result.rows.length === 0) return null;

  const user = result.rows[0];
  const today = new Date().toISOString().split("T")[0];

  if (
    user.last_essay_sent_date &&
    new Date(user.last_essay_sent_date).toISOString().split("T")[0] === today
  ) {
    return null;
  }

  const nextIndex = (user.last_essay_topic_index + 1) % essayTopics.length;

  await pool.query(
    `UPDATE details
     SET last_essay_topic_index = $1,
         last_essay_sent_date = CURRENT_DATE
     WHERE email = $2`,
    [nextIndex, email]
  );

  return essayTopics[nextIndex];
}

function getEssayTopicForToday() {
  const dayIndex = new Date().getDate() % essayTopics.length;
  return essayTopics[dayIndex];
}

async function getUserGoogleTokens(email) {
  const result = await pool.query(
    `SELECT google_access_token, google_refresh_token, google_token_expiry
     FROM details
     WHERE email = $1`,
    [email]
  );

  return result.rows[0] || null;
}

async function createGoogleCalendarEvent(email, task) {
  console.log("createGoogleCalendarEvent called for:", email);
  console.log("Task:", task);

  const tokenRow = await getUserGoogleTokens(email);
  console.log("Token row:", tokenRow);

  if (!tokenRow || !tokenRow.google_refresh_token) {
    console.log("❌ No refresh token found → Google not connected");
    return { success: false, reason: "google_not_connected" };
  }

  oauth2Client.setCredentials({
    access_token: tokenRow.google_access_token,
    refresh_token: tokenRow.google_refresh_token,
    expiry_date: tokenRow.google_token_expiry
      ? new Date(tokenRow.google_token_expiry).getTime()
      : null
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const event = {
    summary: task.task_text,
    description: `Subject: ${task.subject || "General"}`,
    start: {
      dateTime: `${task.task_date}T${task.start_time}:00`,
      timeZone: "Asia/Kolkata"
    },
    end: {
      dateTime: `${task.task_date}T${task.end_time}:00`,
      timeZone: "Asia/Kolkata"
    }
  };

  console.log("Event payload:", event);

  try {
    const response = await calendar.events.insert({
      calendarId: "primary",
      requestBody: event
    });

    console.log("✅ Google event created:", response.data);

    return { success: true, eventId: response.data.id };
  } catch (err) {
    console.error("❌ Google API error:", err);
    return { success: false, error: err.message };
  }
}

// ================= ROUTES =================

// Default route
app.get("/", (req, res) => {
  res.redirect("/signup");
});

// Signup page
app.get("/signup", (req, res) => {
  res.render("signup");
});

// Login page
app.get("/login", (req, res) => {
  res.render("login");
});

// ================= SIGNUP =================
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.send(`
      <script>
        alert("Email and password are required!");
        window.location.href = "/signup";
      </script>
    `);
  }

  if (!isStrongPassword(password)) {
    return res.send(`
      <script>
        alert("Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.");
        window.location.href = "/signup";
      </script>
    `);
  }

  try {
    const checkUser = await pool.query("SELECT * FROM users WHERE mail = $1", [
      email
    ]);

    if (checkUser.rows.length > 0) {
      return res.send(`
        <script>
          alert("User already exists!");
          window.location.href = "/signup";
        </script>
      `);
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    await pool.query("INSERT INTO users (mail, password) VALUES ($1, $2)", [
      email,
      hashedPassword
    ]);

    res.redirect(`/details?email=${email}`);
  } catch (err) {
    console.error(err);
    res.send("Error saving user");
  }
});

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.send(`
      <script>
        alert("Please enter both email and password");
        window.location.href="/login";
      </script>
    `);
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE mail = $1", [
      email
    ]);

    if (result.rows.length === 0) {
      return res.send(`
        <script>
          alert("Invalid email or password");
          window.location.href="/login";
        </script>
      `);
    }

    const user = result.rows[0];
    console.log("User row:", user);
    console.log("Stored password:", user.password);

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.send(`
        <script>
          alert("Invalid email or password");
          window.location.href="/login";
        </script>
      `);
    }

    req.session.email = email;
    return res.redirect("/dashboard");
  } catch (err) {
    console.error("Login error:", err);
    return res.send("Error during login");
  }
});

//=============Logout=====================
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.log("Logout error:", err);
      return res.redirect("/dashboard");
    }

    res.clearCookie("connect.sid");
    res.redirect("/signup");
  });
});

// ================= DETAILS =================
app.get("/details", (req, res) => {
  const email = req.query.email;
  res.render("details", { email });
});

app.post("/submit-details", async (req, res) => {
  const {
    email,
    first_name,
    last_name,
    gender,
    contact_number,
    state,
    city,
    father_name,
    mother_name,
    disabilities,
    language,
    optional
  } = req.body;

  try {
    await pool.query(
      `INSERT INTO details 
      (email, first_name, last_name, gender, contact_number, state, city, father_name, mother_name, disabilities, language, optional)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        email,
        first_name,
        last_name,
        gender,
        contact_number,
        state,
        city,
        father_name,
        mother_name,
        disabilities,
        language,
        optional
      ]
    );

    req.session.email = email;
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error saving details");
  }
});

app.get("/test-emblem", (req, res) => {
  res.send('<img src="/images/emblem.png" width="200">');
});

// ================= DASHBOARD =================
app.get("/dashboard", checkAuth, async (req, res) => {
  const email = req.session.email;

  if (!email) {
    return res.redirect("/login");
  }

  try {
    const userDetails = await pool.query(
      "SELECT first_name FROM details WHERE email = $1",
      [email]
    );

    const userName = userDetails.rows[0]?.first_name || "Aspirant";

    const notificationResult = await pool.query(
      `SELECT email_notifications, notification_popup_shown
       FROM details
       WHERE email = $1`,
      [email]
    );

    const notificationSettings = notificationResult.rows[0] || {
      email_notifications: false,
      notification_popup_shown: false
    };

    const showNotificationPopup = !notificationSettings.notification_popup_shown;

    const result = await pool.query(
      "SELECT quote FROM motivational_quotes ORDER BY RANDOM() LIMIT 1"
    );
    const quote = result.rows[0]?.quote || "Keep pushing forward!";

    const today = new Date();

    const prelimDate = new Date("2026-06-01");
    const mainsDate = new Date("2026-09-15");
    const interviewDate = new Date("2027-03-01");

    const prelimDays = Math.ceil((prelimDate - today) / (1000 * 60 * 60 * 24));
    const mainsDays = Math.ceil((mainsDate - today) / (1000 * 60 * 60 * 24));
    const interviewDays = Math.ceil(
      (interviewDate - today) / (1000 * 60 * 60 * 24)
    );

    const targetsResult = await pool.query(
      `
      SELECT
        id,
        task_text AS topic,
        subject,
        start_time,
        end_time,
        color,
        done
      FROM study_planner_tasks
      WHERE email = $1
        AND task_date = CURRENT_DATE
      ORDER BY start_time NULLS LAST, id ASC
      `,
      [email]
    );

    const targets = targetsResult.rows;

    const activity = await pool.query(
      "SELECT date, study_hours, topics_completed FROM study_log WHERE email=$1",
      [email]
    );

    let streak = 0;
    const totalDays = activity.rows.length;

    const dates = activity.rows.map((r) => r.date.toISOString().split("T")[0]);

    let current = new Date();

    while (true) {
      const d = current.toISOString().split("T")[0];
      if (dates.includes(d)) {
        streak++;
        current.setDate(current.getDate() - 1);
      } else break;
    }

    const frequency = totalDays / 7;
    const totalHours = activity.rows.reduce(
      (sum, r) => sum + (r.study_hours || 0),
      0
    );
    const intensity = totalHours / (totalDays || 1);
    const topics = activity.rows.reduce(
      (sum, r) => sum + (r.topics_completed || 0),
      0
    );

    const score = Math.round(streak * 2 + frequency * 2 + intensity + topics / 10);

    const consistency = {
      streak,
      frequency: frequency.toFixed(2),
      intensity: intensity.toFixed(2),
      time: totalHours,
      topics,
      score
    };

    const { overviewData } = await getSyllabusPageData();

    res.render("dashboard", {
      userName,
      quote,
      prelimDays,
      mainsDays,
      interviewDays,
      targets,
      consistency,
      overviewData,
      showNotificationPopup,
      currentPage: "dashboard"
    });
  } catch (err) {
    console.error(err);
    res.send("Error loading dashboard");
  }
});

//============= Syllabus tracker =====================

// Convert GS I -> General Studies I
function formatMainsPaperName(paper) {
  const mapping = {
    "GS I": "General Studies I",
    "GS II": "General Studies II",
    "GS III": "General Studies III",
    "GS IV": "General Studies IV"
  };
  return mapping[paper] || paper;
}

// Format mains topic text
function formatMainsTopic(row) {
  if (row.subtopic) {
    if (row.section_name === row.topic) {
      return `${row.topic} - ${row.subtopic}`;
    }
    return `${row.section_name} - ${row.topic} - ${row.subtopic}`;
  }

  if (row.section_name === row.topic) {
    return `${row.topic}`;
  }

  return `${row.section_name} - ${row.topic}`;
}

// Format prelims topic text
function formatPrelimsTopic(row) {
  if (row.subject && row.topic) {
    return `${row.subject} - ${row.topic}`;
  }
  return row.subject || row.topic || "Untitled Topic";
}

// Fetch prelims syllabus + overview

//============= Syllabus tracker =====================

// Convert GS I -> General Studies I
//============= Syllabus tracker =====================

// Fetch prelims syllabus + overview
async function getPrelimsData() {
  const result = await pool.query(`
    SELECT id, paper, subject, topic
    FROM prelim_topics
    ORDER BY
      CASE
        WHEN paper = 'Paper 1' THEN 1
        WHEN paper = 'Paper 2' THEN 2
        ELSE 3
      END,
      subject,
      id
  `);

  const checklist = {};
  const overview = {};

  result.rows.forEach((row) => {
    const paper = row.paper;
    const subject = row.subject || "General";
    const formattedTopic = formatPrelimsTopic(row);

    if (!checklist[paper]) {
      checklist[paper] = [];
    }
    checklist[paper].push(formattedTopic);

    if (!overview[paper]) {
      overview[paper] = {};
    }
    if (!overview[paper][subject]) {
      overview[paper][subject] = [];
    }
    overview[paper][subject].push(formattedTopic);
  });

  return { checklist, overview };
}

// Fetch mains syllabus + overview
async function getMainsData() {
  const result = await pool.query(`
    SELECT id, paper, section_no, section_name, topic, subtopic
    FROM mains_topics
    ORDER BY
      CASE
        WHEN paper = 'GS I' THEN 1
        WHEN paper = 'GS II' THEN 2
        WHEN paper = 'GS III' THEN 3
        WHEN paper = 'GS IV' THEN 4
        ELSE 5
      END,
      section_no NULLS LAST,
      id
  `);

  const checklist = {};
  const overview = {};

  result.rows.forEach((row) => {
    const paper = formatMainsPaperName(row.paper);
    const subject = row.section_name || row.topic || "General";
    const formattedTopic = formatMainsTopic(row);

    if (!checklist[paper]) checklist[paper] = [];
    checklist[paper].push(formattedTopic);

    if (!overview[paper]) overview[paper] = {};
    if (!overview[paper][subject]) overview[paper][subject] = [];
    overview[paper][subject].push(formattedTopic);
  });

  return { checklist, overview };
}

// Fetch full syllabus + overview
async function getSyllabusPageData() {
  const prelims = await getPrelimsData();
  const mains = await getMainsData();

  return {
    syllabusData: {
      prelims: prelims.checklist,
      mains: mains.checklist
    },
    overviewData: {
      prelims: prelims.overview,
      mains: mains.overview
    }
  };
}
//============= Syllabus tracker route =====================
app.get("/syllabus-tracker", checkAuth, async (req, res) => {
  const email = req.session.email;
  if (!email) return res.redirect("/login");

  try {
    // ================= USER NAME =================
    const userDetails = await pool.query(
      "SELECT first_name FROM details WHERE email = $1",
      [email]
    );

    const userName = userDetails.rows[0]?.first_name || "Aspirant";

    // ================= NOTIFICATION POPUP STATUS =================
    const notificationResult = await pool.query(
      `SELECT email_notifications, notification_popup_shown
       FROM details
       WHERE email = $1`,
      [email]
    );

    const notificationSettings = notificationResult.rows[0] || {
      email_notifications: false,
      notification_popup_shown: false
    };

    const showNotificationPopup = !notificationSettings.notification_popup_shown;

    // ================= MOTIVATIONAL QUOTE =================
    const quoteResult = await pool.query(
      "SELECT quote FROM motivational_quotes ORDER BY RANDOM() LIMIT 1"
    );

    const quote = quoteResult.rows[0]?.quote || "Keep pushing forward!";

    // ================= COUNTDOWN =================
    const today = new Date();

    const prelimDate = new Date("2026-06-01");
    const mainsDate = new Date("2026-09-15");
    const interviewDate = new Date("2027-03-01");

    const prelimDays = Math.ceil((prelimDate - today) / (1000 * 60 * 60 * 24));
    const mainsDays = Math.ceil((mainsDate - today) / (1000 * 60 * 60 * 24));
    const interviewDays = Math.ceil((interviewDate - today) / (1000 * 60 * 60 * 24));

    // ================= TODAY TARGETS =================
    const targetsResult = await pool.query(
      `
      SELECT
        id,
        task_text AS topic,
        subject,
        start_time,
        end_time,
        color,
        done
      FROM study_planner_tasks
      WHERE email = $1
        AND task_date = CURRENT_DATE
      ORDER BY start_time NULLS LAST, id ASC
      `,
      [email]
    );

    const targets = targetsResult.rows;

    // ================= CONSISTENCY =================
    const activity = await pool.query(
      "SELECT date, study_hours, topics_completed FROM study_log WHERE email = $1",
      [email]
    );

    let streak = 0;
    const totalDays = activity.rows.length;

    const dates = activity.rows.map((r) => r.date.toISOString().split("T")[0]);

    let current = new Date();

    while (true) {
      const d = current.toISOString().split("T")[0];
      if (dates.includes(d)) {
        streak++;
        current.setDate(current.getDate() - 1);
      } else {
        break;
      }
    }

    const frequency = totalDays / 7;
    const totalHours = activity.rows.reduce(
      (sum, r) => sum + (r.study_hours || 0),
      0
    );
    const intensity = totalHours / (totalDays || 1);
    const topics = activity.rows.reduce(
      (sum, r) => sum + (r.topics_completed || 0),
      0
    );

    const score = Math.round(streak * 2 + frequency * 2 + intensity + topics / 10);

    const consistency = {
      streak,
      frequency: frequency.toFixed(2),
      intensity: intensity.toFixed(2),
      time: totalHours,
      topics,
      score
    };

    // ================= SYLLABUS DATA =================
    const { syllabusData, overviewData } = await getSyllabusPageData();

    // ================= RENDER =================
    res.render("syllabus_tracker", {
      email,
      userName,
      quote,
      prelimDays,
      mainsDays,
      interviewDays,
      consistency,
      targets,
      overviewData,
      syllabusData,
      showNotificationPopup,
      currentPage: "syllabus"
    });
  } catch (err) {
    console.error("Error loading syllabus tracker:", err);
    res.send("Error loading syllabus tracker");
  }
});

// ============== SYLLABUS PROGRESS API ==================
app.get("/api/syllabus-progress", async (req, res) => {
  const email = req.session.email;

  console.log("GET /api/syllabus-progress");
  console.log("Session email:", email);

  if (!email) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const result = await pool.query(
      `SELECT category, paper, topic, completed
       FROM syllabus_progress
       WHERE email = $1`,
      [email]
    );

    console.log("Loaded rows:", result.rows);

    const progress = {};

    result.rows.forEach((row) => {
      if (!progress[row.category]) {
        progress[row.category] = {};
      }

      if (!progress[row.category][row.paper]) {
        progress[row.category][row.paper] = {};
      }

      progress[row.category][row.paper][row.topic] = row.completed;
    });

    res.json(progress);
  } catch (err) {
    console.error("Error fetching syllabus progress:", err);
    res.status(500).json({ error: "DB error" });
  }
});

// SAVE checkbox state
app.post("/api/syllabus-progress", async (req, res) => {
  const email = req.session.email;
  const { category, paper, topic, completed } = req.body;

  console.log("POST /api/syllabus-progress");
  console.log("Session email:", email);
  console.log("Body:", req.body);

  if (!email) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    await pool.query(
      `INSERT INTO syllabus_progress (email, category, paper, topic, completed)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email, category, paper, topic)
       DO UPDATE SET completed = EXCLUDED.completed`,
      [email, category, paper, topic, completed]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving syllabus progress:", err);
    res.status(500).json({ error: "DB error" });
  }
});

//=============Study planner=====================
app.get("/study-planner", checkAuth, async (req, res) => {
  const email = req.session.email;
  if (!email) return res.redirect("/login");

  try {
    const userDetails = await pool.query(
      "SELECT first_name FROM details WHERE email = $1",
      [email]
    );

    const userName = userDetails.rows[0]?.first_name || "Aspirant";

    res.render("study_planner", {
      email,
      userName,
      currentPage: "planner"
    });
  } catch (err) {
    console.error("Error loading study planner:", err);
    res.send("Error loading study planner");
  }
});

// ============= STUDY PLANNER API =================

// 7-day calendar data
app.get("/api/study-planner/week", checkAuth, async (req, res) => {
  const email = req.session.email;

  try {
    const result = await pool.query(
      `
      WITH days AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '3 day',
          CURRENT_DATE + INTERVAL '3 day',
          INTERVAL '1 day'
        )::date AS day
      ),
      task_counts AS (
        SELECT task_date, COUNT(*) AS total_tasks
        FROM study_planner_tasks
        WHERE email = $1
          AND task_date BETWEEN CURRENT_DATE - INTERVAL '3 day' AND CURRENT_DATE + INTERVAL '3 day'
        GROUP BY task_date
      ),
      done_counts AS (
        SELECT task_date, COUNT(*) AS done_tasks
        FROM study_planner_tasks
        WHERE email = $1
          AND done = true
          AND task_date BETWEEN CURRENT_DATE - INTERVAL '3 day' AND CURRENT_DATE + INTERVAL '3 day'
        GROUP BY task_date
      ),
      study_hours AS (
        SELECT log_date, study_hours
        FROM study_day_logs
        WHERE email = $1
          AND log_date BETWEEN CURRENT_DATE - INTERVAL '3 day' AND CURRENT_DATE + INTERVAL '3 day'
      )
      SELECT
        d.day,
        COALESCE(t.total_tasks, 0) AS total_tasks,
        COALESCE(dc.done_tasks, 0) AS done_tasks,
        COALESCE(s.study_hours, 0) AS study_hours
      FROM days d
      LEFT JOIN task_counts t ON d.day = t.task_date
      LEFT JOIN done_counts dc ON d.day = dc.task_date
      LEFT JOIN study_hours s ON d.day = s.log_date
      ORDER BY d.day
      `,
      [email]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error loading week data:", err);
    res.status(500).json({ error: "Error loading week data" });
  }
});

// full month data
app.get("/api/study-planner/month", checkAuth, async (req, res) => {
  const email = req.session.email;
  const month = parseInt(req.query.month);
  const year = parseInt(req.query.year);

  if (!month || !year) {
    return res.status(400).json({ error: "Month and year are required" });
  }

  try {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const result = await pool.query(
      `
      WITH bounds AS (
        SELECT
          DATE_TRUNC('month', $2::date)::date AS start_day,
          (DATE_TRUNC('month', $2::date) + INTERVAL '1 month - 1 day')::date AS end_day
      ),
      days AS (
        SELECT generate_series(
          (SELECT start_day FROM bounds),
          (SELECT end_day FROM bounds),
          INTERVAL '1 day'
        )::date AS day
      ),
      task_counts AS (
        SELECT task_date, COUNT(*) AS total_tasks
        FROM study_planner_tasks
        WHERE email = $1
          AND task_date BETWEEN (SELECT start_day FROM bounds) AND (SELECT end_day FROM bounds)
        GROUP BY task_date
      ),
      done_counts AS (
        SELECT task_date, COUNT(*) AS done_tasks
        FROM study_planner_tasks
        WHERE email = $1
          AND done = true
          AND task_date BETWEEN (SELECT start_day FROM bounds) AND (SELECT end_day FROM bounds)
        GROUP BY task_date
      ),
      study_hours AS (
        SELECT log_date, study_hours
        FROM study_day_logs
        WHERE email = $1
          AND log_date BETWEEN (SELECT start_day FROM bounds) AND (SELECT end_day FROM bounds)
      )
      SELECT
        d.day,
        COALESCE(t.total_tasks, 0) AS total_tasks,
        COALESCE(dc.done_tasks, 0) AS done_tasks,
        COALESCE(s.study_hours, 0) AS study_hours
      FROM days d
      LEFT JOIN task_counts t ON d.day = t.task_date
      LEFT JOIN done_counts dc ON d.day = dc.task_date
      LEFT JOIN study_hours s ON d.day = s.log_date
      ORDER BY d.day
      `,
      [email, startDate]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error loading month data:", err);
    res.status(500).json({ error: "Error loading month data" });
  }
});

// tasks for a day
app.get("/api/study-planner/tasks", checkAuth, async (req, res) => {
  const email = req.session.email;
  const selectedDate = req.query.date;

  if (!selectedDate) {
    return res.status(400).json({ error: "Date is required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        task_date,
        task_text,
        subject,
        topic,
        resource_text,
        resource_link,
        resource_file_name,
        start_time,
        end_time,
        color,
        done
      FROM study_planner_tasks
      WHERE email = $1 AND task_date = $2
      ORDER BY start_time NULLS LAST, id ASC
      `,
      [email, selectedDate]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error loading tasks:", err);
    res.status(500).json({ error: "Error loading tasks" });
  }
});

// add task
app.post("/api/study-planner/tasks", checkAuth, async (req, res) => {
  const email = req.session.email;
  const {
    task_date,
    task_text,
    subject,
    topic,
    resource_text,
    resource_link,
    resource_file_name,
    start_time,
    end_time,
    color
  } = req.body;

  console.log("Incoming task body:", req.body);

  if (!task_date || !task_text || !subject || !topic || !start_time || !end_time || !color) {
    console.log("Missing required fields");
    return res.status(400).json({ error: "Required fields are missing" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO study_planner_tasks
      (
        email, task_date, task_text, subject, topic,
        resource_text, resource_link, resource_file_name,
        start_time, end_time, color, done
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)
      RETURNING *
      `,
      [
        email,
        task_date,
        task_text,
        subject,
        topic,
        resource_text || "",
        resource_link || "",
        resource_file_name || "",
        start_time,
        end_time,
        color
      ]
    );

    console.log("Task inserted into DB:", result.rows[0]);

    try {
      const googleResult = await createGoogleCalendarEvent(email, {
        task_text,
        subject,
        task_date,
        start_time,
        end_time
      });

      console.log("Google sync result:", googleResult);
    } catch (gErr) {
      console.error("Google Calendar sync failed:", gErr.message);
    }

    res.json({ success: true, task: result.rows[0] });
  } catch (err) {
    console.error("Error saving task:", err);
    res.status(500).json({ error: "Error saving task" });
  }
});

// toggle task done
app.post("/api/study-planner/tasks/toggle", checkAuth, async (req, res) => {
  const email = req.session.email;
  const { id, done } = req.body;

  if (!id) {
    return res.status(400).json({ error: "Task id required" });
  }

  try {
    await pool.query(
      `UPDATE study_planner_tasks
       SET done = $1
       WHERE id = $2 AND email = $3`,
      [done, id, email]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error toggling task:", err);
    res.status(500).json({ error: "Error toggling task" });
  }
});

// delete task
app.delete("/api/study-planner/tasks/:id", checkAuth, async (req, res) => {
  const email = req.session.email;
  const id = req.params.id;

  try {
    await pool.query(`DELETE FROM study_planner_tasks WHERE id = $1 AND email = $2`, [
      id,
      email
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting task:", err);
    res.status(500).json({ error: "Error deleting task" });
  }
});

// save day hours
app.post("/api/study-planner/hours", checkAuth, async (req, res) => {
  const email = req.session.email;
  const { log_date, study_hours } = req.body;

  if (!log_date || study_hours === undefined || study_hours === null) {
    return res.status(400).json({ error: "Date and study hours required" });
  }

  try {
    await pool.query(
      `
      INSERT INTO study_day_logs (email, log_date, study_hours)
      VALUES ($1, $2, $3)
      ON CONFLICT (email, log_date)
      DO UPDATE SET study_hours = EXCLUDED.study_hours
      `,
      [email, log_date, study_hours]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving study hours:", err);
    res.status(500).json({ error: "Error saving study hours" });
  }
});

// ============= RESOURCES -> ADD TO STUDY PLAN =================
app.post("/api/resources/add-to-study-plan", checkAuth, async (req, res) => {
  const email = req.session.email;
  const { task_date, title, subject, category, resource_link, note } = req.body;

  if (!task_date || !title || !category) {
    return res.status(400).json({ error: "Required fields are missing" });
  }

  try {
    const taskText = note && note.trim() ? `${title} - ${note.trim()}` : `Study ${title}`;

    await pool.query(
      `
      INSERT INTO study_planner_tasks
      (
        email, task_date, task_text, subject, topic,
        resource_text, resource_link, resource_file_name,
        start_time, end_time, color, done
      )
      VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, '06:00:00', '07:00:00', '#1d4ed8', false)
      `,
      [email, task_date, taskText, subject || category, category, category, resource_link || "", title]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error adding resource to study plan:", err);
    res.status(500).json({ error: "Error adding resource to study plan" });
  }
});

// ============= DASHBOARD TODAY TARGETS API =================
app.get("/api/today-targets", checkAuth, async (req, res) => {
  const email = req.session.email;

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        task_date,
        task_text AS topic,
        subject,
        start_time,
        end_time,
        color,
        done
      FROM study_planner_tasks
      WHERE email = $1
        AND task_date = CURRENT_DATE
      ORDER BY start_time NULLS LAST, id ASC
      `,
      [email]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error loading today targets:", err);
    res.status(500).json({ error: "Error loading today targets" });
  }
});

// ============= RESOURCES DATA =============
const ncertsData = [
  { class_name: "6", subject: "History", title: "History - Our Pasts I", link: "/pdfs/ncerts/NCERT-Class-6-History.pdf" },
  { class_name: "6", subject: "Geography", title: "Geography - The Earth Our Habitat", link: "/pdfs/ncerts/NCERT-Class-6-Geography.pdf" },
  { class_name: "6", subject: "Polity", title: "Polity - Social and Political Life I", link: "/pdfs/ncerts/NCERT-Class-6-Political-Science.pdf" },

  { class_name: "7", subject: "History", title: "History - Our Pasts II", link: "/pdfs/ncerts/NCERT-Class-7-History.pdf" },
  { class_name: "7", subject: "Geography", title: "Geography - Our Environment", link: "/pdfs/ncerts/NCERT-Class-7-Geography.pdf" },
  { class_name: "7", subject: "Polity", title: "Polity - Social and Political Life II", link: "/pdfs/ncerts/NCERT-Class-7-Political-Science.pdf" },

  { class_name: "8", subject: "History", title: "History - Our Pasts III", link: "/pdfs/ncerts/NCERT-Class-8-History.pdf" },
  { class_name: "8", subject: "Geography", title: "Geography - Resources and Development", link: "/pdfs/ncerts/NCERT-Class-8-Geography.pdf" },
  { class_name: "8", subject: "Polity", title: "Polity - Social and Political Life III", link: "/pdfs/ncerts/NCERT-Class-8-Political-Science.pdf" },

  { class_name: "9", subject: "History", title: "History - India and the Contemporary World I", link: "/pdfs/ncerts/NCERT-Class-9-History.pdf" },
  { class_name: "9", subject: "Geography", title: "Geography - Contemporary India I", link: "/pdfs/ncerts/NCERT-Class-9-Geography.pdf" },
  { class_name: "9", subject: "Economics", title: "Economics", link: "/pdfs/ncerts/NCERT-Class-9-Economics.pdf" },
  { class_name: "9", subject: "Polity", title: "Polity - Democratic Politics I", link: "/pdfs/ncerts/NCERT-Class-9-Political-Science.pdf" },

  { class_name: "10", subject: "History", title: "History - India and the Contemporary World II", link: "/pdfs/ncerts/NCERT-Class-10-History.pdf" },
  { class_name: "10", subject: "Geography", title: "Geography - Contemporary India II", link: "/pdfs/ncerts/NCERT-Class-10-Geography.pdf" },
  { class_name: "10", subject: "Economics", title: "Economics - Understanding Economic Development", link: "/pdfs/ncerts/NCERT-Class-10-Economics.pdf" },
  { class_name: "10", subject: "Polity", title: "Democratic Politics II", link: "/pdfs/ncerts/NCERT-Class-10-Political-Science.pdf" },

  { class_name: "11", subject: "World History", title: "Themes in World History", link: "/pdfs/ncerts/NCERT_CLASS_11_HISTORY_THEMES_IN_WORLD_HISTORY.pdf" },
  { class_name: "11", subject: "Geography", title: "Fundamentals of Physical Geography", link: "/pdfs/ncerts/NCERT_CLASS_11_GEOGRAPHY_INDIAN_PHYSICAL_ENVIRONMENT.pdf" },
  { class_name: "11", subject: "Indian Society", title: "Sociology - Understanding Society", link: "/pdfs/ncerts/NCERT_CLASS_11_SOCIOLOGY_UNDERSTANDING_SOCIETY.pdf" },
  { class_name: "11", subject: "Polity", title: "Political Theory", link: "/pdfs/ncerts/NCERT_CLASS_11_POLITICAL_SCIENCE_POLITICAL_THEORY.pdf" },
  { class_name: "11", subject: "Polity", title: "Political science - Indian consitution", link: "/pdfs/ncerts/NCERT_CLASS_11_POLITICAL_SCIENCE_INDIAN_CONSTITUTION_AT_WORK.pdf" },
  { class_name: "11", subject: "Economics", title: "Indian Economic Development", link: "/pdfs/ncerts/NCERT_CLASS_11_ECONOMICS_INDIAN_ECONOMIC_DEVELOPMENT.pdf" },

  { class_name: "12", subject: "History", title: "Themes in Indian History I", link: "/pdfs/ncerts/NCERT_CLASS_12_HISTORY_THEMES_IN_INDIAN_HISTORY_1.pdf" },
  { class_name: "12", subject: "History", title: "Themes in Indian History II", link: "/pdfs/ncerts/NCERT_CLASS_12_HISTORY_THEMES_IN_INDIAN_HISTORY_2.pdf" },
  { class_name: "12", subject: "History", title: "Themes in Indian History III", link: "/pdfs/ncerts/NCERT_CLASS_12_HISTORY_THEMES_IN_INDIAN_HISTORY_3.pdf" },
  { class_name: "12", subject: "Geography", title: "Geography fundamentals of human grography", link: "/pdfs/ncerts/NCERT_CLASS_12_GEOGRAPHY_FUNDAMENTALS_OF_HUMAN_GEOGRAPHY.pdf" },
  { class_name: "12", subject: "Geography", title: "Geography of India, people and economy", link: "/pdfs/ncerts/NCERT_CLASS_12_GEOGRAPHY_INDIA_PEOPLE_AND_ECONOMY.pdf" },
  { class_name: "12", subject: "Polity", title: "Politics in India Since Independence", link: "/pdfs/ncerts/NCERT_CLASS_12_POLITICAL_SCIENCE_POLITICS_IN_INDIA_SINCE_INDEPENDENCE.pdf" },
  { class_name: "12", subject: "Polity", title: "Political science - contemporary world politics", link: "/pdfs/ncerts/NCERT_CLASS_12_POLITICAL_SCIENCE_CONTEMPORARY_WORLD_POLITICS.pdf" },
  { class_name: "12", subject: "Economics", title: "Introductory Macroeconomics", link: "/pdfs/ncerts/NCERT_CLASS_12_ECONOMICS_MACROECONOMICS.pdf" },
  { class_name: "12", subject: "Economics", title: "Introductory Microeconomics", link: "/pdfs/ncerts/NCERT_CLASS_12_ECONOMICS_MICROECONOMICS.pdf" },
  { class_name: "12", subject: "Sociology", title: "Indian society", link: "/pdfs/ncerts/NCERT_CLASS_12_SOCIOLOGY_INDIAN_SOCIETY.pdf" },
  { class_name: "12", subject: "Sociology", title: "Indian society", link: "/pdfs/ncerts/NCERT_CLASS_12_SOCIOLOGY_SOCIAL_CHANGE_AND_DEVELOPMENT_IN_INDIA.pdf" }
];

const standardBooksData = [
  {
    subject: "History",
    title: "Modern India (Bipin Chandra Old NCERT)",
    author: "Bipin Chandra",
    link: "/pdfs/standard_books/modern_india_bipin_chandra_old_ncert.pdf"
  },
  {
    subject: "History",
    title: "Ancient India",
    author: "RS Sharma",
    link: "/pdfs/standard_books/ancient_india_rs_sharma.pdf"
  }
];

let uploadedNotes = [];

async function fetchCurrentAffairs() {
  try {
    const key = GNEWS_API_KEY || "";
    console.log("Fetching GNews with key prefix:", key.substring(0, 6));

    const response = await axios.get("https://gnews.io/api/v4/top-headlines", {
      params: {
        category: "general",
        lang: "en",
        country: "in",
        max: 10,
        apikey: GNEWS_API_KEY
      }
    });

    const articles = response.data.articles || [];
    const mapped = [];

    for (const item of articles) {
      const formattedDate = item.publishedAt
        ? new Date(item.publishedAt).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "long",
            year: "numeric"
          })
        : "Latest";

      const rawDate = item.publishedAt ? new Date(item.publishedAt) : new Date();
      const content = item.description || item.content || "No content available.";

      const analysis = generateAnalysis(item);

      const articleObj = {
        heading: item.title || "Untitled",
        source: item.source?.name || "News Source",
        date: formattedDate,
        rawDate,
        content,
        analysis,
        link: item.url || "#"
      };

      mapped.push(articleObj);

      try {
        await pool.query(
          `INSERT INTO current_affairs (title, source, date, content, analysis, link)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (link) DO NOTHING`,
          [
            articleObj.heading,
            articleObj.source,
            articleObj.rawDate,
            articleObj.content,
            articleObj.analysis,
            articleObj.link
          ]
        );
      } catch (dbErr) {
        console.error("DB insert skipped for current affair:", dbErr.message);
      }
    }

    return mapped;
  } catch (error) {
    console.error("Error fetching current affairs:");
    console.error("Status:", error.response?.status);
    console.error("Data:", error.response?.data);
    console.error("Message:", error.message);
    return [];
  }
}

async function generateUPSCAnalysis(title, content) {
  if (!openai) {
    throw new Error("OpenAI client not configured");
  }

  const prompt = `
Explain this news like a UPSC topper.

Title: ${title}

Content: ${content}

Give output in this format:

Why in News:
Background:
Key Points:
UPSC Relevance:
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }]
  });

  return response.choices[0].message.content.trim();
}

function generateAnalysis(item) {
  let text = item.content || item.description || "";

  text = text.replace(/\[[^\]]*\]/g, "").trim();

  let sentences = text.split(". ").slice(0, 3).join(". ");

  if (!sentences || sentences.length < 20) {
    sentences = item.description || "Detailed analysis not available.";
  }

  return `${sentences}.

Why in News:
${item.title}

Source:
${item.source?.name || "News"}

UPSC Relevance:
Important for GS Papers depending on the topic.`;
}

//=============Resources=====================
app.get("/resources", checkAuth, async (req, res) => {
  const email = req.session.email;
  if (!email) return res.redirect("/login");

  try {
    const userDetails = await pool.query(
      "SELECT first_name FROM details WHERE email = $1",
      [email]
    );

    const userName = userDetails.rows[0]?.first_name || "Aspirant";

    let currentAffairs = await fetchCurrentAffairs();

    if (!currentAffairs || currentAffairs.length === 0) {
      try {
        const result = await pool.query(
          "SELECT * FROM current_affairs ORDER BY date DESC LIMIT 10"
        );

        currentAffairs = result.rows.map((row) => ({
          heading: row.title,
          source: row.source,
          date: row.date
            ? new Date(row.date).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "long",
                year: "numeric"
              })
            : "Latest",
          analysis: row.analysis || "No analysis available.",
          link: row.link || "#"
        }));
      } catch (dbErr) {
        console.error("Error reading current affairs from DB:", dbErr.message);
        currentAffairs = [];
      }
    }

    res.render("resources", {
      email,
      userName,
      currentPage: "resources",
      ncerts: ncertsData,
      standardBooks: standardBooksData,
      currentAffairs: currentAffairs || [],
      uploadedNotes
    });
  } catch (err) {
    console.error("Error loading resources page:", err);
    res.send("Error loading resources page");
  }
});

app.post("/save-notification-preference", checkAuth, async (req, res) => {
  const email = req.session.email;

  if (!email) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const { enableNotifications } = req.body;

    await pool.query(
      `UPDATE details
       SET email_notifications = $1,
           notification_popup_shown = TRUE
       WHERE email = $2`,
      [enableNotifications === true || enableNotifications === "true", email]
    );

    if (enableNotifications === true || enableNotifications === "true") {
      const userResult = await pool.query(
        `SELECT first_name, last_essay_topic_index, last_essay_sent_date
         FROM details
         WHERE email = $1`,
        [email]
      );

      const user = userResult.rows[0];
      const firstName = user?.first_name || "Aspirant";
      const today = new Date().toISOString().split("T")[0];

      let topicIndex;
      let topic;

      if (
        user?.last_essay_sent_date &&
        new Date(user.last_essay_sent_date).toISOString().split("T")[0] === today &&
        user.last_essay_topic_index >= 0
      ) {
        topicIndex = user.last_essay_topic_index;
      } else {
        topicIndex = (user?.last_essay_topic_index ?? -1) + 1;

        if (topicIndex >= essayTopics.length) {
          topicIndex = 0;
        }

        await pool.query(
          `UPDATE details
           SET last_essay_topic_index = $1,
               last_essay_sent_date = CURRENT_DATE
           WHERE email = $2`,
          [topicIndex, email]
        );
      }

      topic = essayTopics[topicIndex];

      await transporter.sendMail({
        from: EMAIL_USER,
        to: email,
        subject: "Your Daily UPSC Essay Topic",
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>Hello ${firstName},</h2>
            <p>Notifications have been enabled successfully.</p>
            <p>Here is your essay topic for today:</p>
            <div style="padding: 12px; background: #f4f7fb; border-left: 4px solid #1d4ed8; margin: 12px 0;">
              <strong>${topic}</strong>
            </div>
            <p>Write consistently and keep improving every day.</p>
            <p>Best wishes,<br>UPSC Tracker</p>
          </div>
        `
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving notification preference:", err);
    res.status(500).json({ success: false });
  }
});

cron.schedule("0 7 * * *", async () => {
  try {
    console.log("Running daily essay notification job...");

    const usersResult = await pool.query(
      `SELECT email, first_name
       FROM details
       WHERE email_notifications = TRUE`
    );

    for (const user of usersResult.rows) {
      try {
        const topic = await getNextEssayTopic(user.email);

        if (!topic) continue;

        await transporter.sendMail({
          from: EMAIL_USER,
          to: user.email,
          subject: "Your Daily UPSC Essay Topic",
          html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
              <h2>Hello ${user.first_name || "Aspirant"},</h2>
              <p>Here is your essay topic for today:</p>
              <div style="padding: 12px; background: #f4f7fb; border-left: 4px solid #1d4ed8; margin: 12px 0;">
                <strong>${topic}</strong>
              </div>
              <p>Stay consistent with your UPSC preparation.</p>
              <p>Best wishes,<br>UPSC Tracker</p>
            </div>
          `
        });

        console.log(`Essay email sent to ${user.email}`);
      } catch (userErr) {
        console.error(`Failed for ${user.email}:`, userErr.message);
      }
    }
  } catch (err) {
    console.error("Daily essay cron error:", err);
  }
});

app.get("/auth/google", checkAuth, (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: CALENDAR_SCOPES,
    prompt: "consent"
  });

  res.redirect(authUrl);
});

app.get("/auth/google/callback", checkAuth, async (req, res) => {
  const email = req.session.email;

  if (!email) {
    return res.redirect("/login");
  }

  try {
    const { code } = req.query;

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    console.log("Google tokens received:", tokens);

    await pool.query(
      `UPDATE details
       SET google_access_token = $1,
           google_refresh_token = COALESCE($2, google_refresh_token),
           google_token_expiry = $3
       WHERE email = $4`,
      [
        tokens.access_token || null,
        tokens.refresh_token || null,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        email
      ]
    );

    res.redirect("/study-planner");
  } catch (err) {
    console.error("Google callback error:", err);
    res.send("Failed to connect Google Calendar");
  }
});

//==================SETTINGS=================
app.get("/settings/data", checkAuth, async (req, res) => {
  try {
    const email = req.session.email;

    const result = await pool.query(
      `SELECT email_notifications, language, optional
       FROM details
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.json({
        notifications_enabled: true,
        language: "English",
        optional_subject: ""
      });
    }

    res.json({
      notifications_enabled: result.rows[0].email_notifications ?? true,
      language: result.rows[0].language || "English",
      optional_subject: result.rows[0].optional || ""
    });
  } catch (err) {
    console.error("Error fetching settings:", err);
    res.status(500).json({ success: false, message: "Unable to fetch settings" });
  }
});

app.post("/settings/save", checkAuth, async (req, res) => {
  try {
    const email = req.session.email;
    const { notifications_enabled, language, optional_subject } = req.body;

    await pool.query(
      `UPDATE details
       SET email_notifications = $1,
           language = $2,
           optional = $3
       WHERE email = $4`,
      [notifications_enabled, language, optional_subject, email]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving settings:", err);
    res.status(500).json({ success: false, message: "Unable to save settings" });
  }
});

// ================= SERVER =================
const APP_PORT = PORT || 3000;

app.listen(APP_PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${APP_PORT}`);
});