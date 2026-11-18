const crypto = require('node:crypto');

const COOKIE_NAME = 'barbearia_admin_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SCRYPT_BYTES = 64;

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function constantTimeStringEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function isStrongSecret(value) {
  const secret = String(value || '').trim();
  if (secret.length < 32 || new Set(secret).size < 8) return false;
  return !/^(?:troque|change[-_ ]?me|replace|example|default|your[-_ ])/i.test(secret);
}

function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { result[name] = decodeURIComponent(value); } catch (_) {}
  }
  return result;
}

function makeCookieValue(rawToken, secret) {
  const signature = crypto.createHmac('sha256', secret).update(rawToken).digest('base64url');
  return `${rawToken}.${signature}`;
}

function cookieOptions(isProduction) {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${isProduction ? '; Secure' : ''}`;
}

function createAuth(db, env = process.env) {
  const secret = String(env.ADMIN_SESSION_SECRET || 'development-only-change-me').trim();
  const isProduction = env.NODE_ENV === 'production';
  if (isProduction && !isStrongSecret(env.ADMIN_SETUP_TOKEN)) throw new Error('Configure ADMIN_SETUP_TOKEN com pelo menos 32 caracteres aleatórios e sem valor de exemplo para produção.');
  if (isProduction && !isStrongSecret(secret)) throw new Error('Configure ADMIN_SESSION_SECRET com pelo menos 32 caracteres aleatórios e sem valor de exemplo para produção.');

  function hasAdmin() {
    return Boolean(db.get('SELECT id FROM admins LIMIT 1'));
  }

  function setupAvailable() {
    return !hasAdmin() && isStrongSecret(env.ADMIN_SETUP_TOKEN);
  }

  function setSessionCookie(response, cookieValue) {
    response.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(cookieValue)}; ${cookieOptions(isProduction)}`);
  }

  function clearSessionCookie(response) {
    response.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProduction ? '; Secure' : ''}`);
  }

  function createSession(adminId) {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    db.run(
      'INSERT INTO admin_sessions (token_hash, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      [digest(rawToken), adminId, expiresAt, new Date().toISOString()]
    );
    return makeCookieValue(rawToken, secret);
  }

  function setupAdmin({ setupToken, email, name, password }) {
    const expected = String(env.ADMIN_SETUP_TOKEN || '').trim();
    if (!isStrongSecret(expected) || !constantTimeStringEqual(setupToken, expected)) {
      const error = new Error('Token de configuração inválido.');
      error.status = 403;
      throw error;
    }
    if (hasAdmin()) {
      const error = new Error('A conta de administrador já foi criada.');
      error.status = 409;
      throw error;
    }
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(name || '').trim();
    const cleanPassword = String(password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanName.length < 2 || cleanName.length > 80) {
      const error = new Error('Informe nome e e-mail válidos.');
      error.status = 400;
      throw error;
    }
    if (cleanPassword.length < 12 || cleanPassword.length > 200) {
      const error = new Error('A senha precisa ter entre 12 e 200 caracteres.');
      error.status = 400;
      throw error;
    }
    const id = crypto.randomUUID();
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(cleanPassword, salt, SCRYPT_BYTES);
    db.transaction((tx) => {
      if (tx.get('SELECT id FROM admins LIMIT 1')) {
        const error = new Error('A conta de administrador já foi criada.');
        error.status = 409;
        throw error;
      }
      tx.run('INSERT INTO admins (id,name,email,salt,password_hash,created_at) VALUES (?,?,?,?,?,?)', [
        id, cleanName, cleanEmail, salt.toString('hex'), hash.toString('hex'), new Date().toISOString()
      ]);
    });
    return { admin: { id, name: cleanName, email: cleanEmail }, cookieValue: createSession(id) };
  }

  function login({ email, password }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');
    const admin = db.get('SELECT id,name,email,salt,password_hash FROM admins WHERE email = ?', [cleanEmail]);
    const salt = admin ? Buffer.from(admin.salt, 'hex') : Buffer.alloc(16, 1);
    const expectedHash = admin ? Buffer.from(admin.password_hash, 'hex') : Buffer.alloc(SCRYPT_BYTES, 1);
    const suppliedHash = crypto.scryptSync(cleanPassword, salt, SCRYPT_BYTES);
    const valid = admin && expectedHash.length === suppliedHash.length && crypto.timingSafeEqual(expectedHash, suppliedHash);
    if (!valid) {
      const error = new Error('E-mail ou senha não conferem.');
      error.status = 401;
      throw error;
    }
    return {
      admin: { id: admin.id, name: admin.name, email: admin.email },
      cookieValue: createSession(admin.id)
    };
  }

  function resolveSession(cookieValue) {
    if (!cookieValue) return null;
    const splitAt = cookieValue.lastIndexOf('.');
    if (splitAt < 1) return null;
    const rawToken = cookieValue.slice(0, splitAt);
    const signature = cookieValue.slice(splitAt + 1);
    const expected = crypto.createHmac('sha256', secret).update(rawToken).digest('base64url');
    if (!constantTimeStringEqual(signature, expected)) return null;
    const row = db.get(
      `SELECT a.id,a.name,a.email,s.token_hash FROM admin_sessions s
       JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ?`,
      [digest(rawToken), Math.floor(Date.now() / 1000)]
    );
    return row ? { id: row.id, name: row.name, email: row.email, tokenHash: row.token_hash } : null;
  }

  function middleware(request, response, next) {
    const cookieValue = parseCookies(request.headers.cookie)[COOKIE_NAME];
    request.admin = resolveSession(cookieValue);
    if (!request.admin) return response.status(401).json({ error: 'Entre na área administrativa.' });
    return next();
  }

  function logout(request, response) {
    const cookieValue = parseCookies(request.headers.cookie)[COOKIE_NAME];
    const admin = resolveSession(cookieValue);
    if (admin) db.run('DELETE FROM admin_sessions WHERE token_hash = ?', [admin.tokenHash]);
    clearSessionCookie(response);
  }

  function cleanupExpiredSessions() {
    db.run('DELETE FROM admin_sessions WHERE expires_at <= ?', [Math.floor(Date.now() / 1000)]);
  }

  return { hasAdmin, setupAvailable, setupAdmin, login, middleware, resolveSession, setSessionCookie, clearSessionCookie, logout, cleanupExpiredSessions };
}

module.exports = { createAuth, parseCookies, constantTimeStringEqual, isStrongSecret, COOKIE_NAME };
