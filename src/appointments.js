const crypto = require('node:crypto');
const { DateTime } = require('luxon');

class BookingError extends Error {
  constructor(message, status = 400, code = 'invalid_request') {
    super(message);
    this.name = 'BookingError';
    this.status = status;
    this.code = code;
  }
}

function normalizePhone(value, countryCode = '55') {
  let digits = String(value || '').replace(/\D/g, '');
  const prefix = String(countryCode || '55').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (prefix === '55' && !digits.startsWith(prefix) && /^0\d{2}\d{10,11}$/.test(digits)) digits = digits.slice(3);
  else if (prefix === '55' && !digits.startsWith(prefix) && /^0\d{10,11}$/.test(digits)) digits = digits.slice(1);
  if (prefix && digits.length >= 10 && digits.length <= 11 && !digits.startsWith(prefix)) digits = `${prefix}${digits}`;
  if (prefix === '55' && digits.startsWith('55') && digits.length < 12) throw new BookingError('Informe um WhatsApp com DDD e número válidos.', 400, 'invalid_phone');
  if (digits.length < 11 || digits.length > 15) throw new BookingError('Informe um WhatsApp com DDD e número válidos.', 400, 'invalid_phone');
  return digits;
}

function dateTimeFor(date, time, zone) {
  const value = DateTime.fromISO(`${date}T${time}`, { zone, setZone: true });
  if (!value.isValid) throw new BookingError('Data ou horário inválido.');
  return value;
}

function weekdayKey(dateTime) {
  return dateTime.setLocale('en').toFormat('ccc').toLowerCase();
}

function getService(config, serviceId) {
  return (config.services || []).find((item) => item.id === serviceId && item.active !== false) || null;
}

function getBarber(config, barberId) {
  return (config.barbers || []).find((item) => item.id === barberId && item.active !== false) || null;
}

function validateDate(date, config, now = DateTime.now().setZone(config.timeZone)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new BookingError('Escolha uma data válida.');
  const selected = DateTime.fromISO(date, { zone: config.timeZone }).startOf('day');
  if (!selected.isValid) throw new BookingError('Escolha uma data válida.');
  if (selected < now.startOf('day')) throw new BookingError('Escolha uma data de hoje em diante.');
  if (selected > now.plus({ days: Number(config.bookingHorizonDays || 60) }).endOf('day')) {
    throw new BookingError(`A agenda permite reservas com até ${Number(config.bookingHorizonDays || 60)} dias de antecedência.`, 400, 'date_too_far');
  }
  return selected;
}

function listAvailability({ db, config, date, serviceId, barberId, now = DateTime.now().setZone(config.timeZone) }) {
  const selectedDate = validateDate(date, config, now);
  const service = getService(config, serviceId);
  const barber = getBarber(config, barberId);
  if (!service || !barber) throw new BookingError('Escolha um serviço e um barbeiro válidos.');
  const hours = config.hours?.[weekdayKey(selectedDate)];
  if (!hours || !hours.open || !hours.close) return { date, slots: [] };

  const opening = dateTimeFor(date, hours.open, config.timeZone);
  const closing = dateTimeFor(date, hours.close, config.timeZone);
  const duration = Number(service.durationMinutes);
  const interval = Math.max(15, Number(config.slotIntervalMinutes || 30));
  if (!Number.isFinite(duration) || duration < 10 || duration > 360) throw new BookingError('Duração de serviço inválida.', 500, 'invalid_service_config');

  const existing = db.all(
    `SELECT time_local, starts_at_utc, ends_at_utc FROM appointments
     WHERE date_local = ? AND barber_id = ? AND status != 'cancelled'`,
    [date, barberId]
  );
  const slots = [];
  let cursor = opening;
  while (cursor.plus({ minutes: duration }) <= closing) {
    const startUtc = cursor.toUTC().toISO({ suppressMilliseconds: true });
    const endUtc = cursor.plus({ minutes: duration }).toUTC().toISO({ suppressMilliseconds: true });
    const busy = existing.some((appointment) => appointment.starts_at_utc < endUtc && appointment.ends_at_utc > startUtc);
    const isPast = cursor <= now;
    slots.push({ time: cursor.toFormat('HH:mm'), available: !busy && !isPast, reason: busy ? 'occupied' : (isPast ? 'past' : null) });
    cursor = cursor.plus({ minutes: interval });
  }
  return { date, slots };
}

