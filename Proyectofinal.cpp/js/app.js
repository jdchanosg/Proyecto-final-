"use strict";

const SECTION_LABELS = {
  dashboard: "Dashboard",
  passport: "Pasaporte futbolístico",
  evaluations: "Evaluaciones",
  development: "Evolución deportiva",
  showcase: "Tarjeta para visorías",
  goals: "Objetivos y desafíos",
  reports: "Informes",
  settings: "Configuración"
};
const STORAGE_KEY = "proPlayer.data";
const LEGACY_KEYS = { players: "proPlayer.players" };
const WEIGHTS = { Técnica: 35, Física: 30, Táctica: 25, Actitudinal: 10 };
const GROUPS = {
  Técnica: { control: "Control de balón", pase: "Precisión de pase", regate: "Regate", remate: "Precisión de remate", ambasPiernas: "Dominio de ambas piernas" },
  Física: { velocidad: "Velocidad", resistencia: "Resistencia", aceleracion: "Aceleración", agilidad: "Agilidad", potencia: "Potencia", coordinacion: "Coordinación" },
  Táctica: { posicionamiento: "Posicionamiento", vision: "Visión de juego", decisiones: "Toma de decisiones", equipo: "Trabajo en equipo" },
  Actitudinal: { disciplina: "Disciplina", compromiso: "Compromiso", concentracion: "Concentración", comunicacion: "Comunicación" }
};
const POSITIONS = ["Portero", "Defensa central", "Lateral", "Mediocentro defensivo", "Mediocentro", "Volante ofensivo", "Extremo", "Delantero"];
const AVATARS = ["⚽", "🧤", "🏃", "⭐", "🦅", "🐺", "🦁", "🔥"];
const EMPTY_STATE = { version: 1, players: [], evaluations: [], goals: [], selectedPlayerId: "", preferences: { theme: "dark" } };
const sidebar = document.querySelector("#sidebar");
const mobileBackdrop = document.querySelector("#mobile-backdrop");
const menuToggle = document.querySelector("#menu-toggle");
const toast = document.querySelector("#toast");
const charts = new Map();
let toastTimeout;
let data = loadData();
let playerQuery = "";

function showToast(message, type = "success") {
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 3400);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeState(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new TypeError("El archivo no contiene un objeto de PRO PLAYER.");
  for (const key of ["players", "evaluations", "goals"]) {
    if (!Array.isArray(candidate[key])) throw new TypeError(`El campo "${key}" debe ser una lista.`);
  }
  const playerIds = new Set();
  const players = candidate.players.map((p) => {
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !p.id || typeof p.fullName !== "string" || !p.fullName.trim()) throw new TypeError("Hay un perfil con datos obligatorios inválidos.");
    if (playerIds.has(p.id)) throw new TypeError("El archivo contiene identificadores de jugador duplicados.");
    playerIds.add(p.id);
    if (p.birthDate && !validDate(p.birthDate)) throw new TypeError(`La fecha de nacimiento de ${p.fullName} no es válida.`);
    if (p.photo && (typeof p.photo !== "string" || !p.photo.startsWith("data:image/") || p.photo.length >= 2_500_000)) throw new TypeError(`La fotografía de ${p.fullName} no es válida o supera el límite permitido.`);
    return {
      id: p.id, fullName: p.fullName.trim(), birthDate: p.birthDate || "", height: finiteOrEmpty(p.height), weight: finiteOrEmpty(p.weight),
      position: String(p.position || ""), secondaryPosition: String(p.secondaryPosition || ""), dominantFoot: String(p.dominantFoot || ""),
      club: String(p.club || ""), city: String(p.city || ""), country: String(p.country || ""), experience: finiteOrEmpty(p.experience),
      career: String(p.career || ""), description: String(p.description || ""), strengths: String(p.strengths || ""),
      contact: String(p.contact || ""), contactPublic: p.contactPublic === true, photo: safePhoto(p.photo), avatar: AVATARS.includes(p.avatar) ? p.avatar : "⚽",
      createdAt: String(p.createdAt || new Date().toISOString())
    };
  });
  const evaluationIds = new Set();
  const evaluations = candidate.evaluations.map((e) => {
    if (!e || typeof e !== "object" || typeof e.id !== "string" || !e.id || !playerIds.has(e.playerId) || !validDate(e.date) || !e.scores || typeof e.scores !== "object") throw new TypeError("Hay una evaluación inválida o asociada a un jugador inexistente.");
    if (evaluationIds.has(e.id)) throw new TypeError("El archivo contiene identificadores de evaluación duplicados.");
    evaluationIds.add(e.id);
    const scores = {};
    for (const key of Object.keys(GROUPS).flatMap((group) => Object.keys(GROUPS[group]))) {
      const score = Number(e.scores[key]);
      if (!Number.isFinite(score) || score < 0 || score > 100) throw new TypeError("Las puntuaciones deben ser números entre 0 y 100.");
      scores[key] = score;
    }
    return { id: e.id, playerId: e.playerId, date: e.date, evaluator: String(e.evaluator || ""), testType: String(e.testType || ""), observations: String(e.observations || ""), scores, createdAt: String(e.createdAt || `${e.date}T12:00:00.000Z`) };
  });
  const goalIds = new Set();
  const goals = candidate.goals.map((g) => {
    if (!g || typeof g !== "object" || typeof g.id !== "string" || !g.id || !playerIds.has(g.playerId) || typeof g.title !== "string" || !g.title.trim() || !validDate(g.dueDate)) throw new TypeError("Hay un objetivo inválido o asociado a un jugador inexistente.");
    if (goalIds.has(g.id)) throw new TypeError("El archivo contiene identificadores de objetivo duplicados.");
    goalIds.add(g.id);
    const target = Number(g.target);
    const progress = Number(g.progress);
    if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(progress) || progress < 0) throw new TypeError("Las metas deben ser positivas y el avance no puede ser negativo.");
    return { id: g.id, playerId: g.playerId, title: g.title.trim(), description: String(g.description || ""), category: String(g.category || "Técnica"), dueDate: g.dueDate, unit: String(g.unit || "sesiones"), target, progress: Math.min(progress, target), completed: g.completed === true || progress >= target, createdAt: String(g.createdAt || new Date().toISOString()) };
  });
  return { version: 1, players, evaluations, goals, selectedPlayerId: playerIds.has(candidate.selectedPlayerId) ? candidate.selectedPlayerId : (players[0]?.id || ""), preferences: { theme: "dark" } };
}

function finiteOrEmpty(value) {
  if (value === "" || value == null) return "";
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError("El archivo incluye una medida numérica inválida.");
  return number;
}

function safePhoto(value) {
  return typeof value === "string" && value.startsWith("data:image/") && value.length < 2_500_000 ? value : "";
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_KEYS.players);
    if (legacy) {
      const players = JSON.parse(legacy);
      if (Array.isArray(players)) {
        const migrated = players.filter((p) => p && typeof p.fullName === "string").map((p) => ({ ...p, id: p.id || crypto.randomUUID(), birthDate: p.birthDate || "", height: p.height || "", weight: p.weight || "", position: p.position || "", secondaryPosition: p.secondaryPosition || "", dominantFoot: p.dominantFoot || "", club: p.club || "", city: p.city || "", country: p.country || "", experience: p.experience || "", career: p.career || "", description: p.description || "", strengths: p.strengths || "", contact: p.contact || "", contactPublic: false, photo: safePhoto(p.photo), avatar: p.avatar || "⚽" }));
        return normalizeState({ ...EMPTY_STATE, players, selectedPlayerId: players[0]?.id || "" });
      }
    }
    return structuredClone(EMPTY_STATE);
  } catch (error) {
    console.error("No se pudieron cargar o validar los datos guardados.", error);
    window.setTimeout(() => showToast("No se pudieron cargar los datos guardados. Revisa el almacenamiento del navegador.", "error"), 0);
    return structuredClone(EMPTY_STATE);
  }
}

