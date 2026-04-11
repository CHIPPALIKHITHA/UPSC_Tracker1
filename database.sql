-- =========================================
-- UPSC TRACKER DATABASE SETUP (PostgreSQL)
-- CLEANED VERSION - DUPLICATES REMOVED
-- =========================================

-- Optional
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================
-- 1. USERS
-- =========================================
CREATE TABLE IF NOT EXISTS users (
    mail VARCHAR(255) PRIMARY KEY,
    password TEXT NOT NULL
);

-- =========================================
-- 2. DETAILS
-- =========================================
CREATE TABLE IF NOT EXISTS details (
    email VARCHAR(255) PRIMARY KEY,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    gender VARCHAR(20),
    contact_number VARCHAR(20),
    state VARCHAR(100),
    city VARCHAR(100),
    father_name VARCHAR(100),
    mother_name VARCHAR(100),
    disabilities TEXT,
    language VARCHAR(50) DEFAULT 'English',
    optional VARCHAR(100),

    email_notifications BOOLEAN DEFAULT FALSE,
    notification_popup_shown BOOLEAN DEFAULT FALSE,

    google_access_token TEXT,
    google_refresh_token TEXT,
    google_token_expiry TIMESTAMP,

    last_essay_topic_index INTEGER DEFAULT -1,
    last_essay_sent_date DATE,

    CONSTRAINT fk_details_user
        FOREIGN KEY (email)
        REFERENCES users(mail)
        ON DELETE CASCADE
);

-- =========================================
-- 3. MOTIVATIONAL QUOTES
-- =========================================
CREATE TABLE IF NOT EXISTS motivational_quotes (
    id SERIAL PRIMARY KEY,
    quote TEXT NOT NULL
);

-- =========================================
-- 4. PRELIMS TOPICS
-- =========================================
CREATE TABLE IF NOT EXISTS prelim_topics (
    id SERIAL PRIMARY KEY,
    paper VARCHAR(50) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    topic TEXT NOT NULL
);

-- =========================================
-- 5. MAINS TOPICS
-- =========================================
CREATE TABLE IF NOT EXISTS mains_topics (
    id SERIAL PRIMARY KEY,
    paper VARCHAR(50) NOT NULL,
    section_no INTEGER,
    section_name VARCHAR(255),
    topic TEXT NOT NULL,
    subtopic TEXT
);

-- =========================================
-- 6. SYLLABUS PROGRESS
-- =========================================
CREATE TABLE IF NOT EXISTS syllabus_progress (
    email VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,
    paper VARCHAR(100) NOT NULL,
    topic TEXT NOT NULL,
    completed BOOLEAN DEFAULT FALSE,

    PRIMARY KEY (email, category, paper, topic),

    CONSTRAINT fk_syllabus_progress_user
        FOREIGN KEY (email)
        REFERENCES users(mail)
        ON DELETE CASCADE
);

-- =========================================
-- 7. STUDY PLANNER TASKS
-- =========================================
CREATE TABLE IF NOT EXISTS study_planner_tasks (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    task_date DATE NOT NULL,
    task_text TEXT NOT NULL,
    subject VARCHAR(255) NOT NULL,
    topic TEXT NOT NULL,
    resource_text TEXT,
    resource_link TEXT,
    resource_file_name TEXT,
    start_time TIME,
    end_time TIME,
    color VARCHAR(20) DEFAULT '#2563eb',
    done BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_study_planner_user
        FOREIGN KEY (email)
        REFERENCES users(mail)
        ON DELETE CASCADE
);

-- =========================================
-- 8. STUDY DAY LOGS
-- =========================================
CREATE TABLE IF NOT EXISTS study_day_logs (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    log_date DATE NOT NULL,
    study_hours NUMERIC(4,1) DEFAULT 0,

    CONSTRAINT uq_study_day_logs UNIQUE (email, log_date),

    CONSTRAINT fk_study_day_logs_user
        FOREIGN KEY (email)
        REFERENCES users(mail)
        ON DELETE CASCADE
);

