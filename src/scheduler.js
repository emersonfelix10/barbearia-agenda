const { DateTime } = require('luxon');
const { markOverdueNoShows } = require('./appointments');
const { sendOutboxMessage, WhatsAppNotConfiguredError } = require('./whatsapp');

function secondsBackoff(attempt) {
  return Math.min(6 * 60 * 60, 60 * (2 ** Math.max(0, attempt - 1)));
}

async function processOutbox({ db, config, env = process.env, fetchImpl = fetch, now = DateTime.now().setZone(config.timeZone), limit = 20 }) {
  const nowIso = now.toUTC().toISO({ suppressMilliseconds: true });
  const due = db.all(
    `SELECT * FROM whatsapp_outbox
     WHERE status='pending' AND send_after_utc <= ? AND (next_attempt_utc IS NULL OR next_attempt_utc <= ?)
     ORDER BY send_after_utc ASC LIMIT ?`,
    [nowIso, nowIso, limit]
  );
  let sent = 0;
  for (const outbox of due) {
    const appointment = db.get('SELECT * FROM appointments WHERE id=?', [outbox.appointment_id]);
    if (!appointment) {
      db.run("UPDATE whatsapp_outbox SET status='expired',last_error_code='appointment_missing' WHERE id=?", [outbox.id]);
      continue;
    }
    const expiresAt = DateTime.fromISO(outbox.expires_at_utc, { zone: 'utc' });
    if (expiresAt <= now.toUTC()) {
      db.run("UPDATE whatsapp_outbox SET status='expired',last_error_code='expired' WHERE id=?", [outbox.id]);
      continue;
    }
    if (outbox.template_key.startsWith('reminder_') && !['scheduled', 'confirmed'].includes(appointment.status)) {
      db.run("UPDATE whatsapp_outbox SET status='cancelled',last_error_code='appointment_not_active' WHERE id=?", [outbox.id]);
      continue;
    }
    try {
      const messageId = await sendOutboxMessage({ outbox, appointment, site: config, env, fetchImpl });
      db.run(
        "UPDATE whatsapp_outbox SET status='sent',attempts=attempts+1,provider_message_id=?,sent_at_utc=?,last_error_code=NULL WHERE id=?",
        [messageId, nowIso, outbox.id]
      );
      sent += 1;
    } catch (error) {
      if (error instanceof WhatsAppNotConfiguredError || error.code === 'whatsapp_not_configured') {
        db.run("UPDATE whatsapp_outbox SET next_attempt_utc=?,last_error_code='not_configured' WHERE id=?", [now.plus({ minutes: 30 }).toUTC().toISO({ suppressMilliseconds: true }), outbox.id]);
        continue;
      }
      const attempts = Number(outbox.attempts || 0) + 1;
      const dead = attempts >= 8 || error.retryable === false;
      const nextAttempt = now.plus({ seconds: secondsBackoff(attempts) }).toUTC().toISO({ suppressMilliseconds: true });
      db.run(
        'UPDATE whatsapp_outbox SET status=?,attempts=?,next_attempt_utc=?,last_error_code=? WHERE id=?',
        [dead ? 'dead' : 'pending', attempts, nextAttempt, String(error.code || 'send_error').slice(0, 80), outbox.id]
      );
    }
  }
  return { due: due.length, sent };
}

function createScheduler({ db, config, env = process.env, logger = console, intervalMs = 60_000, fetchImpl = fetch }) {
  let timer = null;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      markOverdueNoShows({ db, config });
      await processOutbox({ db, config, env, fetchImpl });
      db.run('DELETE FROM admin_sessions WHERE expires_at <= ?', [Math.floor(Date.now() / 1000)]);
    } catch (error) {
      logger.error('Falha no ciclo da agenda:', String(error?.message || 'erro interno'));
    } finally {
      running = false;
    }
  }
  return {
    start() { if (!timer) { timer = setInterval(tick, intervalMs); timer.unref?.(); void tick(); } },
    stop() { if (timer) clearInterval(timer); timer = null; },
    tick
  };
}

module.exports = { createScheduler, processOutbox, secondsBackoff };