function saveData() {
  const normalized = normalizeState(data);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    data = normalized;
    return true;
  } catch (error) {
    console.error("No se pudieron guardar los datos en LocalStorage.", error);
    showToast("No se pudieron guardar los cambios. Revisa el espacio disponible del navegador.", "error");
    return false;
  }
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `pp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeAttr(value = "") { return escapeHtml(value); }
function getPlayer(id) { return data.players.find((player) => player.id === id); }
function evaluationsFor(playerId) { return data.evaluations.filter((e) => e.playerId === playerId).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)); }
function goalsFor(playerId) { return data.goals.filter((goal) => goal.playerId === playerId); }
function categoryAverage(evaluation, category) {
  const values = Object.keys(GROUPS[category]).map((key) => evaluation.scores[key]).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function evaluationSummary(evaluation) {
  const categories = {};
  for (const category of Object.keys(GROUPS)) categories[category] = categoryAverage(evaluation, category);
  const enough = Object.values(categories).every((value) => value !== null);
  return { categories, index: enough ? Object.keys(WEIGHTS).reduce((sum, category) => sum + categories[category] * WEIGHTS[category] / 100, 0) : null };
}
function latestEvaluation(playerId) { return evaluationsFor(playerId).at(-1) || null; }
function ageAt(date, today = new Date()) {
  if (!validDate(date)) return null;
  const birth = new Date(`${date}T00:00:00`);
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : null;
}
function averageIndex(playerId) {
  const last = latestEvaluation(playerId);
  return last ? evaluationSummary(last).index : null;
}
function selectedPlayer() {
  return getPlayer(data.selectedPlayerId) || data.players[0] || null;
}
function formatDate(value) {
  if (!validDate(value)) return "—";
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}
function playerAvatar(player, size = "avatar-large") {
  return player.photo ? `<img class="${size}" src="${escapeAttr(player.photo)}" alt="Fotografía de ${escapeAttr(player.fullName)}">` : `<span class="${size} avatar-placeholder" aria-label="Avatar">${escapeHtml(player.avatar || "⚽")}</span>`;
}
function scoreBadge(value) { return value == null ? `<span class="score-missing">Sin datos</span>` : `<span class="score-value">${Math.round(value)}<small>/100</small></span>`; }
function renderSelect(id, players, selectedId, label = "Jugador") {
  return `<label class="field"><span>${label}</span><select id="${id}" required>${players.length ? players.map((player) => `<option value="${escapeAttr(player.id)}" ${player.id === selectedId ? "selected" : ""}>${escapeHtml(player.fullName)}</option>`).join("") : `<option value="">Crea un perfil primero</option>`}</select></label>`;
}
function sectionShell(kicker, title, description, body) {
  return `<div class="module-heading"><div><span class="section-overline">${kicker}</span><h1>${title}</h1><p>${description}</p></div></div>${body}`;
}
function ensureSections() {
  const views = {
    passport: `<div id="passport-content"></div>`,
    evaluations: `<div id="evaluations-content"></div>`,
    development: `<div id="development-content"></div>`,
    showcase: `<div id="showcase-content"></div>`,
    goals: `<div id="goals-content"></div>`,
    reports: `<div id="reports-content"></div>`,
    settings: `<div id="settings-content"></div>`
  };
  for (const [section, content] of Object.entries(views)) {
    const node = document.querySelector(`[data-view="${section}"]`);
    node.className = "page-view module-view";
    node.innerHTML = content;
  }
}

function renderPlayerForm(player = null) {
  const editing = Boolean(player);
  return `<form id="player-form" class="form-card" novalidate>
    <div class="form-section-title"><div><span class="section-overline">${editing ? "EDITAR PERFIL" : "NUEVO PERFIL"}</span><h2>${editing ? "Actualizar pasaporte" : "Crear pasaporte futbolístico"}</h2></div><button type="button" class="button button-quiet" data-action="cancel-player-form">Cancelar</button></div>
    <input type="hidden" name="id" value="${escapeAttr(player?.id || "")}">
    <div class="form-grid">
      <label class="field field-wide"><span>Nombre y apellidos *</span><input name="fullName" required maxlength="100" value="${escapeAttr(player?.fullName || "")}" placeholder="Ej. Nombre Apellido"></label>
      <label class="field"><span>Fecha de nacimiento *</span><input name="birthDate" type="date" required max="${new Date().toISOString().slice(0, 10)}" value="${escapeAttr(player?.birthDate || "")}"><small>La edad se calcula automáticamente.</small></label>
      <label class="field"><span>Posición principal *</span><select name="position" required><option value="">Selecciona posición</option>${POSITIONS.map((position) => `<option ${player?.position === position ? "selected" : ""}>${position}</option>`).join("")}</select></label>
      <label class="field"><span>Posición secundaria</span><select name="secondaryPosition"><option value="">Ninguna</option>${POSITIONS.map((position) => `<option ${player?.secondaryPosition === position ? "selected" : ""}>${position}</option>`).join("")}</select></label>
      <label class="field"><span>Pierna dominante *</span><select name="dominantFoot" required><option value="">Selecciona</option>${["Derecha", "Izquierda", "Ambas"].map((x) => `<option ${player?.dominantFoot === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      <label class="field"><span>Estatura (cm)</span><input name="height" type="number" min="80" max="250" step="1" value="${escapeAttr(player?.height ?? "")}" placeholder="Ej. 175"></label>
      <label class="field"><span>Peso (kg)</span><input name="weight" type="number" min="20" max="200" step="0.1" value="${escapeAttr(player?.weight ?? "")}" placeholder="Ej. 68"></label>
      <label class="field"><span>Club o academia</span><input name="club" maxlength="100" value="${escapeAttr(player?.club || "")}" placeholder="Opcional"></label>
      <label class="field"><span>Ciudad</span><input name="city" maxlength="80" value="${escapeAttr(player?.city || "")}"></label>
      <label class="field"><span>País</span><input name="country" maxlength="80" value="${escapeAttr(player?.country || "")}"></label>
      <label class="field"><span>Años de experiencia</span><input name="experience" type="number" min="0" max="80" step="1" value="${escapeAttr(player?.experience ?? "")}"></label>
      <label class="field"><span>Avatar</span><select name="avatar">${AVATARS.map((avatar) => `<option value="${avatar}" ${player?.avatar === avatar ? "selected" : ""}>${avatar}</option>`).join("")}</select></label>
      <label class="field field-wide"><span>Fotografía (opcional, máximo 1.8 MB)</span><input name="photo" type="file" accept="image/png,image/jpeg,image/webp"><small>Se procesa localmente y no se sube a ningún servidor.</small></label>
      <label class="field field-wide"><span>Trayectoria deportiva</span><textarea name="career" rows="3" maxlength="1200" placeholder="Clubes, academias o experiencias relevantes">${escapeHtml(player?.career || "")}</textarea></label>
      <label class="field field-wide"><span>Descripción personal</span><textarea name="description" rows="3" maxlength="800" placeholder="Cuéntanos sobre tu perfil como futbolista">${escapeHtml(player?.description || "")}</textarea></label>
      <label class="field field-wide"><span>Fortalezas futbolísticas</span><textarea name="strengths" rows="2" maxlength="500" placeholder="Opcional">${escapeHtml(player?.strengths || "")}</textarea></label>
      <label class="field"><span>Contacto (opcional)</span><input name="contact" maxlength="150" value="${escapeAttr(player?.contact || "")}" placeholder="Correo o teléfono"></label>
      <label class="field field-checkbox"><input name="contactPublic" type="checkbox" ${player?.contactPublic ? "checked" : ""}><span>Incluir contacto en la tarjeta imprimible (por defecto privado)</span></label>
    </div>
    <div class="form-actions"><span class="form-hint">Los campos con * son obligatorios.</span><button class="button button-primary" type="submit">${editing ? "Guardar cambios" : "Crear perfil"}</button></div>
    <div class="form-errors" role="alert"></div>
  </form>`;
}

function renderPassport() {
  const view = document.querySelector("#passport-content");
  const query = playerQuery.toLocaleLowerCase("es");
  const activePosition = window.positionFilter || "";
  const players = data.players.filter((p) => `${p.fullName} ${p.club} ${p.position}`.toLocaleLowerCase("es").includes(query) && (!activePosition || p.position === activePosition));
  const selected = selectedPlayer();
  view.innerHTML = sectionShell("PERFILES DE JUGADORES", "Pasaporte futbolístico", "Administra perfiles deportivos y sus datos de manera privada en este dispositivo.", `
    <div class="toolbar-card">
      <label class="field search-field"><span>Buscar por jugador, club o posición</span><input id="player-filter" type="search" value="${escapeAttr(playerQuery)}" placeholder="Escribe para filtrar..."></label>
      <label class="field"><span>Filtrar por posición</span><select id="position-filter"><option value="">Todas las posiciones</option>${POSITIONS.map((x) => `<option>${x}</option>`).join("")}</select></label>
      <button class="button button-primary" data-action="new-player">+ Añadir jugador</button>
    </div>
    <div class="module-columns">
      <div class="player-list-card">${players.length ? `<div class="list-heading"><strong>${players.length} ${players.length === 1 ? "jugador" : "jugadores"}</strong><span>Selecciona para ver ficha</span></div><div class="player-list">${players.map((p) => `<button class="player-list-item ${p.id === selected?.id ? "selected" : ""}" data-action="select-player" data-id="${escapeAttr(p.id)}">${playerAvatar(p, "avatar-small")}<span><strong>${escapeHtml(p.fullName)}</strong><small>${escapeHtml(p.position)}${p.club ? ` · ${escapeHtml(p.club)}` : ""}</small></span><span class="list-chevron">›</span></button>`).join("")}</div>` : `<div class="empty-module"><span class="empty-module-icon">⚽</span><h3>${data.players.length ? "No hay resultados" : "Aún no hay jugadores"}</h3><p>${data.players.length ? "Prueba con otro nombre, club o posición." : "Crea el primer perfil para comenzar el pasaporte futbolístico."}</p><button class="button button-primary" data-action="new-player">${data.players.length ? "Limpiar búsqueda" : "Crear primer perfil"}</button></div>`}</div>
      <div id="player-detail">${selected ? renderPlayerDetail(selected) : `<div class="detail-empty"><span>01</span><strong>Tu primer perfil empieza aquí</strong><p>Añade un jugador para consultar sus datos deportivos.</p></div>`}</div>
    </div>
    <div id="player-form-slot"></div>`);
  const filter = view.querySelector("#position-filter");
  filter.value = window.positionFilter || "";
}

function renderPlayerDetail(player) {
  const evaluations = evaluationsFor(player.id);
  const last = evaluations.at(-1);
  const summary = last ? evaluationSummary(last) : null;
  return `<article class="player-detail-card">
    <div class="detail-cover"><span class="cover-label">PRO PLAYER · PERFIL DE JUGADOR</span><div class="detail-avatar">${playerAvatar(player)}</div></div>
    <div class="detail-body"><div class="detail-name-row"><div><h2>${escapeHtml(player.fullName)}</h2><p>${escapeHtml(player.position)}${player.secondaryPosition ? ` · ${escapeHtml(player.secondaryPosition)}` : ""}</p></div><span class="age-pill">${ageAt(player.birthDate) ?? "—"} años</span></div>
      <div class="detail-stat-grid"><div><small>CLUB / ACADEMIA</small><strong>${escapeHtml(player.club || "No registrado")}</strong></div><div><small>PIERNA DOMINANTE</small><strong>${escapeHtml(player.dominantFoot || "—")}</strong></div><div><small>ESTATURA</small><strong>${player.height ? `${player.height} cm` : "—"}</strong></div><div><small>PESO</small><strong>${player.weight ? `${player.weight} kg` : "—"}</strong></div><div><small>UBICACIÓN</small><strong>${escapeHtml([player.city, player.country].filter(Boolean).join(", ") || "—")}</strong></div><div><small>EXPERIENCIA</small><strong>${player.experience ? `${player.experience} años` : "—"}</strong></div></div>
      <div class="detail-index"><div><small>ÍNDICE PRO · ÚLTIMA EVALUACIÓN</small><p>Indicador orientativo; requiere datos completos de las cuatro categorías.</p></div>${scoreBadge(summary?.index ?? null)}</div>
      ${player.description ? `<div class="detail-copy"><h3>Sobre el jugador</h3><p>${escapeHtml(player.description)}</p></div>` : ""}
      ${player.career ? `<div class="detail-copy"><h3>Trayectoria</h3><p>${escapeHtml(player.career).replace(/\n/g, "<br>")}</p></div>` : ""}
      ${player.strengths ? `<div class="detail-copy"><h3>Fortalezas declaradas</h3><p>${escapeHtml(player.strengths)}</p></div>` : ""}
      <div class="detail-actions"><button class="button button-secondary" data-action="edit-player" data-id="${escapeAttr(player.id)}">Editar perfil</button><button class="button button-danger" data-action="delete-player" data-id="${escapeAttr(player.id)}">Eliminar</button></div>
    </div>
  </article>`;
}

function renderEvaluationForm(evaluation = null) {
  const selectedId = evaluation?.playerId || selectedPlayer()?.id || "";
  return `<form class="form-card" id="evaluation-form" novalidate>
    <div class="form-section-title"><div><span class="section-overline">${evaluation ? "EDITAR EVALUACIÓN" : "NUEVA EVALUACIÓN"}</span><h2>${evaluation ? "Actualizar resultados" : "Registrar rendimiento"}</h2></div><button type="button" class="button button-quiet" data-action="cancel-evaluation">Cancelar</button></div>
    <input type="hidden" name="id" value="${escapeAttr(evaluation?.id || "")}">
    <div class="form-grid form-grid-meta">${renderSelect("evaluation-player", data.players, selectedId)}<label class="field"><span>Fecha *</span><input name="date" type="date" required max="${new Date().toISOString().slice(0,10)}" value="${escapeAttr(evaluation?.date || new Date().toISOString().slice(0,10))}"></label><label class="field"><span>Evaluador *</span><input name="evaluator" required maxlength="100" value="${escapeAttr(evaluation?.evaluator || "")}" placeholder="Nombre del entrenador"></label><label class="field"><span>Tipo de prueba</span><input name="testType" maxlength="100" value="${escapeAttr(evaluation?.testType || "")}" placeholder="Ej. Evaluación técnica"></label></div>
    <p class="scale-explainer"><strong>Escala de 0 a 100:</strong> 0 = sin evidencia observable; 50 = nivel en desarrollo; 100 = desempeño sobresaliente observado. Las calificaciones son valoraciones del evaluador, no mediciones físicas objetivas.</p>
    <div class="score-groups">${Object.entries(GROUPS).map(([group, skills]) => `<fieldset class="score-group"><legend>${group}</legend><div class="score-input-grid">${Object.entries(skills).map(([key, label]) => `<label class="score-input"><span>${label}</span><input type="number" name="score-${key}" required min="0" max="100" step="1" value="${evaluation?.scores?.[key] ?? ""}" placeholder="0–100"></label>`).join("")}</div></fieldset>`).join("")}</div>
    <label class="field"><span>Observaciones del evaluador</span><textarea name="observations" rows="3" maxlength="1200">${escapeHtml(evaluation?.observations || "")}</textarea></label>
    <div class="form-actions"><span class="form-hint">Todas las habilidades deben puntuarse para calcular el Índice PRO.</span><button class="button button-primary" type="submit">${evaluation ? "Guardar evaluación" : "Guardar evaluación"}</button></div><div class="form-errors" role="alert"></div>
  </form>`;
}

function renderEvaluations() {
  const view = document.querySelector("#evaluations-content");
  const player = selectedPlayer();
  const list = player ? evaluationsFor(player.id).slice().reverse() : [];
  view.innerHTML = sectionShell("OBSERVACIÓN Y RENDIMIENTO", "Evaluaciones deportivas", "Registra observaciones por habilidad. Las calificaciones son subjetivas y no sustituyen pruebas físicas con unidades objetivas.", `
    ${data.players.length ? `<div class="toolbar-card">${renderSelect("evaluation-player-filter", data.players, player.id)}<button class="button button-primary" data-action="new-evaluation">+ Nueva evaluación</button></div>
    <div class="index-explainer"><div class="index-explainer-icon">PRO</div><div><strong>Cómo se calcula el Índice PRO</strong><p>Media de habilidades de cada categoría, ponderada por <b>Técnica 35 %</b>, <b>Física 30 %</b>, <b>Táctica 25 %</b> y <b>Actitudinal 10 %</b>. Solo se muestra con puntuación completa en las cuatro categorías, usando la evaluación más reciente.</p></div></div>
    <div class="form-slot" id="evaluation-form-slot"></div>
    ${list.length ? `<div class="history-heading"><div><span class="section-overline">HISTORIAL CRONOLÓGICO</span><h2>${escapeHtml(player.fullName)}</h2></div><span>${list.length} evaluaciones</span></div><div class="evaluation-list">${list.map((e) => renderEvaluationCard(e)).join("")}</div>` : `<div class="empty-module"><span class="empty-module-icon">↗</span><h3>No hay evaluaciones registradas</h3><p>Guarda la primera evaluación de ${escapeHtml(player.fullName)} para calcular promedios, fortalezas y prioridades.</p><button class="button button-primary" data-action="new-evaluation">Registrar evaluación</button></div>`}` : `<div class="empty-module"><h3>Primero crea un perfil</h3><p>Las evaluaciones se asocian a un futbolista existente.</p><button class="button button-primary" data-section="passport">Crear perfil</button></div>`}`);
}

function renderEvaluationCard(evaluation) {
  const summary = evaluationSummary(evaluation);
  const player = getPlayer(evaluation.playerId);
  const categoryChips = Object.entries(summary.categories).map(([key, value]) => `<span>${key} ${value == null ? "—" : Math.round(value)}</span>`).join("");
  return `<article class="evaluation-card"><div class="evaluation-card-top"><div><span class="evaluation-date">${formatDate(evaluation.date)}</span><h3>${escapeHtml(evaluation.testType || "Evaluación de rendimiento")}</h3><p>${escapeHtml(player?.fullName || "Jugador")} · Evaluador: ${escapeHtml(evaluation.evaluator || "No indicado")}</p></div><div class="evaluation-card-score">${scoreBadge(summary.index)}</div></div><div class="category-chips">${categoryChips}</div>${evaluation.observations ? `<p class="evaluation-observations">${escapeHtml(evaluation.observations)}</p>` : ""}<div class="detail-actions"><button class="button button-secondary" data-action="edit-evaluation" data-id="${escapeAttr(evaluation.id)}">Editar</button><button class="button button-danger" data-action="delete-evaluation" data-id="${escapeAttr(evaluation.id)}">Eliminar</button><button class="button button-quiet" data-action="open-report" data-id="${escapeAttr(player?.id || "")}">Ver informe</button></div></article>`;
}

function renderDevelopment() {
  const selectedSkill = document.querySelector("#skill-filter")?.value || "";
  const selectedPeriod = document.querySelector("#period-filter")?.value || "all";
  for (const id of ["evolution-chart", "radar-chart", "category-chart", "compare-chart"]) {
    charts.get(id)?.destroy();
    charts.delete(id);
  }
  const view = document.querySelector("#development-content");
  const player = selectedPlayer();
  const list = player ? evaluationsFor(player.id) : [];
  view.innerHTML = sectionShell("COMPARACIÓN Y PROGRESO", "Evolución deportiva", "Compara evaluaciones del mismo jugador y compara perfiles con sus datos disponibles, sin convertirlos en una clasificación absoluta.", `
    ${data.players.length ? `<div class="toolbar-card">${renderSelect("development-player", data.players, player.id)}<label class="field"><span>Habilidad individual</span><select id="skill-filter"><option value="">Promedio global</option>${Object.values(GROUPS).flatMap(Object.entries).map(([key, name]) => `<option value="${key}">${name}</option>`).join("")}</select></label><label class="field"><span>Periodo</span><select id="period-filter"><option value="all">Todo el historial</option><option value="90">Últimos 90 días</option><option value="30">Últimos 30 días</option></select></label></div>
    <div class="chart-grid"><article class="panel chart-panel"><div class="panel-heading"><div><span class="section-overline">TENDENCIA</span><h3>Evolución temporal</h3></div></div><div class="chart-wrap"><canvas id="evolution-chart" aria-label="Gráfico de evolución temporal"></canvas></div><div id="evolution-empty" class="inline-empty" hidden>Registra al menos una evaluación para consultar la evolución.</div></article>
    <article class="panel chart-panel"><div class="panel-heading"><div><span class="section-overline">PERFIL DE HABILIDADES</span><h3>Radar de rendimiento</h3></div></div><div class="chart-wrap"><canvas id="radar-chart" aria-label="Gráfico radar de habilidades"></canvas></div><div id="radar-empty" class="inline-empty" hidden>Se necesitan puntuaciones de habilidades para generar el radar.</div></article>
    <article class="panel chart-panel"><div class="panel-heading"><div><span class="section-overline">CATEGORÍAS</span><h3>Comparación inicial y reciente</h3></div></div><div class="chart-wrap chart-wrap-short"><canvas id="category-chart" aria-label="Comparación de puntuaciones por categoría"></canvas></div></article>
    <article class="panel comparison-panel"><div class="panel-heading"><div><span class="section-overline">COMPARADOR</span><h3>Comparar dos jugadores</h3></div></div><div class="compare-selects">${renderSelect("compare-player-a", data.players, player.id, "Jugador A")}<label class="field"><span>Jugador B</span><select id="compare-player-b">${data.players.map((p) => `<option value="${escapeAttr(p.id)}" ${p.id !== player.id ? "selected" : ""}>${escapeHtml(p.fullName)}</option>`).join("")}</select></label></div><div id="compare-result"></div><div class="chart-wrap chart-wrap-short"><canvas id="compare-chart" aria-label="Comparación de categorías entre dos jugadores"></canvas></div><p class="disclaimer">Las cifras describen evaluaciones registradas y no establecen una clasificación entre jugadores.</p></article></div>
    <div class="history-heading"><div><span class="section-overline">DIFERENCIAS ENTRE EVALUACIONES</span><h2>Inicial frente a reciente</h2></div></div><div id="evaluation-differences"></div>` : `<div class="empty-module"><h3>Primero crea un perfil</h3><p>Tu evolución se construye a partir del historial real de evaluaciones.</p><button class="button button-primary" data-section="passport">Crear perfil</button></div>`}`);
  if (player) {
    document.querySelector("#skill-filter").value = selectedSkill;
    document.querySelector("#period-filter").value = selectedPeriod;
    drawDevelopmentCharts(player, list);
  }
}

function chartOptions() {
  return { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#b9c7bc", usePointStyle: true, boxWidth: 8, font: { family: "DM Sans", size: 10 } } } }, scales: {} };
}
function createChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas || typeof Chart === "undefined") {
    if (canvas && !canvas.parentElement.querySelector(".chart-library-warning")) canvas.insertAdjacentHTML("afterend", `<div class="chart-library-warning">Para ver los gráficos, conecta a internet y recarga la página (Chart.js).</div>`);
    return;
  }
  charts.get(id)?.destroy();
  charts.set(id, new Chart(canvas, config));
}
function drawDevelopmentCharts(player, evaluations) {
  const start = document.querySelector("#period-filter")?.value || "all";
  const threshold = start === "all" ? 0 : Date.now() - Number(start) * 86400000;
  const filtered = evaluations.filter((e) => new Date(`${e.date}T23:59:59`).getTime() >= threshold);
  const skill = document.querySelector("#skill-filter")?.value || "";
  const values = filtered.map((e) => skill ? e.scores[skill] : evaluationSummary(e).index);
  const labels = filtered.map((e) => formatDate(e.date));
  const hasTrend = values.some(Number.isFinite);
  document.querySelector("#evolution-chart").hidden = !hasTrend;
  document.querySelector("#evolution-empty").hidden = hasTrend;
  if (hasTrend) {
    const options = chartOptions();
    options.scales = { y: { min: 0, max: 100, ticks: { color: "#77877b" }, grid: { color: "rgba(195,220,203,.08)" } }, x: { ticks: { color: "#77877b" }, grid: { display: false } } };
    createChart("evolution-chart", { type: "line", data: { labels, datasets: [{ label: skill ? Object.values(GROUPS).flatMap(Object.entries).find(([key]) => key === skill)?.[1] : "Índice PRO", data: values, borderColor: "#a7f36b", backgroundColor: "rgba(167,243,107,.12)", fill: true, tension: .35, pointBackgroundColor: "#c1ff7f", spanGaps: true }] }, options });
  }
  const last = evaluations.at(-1);
  const summary = last ? evaluationSummary(last) : null;
  const complete = last && Object.keys(GROUPS).every((group) => summary.categories[group] !== null);
  document.querySelector("#radar-chart").hidden = !complete;
  document.querySelector("#radar-empty").hidden = Boolean(complete);
  if (complete) {
    const skillEntries = Object.entries(GROUPS).flatMap(([, skills]) => Object.entries(skills));
    createChart("radar-chart", { type: "radar", data: { labels: skillEntries.map(([, label]) => label), datasets: [{ label: formatDate(last.date), data: skillEntries.map(([key]) => last.scores[key]), borderColor: "#a7f36b", backgroundColor: "rgba(167,243,107,.17)", pointBackgroundColor: "#c1ff7f", borderWidth: 2 }] }, options: { ...chartOptions(), scales: { r: { min: 0, max: 100, ticks: { display: false }, grid: { color: "rgba(195,220,203,.12)" }, angleLines: { color: "rgba(195,220,203,.1)" }, pointLabels: { color: "#aab7ac", font: { size: 9 } } } } } });
  }
  const initial = evaluations[0];
  if (evaluations.length >= 2) {
    const firstSummary = evaluationSummary(initial);
    const finalSummary = evaluationSummary(last);
    createChart("category-chart", { type: "bar", data: { labels: Object.keys(GROUPS), datasets: [{ label: "Inicial", data: Object.keys(GROUPS).map((g) => firstSummary.categories[g]), backgroundColor: "rgba(139,160,143,.55)", borderRadius: 4 }, { label: "Reciente", data: Object.keys(GROUPS).map((g) => finalSummary.categories[g]), backgroundColor: "rgba(167,243,107,.75)", borderRadius: 4 }] }, options: { ...chartOptions(), scales: { y: { min: 0, max: 100, ticks: { color: "#77877b" }, grid: { color: "rgba(195,220,203,.08)" } }, x: { ticks: { color: "#aab7ac" }, grid: { display: false } } } } });
  } else {
    const canvas = document.querySelector("#category-chart");
    canvas.hidden = true;
    canvas.parentElement.insertAdjacentHTML("beforeend", `<div class="inline-empty">Se requieren dos evaluaciones para comparar los resultados iniciales y recientes.</div>`);
  }
  renderComparison();
  renderDifferences(evaluations);
}

