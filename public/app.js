(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { site: null, serviceId: '', barberId: '', time: '', bookingBusy: false, admin: null };

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    const type = response.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await response.json() : {};
    if (!response.ok) {
      const error = new Error(body.error || 'Não foi possível completar a solicitação.');
      error.status = response.status;
      error.code = body.code;
      throw error;
    }
    return body;
  }

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function money(cents) {
    return new Intl.NumberFormat(state.site?.locale || 'pt-BR', {
      style: 'currency', currency: state.site?.currency || 'BRL'
    }).format(Number(cents || 0) / 100);
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch (_) { return ''; }
  }

  function setMessage(element, text, isError = false) {
    element.textContent = text;
    element.classList.toggle('is-error', isError);
  }

  function showToast(text, isError = false) {
    const region = $('#toast-region');
    const toast = make('div', `toast${isError ? ' toast--error' : ''}`, text);
    region.append(toast);
    window.setTimeout(() => toast.remove(), 4600);
  }

  function renderBrand() {
    const site = state.site;
    document.title = `${site.businessName} — Agende seu horário`;
    const description = $('meta[name="description"]');
    if (description) description.content = site.heroText || site.tagline || `Agende seu atendimento na ${site.businessName}.`;
    const themeColor = $('meta[name="theme-color"]');
    if (themeColor && /^#[0-9a-f]{6}$/i.test(site.colors?.ink || '')) themeColor.content = site.colors.ink;
    $$('[data-business-name]').forEach((item) => { item.textContent = site.businessName; });
    $$('[data-tagline]').forEach((item) => { item.textContent = site.tagline; });
    $('[data-hero-title]').textContent = site.heroTitle;
    $('[data-hero-text]').textContent = site.heroText;
    $('[data-about-text]').textContent = site.aboutText;
    $('[data-address]').textContent = site.address;
    $('#hero-image').src = site.heroImage;
    $('#hero-image').alt = `Foto demonstrativa de atendimento da ${site.businessName}`;
    $$('.brand__logo').forEach((image) => { image.src = site.logoPath; });
    $('#year').textContent = String(new Date().getFullYear());
  }

  function renderAboutGallery() {
    const container = $('#about-gallery');
    container.replaceChildren();
    (state.site.aboutImages || []).slice(0, 3).forEach((src, index) => {
      const figure = make('figure');
      const image = make('img');
      image.src = src;
      image.alt = `Foto demonstrativa do espaço da barbearia, imagem ${index + 1}`;
      image.loading = 'lazy';
      figure.append(image);
      container.append(figure);
    });
  }

  function renderServices() {
    const site = state.site;
    const list = $('#services-list');
    const picker = $('#service-picker');
    list.replaceChildren();
    picker.replaceChildren();
    site.services.forEach((service, index) => {
      const row = make('article', 'service-row');
      row.append(make('span', 'service-row__index', String(index + 1).padStart(2, '0')));
      row.append(make('h3', '', service.name));
      row.append(make('p', 'service-row__desc', service.description || 'Atendimento com hora marcada.'));
      row.append(make('span', 'service-row__duration', `${Number(service.durationMinutes)} min`));
      row.append(make('span', 'service-row__price', money(service.priceCents)));
      list.append(row);

      const button = make('button', 'choice-card');
      button.type = 'button';
      button.dataset.serviceId = service.id;
      button.setAttribute('aria-pressed', String(state.serviceId === service.id));
      const copy = make('span');
      copy.append(make('span', 'choice-card__title', service.name));
      copy.append(make('span', 'choice-card__sub', `${Number(service.durationMinutes)} min`));
      button.append(copy, make('span', 'choice-card__meta', money(service.priceCents)));
      button.addEventListener('click', () => {
        state.serviceId = service.id;
        state.time = '';
        renderServices();
        refreshBookingSummary();
        loadAvailability();
      });
      picker.append(button);
    });
  }

  function renderBarbers() {
    const picker = $('#barber-picker');
    picker.replaceChildren();
    state.site.barbers.forEach((barber) => {
      const button = make('button', 'choice-card choice-card--barber');
      button.type = 'button';
      button.dataset.barberId = barber.id;
      button.setAttribute('aria-pressed', String(state.barberId === barber.id));
      const image = make('img');
      image.src = barber.photo;
      image.alt = '';
      image.loading = 'lazy';
      const copy = make('span');
      copy.append(make('span', 'choice-card__title', barber.name));
      copy.append(make('span', 'choice-card__sub', barber.title || 'Barbeiro'));
      button.append(image, copy);
      button.addEventListener('click', () => {
        state.barberId = barber.id;
        state.time = '';
        renderBarbers();
        refreshBookingSummary();
        loadAvailability();
      });
      picker.append(button);
    });
  }

  function renderGallery() {
    const container = $('#gallery-grid');
    container.replaceChildren();
    (state.site.gallery || []).slice(0, 6).forEach((item, index) => {
      const figure = make('figure', 'gallery-card');
      const image = make('img');
      image.src = item.src;
      image.alt = item.alt || 'Foto demonstrativa de um trabalho da barbearia';
      image.loading = 'lazy';
      const caption = make('figcaption');
      caption.append(make('span', '', item.caption || 'Trabalho demonstrativo'));
      caption.append(make('span', '', String(index + 1).padStart(2, '0')));
      figure.append(image, caption);
      container.append(figure);
    });
  }

  function renderTeam() {
    const container = $('#team-grid');
    container.replaceChildren();
    state.site.barbers.forEach((barber, index) => {
      const card = make('article', 'team-card');
      const frame = make('div', 'team-card__image');
      const image = make('img');
      image.src = barber.photo;
      image.alt = `Foto ilustrativa de ${barber.name}`;
      image.loading = 'lazy';
      frame.append(image);
      const copy = make('div', 'team-card__copy');
      copy.append(make('p', 'eyebrow', `PROFISSIONAL ${String(index + 1).padStart(2, '0')}`));
      copy.append(make('h3', '', barber.name));
      copy.append(make('p', '', barber.bio || barber.title || 'Equipe demonstrativa.'));
      card.append(frame, copy);
      container.append(card);
    });
  }

  function renderReviews() {
    const container = $('#reviews-grid');
    container.replaceChildren();
    (state.site.testimonials || []).slice(0, 3).forEach((review) => {
      const card = make('article', 'review-card');
      const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
      const stars = make('div', 'review-stars', '★'.repeat(rating));
      stars.setAttribute('aria-label', `Avaliação: ${rating} de 5 estrelas`);
      card.append(stars);
      const quote = make('blockquote', '', `“${review.text}”`);
      card.append(quote, make('p', 'review-card__name', review.name));
      if (review.demo) card.append(make('span', 'review-card__demo', 'Texto demonstrativo — troque por avaliação real autorizada.'));
      container.append(card);
    });
  }

  function renderHours() {
    const dayNames = { mon: 'Segunda', tue: 'Terça', wed: 'Quarta', thu: 'Quinta', fri: 'Sexta', sat: 'Sábado', sun: 'Domingo' };
    const container = $('#hours-list');
    container.replaceChildren();
    for (const [key, name] of Object.entries(dayNames)) {
      const hours = state.site.hours?.[key];
      const row = make('div', 'hours-row');
      row.append(make('span', '', name));
      row.append(make('strong', '', hours ? `${hours.open}–${hours.close}` : 'Fechado'));
      container.append(row);
    }
  }

  function renderContact() {
    const site = state.site;
    const placeholder = $('#contact-placeholder');
    const addressIsPlaceholder = !site.address || /substitua|endereço da barbearia/i.test(site.address);
    const mapLink = $('#map-link');
    const whatsappLink = $('#whatsapp-link');
    const mapUrl = safeExternalUrl(site.mapUrl) || (!addressIsPlaceholder
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address)}` : '');
    if (mapUrl) {
      mapLink.href = mapUrl;
      mapLink.hidden = false;
      if (!addressIsPlaceholder) {
        const frame = make('iframe', 'contact-map-frame');
        frame.title = `Mapa para ${site.businessName}`;
        frame.loading = 'lazy';
        frame.referrerPolicy = 'no-referrer-when-downgrade';
        frame.src = `https://www.google.com/maps?q=${encodeURIComponent(site.address)}&output=embed`;
        $('#contact-map').replaceChildren(frame);
      }
    }
    const phone = String(site.whatsappContact || '').replace(/\D/g, '');
    if (phone) {
      whatsappLink.href = `https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Gostaria de falar com ${site.businessName}.`)}`;
      whatsappLink.hidden = false;
    }
    if (!addressIsPlaceholder && (mapUrl || phone)) placeholder.hidden = true;
  }

  function refreshBookingSummary() {
    const summary = $('#booking-summary');
    const service = state.site.services.find((item) => item.id === state.serviceId);
    const barber = state.site.barbers.find((item) => item.id === state.barberId);
    const ready = Boolean(service && barber && state.time && $('#booking-date').value);
    summary.hidden = !ready;
    if (ready) summary.textContent = `${service.name} · ${barber.name} · ${$('#booking-date').value} às ${state.time} · ${money(service.priceCents)}`;
    $('#booking-form button[type="submit"]').disabled = !ready || state.bookingBusy;
  }

  function slotButton(slot) {
    const button = make('button', `slot-button${slot.available ? '' : ' slot-button--busy'}`);
    button.type = 'button';
    button.disabled = !slot.available;
    button.setAttribute('aria-disabled', String(!slot.available));
    button.setAttribute('aria-pressed', String(state.time === slot.time));
    if (state.time === slot.time) button.classList.add('slot-button--selected');
    button.append(make('span', '', slot.time));
    const stateLabel = slot.available ? 'Livre' : (slot.reason === 'past' ? 'Passou' : 'Ocupado');
    button.append(make('span', 'slot-button__state', stateLabel));
    if (slot.available) button.addEventListener('click', () => {
      state.time = slot.time;
      $$('.slot-button', $('#slot-grid')).forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      refreshBookingSummary();
    });
    return button;
  }

  async function loadAvailability() {
    const grid = $('#slot-grid');
    const status = $('#availability-status');
    state.time = '';
    refreshBookingSummary();
    const date = $('#booking-date').value;
    if (!state.serviceId || !state.barberId || !date) {
      grid.replaceChildren(make('p', 'slot-empty', 'Escolha primeiro serviço, barbeiro e dia.'));
      return;
    }
    grid.replaceChildren(make('p', 'slot-empty', 'Buscando horários…'));
    try {
      const query = new URLSearchParams({ date, serviceId: state.serviceId, barberId: state.barberId });
      const result = await api(`/api/availability?${query}`);
      grid.replaceChildren();
      if (!result.slots.length) {
        grid.append(make('p', 'slot-empty', 'Não há horários nesta data. Escolha outro dia.'));
        setMessage(status, 'A barbearia pode estar fechada neste dia.');
        return;
      }
      result.slots.forEach((slot) => grid.append(slotButton(slot)));
      const availableCount = result.slots.filter((slot) => slot.available).length;
      setMessage(status, availableCount ? `${availableCount} horário(s) livre(s).` : 'Não há horários livres neste dia.');
    } catch (error) {
      grid.replaceChildren(make('p', 'slot-empty', 'Não foi possível carregar a agenda. Tente novamente.'));
      setMessage(status, error.message, true);
    }
  }

  async function submitBooking(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $('#booking-status');
    if (!state.serviceId || !state.barberId || !state.time || !$('#booking-date').value) {
      setMessage(status, 'Escolha serviço, barbeiro, dia e horário antes de confirmar.', true);
      return;
    }
    const formData = new FormData(form);
    const payload = {
      clientName: formData.get('clientName'),
      clientPhone: formData.get('clientPhone'),
      notes: formData.get('notes'),
      whatsappConsent: formData.get('whatsappConsent') === 'on',
      serviceId: state.serviceId,
      barberId: state.barberId,
      date: $('#booking-date').value,
      time: state.time
    };
    state.bookingBusy = true;
    refreshBookingSummary();
    setMessage(status, 'Confirmando seu horário…');
    try {
      const result = await api('/api/appointments', { method: 'POST', body: JSON.stringify(payload) });
      setMessage(status, 'Agendamento confirmado. A cadeira já está reservada.');
      const when = `${result.appointment.date} às ${result.appointment.time}`;
      showToast(`Agendado: ${result.appointment.serviceName}, ${when}.`);
      form.reset();
      state.time = '';
      refreshBookingSummary();
      await loadAvailability();
    } catch (error) {
      setMessage(status, error.message, true);
      if (error.status === 409) await loadAvailability();
    } finally {
      state.bookingBusy = false;
      refreshBookingSummary();
    }
  }

  function setAdminView(view) {
    $('#admin-setup-view').hidden = view !== 'setup';
    $('#admin-login-view').hidden = view !== 'login';
    $('#admin-panel-view').hidden = view !== 'panel';
  }

  async function refreshAdminState() {
    try {
      const status = await api('/api/admin/status');
      state.admin = status;
      $('#admin-wa-status').textContent = status.whatsappConfigured
        ? 'Notificações WhatsApp configuradas no servidor.'
        : 'WhatsApp automático ainda não está configurado. A agenda e o painel continuam disponíveis.';
      if (status.authenticated) {
        $('#admin-welcome').textContent = `Olá, ${status.admin.name}. Aqui está a agenda do dia.`;
        setAdminView('panel');
        await loadAdminAppointments();
      } else if (!status.hasAdmin) {
        const canSetup = Boolean(status.setupAvailable);
        $$('input, button', $('#admin-setup-form')).forEach((control) => { control.disabled = !canSetup; });
        $('#setup-message').textContent = canSetup
          ? 'Primeiro acesso: use o token definido no servidor.'
          : 'O token de exemplo ou fraco não é aceito. Configure ADMIN_SETUP_TOKEN com pelo menos 32 caracteres aleatórios no servidor e reinicie antes do primeiro acesso.';
        setAdminView('setup');
      } else {
        setAdminView('login');
      }
    } catch (_) {
      showToast('Não foi possível abrir o painel. Verifique o servidor.', true);
    }
  }

  function formatPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const country = String(state.site?.phoneCountryCode || '55').replace(/\D/g, '');
    const local = digits.startsWith(country) ? digits.slice(country.length) : digits;
    if (country === '55' && (local.length === 10 || local.length === 11)) {
      const subscriber = local.slice(2);
      const formatted = subscriber.length === 9
        ? `${subscriber.slice(0, 5)}-${subscriber.slice(5)}`
        : `${subscriber.slice(0, 4)}-${subscriber.slice(4)}`;
      return `+55 (${local.slice(0, 2)}) ${formatted}`;
    }
    return `+${digits}`;
  }

  const statusNames = { scheduled: 'Agendado', confirmed: 'Confirmado', attended: 'Compareceu', missed: 'Faltou', cancelled: 'Cancelado' };

  function adminAppointmentCard(appointment) {
    const card = make('article', 'admin-appointment');
    const top = make('div', 'admin-appointment__top');
    top.append(make('strong', '', `${appointment.time} · ${appointment.clientName}`));
    const pill = make('span', `status-pill status-pill--${appointment.status}`, statusNames[appointment.status] || appointment.status);
    top.append(pill);
    const meta = make('p', 'admin-appointment__meta', `${appointment.serviceName} · ${appointment.barberName} · ${formatPhone(appointment.clientPhone)} · ${money(appointment.priceCents)}\n${appointment.durationMinutes} minutos${appointment.notes ? ` · ${appointment.notes}` : ''}`);
    const actions = make('div', 'admin-appointment__actions');
    const addAction = (status, label) => {
      const button = make('button', '', label);
      button.type = 'button';
      button.addEventListener('click', () => changeAppointmentStatus(appointment.id, status));
      actions.append(button);
    };
    if (['scheduled', 'confirmed'].includes(appointment.status)) {
      addAction('attended', 'Compareceu');
      addAction('missed', 'Faltou');
      addAction('cancelled', 'Cancelar');
    }
    card.append(top, meta);
    if (actions.childElementCount) card.append(actions);
    return card;
  }

  async function loadAdminAppointments() {
    const container = $('#admin-appointments');
    const selectedDate = $('#admin-date').value || state.site.todayLocal;
    const query = new URLSearchParams({ from: selectedDate, to: selectedDate });
    container.replaceChildren(make('p', 'admin-intro', 'Carregando agenda…'));
    try {
      const result = await api(`/api/admin/appointments?${query}`);
      container.replaceChildren();
      if (!result.appointments.length) {
        container.append(make('p', 'admin-intro', 'Nenhum agendamento neste dia.'));
        return;
      }
      result.appointments.forEach((item) => container.append(adminAppointmentCard(item)));
    } catch (error) {
      container.replaceChildren(make('p', 'admin-message is-error', error.message));
    }
  }

  async function changeAppointmentStatus(id, status) {
    try {
      await api(`/api/admin/appointments/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      showToast(`Status atualizado: ${statusNames[status]}.`);
      await loadAdminAppointments();
      if (state.serviceId && state.barberId) await loadAvailability();
    } catch (error) { showToast(error.message, true); }
  }

  async function submitAdminLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify(values) });
      form.reset();
      await refreshAdminState();
    } catch (error) { setMessage($('#login-message'), error.message, true); }
  }

  async function submitAdminSetup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await api('/api/admin/setup', { method: 'POST', body: JSON.stringify(values) });
      form.reset();
      showToast('Acesso administrativo criado.');
      await refreshAdminState();
    } catch (error) { setMessage($('#setup-message'), error.message, true); }
  }

  function bindNavigation() {
    const toggle = $('.nav-toggle');
    const nav = $('#primary-nav');
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
      nav.classList.toggle('is-open', open);
    });
    $$('#primary-nav a').forEach((link) => link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Abrir menu');
    }));
    $('#open-admin').addEventListener('click', async () => {
      const dialog = $('#admin-dialog');
      if (!dialog.open) dialog.showModal();
      await refreshAdminState();
    });
    $('#close-admin').addEventListener('click', () => $('#admin-dialog').close());
    $('#admin-dialog').addEventListener('click', (event) => {
      if (event.target === $('#admin-dialog')) $('#admin-dialog').close();
    });
    $('#admin-login-form').addEventListener('submit', submitAdminLogin);
    $('#admin-setup-form').addEventListener('submit', submitAdminSetup);
    $('#admin-logout').addEventListener('click', async () => {
      try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch (_) {}
      await refreshAdminState();
    });
    $('#refresh-admin').addEventListener('click', loadAdminAppointments);
    $('#admin-date').addEventListener('change', loadAdminAppointments);
  }

  async function init() {
    $('#year').textContent = String(new Date().getFullYear());
    bindNavigation();
    $('#booking-date').addEventListener('change', () => { state.time = ''; loadAvailability(); });
    $('#booking-form').addEventListener('submit', submitBooking);
    try {
      state.site = await api('/api/site');
      renderBrand();
      renderAboutGallery();
      renderServices();
      renderBarbers();
      renderGallery();
      renderTeam();
      renderReviews();
      renderHours();
      renderContact();
      $('#booking-date').min = state.site.todayLocal;
      $('#booking-date').value = state.site.todayLocal;
      $('#admin-date').value = state.site.todayLocal;
      $('#whatsapp-note').textContent = state.site.whatsappConfigured
        ? 'Marque a autorização acima para receber lembretes de 24 h e 1 h antes.'
        : 'A agenda funciona; os lembretes e avisos automáticos pelo WhatsApp serão ativados após configurar a integração Meta.';
      if (state.site.demoContent) showToast('Conteúdo de demonstração: personalize antes de publicar.');
    } catch (error) {
      setMessage($('#availability-status'), 'A agenda ainda não está conectada ao servidor. Inicie o projeto pelo README.', true);
      $('#booking-form button[type="submit"]').disabled = true;
      showToast('Inicie o servidor para carregar a homepage e os horários.', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
