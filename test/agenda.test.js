const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DateTime } = require('luxon');
const { openDatabase } = require('../src/database');
const {
  listAvailability,
  normalizePhone,
  createAppointment,
  updateAppointmentStatus,
  markOverdueNoShows,
  applyQuickReply,
  BookingError
} = require('../src/appointments');
const { processOutbox } = require('../src/scheduler');
const { createAuth } = require('../src/auth');
const {
  makeTemplateComponents,
  sendOutboxMessage,
  verifySignature,
  verifyWebhookChallenge,
  handleWebhookPayload
} = require('../src/whatsapp');
const { buildRuntime } = require('../src/server');

const root = path.resolve(__dirname, '..');
const site = JSON.parse(fs.readFileSync(path.join(root, 'config/site.json'), 'utf8'));

async function withDb(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'barbearia-agenda-test-'));
  const db = await openDatabase({ dataDir });
  try { return await fn(db, dataDir); }
  finally { db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
}

function dateAt(daysAhead, time = '08:00') {
  const now = DateTime.now().setZone(site.timeZone).plus({ days: daysAhead }).startOf('day');
  for (let offset = 0; offset < 10; offset += 1) {
    const candidate = now.plus({ days: offset });
    const key = candidate.setLocale('en').toFormat('ccc').toLowerCase();
    if (site.hours[key]) return {
      date: candidate.toFormat('yyyy-LL-dd'),
      now: DateTime.fromISO(`${candidate.toFormat('yyyy-LL-dd')}T${time}`, { zone: site.timeZone })
    };
  }
  throw new Error('Não há dia aberto na configuração de teste.');
}

function bookingInput(date, overrides = {}) {
  return {
    clientName: 'Cliente de Teste',
    clientPhone: '11988887777',
    whatsappConsent: true,
    serviceId: 'corte',
    barberId: 'barbeiro-1',
    date,
    time: '10:00',
    ...overrides
  };
}

function slot(result, time) { return result.slots.find((item) => item.time === time); }

test('normalização de telefone brasileiro aceita DDD e prefixo de operadora', () => {
  const expected = '5585999999999';
  assert.equal(normalizePhone('(85) 99999-9999', '55'), expected);
  assert.equal(normalizePhone('0 85 99999-9999', '55'), expected);
  assert.equal(normalizePhone('031 85 99999-9999', '55'), expected);
  assert.throws(() => normalizePhone('55 99999-9999', '55'), (error) => error.code === 'invalid_phone');
});

test('token de exemplo não configura admin e produção rejeita segredos fracos', async () => withDb((db) => {
  const weak = 'troque-por-um-token-aleatorio-longo';
  const auth = createAuth(db, { NODE_ENV: 'test', ADMIN_SETUP_TOKEN: weak, ADMIN_SESSION_SECRET: 'test-session-secret' });
  assert.equal(auth.setupAvailable(), false);
  assert.throws(() => auth.setupAdmin({ setupToken: weak, email: 'dono@example.test', name: 'Dono', password: 'senha-forte-teste-2026' }), (error) => error.status === 403);
  assert.throws(() => createAuth(db, { NODE_ENV: 'production', ADMIN_SETUP_TOKEN: weak, ADMIN_SESSION_SECRET: crypto.randomBytes(32).toString('hex') }), /ADMIN_SETUP_TOKEN/);
  assert.throws(() => createAuth(db, { NODE_ENV: 'production', ADMIN_SETUP_TOKEN: crypto.randomBytes(32).toString('hex'), ADMIN_SESSION_SECRET: 'troque-por-outro-segredo-aleatorio-longo' }), /ADMIN_SESSION_SECRET/);
}));

test('reserva confirmada ocupa o horário e transação bloqueia duplicidade', async () => withDb((db) => {
  const { date, now } = dateAt(3);
  const appointment = createAppointment({ db, config: site, input: bookingInput(date), now });
  assert.equal(appointment.status, 'scheduled');
  const availability = listAvailability({ db, config: site, date, serviceId: 'corte', barberId: 'barbeiro-1', now });
  assert.equal(slot(availability, '10:00').available, false);
  const afterTen = listAvailability({ db, config: site, date, serviceId: 'corte', barberId: 'barbeiro-2', now: now.set({ hour: 10, minute: 15 }) });
  assert.equal(slot(afterTen, '10:00').reason, 'past');
  assert.equal(slot(afterTen, '10:30').available, true);
  assert.throws(
    () => createAppointment({ db, config: site, input: bookingInput(date), now }),
    (error) => error instanceof BookingError && error.code === 'slot_taken'
  );
}));

test('serviços de durações diferentes não podem se sobrepor', async () => withDb((db) => {
  const { date, now } = dateAt(4);
  createAppointment({ db, config: site, input: bookingInput(date, { serviceId: 'degrade', time: '10:00' }), now });
  assert.throws(
    () => createAppointment({ db, config: site, input: bookingInput(date, { serviceId: 'barba', time: '10:30' }), now }),
    (error) => error instanceof BookingError && error.code === 'slot_taken'
  );
}));

