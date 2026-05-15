const state = {
  productos: [],
  filtrados: [],
  cart: [],
  modoPrecio: 'venta',
  incluirImpuestos: true
};

const XLSX_URL = 'inventario.xlsx';
const JSON_URL = 'productos.json';
const PDF_LOGO_URL = 'pharma-clinical-logo.png';

const catalogoBody = document.getElementById('catalogoBody');
const filtroDepartamento = document.getElementById('filtroDepartamento');
const filtroStock = document.getElementById('filtroStock');
const ordenSelect = document.getElementById('orden');
const busquedaInput = document.getElementById('busqueda');
const cotizacionItems = document.getElementById('cotizacionItems');
const subtotalEl = document.getElementById('subtotal');
const ivaEl = document.getElementById('iva');
const totalEl = document.getElementById('total');
const ivaLabelEl = document.getElementById('ivaLabel');
const sinImpuestosInput = document.getElementById('sinImpuestos');
const statusBar = document.getElementById('statusBar');

function syncDepartamentoPlaceholder(){
  filtroDepartamento.classList.toggle('center-placeholder', !filtroDepartamento.value);
}

function money(value){
  return new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' }).format(Number(value || 0));
}

function setStatus(message, kind='ok'){
  statusBar.textContent = message;
  statusBar.className = `status-bar ${kind}`;
}

function setToday(){
  document.getElementById('fechaCotizacion').value = new Date().toISOString().slice(0,10);
}

