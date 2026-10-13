const $ = (id) => document.getElementById(id);
let adminToken = '';
function message(text, error = false) {
  const el = $('message');
  el.hidden = !text;
  el.className = error ? 'message error' : 'message';
  el.textContent = text;
}
async function api(path, options = {}) {
  const r = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: {
      ...(options.headers || {}),
      'x-admin-token': adminToken,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(data.error || 'HTTP ' + r.status);
  return data;
}
function context() {
  const storeId = $('store').value.trim();
  if (!storeId) throw Error('Enter a store UUID.');
  return storeId;
}
async function connect() {
  adminToken = $('token').value.trim();
  if (adminToken.length < 32) {
    message('Admin token must be at least 32 characters.', true);
    return;
  }
  try {
    const storeId = context();
    await api('/api/v1/admin/inventory?storeId=' + encodeURIComponent(storeId));
    $('status').textContent = 'Connected';
    message('Admin access verified.');
    await refresh();
  } catch (e) {
    message(e.message, true);
    $('status').textContent = 'Not connected';
  }
}
async function refresh() {
  try {
    const storeId = context();
    const data = await api('/api/v1/admin/inventory?storeId=' + encodeURIComponent(storeId));
    const oldProduct = $('product').value,
      oldCounter = $('counter').value;
    $('product').innerHTML =
      '<option value="">Choose a product</option>' +
      data.products
        .map(
          (p) =>
            '<option value="' +
            esc(p.productId) +
            '">' +
            esc(p.name) +
            ' · ' +
            qty(p.onHandQuantityMilli) +
            ' on hand</option>',
        )
        .join('');
    $('counter').innerHTML =
      '<option value="">Choose a counter</option>' +
      data.counters
        .map(
          (c) =>
            '<option value="' +
            esc(c.counterId) +
            '">' +
            esc(c.counterId) +
            ' ' +
            (c.isActive ? '' : '(disabled)') +
            '</option>',
        )
        .join('');
    if (data.products.some((p) => p.productId === oldProduct)) $('product').value = oldProduct;
    if (data.counters.some((c) => c.counterId === oldCounter)) $('counter').value = oldCounter;
    $('inventory').innerHTML =
      '<table><thead><tr><th>Product</th><th>On hand</th><th>Allocations</th></tr></thead><tbody>' +
      data.products
        .map(
          (p) =>
            '<tr><td><strong>' +
            esc(p.name) +
            '</strong><small>' +
            esc(p.productId) +
            '</small></td><td>' +
            qty(p.onHandQuantityMilli) +
            '</td><td>' +
            data.allocations
              .filter((a) => a.productId === p.productId)
              .map(
                (a) =>
                  esc(a.counterId.slice(0, 8)) +
                  ': ' +
                  qty(a.allocatedQuantityMilli) +
                  ' / ' +
                  qty(a.remainingQuantityMilli),
              )
              .join('<br>') +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table>';
    const c = await api('/api/v1/admin/conflicts?storeId=' + encodeURIComponent(storeId));
    renderConflicts(c.conflicts);
  } catch (e) {
    message(e.message, true);
  }
}
function qty(v) {
  return (Number(v || 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}
function esc(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function renderConflicts(rows) {
  if (!rows.length) {
    $('conflicts').innerHTML = '<p class="empty">No open conflicts.</p>';
    return;
  }
  $('conflicts').innerHTML =
    '<table><thead><tr><th>Event</th><th>Reason</th><th>Payload / resolution</th></tr></thead><tbody>' +
    rows
      .map(
        (c) =>
          '<tr><td>' +
          esc(c.eventType) +
          '<small>' +
          esc(c.counterId) +
          '<br>' +
          esc(c.eventId) +
          '</small></td><td>' +
          esc(c.message) +
          '<small>' +
          esc(new Date(c.createdAt).toLocaleString()) +
          '</small></td><td><button class="secondary" data-payload="' +
          esc(c.id) +
          '">View payload</button> <button data-resolve="' +
          esc(c.id) +
          '">Resolve</button></td></tr>',
      )
      .join('') +
    '</tbody></table>';
  for (const b of $('conflicts').querySelectorAll('[data-payload]'))
    b.onclick = () => {
      const c = rows.find((x) => String(x.id) === b.dataset.payload);
      alert(JSON.stringify(c?.payload ?? {}, null, 2));
    };
  for (const b of $('conflicts').querySelectorAll('[data-resolve]'))
    b.onclick = async () => {
      const note = prompt('Resolution note (minimum 3 characters):');
      if (!note || note.trim().length < 3) return;
      try {
        await api('/api/v1/admin/conflicts/resolve', {
          method: 'POST',
          body: JSON.stringify({
            storeId: context(),
            conflictId: Number(b.dataset.resolve),
            resolutionNote: note.trim(),
          }),
        });
        message('Conflict resolved and resolution note recorded.');
        await refresh();
      } catch (e) {
        message(e.message, true);
      }
    };
}
$('connect').onclick = connect;
$('refresh').onclick = refresh;
$('refreshConflicts').onclick = refresh;
$('token').onkeydown = (e) => {
  if (e.key === 'Enter') connect();
};
$('clear').onclick = () => {
  adminToken = '';
  $('token').value = '';
  $('status').textContent = 'Not connected';
  message('Admin token cleared.');
};
$('adjust').onclick = async () => {
  try {
    const delta = Number($('delta').value),
      reason = $('reason').value.trim();
    if (!Number.isFinite(delta) || delta === 0 || !reason)
      throw Error('Enter a non-zero stock delta and audit reason.');
    await api('/api/v1/admin/inventory/adjustment', {
      method: 'POST',
      body: JSON.stringify({
        storeId: context(),
        productId: $('product').value.trim(),
        deltaQuantityMilli: Math.round(delta * 1000),
        reason,
      }),
    });
    message('Stock adjustment posted.');
    await refresh();
  } catch (e) {
    message(e.message, true);
  }
};
$('allocate').onclick = async () => {
  try {
    const n = Number($('allocation').value);
    if (!Number.isFinite(n) || n < 0) throw Error('Enter a valid allocation total.');
    await api('/api/v1/admin/allocations', {
      method: 'POST',
      body: JSON.stringify({
        storeId: context(),
        counterId: $('counter').value.trim(),
        productId: $('product').value.trim(),
        allocatedQuantityMilli: Math.round(n * 1000),
      }),
    });
    message('Allocation saved.');
    await refresh();
  } catch (e) {
    message(e.message, true);
  }
};