test('botão Confirmo confirma e botão Cancelo libera a reserva e seus lembretes', async () => withDb((db) => {
  const { date, now } = dateAt(5);
  const created = createAppointment({ db, config: site, input: bookingInput(date), now });
  const row = db.get('SELECT * FROM appointments WHERE id=?', [created.id]);
  const confirm = applyQuickReply({ db, config: site, payload: `CONFIRM_${row.confirm_token}`, fromPhone: row.client_phone, now });
  assert.equal(confirm.action, 'confirmed');
  assert.equal(db.get('SELECT status FROM appointments WHERE id=?', [created.id]).status, 'confirmed');
  const cancel = applyQuickReply({ db, config: site, payload: `CANCEL_${row.cancel_token}`, fromPhone: row.client_phone, now });
  assert.equal(cancel.action, 'cancelled');
  assert.equal(db.get('SELECT status FROM appointments WHERE id=?', [created.id]).status, 'cancelled');
  assert.equal(db.get("SELECT COUNT(*) AS count FROM whatsapp_outbox WHERE appointment_id=? AND status='pending' AND template_key LIKE 'reminder_%'", [created.id]).count, 0);
  assert.equal(slot(listAvailability({ db, config: site, date, serviceId: 'corte', barberId: 'barbeiro-1', now }), '10:00').available, true);
}));

test('painel encerra a reserva uma vez e o scheduler registra uma falta após tolerância', async () => withDb((db) => {
  const { date, now } = dateAt(6);
  const created = createAppointment({ db, config: site, input: bookingInput(date, { whatsappConsent: false }), now });
  const attended = updateAppointmentStatus({ db, config: site, id: created.id, status: 'attended', now: now.plus({ minutes: 1 }) });
  assert.equal(attended.status, 'attended');
  assert.throws(() => updateAppointmentStatus({ db, config: site, id: created.id, status: 'missed', now }), (error) => error.status === 409);

  const secondDate = dateAt(8);
  const missed = createAppointment({ db, config: site, input: bookingInput(secondDate.date, { clientPhone: '11977776666', time: '11:00' }), now: secondDate.now });
  const afterEnd = DateTime.fromISO(`${secondDate.date}T12:00`, { zone: site.timeZone });
  assert.equal(markOverdueNoShows({ db, config: site, now: afterEnd }), 1);
  assert.equal(db.get('SELECT status FROM appointments WHERE id=?', [missed.id]).status, 'missed');
  assert.equal(db.get("SELECT COUNT(*) AS count FROM whatsapp_outbox WHERE appointment_id=? AND template_key='owner_no_show'", [missed.id]).count, 1);
}));

test('fila não simula envio quando a integração Meta não está configurada', async () => withDb(async (db) => {
  const { date, now } = dateAt(3);
  createAppointment({ db, config: site, input: bookingInput(date), now });
  const result = await processOutbox({ db, config: site, env: {}, now, fetchImpl: async () => { throw new Error('Não deveria acessar a rede.'); } });
  assert.equal(result.sent, 0);
  assert.equal(db.get("SELECT status FROM whatsapp_outbox WHERE template_key='owner_booking'").status, 'pending');
  assert.equal(db.get("SELECT last_error_code FROM whatsapp_outbox WHERE template_key='owner_booking'").last_error_code, 'not_configured');
}));

