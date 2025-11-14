-- USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('admin','client') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- PHONE NUMBERS TABLE
CREATE TABLE IF NOT EXISTS phone_numbers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  phone VARCHAR(32) NOT NULL,
  added_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_phone (phone),
  INDEX idx_phone (phone),
  CONSTRAINT fk_added_by FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- CLIENT FILES TABLE
CREATE TABLE IF NOT EXISTS client_files (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  output_format ENUM('csv','xlsx') NOT NULL,
  output_path VARCHAR(255) NOT NULL,
  record_count INT DEFAULT 0,
  unmatched_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_client_files_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_created (user_id, created_at)
) ENGINE=InnoDB;

-- INSERT DEFAULT ADMIN (if not exists)
INSERT INTO users (email, password_hash, role)
SELECT 'admin@phoneDirectory.com',
       '$2b$10$AHqKqjqDuw5gRhf2xZo1V.BhWbskJDpQahAgHnWYXqpa7b8TxVlv6',
       'admin'
WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE email = 'admin@phoneDirectory.com'
);
