CREATE TABLE subjects (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255),
  subject_name VARCHAR(100),
  completion_percentage INT DEFAULT 0
);