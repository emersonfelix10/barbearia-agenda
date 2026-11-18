require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { DateTime } = require('luxon');
const { openDatabase } = require('./database');
const { createAuth, parseCookies, COOKIE_NAME } = require('./auth');
const {
  BookingError,
  listAvailability,
  createAppointment,
  getAdminAppointments,
  updateAppointmentStatus
} = require('./appointments');
const {
  isConfigured,
  verifySignature,
  verifyWebhookChallenge,
  handleWebhookPayload
} = require('./whatsapp');
const { createScheduler } = require('./scheduler');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SITE_CONFIG_PATH = path.join(ROOT, 'config', 'site.json');
const DEFAULT_THEME = { ink: '#17191b', paper: '#f4efe7', accent: '#c66e43', accentDark: '#a8522e', sage: '#52634f' };

function themeCss(site) {
  const configured = site.colors || {};
  const color = (key) => /^#[0-9a-f]{6}$/i.test(String(configured[key] || '')) ? configured[key] : DEFAULT_THEME[key];
  return `:root{--ink:${color('ink')};--paper:${color('paper')};--copper:${color('accent')};--copper-dark:${color('accentDark')};--sage:${color('sage')}}\n`;
}

function loadSiteConfig(filePath = SITE_CONFIG_PATH) {
  const site = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!site.businessName || !site.timeZone || !Array.isArray(site.services) || !Array.isArray(site.barbers)) {
    throw new Error('config/site.json precisa conter businessName, timeZone, services e barbers.');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: site.timeZone }); }
  catch (_) { throw new Error('O fuso timeZone em config/site.json não é válido.'); }
  return site;
}

function publicSiteConfig(site, env = process.env) {
  const { ownerWhatsApp: _ownerNumber, ...publicSite } = site;
  return {
    ...publicSite,
    services: (site.services || []).filter((service) => service.active !== false),
    barbers: (site.barbers || []).filter((barber) => barber.active !== false),
    todayLocal: DateTime.now().setZone(site.timeZone).toFormat('yyyy-LL-dd'),
    whatsappConfigured: isConfigured(env, site)
  };
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    'frame-src https://www.google.com https://maps.google.com',
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  response.setHeader('X-DNS-Prefetch-Control', 'off');
  if (process.env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function sameOriginOnly(request, response, next) {
  const origin = request.get('origin');
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.host !== request.get('host')) return response.status(403).json({ error: 'Origem não autorizada.' });
    } catch (_) {
      return response.status(403).json({ error: 'Origem não autorizada.' });
    }
  }
  return next();
}

function createRateLimiter({ max = 10, windowMs = 60_000 } = {}) {
  const counters = new Map();
  return (request, response, next) => {
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = counters.get(key);
    if (!record || now - record.startedAt > windowMs) {
      counters.set(key, { startedAt: now, count: 1 });
      return next();
    }
    record.count += 1;
    if (record.count > max) {
      response.setHeader('Retry-After', String(Math.ceil((windowMs - (now - record.startedAt)) / 1000)));
      return response.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' });
    }
    if (counters.size > 5000) {
      for (const [address, item] of counters) if (now - item.startedAt > windowMs * 2) counters.delete(address);
    }
    return next();
  };
}