-- =========================================
-- 9. STUDY LOG
-- =========================================
CREATE TABLE IF NOT EXISTS study_log (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    study_hours NUMERIC(4,1) DEFAULT 0,
    topics_completed INTEGER DEFAULT 0,

    CONSTRAINT uq_study_log UNIQUE (email, date),

    CONSTRAINT fk_study_log_user
        FOREIGN KEY (email)
        REFERENCES users(mail)
        ON DELETE CASCADE
);

-- =========================================
-- 10. CURRENT AFFAIRS
-- =========================================
CREATE TABLE IF NOT EXISTS current_affairs (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    source VARCHAR(255),
    date DATE,
    content TEXT,
    analysis TEXT,
    link TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================
-- 11. SUBJECTS (legacy / compatibility)
-- =========================================
CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    subject_name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT
);

-- =========================================
-- 12. SYLLABUS (legacy / compatibility)
-- =========================================
CREATE TABLE IF NOT EXISTS syllabus (
    id SERIAL PRIMARY KEY,
    subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
    exam_stage VARCHAR(50),
    paper VARCHAR(100),
    topic TEXT NOT NULL,
    subtopic TEXT
);

-- =========================================
-- 13. DAILY TARGETS (legacy / compatibility)
-- =========================================
CREATE TABLE IF NOT EXISTS daily_targets (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    target_date DATE NOT NULL,
    target_text TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_daily_targets_user
        FOREIGN KEY (email)
        REFERENCES users(mail)
        ON DELETE CASCADE
);

-- =========================================
-- INDEXES
-- =========================================
CREATE INDEX IF NOT EXISTS idx_details_email ON details(email);
CREATE INDEX IF NOT EXISTS idx_prelim_topics_paper ON prelim_topics(paper);
CREATE INDEX IF NOT EXISTS idx_mains_topics_paper ON mains_topics(paper);
CREATE INDEX IF NOT EXISTS idx_study_planner_tasks_email_date ON study_planner_tasks(email, task_date);
CREATE INDEX IF NOT EXISTS idx_study_day_logs_email_date ON study_day_logs(email, log_date);
CREATE INDEX IF NOT EXISTS idx_study_log_email_date ON study_log(email, date);
CREATE INDEX IF NOT EXISTS idx_current_affairs_date ON current_affairs(date);

-- =========================================
-- SAMPLE MOTIVATIONAL QUOTES
-- =========================================
INSERT INTO motivational_quotes (quote)
VALUES
('Success is the sum of small efforts, repeated day in and day out.'),
('Push yourself, because no one else is going to do it for you.'),
('Dream big. Start small. Act now.'),
('Consistency is what transforms average into excellence.'),
('Discipline today leads to success tomorrow.')
ON CONFLICT DO NOTHING;

-- =========================================
-- SAMPLE SUBJECTS
-- =========================================
INSERT INTO subjects (subject_name, description)
VALUES
('History', 'History for UPSC preparation'),
('Geography', 'Geography for UPSC preparation'),
('Polity', 'Polity for UPSC preparation'),
('Economy', 'Economy for UPSC preparation'),
('Environment', 'Environment for UPSC preparation'),
('Ethics', 'Ethics for UPSC preparation')
ON CONFLICT (subject_name) DO NOTHING;

