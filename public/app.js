/* Remember me: all authoritative records live on the server. */
const $ = (s, root = document) => root.querySelector(s);
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const icons = {
  home: '⌂',
  calendar: '▦',
  notes: '▤',
  boards: '▥',
  reading: '▣',
  health: '♡',
  settings: '⚙',
};
const nav = [
  ['home', 'Visão geral'],
  ['calendar', 'Calendário'],
  ['notes', 'Notas'],
  ['boards', 'Quadros'],
  ['reading', 'Leitura'],
  ['health', 'Saúde'],
];
let user = null,
  records = [],
  route = 'home',
  selectedDate = '',
  calendarMode = 'month',
  selectedBoard = '',
  search = '',
  bookFilter = 'all',
  mail = [],
  saving = false;
let currentTheme = localStorage.getItem('aurora-theme') || 'light';
document.documentElement.dataset.theme = currentTheme;
const list = (kind) => records.filter((r) => r.kind === kind);
const get = (id) => records.find((r) => r.id === id);
const dateNow = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: user?.settings.timezone || 'America/Sao_Paulo',
  }).format(new Date());
const dateLabel = (d, options = { day: '2-digit', month: 'short' }) =>
  new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', options);
const shift = (d, n) =>
  new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const upcoming = () =>
  records
    .filter(
      (r) => ['event', 'card'].includes(r.kind) && r.data.date && !r.data.archived && !r.data.done,
    )
    .flatMap((r) =>
      r.kind === 'event' && r.data.deadline && r.data.deadline !== r.data.date
        ? [
            r,
            {
              ...r,
              data: { ...r.data, date: r.data.deadline, time: '', title: 'Prazo: ' + r.data.title },
            },
          ]
        : [r],
    )
    .sort((a, b) =>
      (a.data.date + (a.data.time || '23:59')).localeCompare(
        b.data.date + (b.data.time || '23:59'),
      ),
    );
async function api(path, method = 'GET', data) {
  const response = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || 'Não foi possível concluir.'), {
      status: response.status,
    });
  return result;
}
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').classList.add('visible');
  setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}