function toNumber(value){
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const normalized = String(value).replace(/[$,%\s]/g,'').replace(/,/g,'');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function normalizeProducto(row){
  const codigo = String(row['Código'] ?? row.codigo ?? '').trim();
  const producto = String(row['Producto'] ?? row.producto ?? '').trim();
  if (!codigo && !producto) return null;
  return {
    codigo,
    producto,
    costo: toNumber(row['P. Costo'] ?? row.costo),
    venta: toNumber(row['P. Venta'] ?? row.venta),
    mayoreo: toNumber(row['P. Mayoreo'] ?? row.mayoreo ?? row['P.Mayoreo']),
    existencia: Math.round(toNumber(row['Existencia'] ?? row.existencia)),
    invMin: toNumber(row['Inv. Mínimo'] ?? row['Inv. Minimo'] ?? row.invMin),
    invMax: toNumber(row['Inv. Máximo'] ?? row['Inv. Maximo'] ?? row.invMax),
    departamento: String(row['Departamento'] ?? row.departamento ?? 'Sin departamento').trim() || 'Sin departamento',
    tipo: String(row['TIPO DE PRODUCTO'] ?? row.tipo ?? '').trim(),
    iva: toNumber(row['IVA'] ?? row.iva),
    ieps: toNumber(row['IEPS'] ?? row.ieps)
  };
}

async function loadProductos(){
  try {
    setStatus('Cargando catálogo...', 'warn');
    state.productos = await loadFromJSON();
    if (!state.productos.length) throw new Error('El archivo JSON no trae productos válidos.');
    hydrateCatalog('Catálogo cargado correctamente.');
  } catch (jsonError) {
    console.warn('Fallo JSON, intentando Excel...', jsonError);
    try {
      setStatus('No se pudo leer el catálogo principal en este momento. Cargando respaldo desde Excel...', 'warn');
      state.productos = await loadFromExcel();
      if (!state.productos.length) throw new Error('El archivo Excel no trae productos válidos.');
      hydrateCatalog('Se cargó el respaldo Excel del catálogo.');
    } catch (excelError) {
      console.error(excelError);
      state.productos = [];
      state.filtrados = [];
      renderCatalog();
      setStatus('No se pudo cargar el catálogo ni su respaldo. Vuelve a subir el ZIP completo.', 'error');
    }
  }
}

async function loadFromJSON(){
  const res = await fetch(JSON_URL, { cache:'no-store' });
  if (!res.ok) throw new Error(`No se pudo abrir ${JSON_URL}: HTTP ${res.status}`);
  const raw = await res.json();
  const productos = Array.isArray(raw[0]?.productos) ? raw[0].productos : raw;
  return productos.map(normalizeProducto).filter(Boolean);
}
async function loadFromExcel(){
  if (typeof XLSX === 'undefined') throw new Error('La librería XLSX no está disponible.');
  const res = await fetch(XLSX_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo abrir ${XLSX_URL}: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const workbook = XLSX.read(buffer, { type:'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval:'' });
  return rows.map(normalizeProducto).filter(Boolean);
}

function hydrateCatalog(successMessage){
  state.filtrados = [...state.productos];
  updateStats();
  populateDepartments();
  applyFilters();
  setStatus(`${successMessage} Productos detectados: ${state.productos.length}.`, 'ok');
}

function updateStats(){
  document.getElementById('statProductos').textContent = state.productos.length.toLocaleString('es-MX');
  document.getElementById('statDepartamentos').textContent = new Set(state.productos.map(p => p.departamento).filter(Boolean)).size.toLocaleString('es-MX');
  document.getElementById('statExistencias').textContent = state.productos.reduce((acc,p) => acc + Number(p.existencia || 0), 0).toLocaleString('es-MX');
}

function populateDepartments(){
  const current = filtroDepartamento.value;
  const departments = [...new Set(state.productos.map(p => p.departamento).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  filtroDepartamento.innerHTML = '<option value="">Todos</option>';
  departments.forEach(dep => {
    const option = document.createElement('option');
    option.value = dep;
    option.textContent = dep;
    filtroDepartamento.appendChild(option);
  });
  if (departments.includes(current)) filtroDepartamento.value = current;
  syncDepartamentoPlaceholder();
}

function applyFilters(){
  const text = busquedaInput.value.trim().toLowerCase();
  const departamento = filtroDepartamento.value;
  const stock = filtroStock.value;
  const orden = ordenSelect.value;

  let items = state.productos.filter(item => {
    const hayTexto = !text || [item.codigo, item.producto, item.departamento, item.tipo].join(' ').toLowerCase().includes(text);
    const hayDepartamento = !departamento || item.departamento === departamento;
    let stockOk = true;
    if (stock === 'disponible') stockOk = item.existencia > 0;
    if (stock === 'bajo') stockOk = item.existencia > 0 && item.existencia <= Math.max(1, item.invMin || 1);
    if (stock === 'agotado') stockOk = item.existencia <= 0;
    return hayTexto && hayDepartamento && stockOk;
  });

  items.sort((a,b) => {
    if (orden === 'ventaAsc') return a.venta - b.venta;
    if (orden === 'ventaDesc') return b.venta - a.venta;
    if (orden === 'existenciaDesc') return b.existencia - a.existencia;
    return a.producto.localeCompare(b.producto, 'es');
  });

  state.filtrados = items;
  renderCatalog();
}

function stockMeta(producto){
  if (producto.existencia <= 0) return { label:'Agotado', klass:'stock-out' };
  if (producto.existencia <= Math.max(1, producto.invMin || 1)) return { label:'Stock bajo', klass:'stock-low' };
  return { label:'Disponible', klass:'stock-ok' };
}

function renderCatalog(){
  catalogoBody.innerHTML = '';
  if (!state.filtrados.length) {
    catalogoBody.innerHTML = '<tr><td colspan="7" class="loading">No se encontraron productos con los filtros actuales.</td></tr>';
    return;
  }

  const template = document.getElementById('productoRowTemplate');
  state.filtrados.forEach(producto => {
    const fragment = template.content.cloneNode(true);
    const row = fragment.querySelector('tr');
    const stock = stockMeta(producto);
    fragment.querySelector('.code').innerHTML = `<span class="code-chip">${producto.codigo || '—'}</span>`;
    fragment.querySelector('.product-name').textContent = producto.producto || 'Sin nombre';
    fragment.querySelector('.product-type').textContent = producto.tipo || 'Sin tipo de producto';
    fragment.querySelector('.department').textContent = producto.departamento || 'Sin departamento';
    fragment.querySelector('.stock').innerHTML = `<span class="stock-pill ${stock.klass}">${producto.existencia} · ${stock.label}</span>`;
    fragment.querySelector('.price').innerHTML = `<div class="price-stack"><span class="price-label">Venta</span><strong>${money(producto.venta)}</strong></div>`;
    fragment.querySelector('.wholesale').innerHTML = `<div class="price-stack"><span class="price-label">Mayoreo</span><strong>${money(producto.mayoreo)}</strong></div>`;
    const addBtn = fragment.querySelector('.add-btn');
    addBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      addToCart(producto);
    });
    row.classList.add('clickable');
    row.addEventListener('click', () => addToCart(producto));
    catalogoBody.appendChild(fragment);
  });
}

function addToCart(producto){
  const existing = state.cart.find(item => item.codigo === producto.codigo && item.producto === producto.producto);
  if (existing) {
    existing.cantidad += 1;
  } else {
    state.cart.push({
      ...producto,
      cantidad: 1,
      precio: state.modoPrecio === 'mayoreo' ? producto.mayoreo : producto.venta,
      iva: Number(producto.iva || 0),
      ieps: Number(producto.ieps || 0)
    });
  }
  renderCart();
}

function renderCart(){
  cotizacionItems.innerHTML = '';
  if (!state.cart.length) {
    cotizacionItems.innerHTML = `
      <div class="empty-state">
        <h3>Aún no agregas productos</h3>
        <p>Selecciona elementos del catálogo para generar tu cotización.</p>
      </div>`;
    updateTotals();
    return;
  }

  const template = document.getElementById('itemTemplate');
  state.cart.forEach((item, index) => {
    const fragment = template.content.cloneNode(true);
    fragment.querySelector('h3').textContent = item.producto;
    fragment.querySelector('p').textContent = `${item.codigo || 'Sin código'} · ${item.departamento || 'Sin departamento'} · ${item.tipo || 'Sin tipo'}`;
    const qty = fragment.querySelector('.qty-input');
    const price = fragment.querySelector('.price-input');
    const total = fragment.querySelector('.line-total');
    qty.value = item.cantidad;
    price.value = Number(item.precio || 0).toFixed(2);
    total.textContent = money(item.cantidad * item.precio);

    qty.addEventListener('input', (e) => {
      item.cantidad = Math.max(1, Number(e.target.value || 1));
      renderCart();
    });

    price.addEventListener('input', (e) => {
      item.precio = Math.max(0, Number(e.target.value || 0));
      renderCart();
    });

    fragment.querySelector('.remove-btn').addEventListener('click', () => {
      state.cart.splice(index, 1);
      renderCart();
    });

    cotizacionItems.appendChild(fragment);
  });

  updateTotals();
}

function updateTotals(){
  const subtotal = state.cart.reduce((acc, item) => acc + (Number(item.cantidad || 0) * Number(item.precio || 0)), 0);
  const iva = state.incluirImpuestos ? state.cart.reduce((acc, item) => {
    const base = Number(item.cantidad || 0) * Number(item.precio || 0);
    const tasaIva = Number(item.iva || 0);
    return acc + (base * tasaIva);
  }, 0) : 0;
  const total = subtotal + iva;
  subtotalEl.textContent = money(subtotal);
  ivaEl.textContent = money(iva);
  if (ivaLabelEl) ivaLabelEl.textContent = state.incluirImpuestos ? 'IVA' : 'IVA no aplicado';
  totalEl.textContent = money(total);
}

function setIncluirImpuestos(incluir){
  state.incluirImpuestos = Boolean(incluir);
  if (sinImpuestosInput) sinImpuestosInput.checked = !state.incluirImpuestos;
  renderCart();
}

function setModoPrecio(modo){
  state.modoPrecio = modo;
  document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.modo === modo));
  state.cart.forEach(item => {
    item.precio = modo === 'mayoreo' ? item.mayoreo : item.venta;
  });
  renderCart();
}

function exportJSON(){
  const payload = {
    cliente: {
      nombre: document.getElementById('clienteNombre').value,
      empresa: document.getElementById('clienteEmpresa').value,
      contacto: document.getElementById('clienteContacto').value,
      fecha: document.getElementById('fechaCotizacion').value,
      notas: document.getElementById('notasCotizacion').value
    },
    modoPrecio: state.modoPrecio,
    incluirImpuestos: state.incluirImpuestos,
    productos: state.cart,
    subtotal: subtotalEl.textContent,
    iva: ivaEl.textContent,
    total: totalEl.textContent
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cotizacion-pcs-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function clearCart(){
  state.cart = [];
  renderCart();
}


function sanitizeFilenamePart(value, fallback = 'paciente'){
  const clean = String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || fallback;
}

function formatDisplayDate(value){
  if (!value) return new Date().toLocaleDateString('es-MX');
  const [y, m, d] = String(value).split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function getQuoteData(){
  const cliente = {
    nombre: document.getElementById('clienteNombre').value.trim(),
    empresa: document.getElementById('clienteEmpresa').value.trim(),
    contacto: document.getElementById('clienteContacto').value.trim(),
    fecha: document.getElementById('fechaCotizacion').value,
    notas: document.getElementById('notasCotizacion').value.trim()
  };

  const subtotal = state.cart.reduce((acc, item) => acc + (Number(item.cantidad || 0) * Number(item.precio || 0)), 0);
  const iva = state.incluirImpuestos ? state.cart.reduce((acc, item) => {
    const base = Number(item.cantidad || 0) * Number(item.precio || 0);
    return acc + (base * Number(item.iva || 0));
  }, 0) : 0;
  const total = subtotal + iva;

  return { cliente, subtotal, iva, total, items: state.cart.slice(), modoPrecio: state.modoPrecio, incluirImpuestos: state.incluirImpuestos };
}

function buildPdfFilename(clienteNombre, fecha){
  const paciente = sanitizeFilenamePart(clienteNombre, 'paciente');
  const fechaPart = sanitizeFilenamePart(fecha || new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
  return `pharmaclinical_${paciente}_${fechaPart}.pdf`;
}

function buildPdfMarkup(data){
  const rows = data.items.map((item, index) => {
    const cantidad = Number(item.cantidad || 0);
    const precio = Number(item.precio || 0);
    const base = cantidad * precio;
    const ivaMonto = data.incluirImpuestos ? base * Number(item.iva || 0) : 0;
    const totalLinea = base + ivaMonto;
    const codigo = item.codigo ? `<div style="font-size:11px;color:#6b7d8b;margin-top:2px;">Código: ${item.codigo}</div>` : '';
    const tipo = item.tipo ? `<div style="font-size:11px;color:#7f8f9b;margin-top:4px;">${item.tipo}</div>` : '';
    return `
      <tr style="page-break-inside:avoid;">
        <td style="padding:12px 10px;border-bottom:1px solid #dbe8ef;text-align:center;color:#365364;">${index + 1}</td>
        <td style="padding:12px 10px;border-bottom:1px solid #dbe8ef;">
          <div style="font-weight:700;color:#17384a;">${item.producto || 'Producto'}</div>
          ${codigo}
          ${tipo}
        </td>
        <td style="padding:12px 10px;border-bottom:1px solid #dbe8ef;text-align:center;color:#365364;">${cantidad}</td>
        <td style="padding:12px 10px;border-bottom:1px solid #dbe8ef;text-align:right;color:#365364;">${money(precio)}</td>
        <td style="padding:12px 10px;border-bottom:1px solid #dbe8ef;text-align:right;color:#365364;">${money(base)}</td>
        <td style="padding:12px 10px;border-bottom:1px solid #dbe8ef;text-align:right;color:#365364;">${money(ivaMonto)}</td>
        <td style="padding:12px 10px;border-bottom:1px solid #dbe8ef;text-align:right;font-weight:700;color:#17384a;">${money(totalLinea)}</td>
      </tr>`;
  }).join('');

  const notas = data.cliente.notas
    ? `<div style="margin-top:18px;padding:14px 16px;border:1px solid #dbe8ef;border-radius:14px;background:#f8fcfe;">
         <div style="font-weight:700;color:#17384a;margin-bottom:6px;">Notas</div>
         <div style="color:#425968;line-height:1.6;white-space:pre-wrap;">${data.cliente.notas}</div>
       </div>`
    : '';

  return `
    <div style="font-family:Montserrat,Arial,sans-serif;color:#16384a;background:#ffffff;padding:16px;width:190mm;max-width:190mm;box-sizing:border-box;">
      <div style="border:1px solid #dbe8ef;border-radius:24px;overflow:hidden;background:#fff;box-shadow:0 16px 40px rgba(26,76,102,.08);page-break-inside:auto;">
        <div style="background:linear-gradient(135deg,#eff8fb 0%,#d9edf5 52%,#f8fcfd 100%);padding:24px 26px 20px;border-bottom:1px solid #dbe8ef;page-break-inside:avoid;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:20px;">
            <div style="max-width:65%;">
              <div style="font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#5a7b8f;">Cotización</div>
              <div style="font-size:28px;font-weight:800;color:#17384a;margin-top:8px;">Pharma Clinical Solution</div>
              <div style="font-size:13px;color:#5d7787;margin-top:6px;line-height:1.6;">Documento generado automáticamente desde el cotizador.</div>
            </div>
            <div style="text-align:right;">
              <img src="${PDF_LOGO_URL}" alt="Pharma Clinical Solution" style="width:200px;max-width:100%;border-radius:18px;display:block;box-shadow:0 10px 24px rgba(23,56,74,.08);" />
            </div>
          </div>
        </div>

        <div style="padding:22px 26px 10px;display:grid;grid-template-columns:1.2fr .8fr;gap:16px;page-break-inside:avoid;">
          <div style="border:1px solid #dbe8ef;border-radius:16px;padding:16px 18px;background:#fff;">
            <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7a93a1;margin-bottom:10px;">Datos del cliente</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;font-size:13px;">
              <div><div style="color:#7a93a1;font-size:11px;text-transform:uppercase;font-weight:700;">Cliente</div><div style="color:#17384a;font-weight:700;">${data.cliente.nombre || 'Paciente'}</div></div>
              <div><div style="color:#7a93a1;font-size:11px;text-transform:uppercase;font-weight:700;">Fecha</div><div style="color:#17384a;font-weight:700;">${formatDisplayDate(data.cliente.fecha)}</div></div>
              <div><div style="color:#7a93a1;font-size:11px;text-transform:uppercase;font-weight:700;">Empresa / razón social</div><div style="color:#425968;">${data.cliente.empresa || '—'}</div></div>
              <div><div style="color:#7a93a1;font-size:11px;text-transform:uppercase;font-weight:700;">Contacto</div><div style="color:#425968;">${data.cliente.contacto || '—'}</div></div>
            </div>
          </div>

          <div style="border:1px solid #dbe8ef;border-radius:16px;padding:16px 18px;background:linear-gradient(135deg,#f7fbfd,#eef8fb);">
            <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7a93a1;margin-bottom:10px;">Resumen</div>
            <div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;color:#425968;"><span>Modo de precio</span><strong style="color:#17384a;text-transform:capitalize;">${data.modoPrecio}</strong></div>
            <div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;color:#425968;"><span>Productos</span><strong style="color:#17384a;">${data.items.length}</strong></div>
            <div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;color:#425968;"><span>Subtotal</span><strong style="color:#17384a;">${money(data.subtotal)}</strong></div>
            <div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;color:#425968;"><span>${data.incluirImpuestos ? 'IVA' : 'IVA no aplicado'}</span><strong style="color:#17384a;">${money(data.iva)}</strong></div>
            <div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0 0;margin-top:8px;border-top:1px dashed #c7dbe5;color:#17384a;font-size:18px;font-weight:800;"><span>Total</span><strong>${money(data.total)}</strong></div>
          </div>
        </div>

        <div style="padding:6px 26px 10px;">
          <table style="width:100%;border-collapse:collapse;border-spacing:0;overflow:hidden;border:1px solid #dbe8ef;border-radius:18px;">
            <thead>
              <tr style="background:#17384a;color:#fff;">
                <th style="padding:12px 10px;text-align:center;font-size:12px;">#</th>
                <th style="padding:12px 10px;text-align:left;font-size:12px;">Producto</th>
                <th style="padding:12px 10px;text-align:center;font-size:12px;">Cantidad</th>
                <th style="padding:12px 10px;text-align:right;font-size:12px;">Precio</th>
                <th style="padding:12px 10px;text-align:right;font-size:12px;">Subtotal</th>
                <th style="padding:12px 10px;text-align:right;font-size:12px;">${data.incluirImpuestos ? 'IVA' : 'IVA'}</th>
                <th style="padding:12px 10px;text-align:right;font-size:12px;">Total</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${notas}
        </div>

        <div style="padding:16px 26px 22px;color:#7a93a1;font-size:11px;line-height:1.6;">
          Esta cotización presenta los productos seleccionados y los importes calculados con base en el modo de precio activo al momento de la exportación.
        </div>
      </div>
    </div>`;
}


async function loadImageAsDataUrl(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar imagen: ${url}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}



async function ensurePdfGenerator(){
  if ((window.jspdf && window.jspdf.jsPDF) || window.jsPDF) return true;

  const sources = [
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  ];

  for (const src of sources) {
    try {
      await new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-pdf-src="${src}"]`);
        if (existing) {
          if ((window.jspdf && window.jspdf.jsPDF) || window.jsPDF) return resolve();
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
          return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.dataset.pdfSrc = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });

      if ((window.jspdf && window.jspdf.jsPDF) || window.jsPDF) return true;
    } catch (err) {
      console.warn('Fallo al cargar jsPDF desde', src, err);
    }
  }

  return false;
}

async function exportStyledPdf(){
  if (!state.cart.length) {
    setStatus('Agrega al menos un producto antes de generar el PDF.', 'warn');
    return;
  }

  const pdfReady = await ensurePdfGenerator();
  const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (!pdfReady || !jsPDFCtor) {
    setStatus('No se pudo cargar el generador de PDF. Verifica tu conexión y vuelve a intentarlo.', 'error');
    return;
  }

  const data = getQuoteData();
  const filename = buildPdfFilename(data.cliente.nombre, data.cliente.fecha);
  const button = document.getElementById('imprimirBtn');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Generando PDF...';
  setStatus('Generando PDF profesional...', 'warn');

  try {
    const doc = new jsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 12;
    const contentW = pageW - (margin * 2);
    let y = margin;

    let logoData = null;
    try {
      logoData = await loadImageAsDataUrl(PDF_LOGO_URL);
    } catch (imgErr) {
      console.warn('No se pudo cargar el logo para el PDF', imgErr);
    }

    const drawHeader = () => {
      doc.setFillColor(239, 248, 251);
      doc.roundedRect(margin, y, contentW, 36, 6, 6, 'F');

      doc.setTextColor(90, 123, 143);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('COTIZACIÓN', margin + 6, y + 9);

      doc.setTextColor(23, 56, 74);
      doc.setFontSize(20);
      doc.text('Pharma Clinical Solution', margin + 6, y + 20);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(93, 119, 135);
      doc.text('Documento generado automáticamente desde el cotizador.', margin + 6, y + 28);

      if (logoData) {
        try {
          doc.addImage(logoData, 'PNG', pageW - margin - 48, y + 4, 42, 24, undefined, 'FAST');
        } catch (e) {
          console.warn('No se pudo incrustar el logo en el PDF', e);
        }
      }
      y += 42;
    };

    const drawInfoBoxes = () => {
      const leftW = 106;
      const rightW = contentW - leftW - 4;
      const boxH = 34;

      doc.setDrawColor(219, 232, 239);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, y, leftW, boxH, 5, 5, 'FD');
      doc.setFillColor(247, 251, 253);
      doc.roundedRect(margin + leftW + 4, y, rightW, boxH, 5, 5, 'FD');

      doc.setTextColor(122, 147, 161);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('DATOS DEL CLIENTE', margin + 5, y + 7);
      doc.text('RESUMEN', margin + leftW + 9, y + 7);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text('Cliente', margin + 5, y + 13);
      doc.text('Fecha', margin + 58, y + 13);
      doc.text('Empresa / razón social', margin + 5, y + 24);
      doc.text('Contacto', margin + 58, y + 24);

      doc.setTextColor(23, 56, 74);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(data.cliente.nombre || 'Paciente', margin + 5, y + 18);
      doc.text(formatDisplayDate(data.cliente.fecha), margin + 58, y + 18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(66, 89, 104);
      doc.text(data.cliente.empresa || '—', margin + 5, y + 29);
      doc.text(data.cliente.contacto || '—', margin + 58, y + 29);

      const rx = margin + leftW + 9;
      const rv = margin + leftW + rightW - 5;
      const rows = [
        ['Modo de precio', data.modoPrecio.charAt(0).toUpperCase() + data.modoPrecio.slice(1)],
        ['Productos', String(data.items.length)],
        ['Subtotal', money(data.subtotal)],
        [data.incluirImpuestos ? 'IVA' : 'IVA no aplicado', money(data.iva)],
      ];
      let ry = y + 13;
      doc.setFontSize(8.5);
      rows.forEach(([label, value]) => {
        doc.setTextColor(66, 89, 104);
        doc.setFont('helvetica', 'normal');
        doc.text(label, rx, ry);
        doc.setTextColor(23, 56, 74);
        doc.setFont('helvetica', 'bold');
        doc.text(value, rv, ry, { align: 'right' });
        ry += 6;
      });
      doc.setDrawColor(199, 219, 229);
      doc.line(rx, y + 30, rv, y + 30);
      doc.setFontSize(12);
      doc.setTextColor(23, 56, 74);
      doc.text('Total', rx, y + 36);
      doc.text(money(data.total), rv, y + 36, { align: 'right' });

      y += boxH + 6;
    };

    const ensureSpace = (needed) => {
      if (y + needed <= pageH - margin) return;
      doc.addPage();
      y = margin;
    };

    drawHeader();
    drawInfoBoxes();

    const cols = [10, 70, 16, 24, 24, 18, 24];
    const starts = [margin];
    for (let i = 1; i < cols.length; i++) starts.push(starts[i-1] + cols[i-1]);

    const drawTableHeader = () => {
      doc.setFillColor(23, 56, 74);
      doc.roundedRect(margin, y, contentW, 10, 3, 3, 'F');
      const headers = ['#', 'Producto', 'Cant.', 'Precio', 'Subtotal', 'IVA', 'Total'];
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(255, 255, 255);
      headers.forEach((h, i) => {
        const x = starts[i];
        const w = cols[i];
        const align = i === 1 ? 'left' : (i >= 3 ? 'right' : 'center');
        const tx = align === 'left' ? x + 2 : align === 'right' ? x + w - 2 : x + w / 2;
        doc.text(h, tx, y + 6.5, { align });
      });
      y += 10;
    };

    drawTableHeader();

    data.items.forEach((item, index) => {
      const cantidad = Number(item.cantidad || 0);
      const precio = Number(item.precio || 0);
      const subtotal = cantidad * precio;
      const ivaMonto = data.incluirImpuestos ? subtotal * Number(item.iva || 0) : 0;
      const totalLinea = subtotal + ivaMonto;
      const productLines = doc.splitTextToSize(item.producto || 'Producto', cols[1] - 4);
      const meta = [item.codigo, item.tipo].filter(Boolean).join(' · ');
      const metaLines = meta ? doc.splitTextToSize(meta, cols[1] - 4) : [];
      const lineCount = Math.max(1, productLines.length + metaLines.length);
      const rowH = Math.max(10, lineCount * 4.2 + 3);

      ensureSpace(rowH + 2);
      if (y + rowH > pageH - margin) {
        doc.addPage();
        y = margin;
        drawTableHeader();
      }

      doc.setDrawColor(219, 232, 239);
      doc.line(margin, y + rowH, margin + contentW, y + rowH);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(54, 83, 100);
      doc.setFontSize(8.5);
      doc.text(String(index + 1), starts[0] + cols[0] / 2, y + 6, { align: 'center' });

      doc.setTextColor(23, 56, 74);
      doc.setFont('helvetica', 'bold');
      doc.text(productLines, starts[1] + 2, y + 5.5);
      if (metaLines.length) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(110, 132, 146);
        doc.setFontSize(7.3);
        doc.text(metaLines, starts[1] + 2, y + 5.5 + productLines.length * 4.1);
      }

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(54, 83, 100);
      doc.text(String(cantidad), starts[2] + cols[2] / 2, y + 6, { align: 'center' });
      doc.text(money(precio), starts[3] + cols[3] - 2, y + 6, { align: 'right' });
      doc.text(money(subtotal), starts[4] + cols[4] - 2, y + 6, { align: 'right' });
      doc.text(money(ivaMonto), starts[5] + cols[5] - 2, y + 6, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(23, 56, 74);
      doc.text(money(totalLinea), starts[6] + cols[6] - 2, y + 6, { align: 'right' });

      y += rowH;
    });

    if (data.cliente.notas) {
      const noteLines = doc.splitTextToSize(data.cliente.notas, contentW - 10);
      const noteH = Math.max(16, noteLines.length * 4.3 + 10);
      ensureSpace(noteH + 8);
      doc.setFillColor(248, 252, 254);
      doc.setDrawColor(219, 232, 239);
      doc.roundedRect(margin, y + 6, contentW, noteH, 4, 4, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(23, 56, 74);
      doc.text('Notas', margin + 5, y + 13);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(66, 89, 104);
      doc.text(noteLines, margin + 5, y + 19);
      y += noteH + 8;
    }

    ensureSpace(14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(122, 147, 161);
    doc.text('Esta cotización presenta los productos seleccionados y los importes calculados con base en el modo de precio activo al momento de la exportación.', margin, pageH - 8);

    doc.save(filename);
    setStatus(`PDF generado correctamente: ${filename}`, 'ok');
  } catch (error) {
    console.error(error);
    setStatus('No fue posible generar el PDF. Revisa la consola e inténtalo nuevamente.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function attachEvents(){
  [busquedaInput, filtroDepartamento, filtroStock, ordenSelect].forEach(el => el.addEventListener('input', applyFilters));
  document.getElementById('recargarBtn').addEventListener('click', loadProductos);
  document.getElementById('limpiarBtn').addEventListener('click', clearCart);
  document.getElementById('exportarBtn').addEventListener('click', exportJSON);
  document.getElementById('imprimirBtn').addEventListener('click', exportStyledPdf);
  document.querySelectorAll('.toggle-btn').forEach(btn => btn.addEventListener('click', () => setModoPrecio(btn.dataset.modo)));
  if (sinImpuestosInput) sinImpuestosInput.addEventListener('change', (e) => setIncluirImpuestos(!e.target.checked));
}

syncDepartamentoPlaceholder();
setToday();
attachEvents();
loadProductos();
