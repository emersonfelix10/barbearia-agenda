const crypto = require('node:crypto');
const { DateTime } = require('luxon');
const { normalizePhone, applyQuickReply } = require('./appointments');

class WhatsAppNotConfiguredError extends Error {
  constructor() {
    super('Integração de WhatsApp ainda não configurada.');
    this.name = 'WhatsAppNotConfiguredError';
    this.code = 'whatsapp_not_configured';
  }
}

function isConfigured(env = process.env, site = {}) {
  return Boolean(
    env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_APP_SECRET &&
    env.WHATSAPP_VERIFY_TOKEN && (env.WHATSAPP_OWNER_NUMBER || site.ownerWhatsApp) &&
    env.WHATSAPP_TEMPLATE_REMINDER && env.WHATSAPP_TEMPLATE_OWNER_BOOKING && env.WHATSAPP_TEMPLATE_OWNER_NO_SHOW
  );
}

function safeCompare(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifySignature(rawBody, signatureHeader, appSecret = process.env.WHATSAPP_APP_SECRET) {
  if (!appSecret || !Buffer.isBuffer(rawBody) || !signatureHeader?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeCompare(signatureHeader, expected);
}

function getTemplateName(key, env) {
  if (key === 'reminder_24h' || key === 'reminder_1h') return env.WHATSAPP_TEMPLATE_REMINDER;
  if (key === 'owner_booking') return env.WHATSAPP_TEMPLATE_OWNER_BOOKING;
  if (key === 'owner_no_show') return env.WHATSAPP_TEMPLATE_OWNER_NO_SHOW;
  return '';
}

function localDateAndTime(appointment, site) {
  const local = DateTime.fromISO(appointment.starts_at_utc, { zone: 'utc' }).setZone(site.timeZone || 'America/Sao_Paulo');
  return { date: local.toFormat('dd/LL/yyyy'), time: local.toFormat('HH:mm') };
}

function textParameter(text) {
  return { type: 'text', text: String(text ?? '').slice(0, 1024) };
}

function makeTemplateComponents({ outbox, appointment, site }) {
  const { date, time } = localDateAndTime(appointment, site);
  const buttonComponents = [];
  const components = [];
  if (outbox.template_key === 'reminder_24h' || outbox.template_key === 'reminder_1h') {
    const lead = outbox.template_key === 'reminder_24h' ? '24 horas' : '1 hora';
    components.push({
      type: 'body',
      parameters: [
        textParameter(site.businessName), textParameter(appointment.client_name), textParameter(appointment.service_name),
        textParameter(appointment.barber_name), textParameter(date), textParameter(time), textParameter(lead)
      ]
    });
    buttonComponents.push(
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `CONFIRM_${appointment.confirm_token}` }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: `CANCEL_${appointment.cancel_token}` }] }
    );
  } else if (outbox.template_key === 'owner_booking') {
    components.push({
      type: 'body',
      parameters: [
        textParameter(site.businessName), textParameter(appointment.client_name), textParameter(appointment.client_phone),
        textParameter(appointment.service_name), textParameter(appointment.barber_name), textParameter(date), textParameter(time)
      ]
    });
  } else if (outbox.template_key === 'owner_no_show') {
    components.push({
      type: 'body',
      parameters: [
        textParameter(site.businessName), textParameter(appointment.client_name), textParameter(appointment.service_name),
        textParameter(appointment.barber_name), textParameter(date), textParameter(time)
      ]
    });
  }
  return [...components, ...buttonComponents];
}

function recipientFor(outbox, appointment, site, env) {
  if (outbox.template_key.startsWith('reminder_')) return appointment.client_phone;
  return normalizePhone(env.WHATSAPP_OWNER_NUMBER || site.ownerWhatsApp, site.phoneCountryCode || '55');
}

async function sendOutboxMessage({ outbox, appointment, site, env = process.env, fetchImpl = fetch }) {
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = getTemplateName(outbox.template_key, env);
  const version = env.WHATSAPP_GRAPH_API_VERSION || 'v27.0';
  const language = env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR';
  if (!token || !phoneNumberId || !templateName || !env.WHATSAPP_APP_SECRET) throw new WhatsAppNotConfiguredError();
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('Versão da Graph API inválida.');
  const recipient = recipientFor(outbox, appointment, site, env);
  if (outbox.template_key.startsWith('reminder_') && !appointment.whatsapp_consent) {
    throw new WhatsAppNotConfiguredError();
  }
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components: makeTemplateComponents({ outbox, appointment, site })
    }
  };
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  let body = {};
  try { body = await response.json(); } catch (_) {}
  if (!response.ok) {
    const error = new Error(`WhatsApp API rejeitou o envio (${response.status}).`);
    error.code = String(body?.error?.code || response.status);
    error.retryable = response.status >= 500 || response.status === 429;
    throw error;
  }
  return body?.messages?.[0]?.id || null;
}

function verifyWebhookChallenge(query, env = process.env) {
  const mode = String(query['hub.mode'] || '');
  const supplied = String(query['hub.verify_token'] || '');
  const expected = String(env.WHATSAPP_VERIFY_TOKEN || '');
  if (mode !== 'subscribe' || !safeCompare(supplied, expected) || !expected) return null;
  return String(query['hub.challenge'] || '');
}

function handleWebhookPayload({ body, db, config, now }) {
  const changes = [];
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const messages = change?.value?.messages || [];
      for (const message of messages) {
        if (message.type !== 'button' || !message.button?.payload) continue;
        const result = applyQuickReply({ db, config, payload: message.button.payload, fromPhone: message.from, now });
        if (result.applied) changes.push(result);
      }
    }
  }
  return changes;
}

module.exports = {
  WhatsAppNotConfiguredError,
  isConfigured,
  verifySignature,
  verifyWebhookChallenge,
  sendOutboxMessage,
  handleWebhookPayload,
  makeTemplateComponents
};