-- =========================================
-- SAMPLE PRELIMS TOPICS
-- =========================================
INSERT INTO prelim_topics (paper, subject, topic) VALUES
('Paper 1', 'History', 'History of India'),
('Paper 1', 'History', 'Indian National Movement'),
('Paper 1', 'Geography', 'Indian Geography'),
('Paper 1', 'Geography', 'World Geography'),
('Paper 1', 'Polity', 'Indian Constitution'),
('Paper 1', 'Polity', 'Political System'),
('Paper 1', 'Polity', 'Panchayati Raj'),
('Paper 1', 'Economy', 'Sustainable Development'),
('Paper 1', 'Economy', 'Poverty'),
('Paper 1', 'Environment', 'Biodiversity'),
('Paper 1', 'Science', 'General Science'),
('Paper 2', 'CSAT', 'Comprehension'),
('Paper 2', 'CSAT', 'Logical Reasoning'),
('Paper 2', 'CSAT', 'Decision Making'),
('Paper 2', 'CSAT', 'General Mental Ability'),
('Paper 2', 'CSAT', 'Basic Numeracy')
ON CONFLICT DO NOTHING;

-- =========================================
-- SAMPLE MAINS TOPICS
-- =========================================
INSERT INTO mains_topics (paper, section_no, section_name, topic, subtopic) VALUES

-- =========================
-- GS I
-- =========================
('GS I', 1, 'Indian Heritage and Culture', 'Art Forms', 'Classical dances of India'),
('GS I', 1, 'Indian Heritage and Culture', 'Art Forms', 'Indian music traditions'),
('GS I', 1, 'Indian Heritage and Culture', 'Literature', 'Ancient to modern Indian literature'),
('GS I', 1, 'Indian Heritage and Culture', 'Architecture', 'Temple, Mughal and colonial architecture'),

('GS I', 2, 'History', 'Modern Indian History', 'Significant events from 18th century onwards'),
('GS I', 2, 'History', 'Freedom Struggle', 'Important stages and leaders'),
('GS I', 2, 'History', 'Post Independence', 'Consolidation and reorganization of India'),

('GS I', 3, 'World History', 'Major Events', 'Industrial Revolution'),
('GS I', 3, 'World History', 'Major Events', 'World Wars'),
('GS I', 3, 'World History', 'Political Philosophies', 'Capitalism'),
('GS I', 3, 'World History', 'Political Philosophies', 'Socialism'),
('GS I', 3, 'World History', 'Political Philosophies', 'Communism'),

('GS I', 4, 'Society', 'Indian Society', 'Diversity of India'),
('GS I', 4, 'Society', 'Social Issues', 'Women and women organizations'),
('GS I', 4, 'Society', 'Social Issues', 'Population and poverty'),
('GS I', 4, 'Society', 'Social Issues', 'Urbanization and problems'),
('GS I', 4, 'Society', 'Social Issues', 'Globalization impact'),
('GS I', 4, 'Society', 'Social Issues', 'Communalism and secularism'),

('GS I', 5, 'Geography', 'Physical Geography', 'World physical geography'),
('GS I', 5, 'Geography', 'Resources', 'Natural resources distribution'),
('GS I', 5, 'Geography', 'Geophysical Phenomena', 'Earthquakes'),
('GS I', 5, 'Geography', 'Geophysical Phenomena', 'Cyclones'),
('GS I', 5, 'Geography', 'Geophysical Phenomena', 'Tsunami'),

-- =========================
-- GS II
-- =========================
('GS II', 1, 'Constitution', 'Indian Constitution', 'Historical background'),
('GS II', 1, 'Constitution', 'Indian Constitution', 'Features and amendments'),
('GS II', 1, 'Constitution', 'Indian Constitution', 'Basic structure'),

('GS II', 2, 'Polity', 'Federal Structure', 'Union and State relations'),
('GS II', 2, 'Polity', 'Parliament', 'Structure and functioning'),
('GS II', 2, 'Polity', 'Judiciary', 'Structure and powers'),
('GS II', 2, 'Polity', 'Representation', 'Representation of People Act'),

('GS II', 3, 'Governance', 'Constitutional Bodies', 'Election Commission'),
('GS II', 3, 'Governance', 'Constitutional Bodies', 'Finance Commission'),
('GS II', 3, 'Governance', 'Policies', 'Government schemes'),
('GS II', 3, 'Governance', 'Governance', 'Transparency and accountability'),
('GS II', 3, 'Governance', 'Governance', 'E-governance'),

