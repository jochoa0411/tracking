// Sesión y sincronización con el PFS. Los registros viven primero en IndexedDB (db.js);
// aquí se mandan al servidor cuando hay señal. Si falla algo, queda marcado y se reintenta.
import { API_BASE, API_KEY } from './config.js';
import { servicios, tarifas, meta } from './db.js';

const LS_TOKEN = 'mensajero.token';
const LS_NOMBRE = 'mensajero.nombre';

export class ErrorApi extends Error {
  constructor(status, mensaje) { super(mensaje); this.status = status; }
}

// ── Sesión (por dispositivo) ─────────────────────────────────────────
export function sesion() {
  try {
    const token = localStorage.getItem(LS_TOKEN);
    return token ? { token, nombre: localStorage.getItem(LS_NOMBRE) || '' } : null;
  } catch { return null; }
}

function guardarSesion(token, nombre) {
  try { localStorage.setItem(LS_TOKEN, token); localStorage.setItem(LS_NOMBRE, nombre || ''); } catch {}
}

export function cerrarSesion() {
  try { localStorage.removeItem(LS_TOKEN); localStorage.removeItem(LS_NOMBRE); } catch {}
}

// ── HTTP ─────────────────────────────────────────────────────────────
async function llamar(path, { metodo = 'GET', cuerpo, conToken = true } = {}) {
  const headers = { 'X-Api-Key': API_KEY };
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  const s = sesion();
  if (conToken && s) headers['Authorization'] = `Bearer ${s.token}`;
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: metodo,
      headers,
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    // Con red pero sin respuesta válida (CORS, servidor caído, túnel apagado) el navegador también llega aquí
    throw new ErrorApi(0, navigator.onLine ? 'No se pudo conectar con el PFS' : 'Sin conexión');
  }
  let datos = null;
  try { datos = await res.json(); } catch {}
  if (!res.ok) throw new ErrorApi(res.status, (datos && datos.error) || `Error ${res.status}`);
  return datos;
}

export async function login(usuario, clave) {
  const datos = await llamar('/login', { metodo: 'POST', cuerpo: { username: usuario, password: clave }, conToken: false });
  guardarSesion(datos.token, datos.nombre);
  return datos;
}

// ── Sincronización ───────────────────────────────────────────────────
let sincronizando = false;

// Manda al PFS: servicios pendientes, sus evidencias, y tarifas si se editaron sin señal.
// Devuelve { enviados, pendientes, error }. Nunca lanza: la UI solo muestra el resultado.
export async function sincronizar() {
  if (sincronizando) return { enviados: 0, pendientes: 0, error: null };
  if (!navigator.onLine || !sesion()) return { enviados: 0, pendientes: await contarPendientes(), error: null };
  sincronizando = true;
  let enviados = 0;
  let error = null;
  try {
    const lista = (await servicios.todos()).sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    for (const s of lista) {
      const hayEvidenciaPendiente = (s.evidencias || []).some((e) => !e.enviada);
      if (s.sync === 'ok' && !hayEvidenciaPendiente) continue;
      if (s.sync !== 'ok') {
        const r = await llamar('/servicios', { metodo: 'POST', cuerpo: aPayload(s) });
        s.server_id = r.id;
        s.sync = 'ok';
        await servicios.guardar(s);
        enviados++;
      }
      for (const e of s.evidencias || []) {
        if (e.enviada) continue;
        await llamar(`/servicios/${s.server_id}/evidencias`, {
          metodo: 'POST',
          cuerpo: { tipo: e.tipo, mime: e.mime, data: e.data },
        });
        e.enviada = true;
        await servicios.guardar(s);
      }
    }
    if (await meta.get('tarifas_pendientes')) {
      const locales = await tarifas.todas();
      // id numérico = tarifa ya existente en el PFS; id temporal (texto) = alta nueva → se manda null
      const lista = locales.map((t) => ({ id: typeof t.id === 'number' ? t.id : null, zona: t.zona, nombre: t.nombre, monto: t.monto, activa: t.activa }));
      const r = await llamar('/tarifas', { metodo: 'PUT', cuerpo: { tarifas: lista } });
      await tarifas.reemplazar(r.map(normalizarTarifa));
      await meta.set('tarifas_pendientes', false);
    }
    await bajarTarifas();
  } catch (e) {
    error = e;
  } finally {
    sincronizando = false;
  }
  return { enviados, pendientes: await contarPendientes(), error };
}

// Baja las tarifas del servidor solo si no hay cambios locales sin mandar.
export async function bajarTarifas() {
  if (await meta.get('tarifas_pendientes')) return;
  const r = await llamar('/tarifas');
  await tarifas.reemplazar(r.map(normalizarTarifa));
}

export async function guardarTarifasLocales(lista) {
  const conId = lista.map((t) => normalizarTarifa({ ...t, id: t.id ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }));
  await tarifas.reemplazar(conId);
  await meta.set('tarifas_pendientes', true);
}

export async function contarPendientes() {
  const lista = await servicios.todos();
  return lista.filter((s) => s.sync !== 'ok' || (s.evidencias || []).some((e) => !e.enviada)).length;
}

function aPayload(s) {
  return {
    client_uuid: s.client_uuid,
    tipo: s.tipo,
    cliente_nombre: s.cliente_nombre,
    direccion: s.direccion,
    zona: s.zona,
    descripcion: s.descripcion,
    estado: s.estado,
    recibido_por: s.recibido_por,
    motivo_no_entrega: s.motivo_no_entrega,
    lat: s.lat,
    lng: s.lng,
    precision_m: s.precision_m,
    monto_propuesto: s.monto_propuesto,
    creado_en: s.creado_en,
    entregado_en: s.entregado_en,
  };
}

function normalizarTarifa(t) {
  return { id: t.id, zona: t.zona || '', nombre: t.nombre || '', monto: Number(t.monto) || 0, activa: t.activa !== false };
}
