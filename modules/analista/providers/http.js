'use strict';
// Chamada HTTP com limite de tempo. Usa o fetch do Node 22.
async function postarJson(url, corpo, cabecalhos, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 45000);
  try {
    const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, cabecalhos || {}), body: JSON.stringify(corpo), signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + txt.slice(0, 200));
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}
module.exports = { postarJson };