('GS II', 4, 'Social Justice', 'Welfare Schemes', 'Schemes for vulnerable sections'),
('GS II', 4, 'Social Justice', 'Development Issues', 'Health'),
('GS II', 4, 'Social Justice', 'Development Issues', 'Education'),
('GS II', 4, 'Social Justice', 'Development Issues', 'Poverty and hunger'),

('GS II', 5, 'International Relations', 'India and Neighbours', 'Bilateral relations'),
('GS II', 5, 'International Relations', 'Global Institutions', 'UN and other agencies'),

-- =========================
-- GS III
-- =========================
('GS III', 1, 'Economic Development', 'Indian Economy', 'Planning and growth'),
('GS III', 1, 'Economic Development', 'Indian Economy', 'Employment'),
('GS III', 1, 'Economic Development', 'Inclusive Growth', 'Inclusive development'),
('GS III', 1, 'Economic Development', 'Budgeting', 'Government budgeting'),

('GS III', 2, 'Agriculture', 'Cropping Patterns', 'Major crops'),
('GS III', 2, 'Agriculture', 'Irrigation', 'Irrigation systems'),
('GS III', 2, 'Agriculture', 'Food Security', 'PDS and buffer stocks'),
('GS III', 2, 'Agriculture', 'Land Reforms', 'Land reforms in India'),

('GS III', 3, 'Infrastructure', 'Infrastructure', 'Energy'),
('GS III', 3, 'Infrastructure', 'Infrastructure', 'Roads'),
('GS III', 3, 'Infrastructure', 'Infrastructure', 'Railways'),
('GS III', 3, 'Infrastructure', 'Infrastructure', 'Ports and airports'),

('GS III', 4, 'Science and Technology', 'Technology', 'IT and computers'),
('GS III', 4, 'Science and Technology', 'Technology', 'Robotics'),
('GS III', 4, 'Science and Technology', 'Technology', 'Biotechnology'),
('GS III', 4, 'Science and Technology', 'Technology', 'Space technology'),

('GS III', 5, 'Environment', 'Environmental Issues', 'Pollution'),
('GS III', 5, 'Environment', 'Environmental Issues', 'Biodiversity'),
('GS III', 5, 'Environment', 'Environmental Issues', 'Climate change'),

('GS III', 6, 'Disaster Management', 'Disasters', 'Natural disasters'),
('GS III', 6, 'Disaster Management', 'Disasters', 'Disaster response'),

('GS III', 7, 'Internal Security', 'Security Challenges', 'Cyber security'),
('GS III', 7, 'Internal Security', 'Security Challenges', 'Terrorism'),
('GS III', 7, 'Internal Security', 'Security Challenges', 'Border management'),

-- =========================
-- GS IV
-- =========================
('GS IV', 1, 'Ethics', 'Ethics and Human Interface', 'Dimensions of ethics'),
('GS IV', 1, 'Ethics', 'Human Values', 'Values from leaders and reformers'),

('GS IV', 2, 'Attitude', 'Attitude', 'Structure and function'),
('GS IV', 2, 'Attitude', 'Attitude', 'Moral attitudes'),

('GS IV', 3, 'Aptitude', 'Civil Services Aptitude', 'Integrity'),
('GS IV', 3, 'Aptitude', 'Civil Services Aptitude', 'Impartiality'),
('GS IV', 3, 'Aptitude', 'Civil Services Aptitude', 'Empathy'),

('GS IV', 4, 'Integrity', 'Public Administration', 'Ethics in governance'),
('GS IV', 4, 'Integrity', 'Public Administration', 'Probity in governance'),
('GS IV', 4, 'Integrity', 'Public Administration', 'Citizen charter'),

('GS IV', 5, 'Case Studies', 'Practical Ethics', 'Case study practice');