function outboxInsert(tx, { appointmentId, eventKey, templateKey, sendAt, expiresAt, createdAt }) {
  tx.run(
    `INSERT OR IGNORE INTO whatsapp_outbox
      (id,event_key,appointment_id,template_key,send_after_utc,expires_at_utc,status,attempts,next_attempt_utc,created_at_utc)
     VALUES (?,?,?,?,? ,?,'pending',0,?,?)`,
    [crypto.randomUUID(), eventKey, appointmentId, templateKey, sendAt, expiresAt, sendAt, createdAt]
  );
}

function createAppointment({ db, config, input, now = DateTime.now().setZone(config.timeZone) }) {
  const name = String(input.clientName || '').trim().replace(/\s+/g, ' ');
  const service = getService(config, String(input.serviceId || ''));
  const barber = getBarber(config, String(input.barberId || ''));
  if (name.length < 2 || name.length > 100) throw new BookingError('Informe seu nome completo.');
  if (!service || !barber) throw new BookingError('Escolha um serviço e um barbeiro válidos.');
  const phone = normalizePhone(input.clientPhone, config.phoneCountryCode);
  const notes = String(input.notes || '').trim().slice(0, 400);
  const date = String(input.date || '');
  const time = String(input.time || '');
  const selectedDate = validateDate(date, config, now);
  const dateHours = config.hours?.[weekdayKey(selectedDate)];
  if (!dateHours) throw new BookingError('A barbearia não atende nesta data.', 400, 'closed_day');
  const startLocal = dateTimeFor(date, time, config.timeZone);
  const endLocal = startLocal.plus({ minutes: Number(service.durationMinutes) });
  const opening = dateTimeFor(date, dateHours.open, config.timeZone);
  const closing = dateTimeFor(date, dateHours.close, config.timeZone);
  const interval = Math.max(15, Number(config.slotIntervalMinutes || 30));
  const minuteOffset = startLocal.diff(opening, 'minutes').minutes;
  if (startLocal < opening || endLocal > closing || minuteOffset < 0 || Math.abs(minuteOffset / interval - Math.round(minuteOffset / interval)) > 0.0001) {
    throw new BookingError('Esse horário não está dentro da agenda da barbearia.', 409, 'invalid_slot');
  }
  if (startLocal <= now) throw new BookingError('Esse horário já passou. Escolha outro.', 409, 'slot_in_past');

  const startUtc = startLocal.toUTC().toISO({ suppressMilliseconds: true });
  const endUtc = endLocal.toUTC().toISO({ suppressMilliseconds: true });
  const id = crypto.randomUUID();
  const confirmToken = crypto.randomBytes(24).toString('base64url');
  const cancelToken = crypto.randomBytes(24).toString('base64url');
  const createdAt = now.toUTC().toISO({ suppressMilliseconds: true });
  const consent = input.whatsappConsent === true ? 1 : 0;
  const priceCents = Math.max(0, Math.round(Number(service.priceCents)));

  const appointment = {
    id,
    clientName: name,
    clientPhone: phone,
    whatsappConsent: Boolean(consent),
    serviceId: service.id,
    serviceName: service.name,
    priceCents,
    durationMinutes: Number(service.durationMinutes),
    barberId: barber.id,
    barberName: barber.name,
    date,
    time,
    startUtc,
    endUtc,
    notes,
    status: 'scheduled',
    confirmToken,
    cancelToken
  };

  db.transaction((tx) => {
    const conflict = tx.get(
      `SELECT id FROM appointments
       WHERE barber_id = ? AND status != 'cancelled' AND starts_at_utc < ? AND ends_at_utc > ? LIMIT 1`,
      [barber.id, endUtc, startUtc]
    );
    if (conflict) throw new BookingError('Esse horário acabou de ser ocupado. Escolha outro.', 409, 'slot_taken');
    tx.run(
      `INSERT INTO appointments
       (id,client_name,client_phone,whatsapp_consent,service_id,service_name,price_cents,duration_minutes,
        barber_id,barber_name,date_local,time_local,starts_at_utc,ends_at_utc,notes,status,confirm_token,cancel_token,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, name, phone, consent, service.id, service.name, priceCents, Number(service.durationMinutes), barber.id, barber.name,
        date, time, startUtc, endUtc, notes, 'scheduled', confirmToken, cancelToken, createdAt, createdAt]
    );

    const expiresAt = startUtc;
    outboxInsert(tx, { appointmentId: id, eventKey: `booking:${id}`, templateKey: 'owner_booking', sendAt: createdAt, expiresAt, createdAt });
    const startMs = startLocal.toMillis();
    const nowMs = now.toMillis();
    if (consent && startMs - nowMs > 24 * 60 * 60 * 1000) {
      const sendAt = startLocal.minus({ hours: 24 }).toUTC().toISO({ suppressMilliseconds: true });
      outboxInsert(tx, { appointmentId: id, eventKey: `reminder24:${id}`, templateKey: 'reminder_24h', sendAt, expiresAt, createdAt });
    }
    if (consent && startMs - nowMs > 60 * 60 * 1000) {
      const sendAt = startLocal.minus({ hours: 1 }).toUTC().toISO({ suppressMilliseconds: true });
      outboxInsert(tx, { appointmentId: id, eventKey: `reminder1:${id}`, templateKey: 'reminder_1h', sendAt, expiresAt, createdAt });
    }
  });

  return publicAppointment(appointment);
}

function publicAppointment(row) {
  return {
    id: row.id,
    clientName: row.clientName ?? row.client_name,
    serviceName: row.serviceName ?? row.service_name,
    barberName: row.barberName ?? row.barber_name,
    date: row.date ?? row.date_local,
    time: row.time ?? row.time_local,
    priceCents: Number(row.priceCents ?? row.price_cents),
    durationMinutes: Number(row.durationMinutes ?? row.duration_minutes),
    status: row.status || 'scheduled'
  };
}

function getAdminAppointments({ db, from, to }) {
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  if (!validDate(from) || !validDate(to) || from > to) throw new BookingError('Informe um intervalo de datas válido.');
  const rows = db.all(
    `SELECT id,client_name,client_phone,service_name,price_cents,duration_minutes,barber_name,date_local,time_local,notes,status,whatsapp_consent,created_at
     FROM appointments WHERE date_local >= ? AND date_local <= ?
     ORDER BY date_local ASC,time_local ASC,barber_name ASC`,
    [from, to]
  );
  return rows.map((item) => ({
    id: item.id, clientName: item.client_name, clientPhone: item.client_phone, serviceName: item.service_name,
    priceCents: Number(item.price_cents), durationMinutes: Number(item.duration_minutes), barberName: item.barber_name,
    date: item.date_local, time: item.time_local, notes: item.notes, status: item.status,
    whatsappConsent: Boolean(item.whatsapp_consent), createdAt: item.created_at
  }));
}

function cancelPendingReminders(tx, appointmentId) {
  tx.run("UPDATE whatsapp_outbox SET status='cancelled' WHERE appointment_id=? AND template_key IN ('reminder_24h','reminder_1h') AND status='pending'", [appointmentId]);
}

function queueNoShow(tx, appointment, nowIso) {
  outboxInsert(tx, {
    appointmentId: appointment.id,
    eventKey: `no-show:${appointment.id}`,
    templateKey: 'owner_no_show',
    sendAt: nowIso,
    expiresAt: DateTime.fromISO(appointment.ends_at_utc, { zone: 'utc' }).plus({ days: 1 }).toISO({ suppressMilliseconds: true }),
    createdAt: nowIso
  });
}

function updateAppointmentStatus({ db, config, id, status, now = DateTime.now().setZone(config.timeZone) }) {
  const allowed = new Set(['attended', 'missed', 'cancelled']);
  if (!allowed.has(status)) throw new BookingError('Estado de atendimento inválido.');
  const nowIso = now.toUTC().toISO({ suppressMilliseconds: true });
  let updated;
  db.transaction((tx) => {
    const appointment = tx.get('SELECT * FROM appointments WHERE id=?', [id]);
    if (!appointment) throw new BookingError('Agendamento não encontrado.', 404, 'not_found');
    if (!['scheduled', 'confirmed'].includes(appointment.status)) throw new BookingError('Este agendamento já foi encerrado.', 409, 'already_final');
    tx.run('UPDATE appointments SET status=?,updated_at=?,missed_at=? WHERE id=?', [status, nowIso, status === 'missed' ? nowIso : appointment.missed_at, id]);
    cancelPendingReminders(tx, id);
    if (status === 'missed') queueNoShow(tx, appointment, nowIso);
    updated = { ...appointment, status, updated_at: nowIso };
  });
  return {
    id: updated.id, clientName: updated.client_name, serviceName: updated.service_name,
    barberName: updated.barber_name, date: updated.date_local, time: updated.time_local, status: updated.status
  };
}

function markOverdueNoShows({ db, config, now = DateTime.now().setZone(config.timeZone) }) {
  const cutoff = now.minus({ minutes: Number(config.noShowGraceMinutes || 15) }).toUTC().toISO({ suppressMilliseconds: true });
  const nowIso = now.toUTC().toISO({ suppressMilliseconds: true });
  const due = db.all(
    "SELECT * FROM appointments WHERE status IN ('scheduled','confirmed') AND ends_at_utc <= ? AND no_show_notified_at IS NULL",
    [cutoff]
  );
  if (!due.length) return 0;
  db.transaction((tx) => {
    for (const appointment of due) {
      tx.run("UPDATE appointments SET status='missed',missed_at=?,no_show_notified_at=?,updated_at=? WHERE id=? AND status IN ('scheduled','confirmed')",
        [nowIso, nowIso, nowIso, appointment.id]);
      cancelPendingReminders(tx, appointment.id);
      queueNoShow(tx, appointment, nowIso);
    }
  });
  return due.length;
}

function applyQuickReply({ db, config, payload, fromPhone, now = DateTime.now().setZone(config.timeZone) }) {
  const match = /^(CONFIRM|CANCEL)_([A-Za-z0-9_-]{20,80})$/.exec(String(payload || ''));
  if (!match) return { applied: false, reason: 'unknown_payload' };
  let phone;
  try { phone = normalizePhone(fromPhone, config.phoneCountryCode); } catch (_) { return { applied: false, reason: 'invalid_phone' }; }
  const kind = match[1];
  const token = match[2];
  const column = kind === 'CONFIRM' ? 'confirm_token' : 'cancel_token';
  const nowIso = now.toUTC().toISO({ suppressMilliseconds: true });
  let result = { applied: false, reason: 'not_found' };
  db.transaction((tx) => {
    const appointment = tx.get(`SELECT * FROM appointments WHERE ${column}=?`, [token]);
    if (!appointment) return;
    if (appointment.client_phone !== phone) { result = { applied: false, reason: 'phone_mismatch' }; return; }
    if (!['scheduled', 'confirmed'].includes(appointment.status)) { result = { applied: false, reason: 'not_active' }; return; }
    if (DateTime.fromISO(appointment.starts_at_utc, { zone: 'utc' }) <= now.toUTC()) { result = { applied: false, reason: 'appointment_started' }; return; }
    if (kind === 'CONFIRM') {
      tx.run("UPDATE appointments SET status='confirmed',updated_at=? WHERE id=?", [nowIso, appointment.id]);
      result = { applied: true, action: 'confirmed', appointmentId: appointment.id };
    } else {
      tx.run("UPDATE appointments SET status='cancelled',updated_at=? WHERE id=?", [nowIso, appointment.id]);
      cancelPendingReminders(tx, appointment.id);
      result = { applied: true, action: 'cancelled', appointmentId: appointment.id };
    }
  });
  return result;
}

module.exports = {
  BookingError,
  normalizePhone,
  listAvailability,
  createAppointment,
  publicAppointment,
  getAdminAppointments,
  updateAppointmentStatus,
  markOverdueNoShows,
  applyQuickReply
};
