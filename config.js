// Conexión al relay del PFS. La clave es pública por diseño (igual que el cotizador móvil):
// el servidor la limita con rate-limit; si se abusa, se rota desde el .env del PFS.
export const API_BASE = 'https://mac-mini-de-jose.tail2b51ca.ts.net/api/mensajeria';
export const API_KEY = 'd866cc818c2333d59cc866fb254104632015258f7f7d36f8dd3b687f1c23072b';
