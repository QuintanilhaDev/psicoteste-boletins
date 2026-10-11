// Utilitários de texto, documentos e datas. Tudo puro (sem DOM) para ser testável.

export type Cell = string | number | null;

export const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/** minúsculas, sem acento, só letras/números separados por um espaço */
export function norm(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isCPF(v: unknown): boolean {
  const d = digits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const dv = ((s * 10) % 11) % 10;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

export function isCNPJ(v: unknown): boolean {
  const d = digits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (n: number) => {
    let s = 0;
    let p = n - 7;
    for (let i = 0; i < n; i++) {
      s += Number(d[i]) * p--;
      if (p < 2) p = 9;
    }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export const fmtCPF = (v: string) => {
  const d = digits(v);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : v;
};

export const fmtCNPJ = (v: string) => {
  const d = digits(v);
  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : v;
};

export const isEmail = (v: unknown) => /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(String(v ?? '').trim());

export const brl = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/[\u00a0\u202f]/g, ' ');

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** aceita "1.234,56", "1234.56", "R$ 80", 80 */
export function parseMoney(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = [
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const pad = (n: number) => String(n).padStart(2, '0');
const okDate = (y: number, m: number, d: number) => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Converte o conteúdo de uma célula em data ISO (YYYY-MM-DD) ou null. Formato brasileiro (dia/mês/ano). */
export function parseDate(v: Cell): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // número de série do Excel (2000-01-01 = 36526, 2100-01-01 = 73051)
    if (v >= 36526 && v < 73051) {
      const dt = new Date(Math.round((Math.floor(v) - 25569) * 86400000));
      return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return okDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:\s.*)?$/);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), fullYear(Number(m[3]))];
    return okDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = norm(s).match(/^(\d{1,2}) (?:de )?([a-z]{3,9}) (?:de )?(\d{2}|\d{4})$/);
  if (m) {
    const mo = monthIndex(m[2]);
    const [d, y] = [Number(m[1]), fullYear(Number(m[3]))];
    return mo && okDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  return null;
}

function monthIndex(w: string): number {
  const i = MESES_LONGOS.indexOf(w);
  if (i >= 0) return i + 1;
  const j = MESES.indexOf(w.slice(0, 3));
  return j >= 0 && (w.length === 3 || MESES_LONGOS[j].startsWith(w)) ? j + 1 : 0;
}

/** Procura um mês/ano em texto livre: "Março 2026", "mar-26", "03/2026", "2026-03", "03_2026". */
export function findCompetencia(text: string): string | null {
  const t = norm(text);
  let m = t.match(/\b([a-z]{3,9}) (?:de )?(\d{4}|\d{2})\b/);
  if (m) {
    const mo = monthIndex(m[1]);
    const y = fullYear(Number(m[2]));
    if (mo && y >= 2000 && y <= 2100) return `${y}-${pad(mo)}`;
  }
  m = t.match(/(?:^| )(\d{1,2}) (20\d{2})(?: |$)/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && !/\d{1,2} \d{1,2} 20\d{2}/.test(t))
    return `${m[2]}-${pad(Number(m[1]))}`;
  m = t.match(/(?:^| )(20\d{2}) (\d{1,2})(?: |$)/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && !/20\d{2} \d{1,2} \d{1,2}/.test(t))
    return `${m[1]}-${pad(Number(m[2]))}`;
  m = t.match(/\b(\d{1,2}) (\d{1,2}) (20\d{2})\b/);
  if (m && okDate(Number(m[3]), Number(m[2]), Number(m[1]))) return `${m[3]}-${pad(Number(m[2]))}`;
  return null;
}

export function competenciaLabel(c: string, longo = false): string {
  const [y, m] = c.split('-').map(Number);
  if (!y || !m) return c;
  const nome = longo ? MESES_LONGOS[m - 1].replace('marco', 'março') : MESES[m - 1];
  return longo ? `${nome[0].toUpperCase()}${nome.slice(1)} de ${y}` : `${nome}/${String(y).slice(2)}`;
}

export const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  // data pura (YYYY-MM-DD) não tem fuso; data com hora é mostrada no horário local de quem usa
  if (iso.length > 10) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
export function nomeBonito(v: string): string {
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return s;
  // só "embeleza" quando veio tudo em maiúsculas ou tudo em minúsculas
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const SUFIXOS = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 'ss', 'cia', 'limitada', 'mei', 'slu', 'unipessoal']);
/** chave de comparação de nomes de empresa: sem acento, sem sufixo societário */
export function empresaKey(v: string): string {
  const toks = norm(String(v).replace(/s\s*[/.]\s*a\b\.?/gi, ' sa ').replace(/&/g, ' e '))
    .split(' ')
    .filter(Boolean);
  while (toks.length > 1 && SUFIXOS.has(toks[toks.length - 1])) toks.pop();
  return toks.join(' ');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/ /g, '');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** 0..1 — semelhança entre dois nomes de empresa (coeficiente de Dice sobre bigramas) */
export function similaridade(a: string, b: string): number {
  const ka = empresaKey(a);
  const kb = empresaKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const A = bigrams(ka);
  const B = bigrams(kb);
  let inter = 0;
  let ta = 0;
  let tb = 0;
  for (const n of A.values()) ta += n;
  for (const n of B.values()) tb += n;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const dice = ta + tb ? (2 * inter) / (ta + tb) : 0;
  // um nome contido no outro ("GPS Segurança" x "GPS Segurança Patrimonial") é forte indício
  const sa = ka.split(' ');
  const sb = kb.split(' ');
  const [menor, maior] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  const contido = menor.every((t) => maior.includes(t)) && menor.some((t) => t.length >= 3);
  return Math.min(0.99, contido ? Math.max(dice, 0.85) : dice);
}

const GENERICAS = new Set([
  'seguranca', 'vigilancia', 'servicos', 'servico', 'patrimonial', 'privada', 'empresa', 'grupo', 'de', 'da', 'do', 'dos', 'das', 'e',
  'em', 'transporte', 'transportes', 'valores', 'monitoramento', 'protecao', 'escolta', 'armada', 'eletronica', 'comercio', 'brasil',
]);
/** 0..1 — semelhança olhando só a parte que distingue a empresa ("Alfa" em "Alfa Segurança Ltda") */
export function semelhancaNucleo(a: string, b: string): number {
  const nucleo = (v: string) => {
    const t = empresaKey(v).split(' ');
    const n = t.filter((x) => !GENERICAS.has(x));
    return (n.length ? n : t).join(' ');
  };
  const na = nucleo(a);
  const nb = nucleo(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return similaridade(na, nb);
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function hashString(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