function renderDifferences(evaluations) {
  const target = document.querySelector("#evaluation-differences");
  if (!target) return;
  if (evaluations.length < 2) {
    target.innerHTML = `<div class="inline-empty">Registra dos evaluaciones para calcular diferencias de manera válida.</div>`;
    return;
  }
  const first = evaluations[0], last = evaluations.at(-1);
  const labels = Object.entries(GROUPS).flatMap(([, skills]) => Object.entries(skills));
  target.innerHTML = `<div class="difference-grid">${labels.map(([key, name]) => {
    const a = first.scores[key], b = last.scores[key], diff = b - a;
    const percent = a === 0 ? "Porcentaje no calculable (valor inicial 0)" : `${diff >= 0 ? "+" : ""}${((diff / a) * 100).toFixed(1)} %`;
    return `<div class="difference-item"><span>${name}</span><strong>${a} → ${b}</strong><small class="${diff >= 0 ? "positive" : "negative"}">${diff >= 0 ? "+" : ""}${diff} puntos · ${percent}</small></div>`;
  }).join("")}</div><p class="disclaimer">Comparación entre ${formatDate(first.date)} y ${formatDate(last.date)}; los cambios reflejan calificaciones registradas.</p>`;
}

function renderComparison() {
  const target = document.querySelector("#compare-result");
  if (!target) return;
  const a = getPlayer(document.querySelector("#compare-player-a")?.value);
  const b = getPlayer(document.querySelector("#compare-player-b")?.value);
  if (!a || !b || a.id === b.id) {
    target.innerHTML = `<div class="inline-empty">Selecciona dos jugadores distintos para compararlos.</div>`;
    charts.get("compare-chart")?.destroy();
    return;
  }
  const ea = latestEvaluation(a.id), eb = latestEvaluation(b.id);
  const sa = ea ? evaluationSummary(ea) : null, sb = eb ? evaluationSummary(eb) : null;
  const categories = Object.keys(GROUPS);
  target.innerHTML = `<div class="compare-summary"><div>${playerAvatar(a, "avatar-small")}<strong>${escapeHtml(a.fullName)}</strong><span>Índice PRO ${scoreBadge(sa?.index ?? null)}</span></div><div class="compare-vs">VS</div><div>${playerAvatar(b, "avatar-small")}<strong>${escapeHtml(b.fullName)}</strong><span>Índice PRO ${scoreBadge(sb?.index ?? null)}</span></div></div><div class="compare-table">${categories.map((category) => `<div><span>${category}</span>${scoreBadge(sa?.categories[category] ?? null)}${scoreBadge(sb?.categories[category] ?? null)}</div>`).join("")}${Object.entries(GROUPS).flatMap(([, group]) => Object.entries(group)).map(([key, label]) => `<div><span>${label}</span>${scoreBadge(ea?.scores[key] ?? null)}${scoreBadge(eb?.scores[key] ?? null)}</div>`).join("")}</div>`;
  if (sa && sb && typeof Chart !== "undefined") createChart("compare-chart", { type: "bar", data: { labels: categories, datasets: [{ label: a.fullName, data: categories.map((x) => sa.categories[x]), backgroundColor: "rgba(167,243,107,.7)", borderRadius: 4 }, { label: b.fullName, data: categories.map((x) => sb.categories[x]), backgroundColor: "rgba(115,174,205,.7)", borderRadius: 4 }] }, options: { ...chartOptions(), scales: { y: { min: 0, max: 100, ticks: { color: "#77877b" }, grid: { color: "rgba(195,220,203,.08)" } }, x: { ticks: { color: "#aab7ac" }, grid: { display: false } } } } });
}