test('payload de template, assinatura de webhook e autenticação por telefone', async () => withDb(async (db) => {
  const { date, now: appointmentMorning } = dateAt(4);
  const now = appointmentMorning.minus({ days: 2 });
  const created = createAppointment({ db, config: site, input: bookingInput(date), now });
  const appointment = db.get('SELECT * FROM appointments WHERE id=?', [created.id]);
  const outbox = db.get("SELECT * FROM whatsapp_outbox WHERE template_key='reminder_24h'");
  const components = makeTemplateComponents({ outbox, appointment, site });
  assert.equal(components[0].parameters.length, 7);
  assert.equal(components[1].parameters[0].payload, `CONFIRM_${appointment.confirm_token}`);
  assert.equal(components[2].parameters[0].payload, `CANCEL_${appointment.cancel_token}`);

  const raw = Buffer.from('{"entry":[]}');
  const secret = 'test-secret-whatsapp';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  assert.equal(verifySignature(raw, signature, secret), true);
  assert.equal(verifySignature(Buffer.from('changed'), signature, secret), false);
  assert.equal(verifyWebhookChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify', 'hub.challenge': '123' }, { WHATSAPP_VERIFY_TOKEN: 'verify' }), '123');

  const result = handleWebhookPayload({
    db, config: site, now,
    body: { entry: [{ changes: [{ value: { messages: [{ type: 'button', from: '5511999999999', button: { payload: `CONFIRM_${appointment.confirm_token}` } }] } }] }] }
  });
  assert.equal(result.length, 0, 'telefone diferente deve impedir confirmar a reserva');
}));

test('Cloud API recebe o template Utility e botões sem chamada de rede real', async () => {
  const captured = {};
  const appointment = {
    starts_at_utc: '2026-12-01T13:00:00Z', client_name: 'Cliente', client_phone: '5511999999999',
    whatsapp_consent: 1, service_name: 'Corte', barber_name: 'Barbeiro', confirm_token: 'A'.repeat(32), cancel_token: 'B'.repeat(32)
  };
  const env = {
    WHATSAPP_ACCESS_TOKEN: 'test-token', WHATSAPP_PHONE_NUMBER_ID: '123456', WHATSAPP_APP_SECRET: 'test-app-secret',
    WHATSAPP_TEMPLATE_REMINDER: 'appointment_reminder_utility', WHATSAPP_TEMPLATE_LANGUAGE: 'pt_BR'
  };
  const messageId = await sendOutboxMessage({
    outbox: { template_key: 'reminder_1h' }, appointment, site, env,
    fetchImpl: async (url, options) => {
      captured.url = url;
      captured.payload = JSON.parse(options.body);
      return { ok: true, json: async () => ({ messages: [{ id: 'wamid.test' }] }) };
    }
  });
  assert.equal(messageId, 'wamid.test');
  assert.match(captured.url, /\/v27\.0\/123456\/messages$/);
  assert.equal(captured.payload.to, appointment.client_phone);
  assert.equal(captured.payload.template.components.filter((item) => item.type === 'button').length, 2);
  assert.equal(captured.payload.template.components[0].parameters[6].text, '1 hora');
});

test('servidor serve uma homepage única, protege o painel e aceita reservas via HTTP', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'barbearia-agenda-http-'));
  const db = await openDatabase({ dataDir });
  const env = { NODE_ENV: 'test', ADMIN_SETUP_TOKEN: crypto.randomBytes(32).toString('hex'), ADMIN_SESSION_SECRET: crypto.randomBytes(32).toString('hex') };
  let wakeCount = 0;
  const { app } = buildRuntime({ db, site, env, logger: { error() {} }, wakeScheduler: () => { wakeCount += 1; } });
  const http = require('node:http');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="agendar"/);
  assert.match(html, /Ocupado/);
  assert.match(html, /href="\/theme.css"/);
  assert.equal((html.match(/<main\b/g) || []).length, 1);
  const status = await fetch(`${base}/api/admin/status`);
  assert.equal((await status.json()).hasAdmin, false);
  const publicConfig = await fetch(`${base}/api/site`);
  const publicData = await publicConfig.json();
  assert.equal(publicData.ownerWhatsApp, undefined, 'o telefone administrativo não deve sair para o navegador');
  const unauthorized = await fetch(`${base}/api/admin/appointments`);
  assert.equal(unauthorized.status, 401);

  const origin = base;
  const setup = await fetch(`${base}/api/admin/setup`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ setupToken: env.ADMIN_SETUP_TOKEN, name: 'Dono Teste', email: 'dono@example.test', password: 'senha-para-teste-2026' })
  });
  assert.equal(setup.status, 201);
  const wrongLogin = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: 'dono@example.test', password: 'senha-errada-para-teste' })
  });
  assert.equal(wrongLogin.status, 401);
  const validLogin = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: 'dono@example.test', password: 'senha-para-teste-2026' })
  });
  assert.equal(validLogin.status, 200);
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const authorized = await fetch(`${base}/api/admin/appointments`, { headers: { cookie } });
  assert.equal(authorized.status, 200);

  const bookingDate = dateAt(3).date;
  const booking = await fetch(`${base}/api/appointments`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(bookingInput(bookingDate))
  });
  assert.equal(booking.status, 201);
  const body = await booking.json();
  assert.equal(body.appointment.status, 'scheduled');
  assert.equal(body.whatsappConfigured, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wakeCount, 1, 'a notificação imediata deve acordar o scheduler após salvar a reserva');
  const staticCss = await fetch(`${base}/styles.css`);
  assert.equal(staticCss.status, 200);
  const theme = await fetch(`${base}/theme.css`);
  assert.equal(theme.status, 200);
  assert.match(await theme.text(), /--copper-dark:#a8522e/);
});

test('segredos ficam no servidor e as imagens configuradas são assets locais demonstrativos', () => {
  const publicDir = path.join(root, 'public');
  const js = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const configText = fs.readFileSync(path.join(root, 'config/site.json'), 'utf8');
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
  assert.doesNotMatch(js, /WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET|ADMIN_SESSION_SECRET/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  assert.match(html, /Autorizo receber confirmações/);
  assert.match(html, /class="privacy-note"/);
  assert.match(configText, /"demoContent": true/);
  assert.match(html, /Avaliações de exemplo/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.mobile-booking-bar/);
  const imagePaths = [...new Set([
    site.logoPath, site.heroImage, ...site.aboutImages, ...site.gallery.map((item) => item.src), ...site.barbers.map((item) => item.photo)
  ])];
  for (const assetPath of imagePaths) {
    assert.match(assetPath, /^\/img\//);
    assert.equal(fs.existsSync(path.join(publicDir, assetPath.slice(1))), true, `asset ausente: ${assetPath}`);
  }
});