async function refresh() {
  records = await api('/records');
}
function badge(text, color = '#6366f1') {
  return `<span class="badge" style="--tag:${/^#[0-9a-f]{6}$/i.test(color) ? color : '#6366f1'}">${esc(text)}</span>`;
}
function catColor(name) {
  return user.settings.categories.find((c) => c.name === name)?.color || '#6366f1';
}
function empty(title, copy, action, label) {
  return `<div class="empty"><span class="empty-icon">✧</span><h3>${title}</h3><p>${copy}</p>${action ? `<button class="btn subtle" data-action="${action}">＋ ${label}</button>` : ''}</div>`;
}
function auth(register = false) {
  $('#app').innerHTML =
    `<main class="auth"><div class="auth-story"><a class="brand" href="/"><span class="brand-mark">R</span><span class="brand-name">Remember me</span></a><div><span class="eyebrow">MAIS ESPAÇO PARA O QUE IMPORTA</span><h1>Organize seus dias.<br>Cuide de você.</h1><p>Compromissos, ideias e pequenos hábitos.<br>Um lugar para acompanhar a sua vida.</p><div class="auth-chips"><span>▦ Sua agenda</span><span>▥ Seus projetos</span><span>♡ Seu bem-estar</span></div></div><small>Um dia de cada vez.</small></div><section class="auth-form"><div class="auth-box"><span class="eyebrow">SEU ESPAÇO PESSOAL</span><h2>${register ? 'Comece uma nova rotina' : 'Que bom ter você aqui'}</h2><p>${register ? 'Crie sua conta para guardar tudo em um só lugar.' : 'Entre para continuar de onde parou.'}</p><form id="auth-form">${register ? '<label>Como você quer ser chamado?<input name="name" autocomplete="given-name" maxlength="80" required placeholder="Seu nome"></label>' : ''}<label>E-mail<input type="email" name="email" autocomplete="email" required placeholder="voce@exemplo.com"></label><label>Senha<input type="password" name="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="12" maxlength="128" required placeholder="Pelo menos 12 caracteres"></label><p id="auth-error" class="error" role="alert"></p><button class="btn primary wide">${register ? 'Criar minha conta' : 'Entrar no meu espaço'} <span>→</span></button></form><p class="auth-switch">${register ? 'Já tem uma conta?' : 'Primeira vez por aqui?'} <button class="text-button" id="auth-toggle">${register ? 'Entrar' : 'Criar conta'}</button></p><small>Seus registros são privados e ficam vinculados à sua conta.</small></div></section></main>`;
  $('#auth-toggle').onclick = () => auth(!register);
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const button = $('button', e.target);
    button.disabled = true;
    try {
      await api(
        register ? '/register' : '/login',
        'POST',
        Object.fromEntries(new FormData(e.target)),
      );
      await init();
    } catch (err) {
      $('#auth-error').textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
function render() {
  if (!user) return;
  const today = dateNow();
  const greeting =
    new Date().getHours() < 12 ? 'Bom dia' : new Date().getHours() < 18 ? 'Boa tarde' : 'Boa noite';
  $('#app').innerHTML =
    `<div class="layout"><aside class="sidebar"><a class="brand" href="#home"><span class="brand-mark">R</span><span class="brand-name">Remember me</span></a><span class="nav-caption">MEU ESPAÇO</span><nav aria-label="Navegação principal">${nav.map(([id, name]) => `<button data-route="${id}" class="nav-item ${route === id ? 'active' : ''}"><span aria-hidden="true">${icons[id]}</span>${name}${id === 'notes' && list('note').length ? `<small>${list('note').length}</small>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="little-note"><span>✦</span><p>Pequenos passos,<br>dias mais leves.</p></div><button class="nav-item" data-route="settings"><span>⚙</span>Configurações</button><button class="profile" data-action="account"><span class="avatar">${esc(user.name.slice(0, 1).toUpperCase())}</span><span><strong>${esc(user.name)}</strong><small>Seu espaço pessoal</small></span><span>⌄</span></button></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">Meu espaço <span>/</span> <strong>${nav.find((n) => n[0] === route)?.[1] || 'Configurações'}</strong></div><div class="top-actions"><button class="icon-btn mobile-settings" data-action="account" aria-label="Configurações da conta">⚙</button><span class="today-label">${dateLabel(today, { day: 'numeric', month: 'long' })}</span><button class="icon-btn" data-action="theme" aria-label="Alternar tema">${currentTheme === 'dark' ? '☀' : '☾'}</button><button class="btn primary" data-action="quick">＋ <span>Adicionar</span></button></div></header><main id="main"><div class="page-heading"><div><span class="eyebrow">${route === 'home' ? dateLabel(today, { weekday: 'long' }).toUpperCase() : 'SEU ESPAÇO, NO SEU RITMO'}</span><h1>${route === 'home' ? `${greeting}, ${esc(user.name.split(' ')[0])} <span class="greeting-sun">☀</span>` : nav.find((n) => n[0] === route)?.[1] || 'Configurações'}</h1><p>${{ home: 'Vamos dar espaço ao que importa hoje?', calendar: 'Cada compromisso no seu tempo.', notes: 'Um lugar para suas ideias ganharem espaço.', boards: 'Do primeiro passo à tarefa concluída.', reading: 'Uma página de cada vez.', health: 'Pequenos cuidados fazem parte do dia.', settings: 'Deixe a Remember me do seu jeito.' }[route]}</p></div>${route === 'home' ? `<span class="date-pill">▦ ${dateLabel(today, { day: 'numeric', month: 'long', year: 'numeric' })}</span>` : ''}</div><div id="page">${route === 'home' ? dashboard() : pageFor(route)}</div></main><footer>Remember me <span>•</span> Um dia de cada vez.</footer></div></div>`;
  bind();
}
function eventRow(r) {
  const d = r.data;
  const localTime = new Intl.DateTimeFormat('pt-BR', {
    timeZone: user.settings.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  const overdue = d.date < dateNow() || (d.date === dateNow() && d.time && d.time < localTime);
  return `<button class="event-row" data-edit="${r.id}"><span class="event-time">${d.time || 'Dia todo'}<small>${dateLabel(d.date)}</small></span><span class="event-line" style="background:${catColor(d.category)}"></span><span class="event-info"><strong>${esc(d.title)}</strong><small>${esc(d.category || 'Tarefa do quadro')} ${overdue ? ' · Prazo vencido' : ''}</small></span><span class="row-arrow">↗</span></button>`;
}
function dashboard() {
  const today = dateNow(),
    events = upcoming(),
    day = events.filter((r) => r.data.date === today),
    tasks = list('card').filter((r) => !r.data.archived && !r.data.done),
    health = list('health').find((r) => r.data.date === today),
    water = health?.data.water || 0,
    books = list('book').filter((r) => r.data.status === 'Lendo'),
    notes = list('note')
      .sort((a, b) => Number(b.data.pinned) - Number(a.data.pinned))
      .slice(0, 3);
  return `<div class="stats-grid">${[
    ['▦', 'Compromissos hoje', day.length, 'Tudo no seu tempo', 'purple'],
    ['▥', 'Tarefas pendentes', tasks.length, 'Um passo de cada vez', 'blue'],
    ['▣', 'Livros em leitura', books.length, 'Alimente a curiosidade', 'orange'],
    [
      '♡',
      'Água hoje',
      `${(water / 1000).toLocaleString('pt-BR')} <small>L</small>`,
      `Meta: ${(user.settings.waterGoal / 1000).toLocaleString('pt-BR')} L`,
      'green',
    ],
  ]
    .map(
      ([icon, label, value, caption, color]) =>
        `<section class="stat"><span class="stat-icon ${color}">${icon}</span><span class="stat-label">${label}</span><strong>${value}</strong><small>${caption}</small></section>`,
    )
    .join(
      '',
    )}</div><div class="dashboard-grid"><div class="main-column"><section class="panel"><div class="panel-head"><h2>Seu dia <span class="count">${day.length}</span></h2><button class="text-button" data-route="calendar">Ver calendário ↗</button></div>${day.length ? day.map(eventRow).join('') : empty('Um pouco de espaço no seu dia', 'Nenhum compromisso por aqui. Que tal planejar algo importante?', 'new-event', 'Novo compromisso')}</section><section class="panel"><div class="panel-head"><h2>Próximos passos</h2><span class="muted">Prazos & tarefas</span></div>${
    events
      .filter((r) => r.data.date !== today)
      .slice(0, 4)
      .map(eventRow)
      .join('') ||
    empty('Tudo em dia', 'Seus próximos prazos aparecerão aqui.', 'new-card', 'Adicionar tarefa')
  }</section><section class="panel"><div class="panel-head"><h2>Notas à mão</h2><button class="text-button" data-route="notes">Todas as notas ↗</button></div><div class="note-preview-grid">${notes.length ? notes.map((n) => `<button class="note-preview" data-edit="${n.id}"><small>${n.data.pinned ? '⌖ FIXADA' : 'NOTA'} · ${dateLabel(n.data.date || today)}</small><h3>${esc(n.data.title)}</h3><p>${esc(n.data.content?.slice(0, 100) || 'Sem conteúdo')}</p></button>`).join('') : `<button class="note-add" data-action="new-note">＋<span>Guarde uma ideia</span></button>`}</div></section></div><aside class="right-column"><section class="focus-card"><span class="eyebrow">PAUSA PARA RESPIRAR</span><h2>Você não precisa<br>lembrar de tudo.</h2><p>Deixe os planos por aqui.<br>Leve o dia com mais leveza.</p><button class="btn white" data-action="new-event">Planejar meu dia <span>↗</span></button><span class="focus-symbol" aria-hidden="true">✳</span></section><section class="panel"><div class="panel-head"><h2>Seu bem-estar</h2><span>♡</span></div><div class="water-title"><span>Hidratação</span><strong>${water} <small>/ ${user.settings.waterGoal} ml</small></strong></div><progress max="${user.settings.waterGoal}" value="${water}" aria-label="Progresso de hidratação"></progress><button class="btn water-button wide" data-action="water">＋ 250 ml de água</button><button class="health-link" data-action="new-health"><span>${health?.data.workout === 'yes' ? '✓' : health?.data.workout === 'no' ? '−' : '○'} Treino de hoje</span><small>${health?.data.workout === 'yes' ? `${health.data.duration} min` : health?.data.workout === 'no' ? 'Não realizado' : 'Sem registro'} →</small></button></section><section class="panel"><div class="panel-head"><h2>Entre páginas</h2><button class="text-button" data-route="reading">↗</button></div>${books.length ? books.slice(0, 1).map(bookCard).join('') : empty('Sua próxima boa leitura', 'Adicione um livro para acompanhar cada página.', 'new-book', 'Adicionar livro')}</section></aside></div>`;
}
function pageFor(name) {
  return (
    {
      calendar: calendar,
      notes: notesPage,
      boards: boardsPage,
      reading: readingPage,
      health: healthPage,
      settings: settingsPage,
    }[name]?.() || ''
  );
}
function bookProgress(r) {
  return Math.min(
    r.data.pages,
    list('reading')
      .filter((x) => x.data.bookId === r.id && x.data.read === 'yes')
      .reduce((n, x) => n + x.data.pages, 0),
  );
}
function bookCard(r) {
  const d = r.data,
    pages = bookProgress(r),
    percent = Math.round((pages / d.pages) * 100);
  return `<div class="book-card"><button class="book-top" data-edit="${r.id}">${d.cover ? `<img src="/api/files/${d.cover}" alt="Capa de ${esc(d.title)}">` : `<span class="book-placeholder">▣</span>`}<span><small>${esc(d.status)}</small><h3>${esc(d.title)}</h3><p>${esc(d.author || 'Autor não informado')}</p></span></button><div class="water-title"><span>${pages} de ${d.pages} páginas</span><strong>${percent}%</strong></div><progress max="${d.pages}" value="${pages}" aria-label="Progresso de ${esc(d.title)}"></progress><button class="btn subtle wide" data-read-book="${r.id}">＋ Registrar leitura</button></div>`;
}
function calendar() {
  const date = selectedDate,
    events = upcoming();
  const start = date.slice(0, 8) + '01',
    first = new Date(start + 'T12:00:00').getDay(),
    monthDays = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
  let days = [];
  if (calendarMode === 'month')
    days = Array.from({ length: Math.ceil((first + monthDays) / 7) * 7 }, (_, i) =>
      shift(start, i - first),
    );
  if (calendarMode === 'week') {
    const dow = new Date(date + 'T12:00:00').getDay();
    days = Array.from({ length: 7 }, (_, i) => shift(date, i - dow));
  }
  if (calendarMode === 'day') days = [date];
  const dayEvents = events.filter((r) => r.data.date === date);
  const dayNotes = list('note').filter((n) => n.data.linked && n.data.date === date);
  return `<div class="toolbar"><div class="toolbar-group"><button class="icon-btn" data-cal-step="-1" aria-label="Período anterior">‹</button><h2>${dateLabel(date, { month: 'long', year: 'numeric' })}</h2><button class="icon-btn" data-cal-step="1" aria-label="Próximo período">›</button><button class="btn" data-action="today">Hoje</button></div><div class="toolbar-group"><div class="segmented" aria-label="Visualização do calendário">${[
    ['month', 'Mês'],
    ['week', 'Semana'],
    ['day', 'Dia'],
  ]
    .map(
      ([id, label]) =>
        `<button class="${calendarMode === id ? 'active' : ''}" data-cal-mode="${id}">${label}</button>`,
    )
    .join(
      '',
    )}</div><button class="btn primary" data-action="new-event">＋ Compromisso</button></div></div><div class="calendar-layout"><section class="calendar panel ${calendarMode}">${calendarMode !== 'day' ? `<div class="weekday-row">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((n) => `<span>${n}</span>`).join('')}</div>` : ''}<div class="calendar-grid">${days
    .map((d) => {
      const items = events.filter((r) => r.data.date === d);
      return `<div class="day-cell ${d.slice(0, 7) !== date.slice(0, 7) ? 'outside' : ''} ${d === selectedDate ? 'selected' : ''}"><button class="day-number ${d === dateNow() ? 'today' : ''}" data-day="${d}" aria-label="${dateLabel(d, { day: 'numeric', month: 'long' })}">${calendarMode === 'day' ? dateLabel(d, { weekday: 'long', day: 'numeric' }) : Number(d.slice(-2))}</button>${items
        .slice(0, calendarMode === 'month' ? 3 : 30)
        .map(
          (r) =>
            `<button class="calendar-event" style="--tag:${catColor(r.data.category)}" data-edit="${r.id}"><span>${r.data.time || ''}</span> ${esc(r.data.title)}<small>${esc(r.data.category || 'Tarefa')}</small></button>`,
        )
        .join(
          '',
        )}${items.length > 3 && calendarMode === 'month' ? `<button class="text-button" data-day="${d}">+${items.length - 3} mais</button>` : ''}${list('note').some((n) => n.data.linked && n.data.date === d) ? '<span class="day-note" title="Este dia tem notas">▤ Nota</span>' : ''}</div>`;
    })
    .join(
      '',
    )}</div></section><aside class="panel day-detail"><div class="panel-head"><h2>${dateLabel(date, { day: 'numeric', month: 'long' })}</h2><button class="text-button" data-action="new-event">＋</button></div>${dayEvents.map(eventRow).join('') || '<p class="muted">Nenhum compromisso neste dia.</p>'}<hr class="divider"><div class="panel-head"><h2>Notas do dia</h2><button class="text-button" data-action="day-note">＋ Nota</button></div>${dayNotes.map((n) => `<button class="note-preview wide" data-edit="${n.id}"><h3>${esc(n.data.title)}</h3><p>${esc(n.data.content?.slice(0, 160))}</p></button>`).join('') || '<p class="muted">Anote algo sobre este dia, mesmo sem um compromisso.</p>'}<p class="muted reminder-help">✉ Lembretes por e-mail: 7 dias antes, 1 dia antes e no dia.</p></aside></div>`;
}
function notesPage() {
  const items = list('note')
    .filter((r) =>
      `${r.data.title} ${r.data.content} ${(r.data.tags || []).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) => Number(b.data.pinned) - Number(a.data.pinned));
  return `<div class="toolbar"><input id="note-search" type="search" value="${esc(search)}" placeholder="Pesquisar notas e etiquetas…" aria-label="Pesquisar notas"><button class="btn primary" data-action="new-note">＋ Nova nota</button></div>${items.length ? `<div class="section-grid">${items.map((r) => `<button class="note-tile" data-edit="${r.id}"><div class="row"><small>${dateLabel(r.data.date, { day: 'numeric', month: 'long' })}</small><span class="grow"></span>${r.data.pinned ? '<span aria-label="Fixada">⌖</span>' : ''}</div><h2>${esc(r.data.title)}</h2><p>${esc(r.data.content || 'Sem conteúdo')}</p><div class="row wrap">${(r.data.tags || []).map((t) => badge(t)).join('')}${r.data.linked ? '<small>▦ No calendário</small>' : ''}</div></button>`).join('')}</div>` : empty(search ? 'Nenhuma nota encontrada' : 'Ideias merecem um lugar', search ? 'Experimente outra palavra ou etiqueta.' : 'Escreva, organize por etiquetas e fixe o que importa.', 'new-note', 'Escrever uma nota')}`;
}
function boardsPage() {
  const boards = list('board');
  if (!boards.length)
    return empty(
      'Tire seus planos do papel',
      'Crie um quadro, organize as etapas e acompanhe suas tarefas.',
      'new-board',
      'Criar meu primeiro quadro',
    );
  if (!boards.some((b) => b.id === selectedBoard)) selectedBoard = boards[0].id;
  const board = get(selectedBoard),
    columns = list('column')
      .filter((c) => c.data.boardId === board.id)
      .sort((a, b) => (a.data.order || 0) - (b.data.order || 0));
  const archived = list('card').filter((c) => c.data.boardId === board.id && c.data.archived);
  return `<div class="toolbar"><div class="toolbar-group"><select id="board-select" aria-label="Selecionar quadro">${boards.map((b) => `<option value="${b.id}" ${b.id === board.id ? 'selected' : ''}>${esc(b.data.title)}</option>`).join('')}</select><button class="btn" data-edit="${board.id}">Editar quadro</button><button class="text-button" data-action="new-board">＋ Novo quadro</button></div><button class="btn primary" data-action="new-column">＋ Nova lista</button></div><div class="kanban">${columns
    .map((c) => {
      const cards = list('card')
        .filter((r) => r.data.columnId === c.id && !r.data.archived)
        .sort((a, b) => (a.data.order || 0) - (b.data.order || 0));
      return `<section class="kanban-column" data-column-drop="${c.id}" draggable="true" data-drag-column="${c.id}"><div class="column-heading"><h2>${esc(c.data.title)} <small>${cards.length}</small></h2><button class="text-button" data-edit="${c.id}" aria-label="Editar lista ${esc(c.data.title)}">•••</button></div><div class="column-controls"><button data-column-move="${c.id}" data-direction="-1" aria-label="Mover lista para a esquerda">←</button><button data-column-move="${c.id}" data-direction="1" aria-label="Mover lista para a direita">→</button></div>${cards
        .map((r) => {
          const d = r.data;
          return `<article class="task-card" draggable="true" data-drag-card="${r.id}" data-card-drop="${r.id}">${d.cover ? `<img class="card-cover" src="/api/files/${d.cover}" alt="Capa da tarefa">` : ''}<button class="card-open" data-edit="${r.id}"><div class="row wrap">${(d.tags || []).map((t) => badge(t, d.color)).join('')}</div><h3>${esc(d.title)}</h3>${d.description ? `<p>${esc(d.description.slice(0, 110))}</p>` : ''}<div class="card-meta">${d.date ? `<span class="${d.date < dateNow() ? 'overdue' : ''}">▦ ${dateLabel(d.date)}</span>` : ''}${d.checklist?.length ? `<span>☑ ${d.checklist.filter((x) => x.done).length}/${d.checklist.length}</span>` : ''}${d.attachments?.length ? `<span>↗ ${d.attachments.length}</span>` : ''}${d.done ? '<span>✓ Concluído</span>' : ''}</div></button></article>`;
        })
        .join(
          '',
        )}<button class="add-card" data-new-in="${c.id}">＋ Adicionar tarefa</button></section>`;
    })
    .join(
      '',
    )}</div>${archived.length ? `<section class="panel archive"><h2>Arquivados (${archived.length})</h2>${archived.map((r) => `<button class="btn" data-edit="${r.id}">${esc(r.data.title)}</button>`).join('')}</section>` : ''}`;
}
function readingPage() {
  const books = list('book').filter((r) => bookFilter === 'all' || r.data.status === bookFilter),
    history = list('reading').sort((a, b) => b.data.date.localeCompare(a.data.date));
  const todayRead = history.filter((r) => r.data.date === dateNow());
  return `<div class="toolbar"><div class="segmented">${['all', 'Quero ler', 'Lendo', 'Concluído'].map((s) => `<button class="${bookFilter === s ? 'active' : ''}" data-book-filter="${s}">${s === 'all' ? 'Todos os livros' : s}</button>`).join('')}</div><div class="toolbar-group"><button class="btn" data-action="new-reading">Registrar meu dia</button><button class="btn primary" data-action="new-book">＋ Adicionar livro</button></div></div><p class="muted">Hoje: ${todayRead.length ? (todayRead.some((r) => r.data.read === 'yes') ? '✓ Leitura registrada' : 'Você registrou que não leu') : '○ Sem registro de leitura'}</p>${books.length ? `<div class="section-grid">${books.map((b) => `<section class="panel">${bookCard(b)}</section>`).join('')}</div>` : empty('Qual será a próxima história?', 'Cadastre um livro e registre suas páginas lidas.', 'new-book', 'Adicionar livro')}<section class="panel history"><div class="panel-head"><h2>Histórico de leitura</h2><span class="muted">${history.length} registros</span></div>${
    history
      .slice(0, 50)
      .map(
        (r) =>
          `<button class="history-row" data-edit="${r.id}"><span>${dateLabel(r.data.date, { day: 'numeric', month: 'long', year: 'numeric' })}</span><strong>${r.data.read === 'no' ? 'Não li neste dia' : esc(get(r.data.bookId)?.data.title || 'Livro')}</strong><span>${r.data.read === 'yes' ? `${r.data.pages} páginas` : '−'}</span><small>${esc(r.data.notes || '')}</small></button>`,
      )
      .join('') ||
    '<p class="muted">Seus registros aparecerão aqui. Dias sem registro ficam diferentes dos dias em que você não leu.</p>'
  }</section>`;
}
function healthPage() {
  const r = list('health').find((r) => r.data.date === selectedDate),
    d = r?.data;
  const dates = Array.from({ length: 7 }, (_, i) => shift(selectedDate, i - 6));
  const week = dates.map((date) => list('health').find((r) => r.data.date === date));
  return `<div class="toolbar"><div class="toolbar-group"><button class="icon-btn" data-health-day="-1" aria-label="Dia anterior">‹</button><input type="date" id="health-date" value="${selectedDate}" aria-label="Data do registro"><button class="icon-btn" data-health-day="1" aria-label="Próximo dia">›</button><button class="btn" data-action="today">Hoje</button></div><button class="btn primary" data-action="new-health">${d ? 'Editar' : 'Registrar'} meu dia</button></div><div class="section-grid"><section class="panel"><div class="panel-head"><h2>♡ Movimento</h2></div><strong class="large-value">${d?.workout === 'yes' ? d.duration + ' <small>min</small>' : d?.workout === 'no' ? 'Descanso' : 'Sem registro'}</strong><p>${d?.workout === 'yes' ? esc(d.activity || 'Atividade física') : d?.workout === 'no' ? 'Você informou que não treinou.' : 'Você ainda não informou se treinou.'}</p><p>${esc(d?.notes || '')}</p></section><section class="panel"><div class="panel-head"><h2>◉ Hidratação</h2></div><strong class="large-value">${d?.water || 0} <small>ml</small></strong><p>Meta diária: ${user.settings.waterGoal} ml</p><progress max="${user.settings.waterGoal}" value="${d?.water || 0}" aria-label="Água consumida"></progress><button class="btn water-button wide" data-action="water-date">＋ 250 ml</button></section><section class="panel"><div class="panel-head"><h2>◷ Refeições</h2></div>${[
    ['breakfast', 'Café da manhã'],
    ['lunch', 'Almoço'],
    ['dinner', 'Jantar'],
    ['snacks', 'Lanches'],
  ]
    .map(
      ([key, label]) =>
        `<div class="meal"><strong>${label}</strong><p>${esc(d?.[key] || 'Sem registro')}</p></div>`,
    )
    .join(
      '',
    )}</section></div><section class="panel history"><div class="panel-head"><h2>Seus últimos 7 dias</h2><span class="muted">Até ${dateLabel(selectedDate)}</span></div><div class="weekly-grid">${week.map((r, i) => `<button data-select-health="${dates[i]}" class="week-day"><strong>${dateLabel(dates[i], { weekday: 'short' })}</strong><small>${dateLabel(dates[i])}</small><div class="water-bar" style="--level:${Math.min(100, ((r?.data.water || 0) / user.settings.waterGoal) * 100)}%"><span></span></div><span>${r ? r.data.water + ' ml' : 'Sem registro'}</span><small>${r?.data.workout === 'yes' ? '✓ ' + r.data.duration + ' min' : r?.data.workout === 'no' ? '− Não treinou' : '○ Sem treino registrado'}</small><small>${r ? ['breakfast', 'lunch', 'dinner', 'snacks'].filter((k) => r.data[k]).length : 0}/4 refeições</small></button>`).join('')}</div></section>`;
}
function settingsPage() {
  return `${!user.emailConfigured ? '<div class="notice"><strong>O envio de e-mails ainda não está ativo.</strong><p>O administrador precisa configurar o serviço de e-mail no servidor. Seus registros continuam salvos.</p></div>' : !user.verified ? '<div class="notice"><strong>Confirme seu e-mail para ativar os lembretes.</strong> <button class="text-button" data-action="verify">Enviar link de confirmação</button></div>' : '<div class="notice success">✓ Serviço de e-mail configurado e endereço confirmado.</div>'}<div class="settings-grid"><section class="panel"><div class="panel-head"><h2>Preferências</h2></div><form id="settings-form"><label>Fuso horário<input name="timezone" value="${esc(user.settings.timezone)}" required list="timezones"><datalist id="timezones">${['America/Sao_Paulo', 'America/Manaus', 'America/Recife', 'America/Rio_Branco', 'America/Noronha', 'Europe/Lisbon', 'America/New_York'].map((v) => `<option value="${v}">`).join('')}</datalist></label><label>Horário dos lembretes para compromissos sem horário<input type="time" name="reminderTime" value="${user.settings.reminderTime}" required></label><label>Meta diária de água (ml)<input type="number" name="waterGoal" min="100" max="10000" step="50" value="${user.settings.waterGoal}" required></label><p class="muted">Todos os compromissos e cards com prazo têm lembretes por e-mail em 7 dias, 1 dia e no próprio dia. Só serão agendados horários futuros.</p><button class="btn primary">Salvar preferências</button></form></section><section class="panel"><div class="panel-head"><h2>Categorias</h2></div><div class="category-list">${user.settings.categories.map((c) => badge(c.name, c.color)).join('')}</div><form id="category-form"><label>Nome da nova categoria<input name="name" maxlength="50" required placeholder="Ex.: Estudos"></label><label>Cor<input type="color" name="color" value="#6553da"></label><button class="btn">＋ Adicionar categoria</button></form><hr class="divider"><h2>Sua conta</h2><p class="muted">${esc(user.email)} ${user.verified ? '· Confirmado' : '· Não confirmado'}</p><button class="btn" data-action="logout">Sair da conta</button></section></div><section class="panel history"><div class="panel-head"><h2>Acompanhamento dos e-mails</h2><button class="btn" data-action="mail-refresh">Atualizar</button></div><p class="muted">“Aceito pelo provedor” não confirma a entrega na caixa de entrada. Falhas permanentes exigem revisão do administrador.</p><div id="mail-list">${mail.length ? mail.map((m) => `<div class="history-row"><span>${new Date(m.due).toLocaleString('pt-BR', { timeZone: user.settings.timezone })}</span><strong>${esc(get(m.record_id)?.data.title || 'Registro removido')}</strong><span>${esc({ pending: 'Agendado', sent: 'Aceito pelo provedor', sending: 'Enviando', cancelled: 'Cancelado', failed: 'Falhou', review: 'Revisão necessária' }[m.status])}</span><small>${m.attempts} tentativa(s) ${esc(m.error || '')}</small></div>`).join('') : '<p class="muted">Clique em Atualizar para consultar o agendamento e os resultados.</p>'}</div></section>`;
}
function bind() {
  document.querySelectorAll('[data-route]').forEach(
    (b) =>
      (b.onclick = () => {
        route = b.dataset.route;
        location.hash = route;
        search = '';
        render();
      }),
  );
  document
    .querySelectorAll('[data-action]')
    .forEach((b) => (b.onclick = () => safe(() => action(b.dataset.action))));
  document
    .querySelectorAll('[data-edit]')
    .forEach((b) => (b.onclick = () => edit(get(b.dataset.edit))));
  document.querySelectorAll('[data-cal-mode]').forEach(
    (b) =>
      (b.onclick = () => {
        calendarMode = b.dataset.calMode;
        render();
      }),
  );
  document.querySelectorAll('[data-cal-step]').forEach(
    (b) =>
      (b.onclick = () => {
        const n = Number(b.dataset.calStep);
        if (calendarMode === 'month') {
          const d = new Date(selectedDate.slice(0, 7) + '-01T12:00:00Z');
          d.setUTCMonth(d.getUTCMonth() + n);
          selectedDate = d.toISOString().slice(0, 10);
        } else selectedDate = shift(selectedDate, n * (calendarMode === 'week' ? 7 : 1));
        render();
      }),
  );
  document.querySelectorAll('[data-day]').forEach(
    (b) =>
      (b.onclick = () => {
        selectedDate = b.dataset.day;
        render();
      }),
  );
  if ($('#note-search'))
    $('#note-search').oninput = (e) => {
      const pos = e.target.selectionStart;
      search = e.target.value;
      $('#page').innerHTML = notesPage();
      bind();
      $('#note-search').focus();
      $('#note-search').setSelectionRange(pos, pos);
    };
  if ($('#board-select'))
    $('#board-select').onchange = (e) => {
      selectedBoard = e.target.value;
      render();
    };
  document
    .querySelectorAll('[data-new-in]')
    .forEach(
      (b) =>
        (b.onclick = () =>
          edit(null, 'card', { boardId: selectedBoard, columnId: b.dataset.newIn })),
    );
  document.querySelectorAll('[data-book-filter]').forEach(
    (b) =>
      (b.onclick = () => {
        bookFilter = b.dataset.bookFilter;
        render();
      }),
  );
  document
    .querySelectorAll('[data-read-book]')
    .forEach(
      (b) => (b.onclick = () => edit(null, 'reading', { bookId: b.dataset.readBook, read: 'yes' })),
    );
  document.querySelectorAll('[data-health-day]').forEach(
    (b) =>
      (b.onclick = () => {
        selectedDate = shift(selectedDate, Number(b.dataset.healthDay));
        render();
      }),
  );
  document.querySelectorAll('[data-select-health]').forEach(
    (b) =>
      (b.onclick = () => {
        selectedDate = b.dataset.selectHealth;
        render();
      }),
  );
  if ($('#health-date'))
    $('#health-date').onchange = (e) => {
      if (e.target.value) {
        selectedDate = e.target.value;
        render();
      }
    };
  if ($('#settings-form'))
    $('#settings-form').onsubmit = (e) => {
      e.preventDefault();
      safe(async () => {
        const v = Object.fromEntries(new FormData(e.target));
        await api('/settings', 'PUT', { ...user.settings, ...v, waterGoal: Number(v.waterGoal) });
        user = await api('/me');
        toast('Preferências salvas. Lembretes atualizados.');
        render();
      });
    };
  if ($('#category-form'))
    $('#category-form').onsubmit = (e) => {
      e.preventDefault();
      safe(async () => {
        const c = Object.fromEntries(new FormData(e.target));
        if (user.settings.categories.some((x) => x.name.toLowerCase() === c.name.toLowerCase()))
          throw new Error('Esta categoria já existe.');
        await api('/settings', 'PUT', {
          ...user.settings,
          categories: [...user.settings.categories, c],
        });
        user = await api('/me');
        render();
        toast('Categoria adicionada.');
      });
    };
  bindDrag();
}
async function safe(fn) {
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  }
}
async function saveRecord(kind, data, existing) {
  const result = await api(
    existing ? '/records/' + existing.id : '/records',
    existing ? 'PUT' : 'POST',
    existing ? { data, version: existing.version } : { kind, data },
  );
  const i = records.findIndex((r) => r.id === result.id);
  if (i < 0) records.unshift(result);
  else records[i] = result;
  return result;
}
function showModal(title, content) {
  const modal = $('#modal');
  modal.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" id="modal-close" aria-label="Fechar">×</button></div><div class="modal-body">${content}</div>`;
  modal.showModal();
  $('#modal-close').onclick = () => closeModal();
  modal.oncancel = (e) => {
    e.preventDefault();
    closeModal();
  };
}
let editorDirty = false,
  editorSaving = false,
  autoTimer,
  editorRecord = null;
function closeModal() {
  if (editorSaving) {
    toast('Aguarde o salvamento terminar.');
    return;
  }
  if (editorDirty && !confirm('Há alterações não salvas. Deseja descartá-las?')) return;
  clearTimeout(autoTimer);
  $('#modal').close();
  editorDirty = false;
  render();
}
async function action(name) {
  if (name === 'theme') {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('aurora-theme', currentTheme);
    document.documentElement.dataset.theme = currentTheme;
    render();
    return;
  }
  if (name === 'today') {
    selectedDate = dateNow();
    render();
    return;
  }
  if (name === 'quick') {
    editorDirty = false;
    showModal(
      'O que vamos organizar?',
      `<div class="quick-grid">${[
        ['event', '▦', 'Compromisso'],
        ['note', '▤', 'Nota'],
        ['card', '▥', 'Tarefa'],
        ['book', '▣', 'Livro'],
        ['reading', '◷', 'Leitura do dia'],
        ['health', '♡', 'Saúde do dia'],
      ]
        .map(
          ([key, icon, label]) =>
            `<button class="quick-item" data-quick="${key}"><span>${icon}</span>${label}</button>`,
        )
        .join('')}</div>`,
    );
    document.querySelectorAll('[data-quick]').forEach(
      (b) =>
        (b.onclick = () => {
          $('#modal').close();
          safe(() => action('new-' + b.dataset.quick));
        }),
    );
    return;
  }
  if (name === 'account') {
    route = 'settings';
    render();
    return;
  }
  if (name === 'logout') {
    await api('/logout', 'POST', {});
    user = null;
    records = [];
    auth();
    return;
  }
  if (name === 'verify') {
    await api('/verify/send', 'POST', {});
    toast('Link enviado. Confira sua caixa de entrada.');
    return;
  }
  if (name === 'mail-refresh') {
    mail = await api('/mail');
    render();
    return;
  }
  if (name === 'water' || name === 'water-date') {
    const date = name === 'water' ? dateNow() : selectedDate;
    const old = list('health').find((r) => r.data.date === date);
    await saveRecord(
      'health',
      { date, workout: '', duration: 0, ...old?.data, water: (old?.data.water || 0) + 250 },
      old,
    );
    toast('Mais 250 ml registrados.');
    render();
    return;
  }
  if (name === 'day-note') {
    edit(null, 'note', { date: selectedDate, linked: true });
    return;
  }
  if (name.startsWith('new-')) {
    const kind = name.slice(4);
    if (kind === 'card' && !list('column').length) {
      route = 'boards';
      render();
      toast('Crie um quadro e uma lista para adicionar tarefas.');
      if (!list('board').length) edit(null, 'board');
      else edit(null, 'column', { boardId: selectedBoard || list('board')[0].id });
      return;
    }
    if (kind === 'health') {
      const date = route === 'health' ? selectedDate : dateNow();
      edit(
        list('health').find((r) => r.data.date === date),
        'health',
        { date },
      );
      return;
    }
    edit(null, kind, kind === 'event' && route === 'calendar' ? { date: selectedDate } : {});
  }
}
function field(name, label, value = '', type = 'text', extra = '') {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function area(name, label, value = '', extra = '') {
  return `<label class="full">${label}<textarea name="${name}" ${extra}>${esc(value)}</textarea></label>`;
}
function select(name, label, items, value) {
  return `<label>${label}<select name="${name}">${items
    .map((item) => {
      const [v, text] = Array.isArray(item) ? item : [item, item];
      return `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(text)}</option>`;
    })
    .join('')}</select></label>`;
}
function edit(record, kind = record?.kind, preset = {}) {
  if (!kind) return;
  clearTimeout(autoTimer);
  editorDirty = false;
  editorSaving = false;
  editorRecord = record || null;
  const d = { date: kind === 'card' ? '' : dateNow(), ...record?.data, ...preset };
  let fields = '';
  const titleField = field('title', 'Título', d.title, 'text', 'required maxlength="180"');
  if (kind === 'event')
    fields = `${titleField}<div class="form-grid">${field('date', 'Data do compromisso', d.date, 'date', 'required')}${field('time', 'Horário (opcional)', d.time, 'time')}${field('deadline', 'Prazo (opcional)', d.deadline, 'date')}${select(
      'category',
      'Categoria',
      user.settings.categories.map((c) => c.name),
      d.category,
    )}</div>${area('notes', 'Observações', d.notes)}<p class="muted">✉ Você receberá e-mails 7 dias antes, 1 dia antes e no dia, nos horários ainda futuros.${!user.emailConfigured ? ' O serviço de e-mail ainda precisa ser configurado.' : !user.verified ? ' Confirme seu e-mail nas configurações.' : ''}</p>`;
  if (kind === 'note')
    fields = `<div class="save-status" role="status" id="save-state">${record ? 'Todas as alterações salvas' : 'Salvamento automático após preencher o título'}</div>${titleField}${area('content', 'Sua nota', d.content, 'rows="8"')}${field('tags', 'Etiquetas (separadas por vírgula)', d.tags?.join(', '))}${field('date', 'Data', d.date, 'date', 'required')}<label class="check-label"><input type="checkbox" name="linked" ${d.linked ? 'checked' : ''}> Associar a este dia no calendário</label><label class="check-label"><input type="checkbox" name="pinned" ${d.pinned ? 'checked' : ''}> Fixar nota importante</label>`;
  if (kind === 'board')
    fields = `${titleField}${area('description', 'Descrição', d.description)}${record ? '<p class="muted">Excluir o quadro também exclui suas listas e tarefas.</p>' : '<p class="muted">O quadro começará com A fazer, Em andamento e Concluído.</p>'}`;
  if (kind === 'column')
    fields = `${titleField}${field('order', 'Posição da lista', d.order ?? list('column').length, 'number', 'min="0" step="1" required')}<p class="muted">Excluir a lista também exclui os cards que estão nela.</p>`;
  if (kind === 'card') {
    const boardId = d.boardId || selectedBoard || list('board')[0]?.id;
    const columns = list('column')
      .filter((c) => c.data.boardId === boardId)
      .sort((a, b) => (a.data.order || 0) - (b.data.order || 0));
    d.boardId = boardId;
    d.columnId = d.columnId || columns[0]?.id;
    fields = `${titleField}${area('description', 'Descrição', d.description)}<div class="form-grid">${select(
      'columnId',
      'Lista',
      columns.map((c) => [c.id, c.data.title]),
      d.columnId,
    )}${field('order', 'Posição na lista', d.order ?? list('card').length, 'number', 'min="0" step="1" required')}${field('date', 'Prazo (sincronizado ao calendário)', d.date, 'date')}${field('time', 'Horário do prazo (opcional)', d.time, 'time')}${field('tags', 'Etiquetas (separadas por vírgula)', d.tags?.join(', '))}${field('color', 'Cor da etiqueta', d.color || '#6553da', 'color')}</div><label class="check-label"><input name="done" type="checkbox" ${d.done ? 'checked' : ''}> Tarefa concluída</label><div class="checklist-editor"><h3>Checklist</h3><div id="check-items">${(d.checklist || []).map((c, i) => checkItem(c, i)).join('')}</div><button class="text-button" type="button" id="add-check">＋ Adicionar item</button></div>${uploadFields(d, true)}<label class="check-label"><input name="archived" type="checkbox" ${d.archived ? 'checked' : ''}> Arquivar esta tarefa</label><p class="muted">O prazo aparece automaticamente no calendário. Tarefas concluídas ou arquivadas não geram novos lembretes.</p>`;
  }
  if (kind === 'book')
    fields = `${titleField}${field('author', 'Autor', d.author)}<div class="form-grid">${field('pages', 'Total de páginas', d.pages || '', 'number', 'min="1" max="100000" step="1" required')}${select('status', 'Status', ['Quero ler', 'Lendo', 'Concluído'], d.status || 'Quero ler')}</div>${uploadFields(d, false)}${area('notes', 'Observações', d.notes)}`;
  if (kind === 'reading')
    fields = `<div class="form-grid">${field('date', 'Dia da leitura', d.date, 'date', 'required')}${select(
      'read',
      'Você leu neste dia?',
      [
        ['yes', 'Sim, eu li'],
        ['no', 'Não li'],
      ],
      d.read || 'yes',
    )}</div>${select('bookId', 'Livro', [['', 'Selecione um livro'], ...list('book').map((b) => [b.id, b.data.title])], d.bookId)}${field('pages', 'Páginas lidas neste dia', d.pages || '', 'number', 'min="1" max="100000" step="1"')}${area('notes', 'Observações', d.notes)}`;
  if (kind === 'health')
    fields = `${field('date', 'Dia do registro', d.date, 'date', 'required')}<div class="form-grid">${select(
      'workout',
      'Houve treino?',
      [
        ['', 'Ainda não registrei'],
        ['yes', 'Sim, treinei'],
        ['no', 'Não treinei'],
      ],
      d.workout || '',
    )}${field('activity', 'Tipo de atividade', d.activity)}${field('duration', 'Duração (minutos)', d.duration || 0, 'number', 'min="0" max="1440" required')}${field('water', 'Água consumida (ml)', d.water || 0, 'number', 'min="0" max="30000" required')}</div>${area('notes', 'Observações do treino', d.notes)}<h3>Refeições</h3><div class="form-grid">${[
      ['breakfast', 'Café da manhã'],
      ['lunch', 'Almoço'],
      ['dinner', 'Jantar'],
      ['snacks', 'Lanches'],
    ]
      .map(([key, label]) => area(key, label, d[key]))
      .join('')}</div>`;
  const names = {
    event: 'compromisso',
    note: 'nota',
    board: 'quadro',
    column: 'lista',
    card: 'tarefa',
    book: 'livro',
    reading: 'registro de leitura',
    health: 'registro de saúde',
  };
  showModal(
    `${record ? 'Editar' : 'Adicionar'} ${names[kind]}`,
    `<form id="editor">${fields}<p class="error" id="editor-error" role="alert"></p><div class="modal-actions">${record ? '<button type="button" class="btn danger" id="delete-record">Excluir</button>' : ''}${record && kind === 'card' ? '<button type="button" class="btn" id="duplicate-card">Duplicar</button>' : ''}<span class="grow"></span><button class="btn" type="button" id="cancel-edit">Fechar</button><button class="btn primary" id="save-record">Salvar</button></div></form>`,
  );
  const form = $('#editor');
  $('#cancel-edit').onclick = closeModal;
  form.oninput = () => {
    editorDirty = true;
    if (kind === 'note') {
      clearTimeout(autoTimer);
      $('#save-state').textContent = 'Alterações pendentes…';
      autoTimer = setTimeout(() => persist(false), 850);
    }
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    clearTimeout(autoTimer);
    persist(true);
  };
  const persist = async (close) => {
    if (editorSaving) return;
    if (!form.reportValidity()) return;
    editorSaving = true;
    $('#save-record').disabled = true;
    const snapshot = new FormData(form);
    try {
      const data = { ...d, ...Object.fromEntries(snapshot) };
      for (const key of ['pages', 'duration', 'water', 'order'])
        if (key in data) data[key] = Number(data[key]);
      if (['note', 'card'].includes(kind))
        data.tags = String(data.tags || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
          .slice(0, 20);
      for (const key of ['pinned', 'linked', 'done', 'archived'])
        if (form.elements.namedItem(key)) data[key] = snapshot.has(key);
      if (kind === 'card') {
        data.checklist = [...document.querySelectorAll('.check-item')]
          .map((row) => ({
            text: $('input[type=text]', row).value,
            done: $('input[type=checkbox]', row).checked,
          }))
          .filter((x) => x.text.trim());
        data.boardId = d.boardId;
      }
      if (kind === 'column') data.boardId = d.boardId || selectedBoard;
      if (kind === 'book' || kind === 'card') {
        const cover = $('#cover-file').files[0];
        if (cover) {
          if (!['image/jpeg', 'image/png'].includes(cover.type))
            throw new Error('A capa deve ser uma imagem JPEG ou PNG.');
          data.cover = (await upload(cover)).id;
        }
        if ($('#remove-cover')?.checked) data.cover = '';
        if (kind === 'card') {
          data.attachments = (d.attachments || []).filter(
            (f) => !document.querySelector(`[data-remove-file="${f.id}"]`)?.checked,
          );
          for (const file of $('#attachment-files').files)
            data.attachments.push(await upload(file));
        }
      }
      if (kind === 'reading' && data.read === 'no') {
        data.pages = 0;
        data.bookId = '';
      }
      if (kind === 'reading' && data.read === 'yes' && !data.bookId)
        throw new Error('Escolha um livro para registrar a leitura.');
      if (kind === 'health' && data.workout !== 'yes') {
        data.duration = 0;
        data.activity = '';
      }
      const wasNew = !editorRecord;
      editorRecord = await saveRecord(kind, data, editorRecord);
      if (kind === 'board' && wasNew) {
        selectedBoard = editorRecord.id;
        for (const [i, title] of ['A fazer', 'Em andamento', 'Concluído'].entries())
          await saveRecord('column', { title, boardId: selectedBoard, order: i });
      }
      // The next autosave uses the returned version. Edits made during the request remain dirty.
      const changed = JSON.stringify([...new FormData(form)]) !== JSON.stringify([...snapshot]);
      editorDirty = changed;
      if ($('#save-state'))
        $('#save-state').textContent = changed
          ? 'Alterações pendentes…'
          : 'Todas as alterações salvas';
      $('#editor-error').textContent = '';
      if (close && !changed) {
        $('#modal').close();
        render();
        toast('Salvo com carinho.');
      } else if (changed && kind === 'note') autoTimer = setTimeout(() => persist(false), 400);
    } catch (e) {
      $('#editor-error').textContent = e.message;
      if ($('#save-state')) $('#save-state').textContent = 'Não foi salvo — tente novamente';
      editorDirty = true;
    } finally {
      editorSaving = false;
      if ($('#save-record')) $('#save-record').disabled = false;
    }
  };
  if ($('#delete-record'))
    $('#delete-record').onclick = () =>
      safe(async () => {
        if (editorSaving) return;
        if (
          !confirm(
            `Excluir ${names[kind]}? ${['board', 'column', 'book'].includes(kind) ? 'Os registros associados também serão excluídos. ' : ''}Esta ação não pode ser desfeita.`,
          )
        )
          return;
        clearTimeout(autoTimer);
        await api('/records/' + editorRecord.id, 'DELETE');
        await refresh();
        editorDirty = false;
        $('#modal').close();
        render();
        toast('Registro excluído.');
      });
  if ($('#duplicate-card'))
    $('#duplicate-card').onclick = () =>
      safe(async () => {
        await saveRecord('card', {
          ...record.data,
          title: record.data.title + ' (cópia)',
          archived: false,
        });
        toast('Tarefa duplicada.');
      });
  if ($('#add-check')) {
    $('#add-check').onclick = () => {
      $('#check-items').insertAdjacentHTML(
        'beforeend',
        checkItem({ text: '', done: false }, Date.now()),
      );
      editorDirty = true;
      bindChecks();
    };
    bindChecks();
  }
  if (kind === 'reading') {
    const change = () => {
      const no = form.elements.namedItem('read').value === 'no';
      for (const name of ['bookId', 'pages']) {
        form.elements.namedItem(name).disabled = no;
        form.elements.namedItem(name).required = !no;
      }
    };
    form.elements.namedItem('read').onchange = change;
    change();
  }
}
function checkItem(c, i) {
  return `<div class="check-item"><input type="checkbox" ${c.done ? 'checked' : ''} aria-label="Item concluído"><input type="text" value="${esc(c.text)}" aria-label="Descrição do item" maxlength="200"><button type="button" data-remove-check="${i}" class="text-button" aria-label="Remover item">×</button></div>`;
}
function bindChecks() {
  document.querySelectorAll('[data-remove-check]').forEach(
    (b) =>
      (b.onclick = () => {
        b.closest('.check-item').remove();
        editorDirty = true;
      }),
  );
}
function uploadFields(d, attachments) {
  return `<label>Capa (JPEG ou PNG, até 5 MB)<input id="cover-file" type="file" accept="image/jpeg,image/png"></label>${d.cover ? `<div class="row"><img class="cover-preview" src="/api/files/${d.cover}" alt="Capa atual"><label class="check-label"><input type="checkbox" id="remove-cover"> Remover capa</label></div>` : ''}${attachments ? `<label>Anexos (JPEG, PNG ou PDF, até 5 MB cada)<input id="attachment-files" type="file" accept="image/jpeg,image/png,application/pdf" multiple></label>${(d.attachments || []).map((f) => `<div class="attachment-row"><a href="/api/files/${f.id}" target="_blank" rel="noopener">${esc(f.name)}</a><label class="check-label"><input type="checkbox" data-remove-file="${f.id}"> Remover</label></div>`).join('')}` : ''}`;
}
async function upload(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Envie arquivos com até 5 MB.');
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return api('/files', 'POST', { name: file.name, mime: file.type, base64 });
}
async function reorder(kind, sourceId, targetId, direction = 0) {
  const source = get(sourceId),
    target = get(targetId);
  if (!source || !target || source.id === target.id) return;
  const parent = kind === 'column' ? 'boardId' : 'columnId';
  const targetParent = target.data[parent];
  const sorted = list(kind)
    .filter((r) => r.data[parent] === targetParent && r.id !== source.id)
    .sort((a, b) => (a.data.order || 0) - (b.data.order || 0));
  let index = sorted.findIndex((r) => r.id === targetId);
  if (direction > 0) index++;
  sorted.splice(Math.max(0, index), 0, source);
  for (let i = 0; i < sorted.length; i++)
    await saveRecord(
      kind,
      { ...sorted[i].data, [parent]: targetParent, order: i },
      get(sorted[i].id),
    );
  render();
}
function bindDrag() {
  document.querySelectorAll('[data-drag-card]').forEach(
    (el) =>
      (el.ondragstart = (e) => {
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', 'card:' + el.dataset.dragCard);
      }),
  );
  document.querySelectorAll('[data-drag-column]').forEach(
    (el) =>
      (el.ondragstart = (e) => {
        if (e.target !== el) return;
        e.dataTransfer.setData('text/plain', 'column:' + el.dataset.dragColumn);
      }),
  );
  document.querySelectorAll('[data-card-drop]').forEach((el) => {
    el.ondragover = (e) => e.preventDefault();
    el.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const [kind, id] = e.dataTransfer.getData('text/plain').split(':');
      if (kind === 'card') safe(() => reorder('card', id, el.dataset.cardDrop));
    };
  });
  document.querySelectorAll('[data-column-drop]').forEach((el) => {
    el.ondragover = (e) => {
      e.preventDefault();
    };
    el.ondrop = (e) => {
      e.preventDefault();
      const [kind, id] = e.dataTransfer.getData('text/plain').split(':');
      if (kind === 'column') safe(() => reorder('column', id, el.dataset.columnDrop));
      else if (kind === 'card')
        safe(async () => {
          const r = get(id);
          if (!r) return;
          const max = Math.max(
            0,
            ...list('card')
              .filter((c) => c.data.columnId === el.dataset.columnDrop)
              .map((c) => c.data.order || 0),
          );
          await saveRecord(
            'card',
            { ...r.data, columnId: el.dataset.columnDrop, order: max + 1 },
            r,
          );
          render();
        });
    };
  });
  document.querySelectorAll('[data-column-move]').forEach(
    (b) =>
      (b.onclick = () =>
        safe(async () => {
          const r = get(b.dataset.columnMove),
            n = Number(b.dataset.direction);
          const columns = list('column')
            .filter((c) => c.data.boardId === r.data.boardId)
            .sort((a, b) => (a.data.order || 0) - (b.data.order || 0));
          const target = columns[columns.findIndex((c) => c.id === r.id) + n];
          if (target) await reorder('column', r.id, target.id, n);
        })),
  );
}
window.addEventListener('beforeunload', (e) => {
  if (editorDirty || editorSaving) {
    e.preventDefault();
    e.returnValue = '';
  }
});
async function init() {
  try {
    user = await api('/me');
    selectedDate = selectedDate || dateNow();
    route = location.hash.slice(1) || 'home';
    if (![...nav.map((n) => n[0]), 'settings'].includes(route)) route = 'home';
    await refresh();
    render();
    const params = new URLSearchParams(location.search);
    if (params.has('verify')) {
      try {
        await api('/verify', 'POST', { token: params.get('verify') });
        user = await api('/me');
        toast('E-mail confirmado. Seus lembretes estão ativos.');
      } catch (e) {
        toast(e.message);
      }
      history.replaceState(null, '', '/');
    }
    if (params.has('record')) {
      const r = get(params.get('record'));
      if (r) edit(r);
      else toast('Este registro não está disponível nesta conta.');
    }
  } catch (e) {
    if (e.status === 401) auth();
    else {
      $('#app').innerHTML =
        `<main class="boot"><h1>Não foi possível carregar seu espaço</h1><p>${esc(e.message)}</p><button class="btn primary" id="retry-init">Tentar novamente</button></main>`;
      $('#retry-init').onclick = init;
    }
  }
}
init();