function renderShowcase() {
  const view = document.querySelector("#showcase-content");
  const player = selectedPlayer();
  const evaluation = player && latestEvaluation(player.id);
  const summary = evaluation && evaluationSummary(evaluation);
  const skills = evaluation ? Object.entries(GROUPS).flatMap(([, group]) => Object.entries(group)).sort((a, b) => evaluation.scores[b[0]] - evaluation.scores[a[0]]) : [];
  view.innerHTML = sectionShell("TU FICHA DEPORTIVA", "Tarjeta para visorías", "Prepara una ficha imprimible con la información que registraste. No se incluyen contactos privados.", `
  ${player ? `<div class="toolbar-card">${renderSelect("showcase-player", data.players, player.id)}<button class="button button-primary" data-action="print-showcase">Imprimir / Guardar PDF</button></div>
    <article class="showcase-card" id="printable-showcase"><div class="showcase-top"><div class="showcase-brand">PRO<span>PLAYER</span><small>PLAYER DEVELOPMENT</small></div><span class="showcase-label">PLAYER PASSPORT · ${new Date().getFullYear()}</span></div><div class="showcase-hero"><div class="showcase-photo">${playerAvatar(player, "showcase-avatar")}</div><div class="showcase-identity"><span class="section-overline">PERFIL DE FUTBOLISTA</span><h2>${escapeHtml(player.fullName)}</h2><p>${escapeHtml(player.position)}${player.secondaryPosition ? ` · ${escapeHtml(player.secondaryPosition)}` : ""}</p><div class="showcase-tags"><span>${ageAt(player.birthDate) ?? "—"} años</span><span>Pierna ${escapeHtml(player.dominantFoot || "—")}</span>${player.club ? `<span>${escapeHtml(player.club)}</span>` : ""}</div></div><div class="showcase-index"><small>ÍNDICE PRO</small><strong>${summary?.index == null ? "—" : Math.round(summary.index)}</strong><span>${summary?.index == null ? "Faltan datos" : "Indicador orientativo"}</span></div></div>
      <div class="showcase-details"><div><small>ESTATURA</small><strong>${player.height ? `${player.height} cm` : "No registrada"}</strong></div><div><small>PESO</small><strong>${player.weight ? `${player.weight} kg` : "No registrado"}</strong></div><div><small>UBICACIÓN</small><strong>${escapeHtml([player.city, player.country].filter(Boolean).join(", ") || "No registrada")}</strong></div><div><small>ÚLTIMA EVALUACIÓN</small><strong>${evaluation ? formatDate(evaluation.date) : "Sin evaluaciones"}</strong></div></div>
      ${skills.length ? `<div class="showcase-skills"><div><span class="section-overline">HABILIDADES DESTACADAS</span><div class="skill-bars">${skills.slice(0, 5).map(([key, label]) => `<div class="skill-bar"><span>${label}</span><div><i style="width:${evaluation.scores[key]}%"></i></div><b>${evaluation.scores[key]}</b></div>`).join("")}</div></div><div class="showcase-stat-list"><span class="section-overline">PROMEDIOS POR CATEGORÍA</span>${Object.entries(summary.categories).map(([key, value]) => `<div><span>${key}</span>${scoreBadge(value)}</div>`).join("")}</div></div>` : `<div class="inline-empty">Aún no hay evaluaciones: las estadísticas aparecerán al registrar datos reales.</div>`}
      ${player.strengths ? `<div class="showcase-strengths"><small>FORTALEZAS DECLARADAS</small><p>${escapeHtml(player.strengths)}</p></div>` : ""}
      ${player.contactPublic && player.contact ? `<div class="showcase-strengths"><small>CONTACTO COMPARTIDO POR EL JUGADOR</small><p>${escapeHtml(player.contact)}</p></div>` : ""}
      <div class="showcase-footer"><span>pro player · tu talento, tu evolución</span><span>Datos generados desde este dispositivo</span></div>
    </article>` : `<div class="empty-module"><h3>Primero crea un perfil</h3><p>La ficha se crea con los datos que hayas registrado.</p><button class="button button-primary" data-section="passport">Crear perfil</button></div>`}`);
}

