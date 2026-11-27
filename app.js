// Mensajero — bitácora de servicios. Vanilla JS, sin dependencias. Datos locales primero (db.js); sync con el PFS (api.js).
import { servicios, tarifas, meta } from './db.js';
import * as api from './api.js';

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const toastEl = document.getElementById('toast');

const ESTADOS = { PENDIENTE: 'Pendiente', EN_CAMINO: 'En camino', ENTREGADO: 'Entregado', NO_ENTREGADO: 'No entregado' };
const TIPOS = { ENTREGA: 'Entrega', RECOLECCION: 'Recolección', TRAMITE: 'Trámite' };

const ICONOS = {
  inicio: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  servicios: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  mas: 'M12 5v14M5 12h14',
  tarifas: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7 7h.01',
  perfil: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  sync: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
  atras: 'M15 18l-6-6 6-6',
  caja: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
};
const svg = (nombre, clase = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${clase}" aria-hidden="true"><path d="${ICONOS[nombre]}"/></svg>`;

// Estado de pantalla (no persiste): acción abierta en el detalle, filtro de lista, evidencias a medias.
const ui = { acc: null, foto: null, firma: null, geo: null, filtro: 'hoy', guardando: false, renderId: 0, tarifasMsg: null };

// Cabecera con botón de regreso. `volverA` es la ruta destino (explícita, no el historial del navegador).
const cabecera = (titulo, sub, volverA) => `
  <header class="top">
    <div class="top-titulo">
      ${volverA ? `<button class="icon-btn" data-go="${volverA}" aria-label="Volver">${svg('atras')}</button>` : ''}
      <div>${sub ? `<p class="muted">${sub}</p>` : ''}<h1>${titulo}</h1></div>
    </div>
  </header>`;

// ── Utilidades ───────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtQ = (n) => 'Q ' + (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFecha = (iso) => (iso ? new Date(iso).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const fmtHora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' }) : '');
const hoyTexto = () => new Date().toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long' });
const esHoy = (iso) => new Date(iso).toDateString() === new Date().toDateString();
const esEsteMes = (iso) => { const d = new Date(iso), h = new Date(); return d.getMonth() === h.getMonth() && d.getFullYear() === h.getFullYear(); };
const haceDias = (iso, n) => Date.now() - new Date(iso).getTime() <= n * 86400000;
const codigo = (s) => (s.client_uuid || '').slice(0, 8).toUpperCase();
const claseEstado = (e) => e.toLowerCase();

function toast(msg, tipo = 'ok') {
  toastEl.textContent = msg;
  toastEl.className = 'toast ' + tipo;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

function pill(s) {
  const extra = s.sync !== 'ok' ? '<span class="pill pendiente-sync">Por enviar</span> ' : '';
  return `${extra}<span class="pill ${claseEstado(s.estado)}">${esc(ESTADOS[s.estado])}</span>`;
}

function filaServicio(s) {
  return `<button class="fila fila-btn" data-go="servicio/${esc(s.client_uuid)}">
    <div class="fila-main"><strong>${esc(s.cliente_nombre || 'Sin nombre')}</strong>
      <span class="muted">${esc(s.zona || 'Sin zona')} · ${esc(TIPOS[s.tipo] || s.tipo)} · ${fmtHora(s.creado_en)}</span></div>
    ${pill(s)}<span class="fila-flecha">›</span></button>`;
}

// ── Sincronización (disparo y banner) ────────────────────────────────
async function dispararSync({ silencioso = false } = {}) {
  const r = await api.sincronizar();
  if (r.error) {
    if (r.error.status === 401) {
      api.cerrarSesion();
      toast('Tu sesión venció. Entra de nuevo: tus servicios siguen guardados y se enviarán.', 'error');
      location.hash = '#/login';
      return r;
    }
    if (!silencioso) toast(r.error.message === 'Sin conexión' ? 'Sin conexión: se enviará cuando haya señal' : r.error.message, 'error');
  } else if (r.enviados > 0 && !silencioso) {
    toast(`${r.enviados} servicio(s) enviados al PFS`);
  }
  // Repinta las pantallas que muestran el estado de sync. No repinta el detalle con un formulario de entrega abierto (perdería la firma).
  const [base] = ruta().split('/');
  if (['inicio', 'servicios', 'perfil'].includes(base) || (base === 'servicio' && !ui.acc)) render();
  return r;
}

function bannerSync(pendientes) {
  if (!pendientes) return '';
  return `<div class="banner-sync"><span>${pendientes} pendiente(s) por enviar</span>
    <button data-action="sync">Sincronizar</button></div>`;
}

// ── Ruteo ────────────────────────────────────────────────────────────
function ruta() { return location.hash.replace(/^#\/?/, '') || 'inicio'; }

async function render() {
  const id = ++ui.renderId;
  const sesion = api.sesion();
  const [base, arg] = ruta().split('/');
  if (!sesion && base !== 'login') { location.hash = '#/login'; return; }
  if (sesion && base === 'login') { location.hash = '#/inicio'; return; }
  if (base !== 'tarifas') ui.tarifasMsg = null;
  const vista = VISTAS[base] || VISTAS.inicio;
  const { html, after } = await vista(arg);
  if (id !== ui.renderId) return;   // llegó otra navegación mientras cargaba
  app.classList.toggle('sin-tabs', !sesion);
  tabbar.hidden = !sesion;
  app.innerHTML = html;
  if (after) after();
  if (sesion) pintarTabbar(base);
  window.scrollTo(0, 0);
}

function pintarTabbar(activo) {
  const item = (clave, etiqueta) => `<button class="tab ${activo === clave ? 'activo' : ''}" data-go="${clave}" aria-label="${etiqueta}">${svg(clave === 'inicio' ? 'inicio' : clave, '')}<span>${etiqueta}</span></button>`;
  tabbar.innerHTML = item('inicio', 'Inicio') + item('servicios', 'Servicios') +
    `<div class="tab-mas"><button data-go="nuevo" aria-label="Nuevo servicio">${svg('mas')}</button></div>` +
    item('tarifas', 'Tarifas') + item('perfil', 'Perfil');
}

// ── Vistas ───────────────────────────────────────────────────────────
const VISTAS = {
  login: async () => ({
    html: `<div class="login">
      <div class="login-marca"><img class="logo" src="icons/icon.svg" alt=""><h1>Mensajero</h1>
        <p class="muted">Registra tus servicios del día</p></div>
      <form class="card" id="form-login">
        <div class="campo"><label for="usuario">Usuario</label>
          <input id="usuario" type="text" autocomplete="username" placeholder="ej. cmendez" required></div>
        <div class="campo"><label for="clave">Contraseña</label>
          <input id="clave" type="password" autocomplete="current-password" placeholder="••••••••" required></div>
        <button class="btn" type="submit">Entrar</button>
      </form></div>`,
  }),

  inicio: async () => {
    const lista = (await servicios.todos()).sort((a, b) => b.creado_en.localeCompare(a.creado_en));
    const hoy = lista.filter((s) => esHoy(s.creado_en));
    const cont = (e) => hoy.filter((s) => s.estado === e).length;
    const totalMes = lista.filter((s) => s.estado === 'ENTREGADO' && esEsteMes(s.creado_en))
      .reduce((a, s) => a + (Number(s.monto_propuesto) || 0), 0);
    const pendientes = await api.contarPendientes();
    const nombre = (api.sesion() || {}).nombre || '';
    return {
      html: `
        <header class="top"><div><p class="muted">${esc(hoyTexto())}</p>
          <h1>Hola, ${esc(nombre.split(' ')[0] || 'mensajero')}</h1></div></header>
        ${bannerSync(pendientes)}
        <section class="card">
          <div class="resumen-head"><span>Hoy</span><span class="muted">${hoy.length} servicio(s)</span></div>
          <div class="kpis">
            <div class="kpi"><strong>${cont('PENDIENTE')}</strong><span>Pendientes</span></div>
            <div class="kpi"><strong>${cont('EN_CAMINO')}</strong><span>En camino</span></div>
            <div class="kpi"><strong>${cont('ENTREGADO')}</strong><span>Entregados</span></div>
            <div class="kpi"><strong>${cont('NO_ENTREGADO')}</strong><span>No entregados</span></div>
          </div>
          <div class="total-mes"><span class="muted">Entregado este mes</span><strong>${fmtQ(totalMes)}</strong></div>
        </section>
        <div class="tiles">
          <button class="tile primario" data-go="nuevo"><span class="ico">${svg('mas')}</span>Registrar servicio</button>
          <button class="tile" data-go="servicios"><span class="ico">${svg('caja')}</span>Mis servicios</button>
          <button class="tile" data-go="tarifas"><span class="ico">${svg('tarifas')}</span>Tarifas</button>
          <button class="tile" data-action="sync"><span class="ico">${svg('sync')}</span>Sincronizar</button>
        </div>
        <h2>Últimos servicios</h2>
        ${lista.length ? `<section class="card">${lista.slice(0, 5).map(filaServicio).join('')}</section>`
          : `<div class="vacio"><strong>Aún no hay servicios</strong>Toca “Registrar servicio” para empezar.</div>`}`,
    };
  },

  servicios: async () => {
    const todos = (await servicios.todos()).sort((a, b) => b.creado_en.localeCompare(a.creado_en));
    const filtrados = todos.filter((s) => {
      if (ui.filtro === 'hoy') return esHoy(s.creado_en);
      if (ui.filtro === 'semana') return haceDias(s.creado_en, 7);
      return true;
    });
    const chip = (v, t) => `<button class="chip ${ui.filtro === v ? 'activo' : ''}" data-action="filtro" data-val="${v}">${t}</button>`;
    return {
      html: `
        <header class="top"><div class="top-titulo"><button class="icon-btn" data-go="inicio" aria-label="Volver">${svg('atras')}</button><h1>Mis servicios</h1></div>
          <div class="top-acciones"><button class="icon-btn" data-action="sync" aria-label="Sincronizar">${svg('sync')}</button></div></header>
        <div class="chips">${chip('hoy', 'Hoy')}${chip('semana', 'Últimos 7 días')}${chip('todos', 'Todos')}</div>
        ${filtrados.length ? `<section class="card">${filtrados.map(filaServicio).join('')}</section>`
          : `<div class="vacio"><strong>No hay servicios en este filtro</strong>Registra uno con el botón +.</div>`}`,
    };
  },

  nuevo: async () => {
    const lista = (await tarifas.todas()).filter((t) => t.activa !== false).sort((a, b) => a.zona.localeCompare(b.zona));
    const opciones = lista.length
      ? `<option value="">Elige la zona</option>` + lista.map((t) => `<option value="${esc(t.zona)}" data-monto="${Number(t.monto)}">${esc(t.zona)}${t.nombre ? ' · ' + esc(t.nombre) : ''} — ${fmtQ(t.monto)}</option>`).join('')
      : `<option value="">Primero agrega tus tarifas</option>`;
    return {
      html: `
        ${cabecera('Nuevo servicio', 'Un servicio por entrega o recolección', 'inicio')}
        <form class="card" id="form-nuevo">
          <div class="campo"><span class="etiqueta">Tipo</span>
            <div class="segmentos" data-seg="tipo">
              <button type="button" class="activo" data-val="ENTREGA">Entrega</button>
              <button type="button" data-val="RECOLECCION">Recolección</button>
              <button type="button" data-val="TRAMITE">Trámite</button>
            </div>
            <input type="hidden" name="tipo" value="ENTREGA"></div>
          <div class="campo"><label for="cliente">Cliente o destinatario</label>
            <input id="cliente" name="cliente" type="text" maxlength="200" placeholder="ej. María González" required></div>
          <div class="campo"><label for="direccion">Dirección</label>
            <input id="direccion" name="direccion" type="text" maxlength="300" placeholder="ej. 4a calle 12-30, zona 15" required></div>
          <div class="campo"><label for="zona">Zona (define la tarifa)</label>
            <select id="zona" name="zona" ${lista.length ? '' : 'disabled'} required>${opciones}</select>
            ${lista.length ? '' : '<span class="ayuda"><button type="button" class="link" data-go="tarifas">Ir a Tarifas</button></span>'}</div>
          <div class="campo"><label for="monto">Monto a cobrar (Q)</label>
            <input id="monto" name="monto" type="number" inputmode="decimal" min="0" step="0.01" placeholder="ej. 45.00"></div>
          <div class="campo"><label for="descripcion">Descripción (opcional)</label>
            <textarea id="descripcion" name="descripcion" maxlength="2000" placeholder="ej. 2 sobres con documentos, firma de contrato"></textarea></div>
          <button class="btn" type="submit" ${lista.length ? '' : 'disabled'}>Guardar servicio</button>
        </form>`,
    };
  },

  servicio: async (uuid) => {
    const s = await servicios.obtener(uuid);
    if (!s) return { html: `<header class="top"><h1>Servicio</h1></header><div class="vacio"><strong>No encontrado</strong></div>` };
    const abierto = s.estado === 'PENDIENTE' || s.estado === 'EN_CAMINO';
    const pasos = [
      { titulo: 'Registrado', fecha: s.creado_en, hecho: true },
      { titulo: 'En camino', fecha: s.en_camino_en, hecho: !!s.en_camino_en || s.estado === 'ENTREGADO' || s.estado === 'NO_ENTREGADO' },
    ];
    let final;
    if (s.estado === 'ENTREGADO') final = { titulo: 'Entregado', fecha: s.entregado_en, hecho: true, clase: 'ok' };
    else if (s.estado === 'NO_ENTREGADO') final = { titulo: 'No entregado', fecha: s.no_entregado_en, hecho: true, clase: 'mal', extra: s.motivo_no_entrega };
    else final = { titulo: 'Entrega pendiente', fecha: null, hecho: false };
    pasos.push(final);

    const mapa = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.direccion || '')}`;
    const botones = [];
    if (s.estado === 'PENDIENTE') botones.push(`<button class="btn secundario" data-action="en-camino" data-uuid="${esc(uuid)}">Voy en camino</button>`);
    if (abierto) {
      botones.push(`<button class="btn" data-action="accion" data-val="entregar">Entregar</button>`);
      botones.push(`<button class="btn peligro" data-action="accion" data-val="no-entregado">No entregado</button>`);
    }

    let panel = '';
    if (abierto && ui.acc === 'entregar') panel = panelEntrega(uuid);
    if (abierto && ui.acc === 'no-entregado') panel = panelNoEntregado(uuid);

    return {
      html: `
        <a class="volver" data-go="servicios">${svg('atras')} Servicios</a>
        <section class="card">
          <div class="encabezado-servicio">
            <div class="ico">${svg('caja')}</div>
            <div class="fila-main"><div class="muted">Servicio ${esc(codigo(s))}</div>
              <div class="card-titulo">${esc(s.cliente_nombre || 'Sin nombre')}</div></div>
            ${pill(s)}
          </div>
          <div class="mini-datos">
            <div class="mini">Tipo<strong>${esc(TIPOS[s.tipo] || s.tipo)}</strong></div>
            <div class="mini">Zona<strong>${esc(s.zona || '—')}</strong></div>
            <div class="mini">Monto<strong>${fmtQ(s.monto_propuesto)}</strong></div>
            <div class="mini">Sync<strong>${s.sync === 'ok' ? 'Enviado' : 'Pendiente'}</strong></div>
          </div>
        </section>
        <section class="card">
          <div class="card-titulo" style="margin-bottom:12px">Seguimiento</div>
          <ol class="timeline">
            ${pasos.map((p) => `<li class="${p.hecho ? 'hecho' : ''} ${p.clase || ''}">
              <strong>${esc(p.titulo)}</strong>
              <span class="muted">${p.fecha ? fmtFecha(p.fecha) : ''}${p.extra ? ' · ' + esc(p.extra) : ''}</span></li>`).join('')}
          </ol>
        </section>
        <section class="card">
          <div class="card-titulo" style="margin-bottom:6px">Información de entrega</div>
          <div class="fila"><div class="fila-main"><span class="muted">Dirección</span><strong>${esc(s.direccion || '—')}</strong></div>
            <a class="icon-btn" href="${mapa}" target="_blank" rel="noopener" aria-label="Abrir en mapa">${svg('pin')}</a></div>
          ${s.recibido_por ? `<div class="fila"><div class="fila-main"><span class="muted">Recibió</span><strong>${esc(s.recibido_por)}</strong></div></div>` : ''}
          ${s.descripcion ? `<div class="fila"><div class="fila-main"><span class="muted">Descripción</span><strong style="white-space:normal">${esc(s.descripcion)}</strong></div></div>` : ''}
        </section>
        ${panel}
        ${botones.length && !panel ? `<div class="acciones">${botones.join('')}</div>` : ''}`,
      after: () => { if (abierto && ui.acc === 'entregar') { iniciarFirma(); if (!ui.geo) pedirGPS(); } },
    };
  },

  tarifas: async () => {
    let lista = await tarifas.todas();
    if (!lista.length && navigator.onLine && api.sesion()) {
      try { await api.bajarTarifas(); lista = await tarifas.todas(); } catch {}
    }
    lista.sort((a, b) => String(a.zona).localeCompare(String(b.zona)));
    return {
      html: `
        ${cabecera('Tarifas', 'Tú cargas tus precios; LGM los revisa después', 'inicio')}
        <section class="card">
          <div class="fila-dos" style="font-size:12px;color:var(--muted);margin-bottom:4px"><span>Zona · nombre</span><span>Monto (Q)</span></div>
          <div id="tarifas-lista">${lista.map(filaTarifa).join('') || ''}</div>
          ${lista.length ? '' : '<div class="vacio" id="tarifas-vacio"><strong>Aún no tienes tarifas</strong>Toca “Agregar tarifa” para crear la primera.</div>'}
        </section>
        <div class="acciones">
          <button class="btn secundario" data-action="agregar-tarifa">Agregar tarifa</button>
          <button class="btn" data-action="guardar-tarifas">Guardar tarifas</button>
          ${ui.tarifasMsg ? `<p class="ok-msg" role="status">${esc(ui.tarifasMsg)}</p>` : ''}
        </div>
        <p class="muted" style="margin-top:12px">Para quitar una tarifa, desmarca “Activa”. Así no se pierde el historial de los servicios.</p>`,
    };
  },

  perfil: async () => {
    const s = api.sesion() || {};
    const pendientes = await api.contarPendientes();
    return {
      html: `
        ${cabecera('Perfil', '', 'inicio')}
        <section class="card">
          <div class="card-titulo">${esc(s.nombre || 'Mensajero')}</div>
          <p class="muted" style="margin-top:4px">${pendientes ? pendientes + ' servicio(s) por enviar' : 'Todo sincronizado'}</p>
        </section>
        <div class="acciones">
          <button class="btn secundario" data-action="sync">Sincronizar ahora</button>
          <button class="btn peligro" data-action="cerrar-sesion">Cerrar sesión</button>
        </div>`,
    };
  },
};

function filaTarifa(t) {
  return `<div class="tarifa-fila ${t.activa === false ? 'inactiva' : ''}" data-id="${esc(t.id)}">
    <input type="text" name="zona" value="${esc(t.zona)}" placeholder="ej. Zona 15" maxlength="120" aria-label="Zona">
    <input type="text" name="nombre" value="${esc(t.nombre)}" placeholder="ej. Residencial" maxlength="200" aria-label="Nombre">
    <input type="number" name="monto" value="${Number(t.monto) || ''}" placeholder="ej. 45" min="0" step="0.01" inputmode="decimal" aria-label="Monto en quetzales">
    <label class="check">Activa<input type="checkbox" name="activa" ${t.activa === false ? '' : 'checked'}></label>
  </div>`;
}

function panelEntrega(uuid) {
  return `<section class="card panel-accion">
    <div class="card-titulo">Confirmar entrega</div>
    <div class="campo" style="margin-top:12px"><label for="recibido">Recibido por</label>
      <input id="recibido" type="text" maxlength="200" placeholder="ej. Juan Pérez, recepción"></div>
    <div class="campo"><span class="etiqueta">Foto de la entrega</span>
      <div class="foto-caja" id="foto-caja">${fotoHtml()}</div></div>
    <div class="campo"><span class="etiqueta">Firma de quien recibe</span>
      <div class="firma-caja"><canvas id="firma" aria-label="Firma"></canvas>
        <button type="button" class="link limpiar" data-action="limpiar-firma">Limpiar</button></div></div>
    <p class="gps" id="gps">${geoTexto()}</p>
    <div class="acciones">
      <button class="btn" data-action="confirmar-entrega" data-uuid="${esc(uuid)}">Confirmar entrega</button>
      <button class="btn secundario" data-action="cancelar-accion">Cancelar</button>
    </div>
  </section>`;
}

function panelNoEntregado(uuid) {
  return `<section class="card panel-accion">
    <div class="card-titulo">No se pudo entregar</div>
    <div class="campo" style="margin-top:12px"><label for="motivo">Motivo</label>
      <textarea id="motivo" maxlength="1000" placeholder="ej. Nadie en la dirección; se dejó aviso en portería"></textarea></div>
    <div class="acciones">
      <button class="btn peligro" data-action="confirmar-no-entregado" data-uuid="${esc(uuid)}">Guardar como no entregado</button>
      <button class="btn secundario" data-action="cancelar-accion">Cancelar</button>
    </div>
  </section>`;
}

function fotoHtml() {
  const img = ui.foto ? `<img src="${ui.foto}" alt="Foto de la entrega">` : 'Toma una foto del paquete o de quien lo recibe';
  return `${img}<label class="btn secundario pequeno" style="cursor:pointer">${ui.foto ? 'Cambiar foto' : 'Tomar foto'}
    <input id="foto" type="file" accept="image/*" capture="environment" hidden></label>`;
}

function geoTexto() {
  if (ui.geo) return `Ubicación lista (±${ui.geo.precision_m} m)`;
  if (ui.geoError) return ui.geoError;
  return 'Buscando ubicación…';
}

// ── Firma y foto ─────────────────────────────────────────────────────
function iniciarFirma() {
  const c = document.getElementById('firma');
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0E1A33';
  if (ui.firma) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, w, h);
    img.src = ui.firma;
  }
  let dibujando = false, last = null;
  const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  c.addEventListener('pointerdown', (e) => { dibujando = true; last = pos(e); c.setPointerCapture(e.pointerId); e.preventDefault(); });
  c.addEventListener('pointermove', (e) => {
    if (!dibujando) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
  });
  const fin = () => { if (!dibujando) return; dibujando = false; ui.firma = c.toDataURL('image/png'); };
  c.addEventListener('pointerup', fin);
  c.addEventListener('pointercancel', fin);
}

function limpiarFirma() {
  const c = document.getElementById('firma');
  if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  ui.firma = null;
}

function cargarImagen(file) {
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolver(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

// Reduce la foto a 900 px de lado mayor y JPEG 72 % para que quepa bien en datos móviles.
async function comprimirFoto(file) {
  const img = await cargarImagen(file);
  const escala = Math.min(1, 900 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

function pedirGPS() {
  ui.geo = null; ui.geoError = null;
  if (!navigator.geolocation) { ui.geoError = 'Este equipo no tiene GPS; la entrega se guarda sin ubicación'; actualizarGps(); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => { ui.geo = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), precision_m: Math.round(p.coords.accuracy) }; actualizarGps(); },
    () => { ui.geoError = 'No se pudo obtener la ubicación; la entrega se guarda sin GPS'; actualizarGps(); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function actualizarGps() { const el = document.getElementById('gps'); if (el) el.textContent = geoTexto(); }

// ── Acciones sobre servicios ─────────────────────────────────────────
async function actualizarServicio(uuid, cambios) {
  const s = await servicios.obtener(uuid);
  if (!s) throw new Error('El servicio ya no existe');
  Object.assign(s, cambios, { sync: 'pendiente', actualizado_en: new Date().toISOString() });
  await servicios.guardar(s);
  return s;
}

function resetAccion() { ui.acc = null; ui.foto = null; ui.firma = null; ui.geo = null; ui.geoError = null; }

async function confirmarEntrega(uuid) {
  if (ui.guardando) return;
  const recibido = (document.getElementById('recibido')?.value || '').trim();
  if (!recibido) return toast('Escribe quién recibió el paquete', 'error');
  if (!ui.foto) return toast('Toma la foto de la entrega', 'error');
  if (!ui.firma) return toast('Pide la firma de quien recibe', 'error');
  ui.guardando = true;
  try {
    const s = await servicios.obtener(uuid);
    const evidencias = [
      ...(s.evidencias || []),
      { tipo: 'FOTO', mime: 'image/jpeg', data: ui.foto, enviada: false },
      { tipo: 'FIRMA', mime: 'image/png', data: ui.firma, enviada: false },
    ];
    await actualizarServicio(uuid, {
      estado: 'ENTREGADO',
      recibido_por: recibido,
      entregado_en: new Date().toISOString(),
      lat: ui.geo?.lat ?? null, lng: ui.geo?.lng ?? null, precision_m: ui.geo?.precision_m ?? null,
      evidencias,
    });
    resetAccion();
    toast('Entrega guardada');
    location.hash = '#/servicio/' + uuid;
    dispararSync({ silencioso: true });
    render();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    ui.guardando = false;
  }
}

async function confirmarNoEntregado(uuid) {
  const motivo = (document.getElementById('motivo')?.value || '').trim();
  if (!motivo) return toast('Escribe el motivo', 'error');
  await actualizarServicio(uuid, { estado: 'NO_ENTREGADO', motivo_no_entrega: motivo, no_entregado_en: new Date().toISOString() });
  resetAccion();
  toast('Guardado como no entregado');
  dispararSync({ silencioso: true });
  render();
}

async function guardarNuevoServicio(form) {
  const datos = Object.fromEntries(new FormData(form).entries());
  const cliente = String(datos.cliente || '').trim();
  const direccion = String(datos.direccion || '').trim();
  if (!cliente || !direccion) return toast('Falta cliente o dirección', 'error');
  if (!datos.zona) return toast('Elige la zona', 'error');
  const monto = Number(datos.monto || 0);
  if (!(monto >= 0)) return toast('Monto inválido', 'error');
  const s = {
    client_uuid: crypto.randomUUID(),
    tipo: datos.tipo || 'ENTREGA',
    cliente_nombre: cliente,
    direccion,
    zona: datos.zona,
    descripcion: String(datos.descripcion || '').trim(),
    estado: 'PENDIENTE',
    recibido_por: '',
    motivo_no_entrega: '',
    lat: null, lng: null, precision_m: null,
    monto_propuesto: monto,
    creado_en: new Date().toISOString(),
    entregado_en: null,
    evidencias: [],
    sync: 'pendiente',
  };
  await servicios.guardar(s);
  toast('Servicio guardado');
  location.hash = '#/servicio/' + s.client_uuid;
  dispararSync({ silencioso: true });
}

async function guardarTarifas() {
  const filas = [...document.querySelectorAll('#tarifas-lista .tarifa-fila')];
  const lista = [];
  for (const f of filas) {
    const zona = f.querySelector('[name=zona]').value.trim();
    const nombre = f.querySelector('[name=nombre]').value.trim();
    const montoTxt = f.querySelector('[name=monto]').value;
    const activa = f.querySelector('[name=activa]').checked;
    if (!zona && !montoTxt) continue;   // fila vacía: se ignora
    if (!zona) return toast('Cada tarifa necesita una zona', 'error');
    const monto = Number(montoTxt);
    if (montoTxt === '' || !(monto >= 0)) return toast(`Monto inválido en “${zona}”`, 'error');
    const id = f.dataset.id;
    lista.push({ id: /^\d+$/.test(id) ? Number(id) : id, zona, nombre, monto, activa });
  }
  if (!lista.length) return toast('Agrega al menos una tarifa antes de guardar', 'error');
  await api.guardarTarifasLocales(lista);
  ui.tarifasMsg = navigator.onLine ? 'Guardado. Se envía al PFS ahora.' : 'Guardado en el teléfono. Se envía al PFS cuando haya señal.';
  toast('Tarifas guardadas');
  dispararSync({ silencioso: true });
  render();
}

// ── Eventos (delegación) ─────────────────────────────────────────────
app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action],[data-go]');
  if (!el) return;
  if (el.dataset.go) { location.hash = '#/' + el.dataset.go; return; }
  const a = el.dataset.action;
  if (a === 'sync') { el.disabled = true; const r = await dispararSync(); el.disabled = false; if (!r.error) toast('Sincronizado'); return; }
  if (a === 'filtro') { ui.filtro = el.dataset.val; return render(); }
  if (a === 'accion') { ui.acc = el.dataset.val; ui.foto = null; ui.firma = null; ui.geo = null; return render(); }
  if (a === 'cancelar-accion') { resetAccion(); return render(); }
  if (a === 'limpiar-firma') return limpiarFirma();
  if (a === 'en-camino') {
    await actualizarServicio(el.dataset.uuid, { estado: 'EN_CAMINO', en_camino_en: new Date().toISOString() });
    toast('Marcado en camino');
    dispararSync({ silencioso: true });
    return render();
  }
  if (a === 'confirmar-entrega') return confirmarEntrega(el.dataset.uuid);
  if (a === 'confirmar-no-entregado') return confirmarNoEntregado(el.dataset.uuid);
  if (a === 'agregar-tarifa') {
    const lista = document.getElementById('tarifas-lista');
    document.getElementById('tarifas-vacio')?.remove();
    const tmp = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    lista.insertAdjacentHTML('beforeend', filaTarifa({ id: tmp, zona: '', nombre: '', monto: '', activa: true }));
    ui.tarifasMsg = null;
    const nueva = lista.lastElementChild;
    nueva.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nueva.querySelector('[name=zona]').focus();
    return;
  }
  if (a === 'guardar-tarifas') return guardarTarifas();
  if (a === 'cerrar-sesion') {
    const pend = await api.contarPendientes();
    if (pend) return toast(`Tienes ${pend} servicio(s) sin enviar. Sincroniza antes de salir.`, 'error');
    api.cerrarSesion();
    location.hash = '#/login';
    return;
  }
});

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'form-login') {
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api.login(document.getElementById('usuario').value.trim(), document.getElementById('clave').value);
      toast('Sesión iniciada');
      location.hash = '#/inicio';
      dispararSync({ silencioso: true });
    } catch (err) {
      toast(err.status === 401 ? 'Usuario o contraseña incorrectos' : err.message, 'error');
    } finally { btn.disabled = false; }
  }
  if (e.target.id === 'form-nuevo') guardarNuevoServicio(e.target);
});

app.addEventListener('change', async (e) => {
  if (e.target.id === 'zona') {
    const op = e.target.selectedOptions[0];
    const monto = document.getElementById('monto');
    if (op && op.dataset.monto !== undefined && monto) monto.value = op.dataset.monto;
    return;
  }
  if (e.target.id === 'foto' && e.target.files[0]) {
    try {
      ui.foto = await comprimirFoto(e.target.files[0]);
      document.getElementById('foto-caja').innerHTML = fotoHtml();
    } catch (err) { toast(err.message, 'error'); }
  }
});

// Segmentos (tipo de servicio) y zona→monto: se enganchan tras cada render de Nuevo
const observador = new MutationObserver(() => {
  const seg = document.querySelector('[data-seg="tipo"]');
  if (seg && !seg.dataset.listo) {
    seg.dataset.listo = '1';
    seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('activo', x === b));
      document.querySelector('input[name=tipo]').value = b.dataset.val;
    }));
  }
});
observador.observe(app, { childList: true });

// ── Arranque ─────────────────────────────────────────────────────────
window.addEventListener('hashchange', render);
window.addEventListener('online', () => { dispararSync({ silencioso: true }); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
if (api.sesion()) dispararSync({ silencioso: true });