function buildRuntime({ db, site, env = process.env, fetchImpl = fetch, logger = console, wakeScheduler = () => {} } = {}) {
  const runtimeDb = db;
  const runtimeSite = site || loadSiteConfig();
  const auth = createAuth(runtimeDb, env);
  const app = express();
  if (env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((request, response, next) => { setSecurityHeaders(response); next(); });
  app.use((request, response, next) => {
    if (request.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store');
    next();
  });

  const loginLimiter = createRateLimiter({ max: 8, windowMs: 15 * 60_000 });
  const bookingLimiter = createRateLimiter({ max: 12, windowMs: 60 * 60_000 });
  const wakeNotifications = () => {
    if (typeof wakeScheduler !== 'function') return;
    setImmediate(() => { Promise.resolve().then(wakeScheduler).catch((error) => logger.error('Falha ao despertar notificações:', String(error?.message || 'erro interno'))); });
  };

  app.get('/api/health', (_request, response) => response.json({ ok: true, whatsappConfigured: isConfigured(env, runtimeSite) }));
  app.get('/api/site', (_request, response) => response.json(publicSiteConfig(runtimeSite, env)));
  app.get('/theme.css', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.type('text/css').send(themeCss(runtimeSite));
  });

  app.get('/api/availability', (request, response, next) => {
    try {
      const result = listAvailability({
        db: runtimeDb,
        config: runtimeSite,
        date: String(request.query.date || ''),
        serviceId: String(request.query.serviceId || ''),
        barberId: String(request.query.barberId || '')
      });
      response.json(result);
    } catch (error) { next(error); }
  });

  app.post('/api/appointments', sameOriginOnly, bookingLimiter, express.json({ limit: '12kb' }), (request, response, next) => {
    try {
      const appointment = createAppointment({ db: runtimeDb, config: runtimeSite, input: request.body || {} });
      wakeNotifications();
      response.status(201).json({
        appointment,
        message: 'Agendamento registrado. Confira o resumo e salve o horário.' ,
        whatsappConfigured: isConfigured(env, runtimeSite)
      });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/status', (request, response) => {
    const cookies = parseCookies(request.headers.cookie);
    const session = auth.resolveSession(cookies[COOKIE_NAME]);
    response.json({
      hasAdmin: auth.hasAdmin(),
      setupAvailable: auth.setupAvailable(),
      authenticated: Boolean(session),
      admin: session ? { name: session.name, email: session.email } : null,
      whatsappConfigured: isConfigured(env, runtimeSite)
    });
  });

  app.post('/api/admin/setup', sameOriginOnly, loginLimiter, express.json({ limit: '12kb' }), (request, response, next) => {
    try {
      const result = auth.setupAdmin(request.body || {});
      auth.setSessionCookie(response, result.cookieValue);
      response.status(201).json({ admin: result.admin });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/login', sameOriginOnly, loginLimiter, express.json({ limit: '12kb' }), (request, response, next) => {
    try {
      const result = auth.login(request.body || {});
      auth.setSessionCookie(response, result.cookieValue);
      response.json({ admin: result.admin });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/logout', sameOriginOnly, express.json({ limit: '2kb' }), (request, response) => {
    auth.logout(request, response);
    response.json({ ok: true });
  });

  app.get('/api/admin/appointments', auth.middleware, (request, response, next) => {
    try {
      const today = DateTime.now().setZone(runtimeSite.timeZone);
      const from = String(request.query.from || today.toFormat('yyyy-LL-dd'));
      const to = String(request.query.to || today.plus({ days: 7 }).toFormat('yyyy-LL-dd'));
      response.json({ appointments: getAdminAppointments({ db: runtimeDb, from, to }) });
    } catch (error) { next(error); }
  });

  app.patch('/api/admin/appointments/:id/status', sameOriginOnly, auth.middleware, express.json({ limit: '4kb' }), (request, response, next) => {
    try {
      const result = updateAppointmentStatus({ db: runtimeDb, config: runtimeSite, id: request.params.id, status: String(request.body?.status || '') });
      if (result.status === 'missed') wakeNotifications();
      response.json({ appointment: result });
    } catch (error) { next(error); }
  });

  app.get('/api/webhooks/whatsapp', (request, response) => {
    const challenge = verifyWebhookChallenge(request.query, env);
    if (challenge === null) return response.sendStatus(403);
    return response.status(200).type('text/plain').send(challenge);
  });

  app.post('/api/webhooks/whatsapp', express.raw({ type: 'application/json', limit: '256kb' }), (request, response) => {
    if (!verifySignature(request.body, request.get('x-hub-signature-256'), env.WHATSAPP_APP_SECRET)) return response.sendStatus(401);
    try {
      const payload = JSON.parse(request.body.toString('utf8'));
      const changes = handleWebhookPayload({ body: payload, db: runtimeDb, config: runtimeSite });
      return response.status(200).json({ received: true, applied: changes.length });
    } catch (error) {
      logger.error('Falha ao processar webhook WhatsApp:', String(error?.message || 'erro interno'));
      return response.sendStatus(400);
    }
  });

  app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: env.NODE_ENV === 'production' ? '1h' : 0, index: false }));
  app.get('/', (_request, response) => response.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  app.use((request, response, next) => {
    if (request.path.startsWith('/api/')) return response.status(404).json({ error: 'Rota não encontrada.' });
    return next();
  });

  app.use((error, _request, response, _next) => {
    if (response.headersSent) return;
    const status = Number(error.status || 500);
    const safeMessage = status < 500 ? error.message : 'Ocorreu um erro no servidor. Tente novamente.';
    if (status >= 500) logger.error('Erro interno:', String(error?.message || 'erro interno'));
    response.status(status).json({ error: safeMessage, code: error.code || 'request_error' });
  });

  return { app, auth, db: runtimeDb, site: runtimeSite };
}

async function start() {
  const site = loadSiteConfig();
  const db = await openDatabase({ dataDir: process.env.DATA_DIR || path.join(ROOT, 'data') });
  const scheduler = createScheduler({ db, config: site });
  const runtime = buildRuntime({ db, site, wakeScheduler: scheduler.tick });
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const server = runtime.app.listen(port, host, () => {
    console.log(`Barbearia agenda escutando em http://${host}:${port}`);
    if (!isConfigured(process.env, site)) console.log('WhatsApp automático aguardando configuração Meta.');
  });
  scheduler.start();
  const shutdown = () => {
    scheduler.stop();
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Não foi possível iniciar a agenda:', String(error?.message || 'erro interno'));
    process.exitCode = 1;
  });
}

module.exports = { buildRuntime, loadSiteConfig, publicSiteConfig, createRateLimiter };