function renderGoalForm(goal = null) {
  const playerId = goal?.playerId || selectedPlayer()?.id || "";
  return `<form id="goal-form" class="form-card" novalidate><div class="form-section-title"><div><span class="section-overline">${goal ? "EDITAR OBJETIVO" : "NUEVO OBJETIVO"}</span><h2>${goal ? "Actualizar objetivo" : "Define una meta cuantificable"}</h2></div><button type="button" class="button button-quiet" data-action="cancel-goal">Cancelar</button></div><input type="hidden" name="id" value="${escapeAttr(goal?.id || "")}"><div class="form-grid">${renderSelect("goal-player", data.players, playerId)}<label class="field"><span>Nombre del objetivo *</span><input name="title" required maxlength="100" value="${escapeAttr(goal?.title || "")}" placeholder="Ej. Completar sesiones"></label><label class="field"><span>Categoría</span><select name="category">${["Técnica", "Física", "Táctica", "Actitudinal", "General"].map((c) => `<option ${goal?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label class="field"><span>Fecha límite *</span><input name="dueDate" type="date" required value="${escapeAttr(goal?.dueDate || "")}"></label><label class="field"><span>Meta *</span><input name="target" type="number" min="1" step="any" required value="${escapeAttr(goal?.target || "")}"></label><label class="field"><span>Unidad</span><input name="unit" maxlength="30" value="${escapeAttr(goal?.unit || "sesiones")}" placeholder="sesiones, km, repeticiones"></label><label class="field"><span>Avance actual</span><input name="progress" type="number" min="0" step="any" value="${escapeAttr(goal?.progress || 0)}"></label><label class="field field-wide"><span>Descripción</span><textarea name="description" rows="2" maxlength="500">${escapeHtml(goal?.description || "")}</textarea></label></div><div class="form-actions"><span class="form-hint">Al alcanzar la meta, el objetivo se marcará como completado.</span><button class="button button-primary" type="submit">Guardar objetivo</button></div><div class="form-errors" role="alert"></div></form>`;
}

function renderGoals() {
  const view = document.querySelector("#goals-content");
  const player = selectedPlayer();
  const goals = player ? goalsFor(player.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate)) : [];
  view.innerHTML = sectionShell("PLAN DE ENTRENAMIENTO", "Objetivos y desafíos", "Define metas medibles y registra el avance. Cada objetivo está vinculado a un perfil.", `${player ? `<div class="toolbar-card">${renderSelect("goals-player", data.players, player.id)}<button class="button button-primary" data-action="new-goal">+ Crear objetivo</button></div><div id="goal-form-slot"></div>${goals.length ? `<div class="goal-grid">${goals.map((g) => {
    const pct = Math.min(100, Math.round(g.progress / g.target * 100));
    const overdue = !g.completed && g.dueDate < new Date().toISOString().slice(0,10);
    return `<article class="goal-card ${g.completed ? "goal-completed" : ""}"><div class="goal-card-top"><span class="goal-category">${escapeHtml(g.category)}</span>${g.completed ? `<span class="completed-badge">✓ Completado</span>` : overdue ? `<span class="overdue-badge">Vencido</span>` : `<span class="goal-due">Límite ${formatDate(g.dueDate)}</span>`}</div><h3>${escapeHtml(g.title)}</h3>${g.description ? `<p>${escapeHtml(g.description)}</p>` : ""}<div class="goal-progress-label"><span>Avance</span><strong>${g.progress} / ${g.target} ${escapeHtml(g.unit)}</strong></div><div class="progress-track"><span style="width:${pct}%"></span></div><div class="goal-actions">${g.completed ? "" : `<button class="button button-quiet" data-action="update-progress" data-id="${escapeAttr(g.id)}">+ Registrar avance</button>`}<button class="button button-quiet" data-action="edit-goal" data-id="${escapeAttr(g.id)}">Editar</button><button class="button button-danger" data-action="delete-goal" data-id="${escapeAttr(g.id)}">Eliminar</button></div></article>`;
  }).join("")}</div>` : `<div class="empty-module"><span class="empty-module-icon">◎</span><h3>Sin objetivos activos</h3><p>Elige una meta concreta y haz seguimiento de tu progreso.</p><button class="button button-primary" data-action="new-goal">Crear primer objetivo</button></div>`}` : `<div class="empty-module"><h3>Primero crea un perfil</h3><p>Los objetivos se asocian a un futbolista.</p><button class="button button-primary" data-section="passport">Crear perfil</button></div>`}`);
}

function getRecommendations(evaluation) {
  if (!evaluation) return [];
  return Object.entries(GROUPS).flatMap(([, group]) => Object.entries(group).map(([key, label]) => ({ key, label, score: evaluation.scores[key] }))).sort((a, b) => a.score - b.score).slice(0, 3);
}

function renderReports() {
  const view = document.querySelector("#reports-content");
  const player = selectedPlayer();
  const evaluation = player && latestEvaluation(player.id);
  const summary = evaluation && evaluationSummary(evaluation);
  const recommendations = evaluation ? getRecommendations(evaluation) : [];
  view.innerHTML = sectionShell("RESUMEN DE RENDIMIENTO", "Informes del entrenador", "Genera informes imprimibles basados exclusivamente en evaluaciones y perfiles guardados.", `${player ? `<div class="toolbar-card">${renderSelect("report-player", data.players, player.id)}<button class="button button-primary" data-action="print-report" ${evaluation ? "" : "disabled"}>Imprimir / Guardar PDF</button></div>
    <article class="report-paper" id="printable-report"><div class="report-header"><div><span class="section-overline">PRO PLAYER · INFORME DE RENDIMIENTO</span><h2>${escapeHtml(player.fullName)}</h2><p>${escapeHtml(player.position)} · ${escapeHtml(player.club || "Club no registrado")} · ${ageAt(player.birthDate) ?? "—"} años</p></div><div class="report-mark">PP</div></div>
    ${evaluation ? `<div class="report-meta"><span>Evaluación: <strong>${formatDate(evaluation.date)}</strong></span><span>Evaluador: <strong>${escapeHtml(evaluation.evaluator || "No indicado")}</strong></span><span>Prueba: <strong>${escapeHtml(evaluation.testType || "General")}</strong></span></div>
    <div class="report-profile-details"><span><small>EDAD</small><strong>${ageAt(player.birthDate) ?? "—"} años</strong></span><span><small>PIERNA</small><strong>${escapeHtml(player.dominantFoot || "—")}</strong></span><span><small>ESTATURA</small><strong>${player.height ? `${player.height} cm` : "—"}</strong></span><span><small>PESO</small><strong>${player.weight ? `${player.weight} kg` : "—"}</strong></span><span><small>UBICACIÓN</small><strong>${escapeHtml([player.city, player.country].filter(Boolean).join(", ") || "—")}</strong></span></div>
    <div class="report-index"><div><small>ÍNDICE PRO</small><strong>${summary.index == null ? "Datos incompletos" : `${Math.round(summary.index)} / 100`}</strong><span>Orientativo. No es clasificación oficial ni garantía de contratación.</span></div><div class="weights-list">${Object.entries(WEIGHTS).map(([k,v]) => `<span>${k} <b>${v}%</b></span>`).join("")}</div></div>
    <div class="report-chart-wrap"><span class="section-overline">GRÁFICO DE RENDIMIENTO</span><div class="chart-wrap chart-wrap-short"><canvas id="report-category-chart" aria-label="Gráfico de resultados por categoría"></canvas></div></div>
    <div class="report-categories">${Object.entries(GROUPS).map(([category, skills]) => `<section><h3>${category} <span>${summary.categories[category] == null ? "—" : `${Math.round(summary.categories[category])}/100`}</span></h3><div>${Object.entries(skills).map(([key, label]) => `<div class="report-skill"><span>${label}</span><strong>${evaluation.scores[key]}/100</strong></div>`).join("")}</div></section>`).join("")}</div>
    <div class="report-insights"><section><h3>Fortalezas observadas</h3><ul>${Object.entries(GROUPS).flatMap(([,g]) => Object.entries(g).map(([key,label]) => ({label,score:evaluation.scores[key]}))).sort((a,b)=>b.score-a.score).slice(0,3).map((x)=>`<li>${escapeHtml(x.label)} <b>${x.score}/100</b></li>`).join("")}</ul></section><section><h3>Prioridades de mejora</h3><ul>${recommendations.map((x)=>`<li>${escapeHtml(x.label)} <b>${x.score}/100</b></li>`).join("")}</ul></section></div>
    ${recommendations.length ? `<div class="recommendation-note"><strong>Recomendaciones basadas en puntuaciones</strong><p>Priorizar ejercicios progresivos de ${recommendations.map((x)=>escapeHtml(x.label.toLowerCase())).join(", ")} y volver a evaluar para observar cambios.</p></div>` : ""}
    ${evaluation.observations ? `<div class="report-observations"><h3>Observaciones del evaluador</h3><p>${escapeHtml(evaluation.observations)}</p></div>` : `<p class="disclaimer">Sin observaciones registradas en esta evaluación.</p>`}
    <div class="report-footer">Generado localmente desde PRO PLAYER · ${formatDate(new Date().toISOString().slice(0,10))}</div>` : `<div class="empty-module"><h3>Este jugador aún no tiene evaluaciones</h3><p>Registra una evaluación para generar el informe con datos reales.</p><button class="button button-primary" data-section="evaluations">Registrar evaluación</button></div>`}
    </article>` : `<div class="empty-module"><h3>Primero crea un perfil</h3><p>Los informes se generan desde perfiles y evaluaciones registradas.</p><button class="button button-primary" data-section="passport">Crear perfil</button></div>`}`);
  charts.get("report-category-chart")?.destroy();
  charts.delete("report-category-chart");
  if (evaluation && summary && typeof Chart !== "undefined") {
    createChart("report-category-chart", { type: "bar", data: { labels: Object.keys(GROUPS), datasets: [{ label: "Promedio / 100", data: Object.keys(GROUPS).map((category) => summary.categories[category]), backgroundColor: ["rgba(167,243,107,.75)", "rgba(115,203,160,.7)", "rgba(119,176,219,.7)", "rgba(190,152,231,.7)"], borderRadius: 5 }] }, options: { ...chartOptions(), plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { color: "#77877b" }, grid: { color: "rgba(195,220,203,.08)" } }, x: { ticks: { color: "#aab7ac" }, grid: { display: false } } } } });
  }
}

function renderSettings() {
  const view = document.querySelector("#settings-content");
  view.innerHTML = sectionShell("DATOS Y PRIVACIDAD", "Configuración", "Administra tus copias de seguridad. Los datos se guardan únicamente en este navegador y no se sincronizan entre dispositivos.", `
  <div class="settings-grid"><article class="settings-card"><span class="settings-card-icon">↓</span><h2>Exportar datos</h2><p>Descarga perfiles, evaluaciones y objetivos en un archivo JSON de respaldo.</p><button class="button button-secondary" data-action="export-data">Exportar JSON</button></article>
  <article class="settings-card"><span class="settings-card-icon">↑</span><h2>Importar copia</h2><p>Valida un archivo PRO PLAYER antes de reemplazar los datos actuales.</p><label class="button button-secondary file-button">Seleccionar archivo JSON<input id="import-file" type="file" accept=".json,application/json" hidden></label></article>
  <article class="settings-card settings-danger"><span class="settings-card-icon">!</span><h2>Reiniciar aplicación</h2><p>Elimina todos los perfiles, evaluaciones y objetivos de este navegador. Esta acción no se puede deshacer.</p><button class="button button-danger" data-action="reset-data">Borrar todos los datos</button></article>
  <article class="settings-card privacy-settings"><span class="settings-card-icon">◇</span><h2>Privacidad local</h2><p>No se utiliza autenticación ni servidor. Las fotografías se mantienen en el navegador; evita datos sensibles y exporta una copia para conservarlos.</p><div class="privacy-stat"><span>Perfiles</span><strong>${data.players.length}</strong><span>Evaluaciones</span><strong>${data.evaluations.length}</strong><span>Objetivos</span><strong>${data.goals.length}</strong></div></article>
  <article class="settings-card"><span class="settings-card-icon">⌁</span><h2>Librerías y conexión</h2><p>Chart.js 4 se carga desde jsDelivr para los gráficos y Google Fonts mejora la tipografía. Si no hay internet, el resto de la aplicación funciona con fuentes de respaldo; los gráficos requieren conexión. No se instala ningún framework.</p></article></div>`);
}

function updateDashboard() {
  charts.get("dashboard-evolution-chart")?.destroy();
  charts.delete("dashboard-evolution-chart");
  const player = selectedPlayer();
  const evaluations = data.evaluations;
  const goals = player ? goalsFor(player.id) : [];
  document.querySelector(".player-overview .card-label").textContent = `PERFIL DE JUGADOR · ${data.players.length}`;
  const overview = document.querySelector(".evaluation-overview .metric-empty");
  overview.innerHTML = `<strong>${evaluations.length}</strong><span>${evaluations.length === 1 ? "evaluación guardada" : "evaluaciones guardadas"}</span>`;
  document.querySelector(".evaluation-overview .card-footnote").innerHTML = evaluations.length ? `<span class="status-dot"></span> ${player ? `Perfil activo: ${escapeHtml(player.fullName)}` : "Datos registrados"}` : `<span class="neutral-dash"></span> Sin actividad registrada`;
  const last = player && latestEvaluation(player.id);
  const index = last && evaluationSummary(last).index;
  document.querySelector(".index-overview .metric-empty").innerHTML = `<strong>${index == null ? "—" : Math.round(index)}</strong><span>${index == null ? "Se requieren cuatro categorías completas" : "Índice PRO orientativo / 100"}</span>`;
  document.querySelector(".index-overview .card-footnote").innerHTML = `<span class="neutral-dash"></span> ${index == null ? "Sin datos suficientes" : `Última evaluación: ${formatDate(last.date)}`}`;
  document.querySelector(".goals-overview .metric-empty").innerHTML = `<strong>${goals.filter((g) => !g.completed).length}</strong><span>${goals.length ? "objetivos pendientes del perfil" : "Crea un objetivo para comenzar"}</span>`;
  document.querySelector(".goals-overview .card-footnote").innerHTML = `<span class="neutral-dash"></span> ${goals.filter((g) => g.completed).length} completados`;
  const categoriesTarget = document.querySelector("#dashboard-categories");
  const categorySummary = last ? evaluationSummary(last).categories : null;
  categoriesTarget.innerHTML = last
    ? `<div class="dashboard-category-heading"><span class="section-overline">ÚLTIMA EVALUACIÓN · PROMEDIOS POR CATEGORÍA</span><span>${formatDate(last.date)}</span></div><div class="dashboard-category-chips">${Object.entries(categorySummary).map(([category, value]) => `<div><span>${category}</span>${scoreBadge(value)}</div>`).join("")}</div>`
    : `<div class="dashboard-category-heading"><span class="section-overline">PROMEDIOS POR CATEGORÍA</span><span>${data.players.length ? "Aún no hay evaluaciones" : "Los datos aparecerán al registrar evaluaciones"}</span></div>`;
  const playerCard = document.querySelector(".player-overview .empty-card-content");
  playerCard.innerHTML = player
    ? playerAvatar(player, "avatar-small") + "<div><strong id=\"player-count\">" + escapeHtml(player.fullName) + "</strong><p>" + escapeHtml(player.position) + (player.club ? " · " + escapeHtml(player.club) : "") + "</p></div>"
    : `<span class="empty-icon"><svg viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14"/></svg></span><div><strong id="player-count">${data.players.length ? `${data.players.length} jugadores registrados` : "Sin perfiles todavía"}</strong><p>Crea tu pasaporte para comenzar.</p></div>`;
  document.querySelector(".player-overview .card-action").textContent = player ? "Ver pasaporte ↗" : "Crear perfil ↗";
  document.querySelector(".chart-empty").innerHTML = last ? `<div class="chart-wrap dashboard-chart-wrap"><canvas id="dashboard-evolution-chart" aria-label="Evolución del Índice PRO"></canvas></div>` : `<div class="chart-grid-lines"><span></span><span></span><span></span><span></span></div><div class="chart-empty-content"><span class="chart-empty-icon"><svg viewBox="0 0 24 24"><path d="M4 19V5m0 14h17"/><path d="m7 15 4-4 3 2 6-7"/></svg></span><strong>${data.players.length ? "Tu progreso comienza con tus datos" : "Crea un perfil para empezar"}</strong><p>${data.players.length ? "Registra evaluaciones para visualizar tu evolución." : "Tus estadísticas aparecerán cuando registres información real."}</p><a href="#${data.players.length ? "evaluations" : "passport"}" data-section="${data.players.length ? "evaluations" : "passport"}">${data.players.length ? "Ir a evaluaciones" : "Crear perfil"} <span>→</span></a></div>`;
  if (last) {
    const items = evaluationsFor(player.id);
    const completeValues = items.map((e) => evaluationSummary(e).index);
    if (completeValues.some(Number.isFinite)) {
      const opts = chartOptions();
      opts.plugins.legend.display = false;
      opts.scales = { y: { min: 0, max: 100, ticks: { color: "#77877b" }, grid: { color: "rgba(195,220,203,.08)" } }, x: { ticks: { color: "#77877b" }, grid: { display: false } } };
      createChart("dashboard-evolution-chart", { type: "line", data: { labels: items.map((e) => formatDate(e.date)), datasets: [{ label: "Índice PRO", data: completeValues, borderColor: "#a7f36b", backgroundColor: "rgba(167,243,107,.12)", fill: true, tension: .35, spanGaps: true }] }, options: opts });
    } else {
      document.querySelector(".chart-empty").innerHTML = `<div class="chart-empty-content"><strong>Evaluaciones incompletas</strong><p>Completa las cuatro categorías para mostrar la evolución del Índice PRO.</p></div>`;
    }
  }
  const priorities = last ? getRecommendations(last) : [];
  const target = document.querySelector(".next-level-empty");
  if (priorities.length) {
    const allSkills = Object.entries(GROUPS).flatMap(([, group]) => Object.entries(group).map(([key, label]) => ({ key, label, score: last.scores[key] })));
    const strengths = allSkills.sort((a, b) => b.score - a.score).slice(0, 3);
    const renderPriorities = (items) => `<div class="priority-list">${items.map((item, index) => `<div><span>${index + 1}</span><strong>${escapeHtml(item.label)}</strong><small>${item.score}/100</small></div>`).join("")}</div>`;
    target.innerHTML = `<div class="dashboard-insights"><div><span class="section-overline">FORTALEZAS</span>${renderPriorities(strengths)}</div><div><span class="section-overline">PRIORIDADES DE MEJORA</span>${renderPriorities(priorities)}</div></div><a href="#reports" data-section="reports" class="text-link">Ver recomendaciones del informe →</a>`;
  } else {
    target.innerHTML = `<div class="target-graphic"><span class="target-ring ring-outer"></span><span class="target-ring ring-middle"></span><span class="target-ring ring-inner"></span><span class="target-dot"></span></div><strong>Las prioridades nacen de tus evaluaciones</strong><p>Cuando tengas resultados, destacaremos tres aspectos concretos para enfocar tu entrenamiento.</p>`;
  }
  const activities = [...data.evaluations.map((e) => ({ date: e.createdAt, text: `Evaluación · ${getPlayer(e.playerId)?.fullName || "Jugador"} · ${formatDate(e.date)}`, section: "evaluations" })), ...data.goals.map((g) => ({ date: g.createdAt, text: `Objetivo · ${g.title}${g.completed ? " (completado)" : ""}`, section: "goals" }))].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  document.querySelector(".activity-empty").innerHTML = activities.length ? `<div class="activity-feed">${activities.map((x) => `<a href="#${x.section}" data-section="${x.section}"><span class="activity-feed-dot"></span><span>${escapeHtml(x.text)}</span><small>${formatDate(String(x.date).slice(0,10))}</small></a>`).join("")}</div>` : `<span class="activity-empty-mark">⌁</span><div><strong>Todo listo para empezar</strong><p>Tu actividad aparecerá aquí cuando registres datos.</p></div>`;
}

function updateAll() {
  renderPassport();
  renderEvaluations();
  renderDevelopment();
  renderShowcase();
  renderGoals();
  renderReports();
  renderSettings();
  updateDashboard();
}

function closeMobileMenu() {
  sidebar.classList.remove("open");
  mobileBackdrop.classList.remove("visible");
  menuToggle.setAttribute("aria-expanded", "false");
}

function navigateTo(section, updateHistory = true) {
  if (!Object.hasOwn(SECTION_LABELS, section)) section = "dashboard";
  document.querySelectorAll("[data-view]").forEach((view) => {
    const active = view.dataset.view === section;
    view.hidden = !active;
    view.classList.toggle("active", active);
  });
  document.querySelectorAll(".nav-link[data-section]").forEach((link) => {
    const active = link.dataset.section === section;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelector("#breadcrumb-current").textContent = SECTION_LABELS[section];
  if (updateHistory && window.location.hash !== `#${section}`) window.history.pushState({ section }, "", `#${section}`);
  if (section === "development") renderDevelopment();
  if (section === "dashboard") updateDashboard();
  closeMobileMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function reportFormError(form, message) {
  const target = form.querySelector(".form-errors");
  target.textContent = message;
  target.classList.add("visible");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}
function clearFormError(form) {
  const target = form.querySelector(".form-errors");
  target.textContent = "";
  target.classList.remove("visible");
}
function validateForm(form) {
  if (!form.checkValidity()) {
    const invalid = form.querySelector(":invalid");
    const field = invalid?.closest(".field")?.querySelector("span")?.textContent || "Un campo obligatorio";
    const message = invalid?.validity.valueMissing ? "Este campo es obligatorio."
      : invalid?.validity.typeMismatch ? "Introduce un valor con el formato indicado."
        : invalid?.validity.rangeUnderflow ? "El valor es menor que el mínimo permitido."
          : invalid?.validity.rangeOverflow ? "El valor supera el máximo permitido."
            : invalid?.validity.stepMismatch ? "El valor no coincide con el incremento permitido."
              : "Revisa el valor ingresado.";
    reportFormError(form, `${field.replace(/\s*\*$/, "")}: ${message}`);
    invalid?.focus();
    return false;
  }
  for (const input of form.querySelectorAll("input[type=number]")) {
    if (input.value !== "" && (!Number.isFinite(Number(input.value)) || Number(input.value) < Number(input.min || 0) || Number(input.value) > Number(input.max || Infinity))) {
      input.focus();
      reportFormError(form, `Revisa el valor de "${input.closest(".field")?.querySelector("span")?.textContent || input.name}".`);
      return false;
    }
  }
  return true;
}

async function readPhoto(file) {
  if (!file) return "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new TypeError("La fotografía debe ser JPG, PNG o WebP.");
  if (file.size > 1_800_000) throw new TypeError("La fotografía debe pesar menos de 1.8 MB.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer la fotografía seleccionada."));
    reader.readAsDataURL(file);
  });
}

async function submitPlayer(form) {
  clearFormError(form);
  if (!validateForm(form)) return;
  const fields = new FormData(form);
  const id = String(fields.get("id") || "");
  const existing = getPlayer(id);
  let photo = existing?.photo || "";
  try {
    const file = form.elements.photo.files[0];
    if (file) photo = await readPhoto(file);
  } catch (error) {
    reportFormError(form, error.message);
    return;
  }
  const birthDate = String(fields.get("birthDate"));
  if (ageAt(birthDate) === null) {
    reportFormError(form, "La fecha de nacimiento debe ser válida y no puede estar en el futuro.");
    return;
  }
  const player = {
    id: id || uuid(), fullName: String(fields.get("fullName")).trim(), birthDate,
    position: String(fields.get("position")), secondaryPosition: String(fields.get("secondaryPosition") || ""),
    dominantFoot: String(fields.get("dominantFoot")), height: fields.get("height") ? Number(fields.get("height")) : "",
    weight: fields.get("weight") ? Number(fields.get("weight")) : "", club: String(fields.get("club") || "").trim(),
    city: String(fields.get("city") || "").trim(), country: String(fields.get("country") || "").trim(),
    experience: fields.get("experience") ? Number(fields.get("experience")) : "", career: String(fields.get("career") || "").trim(),
    description: String(fields.get("description") || "").trim(), strengths: String(fields.get("strengths") || "").trim(),
    contact: String(fields.get("contact") || "").trim(), contactPublic: fields.get("contactPublic") === "on",
    avatar: String(fields.get("avatar")), photo, createdAt: existing?.createdAt || new Date().toISOString()
  };
  const previous = data;
  data = { ...data, players: existing ? data.players.map((p) => p.id === id ? player : p) : [...data.players, player], selectedPlayerId: player.id };
  if (!saveData()) { data = previous; return; }
  updateAll();
  showToast(existing ? "Perfil actualizado correctamente." : "Perfil creado correctamente.");
}

function submitEvaluation(form) {
  clearFormError(form);
  if (!validateForm(form)) return;
  const fields = new FormData(form), id = String(fields.get("id") || "");
  const scores = {};
  for (const key of Object.keys(GROUPS).flatMap((group) => Object.keys(GROUPS[group]))) scores[key] = Number(fields.get(`score-${key}`));
  const date = String(fields.get("date"));
  if (date > new Date().toISOString().slice(0,10)) { reportFormError(form, "La fecha de evaluación no puede estar en el futuro."); return; }
  const evaluation = { id: id || uuid(), playerId: String(fields.get("playerId") || document.querySelector("#evaluation-player")?.value || ""), date, evaluator: String(fields.get("evaluator")).trim(), testType: String(fields.get("testType") || "").trim(), observations: String(fields.get("observations") || "").trim(), scores, createdAt: getEvaluation(id)?.createdAt || new Date().toISOString() };
  const existing = getEvaluation(id);
  const previous = data;
  data = { ...data, evaluations: existing ? data.evaluations.map((e) => e.id === id ? evaluation : e) : [...data.evaluations, evaluation], selectedPlayerId: evaluation.playerId };
  if (!saveData()) { data = previous; return; }
  updateAll();
  showToast(existing ? "Evaluación actualizada." : "Evaluación guardada.");
}
function getEvaluation(id) { return data.evaluations.find((e) => e.id === id); }

function submitGoal(form) {
  clearFormError(form);
  if (!validateForm(form)) return;
  const fields = new FormData(form), id = String(fields.get("id") || "");
  const target = Number(fields.get("target")), progress = Number(fields.get("progress") || 0);
  if (progress > target) { reportFormError(form, "El avance no puede superar la meta."); return; }
  const existing = data.goals.find((g) => g.id === id);
  const goal = { id: id || uuid(), playerId: document.querySelector("#goal-player")?.value || "", title: String(fields.get("title")).trim(), category: String(fields.get("category")), dueDate: String(fields.get("dueDate")), target, unit: String(fields.get("unit") || "sesiones").trim(), progress, description: String(fields.get("description") || "").trim(), completed: progress >= target, createdAt: existing?.createdAt || new Date().toISOString() };
  const previous = data;
  data = { ...data, goals: existing ? data.goals.map((g) => g.id === id ? goal : g) : [...data.goals, goal], selectedPlayerId: goal.playerId };
  if (!saveData()) { data = previous; return; }
  updateAll();
  showToast(goal.completed ? "¡Objetivo alcanzado! Excelente trabajo." : existing ? "Objetivo actualizado." : "Objetivo creado.");
}

function onAction(target) {
  const action = target.dataset.action, id = target.dataset.id;
  if (!action) return;
  if (action === "new-player") {
    const slot = document.querySelector("#player-form-slot"); slot.innerHTML = renderPlayerForm(); slot.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action === "cancel-player-form") document.querySelector("#player-form-slot").innerHTML = "";
  else if (action === "select-player") { data.selectedPlayerId = id; if (saveData()) updateAll(); }
  else if (action === "edit-player") { document.querySelector("#player-form-slot").innerHTML = renderPlayerForm(getPlayer(id)); document.querySelector("#player-form-slot").scrollIntoView({ behavior: "smooth", block: "start" }); }
  else if (action === "delete-player") {
    const player = getPlayer(id);
    if (player && confirm(`¿Eliminar el perfil de ${player.fullName} y todas sus evaluaciones y objetivos asociados?`)) {
      data = { ...data, players: data.players.filter((p) => p.id !== id), evaluations: data.evaluations.filter((e) => e.playerId !== id), goals: data.goals.filter((g) => g.playerId !== id), selectedPlayerId: data.selectedPlayerId === id ? "" : data.selectedPlayerId };
      if (saveData()) { updateAll(); showToast("Perfil y datos asociados eliminados."); }
    }
  } else if (action === "new-evaluation") {
    if (!data.players.length) { showToast("Crea un perfil antes de registrar una evaluación.", "error"); navigateTo("passport"); return; }
    document.querySelector("#evaluation-form-slot").innerHTML = renderEvaluationForm(); document.querySelector("#evaluation-form-slot").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action === "cancel-evaluation") document.querySelector("#evaluation-form-slot").innerHTML = "";
  else if (action === "edit-evaluation") { document.querySelector("#evaluation-form-slot").innerHTML = renderEvaluationForm(getEvaluation(id)); document.querySelector("#evaluation-form-slot").scrollIntoView({ behavior: "smooth", block: "start" }); }
  else if (action === "delete-evaluation") {
    const evaluation = getEvaluation(id);
    if (evaluation && confirm(`¿Eliminar la evaluación del ${formatDate(evaluation.date)}?`)) { data = { ...data, evaluations: data.evaluations.filter((e) => e.id !== id) }; if (saveData()) { updateAll(); showToast("Evaluación eliminada."); } }
  } else if (action === "new-goal") {
    if (!data.players.length) { showToast("Crea un perfil antes de añadir objetivos.", "error"); navigateTo("passport"); return; }
    document.querySelector("#goal-form-slot").innerHTML = renderGoalForm(); document.querySelector("#goal-form-slot").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action === "cancel-goal") document.querySelector("#goal-form-slot").innerHTML = "";
  else if (action === "edit-goal") { const goal = data.goals.find((g) => g.id === id); document.querySelector("#goal-form-slot").innerHTML = renderGoalForm(goal); document.querySelector("#goal-form-slot").scrollIntoView({ behavior: "smooth", block: "start" }); }
  else if (action === "delete-goal") {
    const goal = data.goals.find((g) => g.id === id);
    if (goal && confirm(`¿Eliminar el objetivo "${goal.title}"?`)) { data = { ...data, goals: data.goals.filter((g) => g.id !== id) }; if (saveData()) { updateAll(); showToast("Objetivo eliminado."); } }
  } else if (action === "update-progress") {
    const goal = data.goals.find((g) => g.id === id);
    const card = target.closest(".goal-card");
    if (!goal || goal.completed || !card || card.querySelector(".progress-entry")) return;
    card.querySelector(".goal-actions").insertAdjacentHTML("beforebegin", `<form class="progress-entry" id="progress-form"><input type="hidden" name="goalId" value="${escapeAttr(goal.id)}"><label class="field"><span>Avance a registrar (${escapeHtml(goal.unit)})</span><input name="increment" type="number" min="0.01" max="${goal.target - goal.progress}" step="any" value="1" required></label><button class="button button-primary" type="submit">Guardar avance</button><button class="button button-quiet" type="button" data-action="cancel-progress">Cancelar</button></form>`);
  } else if (action === "cancel-progress") target.closest(".progress-entry")?.remove();
  else if (action === "print-showcase" || action === "print-report") window.print();
  else if (action === "open-report") { navigateTo("reports"); data.selectedPlayerId = id; saveData(); updateAll(); }
  else if (action === "export-data") exportData();
  else if (action === "reset-data") {
    if (confirm("¿Seguro que deseas borrar TODOS los perfiles, evaluaciones y objetivos de este navegador? Exporta una copia antes si la necesitas.")) {
      try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_KEYS.players); data = structuredClone(EMPTY_STATE); updateAll(); showToast("Se reiniciaron los datos de PRO PLAYER."); }
      catch (error) { console.error("No se pudieron reiniciar los datos.", error); showToast("No fue posible borrar los datos del navegador.", "error"); }
    }
  }
}

