const url = process.env.METRICS_URL,
  token = process.env.MONITOR_TOKEN;
if (!url || !token)
  throw Error('Configure METRICS_URL e MONITOR_TOKEN no ambiente de monitoramento.');
const r = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(15000),
});
if (!r.ok) throw Error(`Monitoramento indisponível: HTTP ${r.status}`);
const data = await r.json();
const failed = data.queue.some((q) => ['failed', 'review'].includes(q.status) && q.total > 0);
const overdue = data.oldest.due && Date.now() - data.oldest.due > 3600000;
console.log(
  JSON.stringify({ emailConfigured: data.emailConfigured, queue: data.queue, overdue: !!overdue }),
);
if (!data.emailConfigured || failed || overdue)
  throw Error('Há envios com falha, atraso ou configuração pendente. Consulte os logs.');
