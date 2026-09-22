ALTER TABLE captcha_challenges ADD COLUMN mode TEXT NOT NULL DEFAULT 'math';
ALTER TABLE captcha_challenges ADD COLUMN external_token TEXT;
ALTER TABLE captcha_challenges ADD COLUMN external_url TEXT;
