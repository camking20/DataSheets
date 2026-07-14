-- Email verification tokens for auth.register / auth.verifyEmail
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification_token text,
  ADD COLUMN IF NOT EXISTS email_verification_expires timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_verification_token_uidx
  ON users (email_verification_token)
  WHERE email_verification_token IS NOT NULL;