function exportData() {
  const payload = { ...data, exportedAt: new Date().toISOString(), app: "PRO PLAYER" };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `pro-player-respaldo-${new Date().toISOString().slice(0,10)}.json`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Copia JSON exportada.");
}

async function importData(file) {
  if (!file) return;
  try {
    if (file.size > 20_000_000) throw new TypeError("El archivo supera el límite de 20 MB.");
    const parsed = JSON.parse(await file.text());
    const validated = normalizeState(parsed);
    if (!confirm(`El archivo es válido. ¿Reemplazar los datos actuales? Se importarán ${validated.players.length} perfiles, ${validated.evaluations.length} evaluaciones y ${validated.goals.length} objetivos.`)) return;
    const previous = data;
    data = validated;
    if (!saveData()) { data = previous; return; }
    updateAll(); showToast("Copia importada correctamente.");
  } catch (error) {
    console.error("Falló la importación de datos.", error);
    showToast(`No se importó el archivo: ${error.message}`, "error");
  } finally {
    document.querySelector("#import-file").value = "";
  }
}

function updateCurrentDate() {
  const date = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  document.querySelector("#current-date").textContent = date.charAt(0).toUpperCase() + date.slice(1);
}

ensureSections();
document.addEventListener("click", (event) => {
  const sectionLink = event.target.closest("[data-section]");
  if (sectionLink) { event.preventDefault(); navigateTo(sectionLink.dataset.section); return; }
  const action = event.target.closest("[data-action]");
  if (action) onAction(action);
});
document.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.getAttribute("id") === "player-form") submitPlayer(form).catch((error) => handleFormFailure(form, error));
    if (form.getAttribute("id") === "evaluation-form") submitEvaluation(form);
    if (form.getAttribute("id") === "goal-form") submitGoal(form);
    if (form.getAttribute("id") === "progress-form") submitProgress(form);
  } catch (error) {
    handleFormFailure(form, error);
  }
});
function handleFormFailure(form, error) {
  console.error("No se pudo procesar el formulario.", error);
  const message = error instanceof Error ? error.message : "Ocurrió un error inesperado al guardar.";
  if (form.isConnected && form.querySelector(".form-errors")) reportFormError(form, `No se pudieron guardar los datos: ${message}`);
  else showToast(`No se pudieron guardar los datos: ${message}`, "error");
}
function submitProgress(form) {
  const fields = new FormData(form);
  const id = String(fields.get("goalId") || "");
  const increment = Number(fields.get("increment"));
  const goal = data.goals.find((item) => item.id === id);
  if (!goal || goal.completed || !Number.isFinite(increment) || increment <= 0) {
    showToast("Introduce un avance mayor que cero para un objetivo activo.", "error");
    return;
  }
  const progress = Math.min(goal.target, goal.progress + increment);
  data = { ...data, goals: data.goals.map((item) => item.id === id ? { ...item, progress, completed: progress >= item.target } : item) };
  if (saveData()) {
    updateAll();
    showToast(progress >= goal.target ? "¡Objetivo alcanzado! Excelente trabajo." : "Avance registrado.");
  }
}
document.addEventListener("change", (event) => {
  const { id, value } = event.target;
  if (id === "player-filter") { playerQuery = value; renderPassport(); document.querySelector("#player-filter").focus(); }
  if (id === "position-filter") { window.positionFilter = value; playerQuery = value ? playerQuery : ""; renderPassport(); const filter = document.querySelector("#position-filter"); filter.value = value; }
  if (["evaluation-player-filter", "development-player", "showcase-player", "goals-player", "report-player", "compare-player-a", "compare-player-b"].includes(id)) {
    if (id === "evaluation-player-filter" || id === "development-player" || id === "showcase-player" || id === "goals-player" || id === "report-player") { data.selectedPlayerId = value; saveData(); updateAll(); }
    else if (id.startsWith("compare-")) renderComparison();
  }
  if (id === "skill-filter" || id === "period-filter") renderDevelopment();
  if (id === "import-file") importData(event.target.files[0]);
});
document.addEventListener("input", (event) => {
  if (event.target.id === "player-filter") {
    const start = event.target.selectionStart;
    playerQuery = event.target.value;
    renderPassport();
    const next = document.querySelector("#player-filter"); next.focus(); next.setSelectionRange(start, start);
  }
});
window.addEventListener("popstate", () => navigateTo(window.location.hash.slice(1) || "dashboard", false));
menuToggle.addEventListener("click", () => {
  const isOpen = sidebar.classList.toggle("open");
  mobileBackdrop.classList.toggle("visible", isOpen);
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});
mobileBackdrop.addEventListener("click", closeMobileMenu);
document.querySelector("#global-search").addEventListener("input", (event) => { playerQuery = event.target.value; });
document.querySelector("#global-search").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const query = event.currentTarget.value.trim();
  if (!query) { showToast("Escribe un nombre para buscar jugadores.", "error"); return; }
  const matches = data.players.filter((p) => `${p.fullName} ${p.club} ${p.position}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
  if (!matches.length) { showToast(data.players.length ? "No se encontraron jugadores con ese nombre." : "Aún no hay perfiles para buscar.", "error"); return; }
  playerQuery = query; navigateTo("passport"); renderPassport();
  showToast(matches.length === 1 ? `Jugador encontrado: ${matches[0].fullName}` : `Se encontraron ${matches.length} jugadores.`);
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); document.querySelector("#global-search").focus(); }
  if (event.key === "Escape") { closeMobileMenu(); document.querySelector("#global-search").blur(); }
});
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) { data = loadData(); updateAll(); showToast("Los datos se actualizaron en otra pestaña."); }
});

updateCurrentDate();
updateAll();
navigateTo(window.location.hash.slice(1) || "dashboard", false);
