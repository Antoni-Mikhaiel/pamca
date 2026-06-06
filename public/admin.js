(() => {
  // Shared fallback content (see content-defaults.js, loaded before this script).
  const PAMCA_DEFAULTS = window.PAMCA_DEFAULTS || { pillars: [], incidentReport: {}, legacyStandardsCopyText: '' };
  const legacyStandardsCopyText = PAMCA_DEFAULTS.legacyStandardsCopyText;

  // ---------------------------------------------------------------------------
  // API layer — all admin data now lives in Supabase, reached via the serverless
  // endpoints. Writes require an admin Bearer token (Supabase Auth + role=admin).
  // ---------------------------------------------------------------------------
  const API = {
    session: '/api/admin/session',
    content: (key) => `/api/content/${key}`,
    saveContent: '/api/admin/content',
    products: '/api/admin/products',
    upload: '/api/admin/upload',
    orders: '/api/admin/orders',
    flagOrder: '/api/admin/orders/flag',
    completeOrder: '/api/admin/orders/complete',
    dashboard: '/api/admin/dashboard'
  };

  function whenAuthReady(){
    return new Promise((resolve) => {
      if (window.authReady) return resolve();
      window.addEventListener('authReady', () => resolve(), { once: true });
    });
  }

  function getToken(){
    const session = (typeof window.getSession === 'function') ? window.getSession() : null;
    return session && session.access_token ? session.access_token : null;
  }

  function authHeaders(){
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  async function apiGet(path){
    const res = await fetch(path, { headers: authHeaders(), credentials: 'same-origin' });
    if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
    const json = await res.json().catch(() => ({}));
    if (json.success === false) throw new Error(json.message || 'Request failed');
    return json.data;
  }

  async function apiSend(path, method, body){
    const res = await fetch(path, {
      method,
      headers: authHeaders(),
      credentials: 'same-origin',
      body: body != null ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized — admin sign-in required'); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.message || 'Request failed');
    return json.data;
  }

  function handleUnauthorized(){
    if (typeof showAuthGate === 'function') {
      showAuthGate('Your session expired or this account is not an admin. Please sign in again.');
    }
  }

  // In-memory caches populated from the API after sign-in.
  let pillarsCache = null;
  let incidentCache = null;

  const defaultPillars = PAMCA_DEFAULTS.pillars;
  const defaultIncidentReport = PAMCA_DEFAULTS.incidentReport;

  // Sync readers return the current cache (falling back to defaults); the editors
  // call these. The cache is populated by the async load* functions after sign-in.
  function readPillars(){
    return (Array.isArray(pillarsCache) && pillarsCache.length)
      ? pillarsCache
      : JSON.parse(JSON.stringify(defaultPillars));
  }

  async function loadPillars(){
    try{
      const data = await apiGet(API.content('pillars'));
      pillarsCache = (Array.isArray(data) && data.length) ? data : JSON.parse(JSON.stringify(defaultPillars));
    }catch(e){
      console.error('loadPillars', e);
      pillarsCache = JSON.parse(JSON.stringify(defaultPillars));
    }
    return pillarsCache;
  }

  async function savePillars(pillars){
    pillarsCache = pillars;
    await apiSend(API.saveContent, 'POST', { key: 'pillars', value: pillars });
    window.dispatchEvent(new Event('pillarsUpdated'));
  }

  function readIncidentReport(){
    const merged = JSON.parse(JSON.stringify(defaultIncidentReport));
    if(incidentCache && typeof incidentCache === 'object') Object.assign(merged, incidentCache);
    if(merged.standardsCopy === legacyStandardsCopyText) merged.standardsCopy = '';
    if(!Array.isArray(merged.heroTags) || !merged.heroTags.length){
      merged.heroTags = JSON.parse(JSON.stringify(defaultIncidentReport.heroTags));
    }
    return merged;
  }

  async function loadIncidentReport(){
    try{
      const data = await apiGet(API.content('incident_report'));
      incidentCache = (data && typeof data === 'object') ? data : null;
    }catch(e){
      console.error('loadIncidentReport', e);
      incidentCache = null;
    }
    return readIncidentReport();
  }

  async function saveIncidentReport(report){
    incidentCache = report;
    await apiSend(API.saveContent, 'POST', { key: 'incident_report', value: report });
    window.dispatchEvent(new Event('incidentReportUpdated'));
  }

  function buildEditor(){
    const container = document.getElementById('editor');
    const pillars = readPillars();
    container.innerHTML = '';

    function syncPillarToggleLabel(wrap) {
      if (!wrap || !wrap._toggle || !wrap._title) return;
      const titleText = wrap._toggle.querySelector('.pill-toggle-left strong');
      if (titleText) {
        titleText.textContent = wrap._title.value || `Pillar ${Number(wrap.dataset.pillarIndex) + 1}`;
      }
    }

    pillars.forEach((p, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'pill-edit';
      wrap.dataset.pillarIndex = String(idx);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pill-toggle';
      toggle.setAttribute('aria-expanded', 'false');

      const toggleLeft = document.createElement('span');
      toggleLeft.className = 'pill-toggle-left';
      const badge = document.createElement('span');
      badge.className = 'panel-badge';
      badge.textContent = `Pillar ${idx + 1}`;
      const titleText = document.createElement('strong');
      titleText.textContent = p.title || ['Practical', 'Accessible', 'Multi-functional'][idx];
      titleText.style.color = '#162950';
      titleText.style.fontSize = '1rem';
      toggleLeft.appendChild(badge);
      toggleLeft.appendChild(titleText);

      const toggleRight = document.createElement('span');
      toggleRight.className = 'pill-toggle-right';
      toggleRight.textContent = 'Open';

      toggle.appendChild(toggleLeft);
      toggle.appendChild(toggleRight);

      const body = document.createElement('div');
      body.className = 'pill-body';

      const label = document.createElement('label');
      label.textContent = `Pillar ${idx+1} Title`;
      const title = document.createElement('input');
      title.type = 'text';
      title.value = p.title;
      title.style.width = '100%';

      const label2 = document.createElement('label');
      label2.textContent = `Pillar ${idx+1} Description`;
      const desc = document.createElement('textarea');
      desc.rows = 4;
      desc.style.width = '100%';
      desc.value = p.desc || '';

      body.appendChild(label);
      body.appendChild(title);
      body.appendChild(label2);
      body.appendChild(desc);

      const bulletLabel = document.createElement('label');
      bulletLabel.textContent = idx === 2
        ? 'Pillar 3 Bullet Points (One Point Per Line)'
        : `Pillar ${idx + 1} Bullet Points (One Point Per Line)`;
      const bulletPoints = document.createElement('textarea');
      bulletPoints.rows = 4;
      bulletPoints.style.width = '100%';
      bulletPoints.placeholder = 'Add one bullet point per line';
      bulletPoints.value = (p.list || []).join('\n');
      body.appendChild(bulletLabel);
      body.appendChild(bulletPoints);
      wrap._listTa = bulletPoints;

      // attach references
      wrap._title = title;
      wrap._desc = desc;
      wrap._idx = idx;
      wrap._toggle = toggle;
      wrap._body = body;

      toggle.addEventListener('click', () => togglePillar(idx));
      title.addEventListener('input', () => syncPillarToggleLabel(wrap));

      wrap.appendChild(toggle);
      wrap.appendChild(body);
      container.appendChild(wrap);

      syncPillarToggleLabel(wrap);
    });
  }

  function buildIncidentEditor(){
    const container = document.getElementById('incident-editor');
    if(!container) return;
    const report = readIncidentReport();
    container.innerHTML = '';

    const batches = [
      {
        key: 'hero',
        kicker: 'Batch 1',
        title: 'Top of Page',
        layoutClass: 'hero-layout',
        fields: [
          { key: 'heroTitle', label: 'Title', type: 'input', value: report.heroTitle },
          { key: 'heroTags', label: 'Tags', type: 'tags', value: report.heroTags || defaultIncidentReport.heroTags, helper: 'Add, edit, or remove the pill tags shown at the top of the page.' },
          { key: 'heroSubheader', label: 'Subheader', type: 'textarea', value: report.heroSubheader, rows: 4 },
        ]
      },
      {
        key: 'prep',
        kicker: 'Batch 2',
        title: 'Pricing',
        layoutClass: 'prep-layout',
        fields: [
          { key: 'prepTitle', label: 'Header', type: 'input', value: report.prepTitle || defaultIncidentReport.prepTitle || '', compactField: true },
          { key: 'prepSubheader', label: 'Subheader', type: 'textarea', value: report.prepSubheader || defaultIncidentReport.prepSubheader, rows: 6, helper: 'Use a blank line to separate the two paragraphs.', compactField: true },
          { key: 'prepComment', label: 'Comment', type: 'input', value: report.prepComment || defaultIncidentReport.prepComment, compactField: true }
        ]
      },
      {
        key: 'standards',
        kicker: 'Batch 3',
        title: 'Features',
        layoutClass: 'standards-layout',
        fields: [
          { key: 'standardsTitle', label: 'Features Card Title', type: 'input', value: report.standardsTitle },
          { key: 'standardsCopy', label: 'Features Card Text', type: 'input', value: report.standardsCopy || '' },
          { key: 'standardsBullets', label: 'Features Bullet Points', type: 'bullet-tags', value: report.standardsBullets || defaultIncidentReport.standardsBullets }
        ]
      },
      {
        key: 'cta',
        kicker: 'Batch 4',
        title: 'Call To Action',
        layoutClass: 'cta-layout',
        fields: [
          { key: 'ctaTitle', label: 'CTA Title', type: 'input', value: report.ctaTitle, compactField: true },
          { key: 'ctaText', label: 'CTA Text', type: 'textarea', value: report.ctaText, rows: 3 }
        ]
      }
    ];

    function createField(field) {
      const group = document.createElement('div');
      group.className = field.type === 'tags' || field.type === 'bullet-tags'
        ? 'incident-field incident-tags-field'
        : field.bulletField
          ? 'incident-field bullet-field'
          : field.compactField
            ? 'incident-field incident-field-compact'
            : 'incident-field';

      if (field.key === 'prepTitle') {
        group.classList.add('incident-field-prep-title');
      } else if (field.key === 'prepSubheader') {
        group.classList.add('incident-field-prep-subheader');
      } else if (field.key === 'prepComment') {
        group.classList.add('incident-field-prep-comment');
      } else if (field.key === 'standardsTitle') {
        group.classList.add('incident-field-features-title');
      } else if (field.key === 'standardsCopy') {
        group.classList.add('incident-field-features-text');
      } else if (field.key === 'ctaTitle') {
        group.classList.add('incident-field-cta-title');
      } else if (field.key === 'ctaText') {
        group.classList.add('incident-field-cta-text');
      }

      const label = document.createElement('label');
      label.textContent = field.label;
      group.appendChild(label);

      if(field.helper){
        const helper = document.createElement('div');
        helper.className = 'helper';
        helper.textContent = field.helper;
        group.appendChild(helper);
      }

      if(field.type === 'tags' || field.type === 'bullet-tags'){
        const list = document.createElement('div');
        list.className = 'incident-tag-list';

        const addTagRow = (value = '') => {
          const row = document.createElement('div');
          row.className = 'incident-tag-row';

          const input = document.createElement('input');
          input.type = 'text';
          input.value = value;
          input.placeholder = field.type === 'bullet-tags' ? 'Enter bullet point' : 'Enter tag text';

          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'incident-tag-remove';
          remove.textContent = 'Remove';
          remove.addEventListener('click', () => {
            row.remove();
          });

          row.appendChild(input);
          row.appendChild(remove);
          list.appendChild(row);
        };

        (field.value || []).forEach((tag) => addTagRow(tag));

        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'incident-tag-add';
        addButton.textContent = field.type === 'bullet-tags' ? 'Add Bullet Point' : 'Add Tag';
        addButton.addEventListener('click', () => addTagRow(''));

        group._tagList = list;
        group._tagAdd = addButton;
        group.dataset.fieldKey = field.key;

        group.appendChild(list);
        group.appendChild(addButton);
        return group;
      }

      let input;
      if(field.type === 'input'){
        input = document.createElement('input');
        input.type = 'text';
        input.value = field.value || '';
      }else{
        input = document.createElement('textarea');
        input.rows = field.rows || 3;
        input.value = field.value ?? '';
      }

      if(field.key === 'heroSubheader'){
        group.classList.add('hero-subheader-field');
      }

      group.dataset.fieldKey = field.key;
      group._field = input;
      group.appendChild(input);
      return group;
    }

    batches.forEach((batch) => {
      const wrapper = document.createElement('section');
      wrapper.className = `incident-batch ${batch.key}`;

      const fields = batch.fields.slice();
      const featuredField = batch.key === 'hero' ? fields.shift() : null;

      const header = document.createElement('div');
      header.className = 'incident-batch-header';

      const headingWrap = document.createElement('div');
      const kicker = document.createElement('div');
      kicker.className = 'incident-batch-kicker';
      kicker.textContent = batch.kicker;
      const title = document.createElement('h4');
      title.textContent = batch.title;
      headingWrap.appendChild(kicker);
      headingWrap.appendChild(title);
      header.appendChild(headingWrap);

      const grid = document.createElement('div');
      grid.className = `incident-batch-grid ${batch.layoutClass}`;

      fields.forEach((field) => {
        grid.appendChild(createField(field));
      });

      wrapper.appendChild(header);
      if(featuredField){
        const heroField = createField(featuredField);
        heroField.classList.add('hero-featured');
        wrapper.appendChild(heroField);
      }
      wrapper.appendChild(grid);
      container.appendChild(wrapper);
    });
  }

  function setActivePillar(idx){
    const cards = document.querySelectorAll('.pill-edit');
    cards.forEach((card, cardIndex) => {
      const isActive = cardIndex === idx;
      card.classList.toggle('is-open', isActive);
      const toggle = card._toggle;
      const body = card._body;
      if(toggle) {
        toggle.setAttribute('aria-expanded', String(isActive));
        const right = toggle.querySelector('.pill-toggle-right');
        if(right) right.textContent = isActive ? 'Close' : 'Open';
      }
      if(body) body.style.display = isActive ? 'grid' : 'none';
    });
  }

  function togglePillar(idx){
    if(isPanelOpen(idx)) {
      collapseAll();
      return;
    }
    setActivePillar(idx);
  }

  function isPanelOpen(idx){
    const card = document.querySelector(`.pill-edit[data-pillar-index="${idx}"]`);
    return !!card && card.classList.contains('is-open');
  }

  function collapseAll(){
    document.querySelectorAll('.pill-edit').forEach((card) => {
      card.classList.remove('is-open');
      if(card._toggle) {
        card._toggle.setAttribute('aria-expanded', 'false');
        const right = card._toggle.querySelector('.pill-toggle-right');
        if(right) right.textContent = 'Open';
      }
      if(card._body) card._body.style.display = 'none';
    });
  }

  function flashSaved(msgId, text){
    const el = document.getElementById(msgId);
    if(!el) return;
    el.textContent = text || 'Saved';
    el.style.color = text && text.startsWith('Error') ? '#cf4626' : '#0c7c74';
    el.style.display = 'inline-block';
    setTimeout(() => { el.style.display = 'none'; }, text && text.startsWith('Error') ? 4000 : 1500);
  }

  function wireControls(){
    document.getElementById('save-btn').addEventListener('click', async () => {
      const container = document.getElementById('editor');
      const edits = [];
      Array.from(container.children).forEach(wrap => {
        const idx = wrap._idx;
        const t = wrap._title.value;
        const d = wrap._desc.value;
        const obj = { title: t, desc: d };
        if(wrap._listTa){
          obj.list = wrap._listTa.value.split('\n').map(s=>s.trim()).filter(Boolean);
        }
        edits[idx] = obj;
      });
      try{
        await savePillars(edits);
        flashSaved('save-msg', 'Saved');
      }catch(e){
        flashSaved('save-msg', 'Error: ' + e.message);
      }
    });

    const incidentSaveBtn = document.getElementById('incident-save-btn');
    if(incidentSaveBtn){
      incidentSaveBtn.addEventListener('click', async () => {
        const container = document.getElementById('incident-editor');
        const edits = {};
        Array.from(container.querySelectorAll('.incident-field')).forEach(group => {
          const key = group.dataset.fieldKey;
          if(!key) return;
          if((key === 'heroTags' || key === 'standardsBullets') && group._tagList){
            edits[key] = Array.from(group._tagList.querySelectorAll('.incident-tag-row input'))
              .map(input => input.value.trim())
              .filter(Boolean);
            return;
          }
          const field = group._field;
          if(!field) return;
          edits[key] = field.value;
        });
        if(Array.isArray(edits.heroTags) && edits.heroTags.length){
          edits.heroTag = edits.heroTags[edits.heroTags.length - 1];
        }
        try{
          await saveIncidentReport(edits);
          flashSaved('incident-save-msg', 'Saved');
        }catch(e){
          flashSaved('incident-save-msg', 'Error: ' + e.message);
        }
      });
    }

  }

  /* =====================================================================
     Pharmacy Products manager — persists to Supabase via /api/admin/products
     (admin-only). The `products` table is the live source of truth that the
     public store reads through /api/products. `defaultProducts` is kept only
     for reference/debugging via window.adminPamca.
     ===================================================================== */
  const defaultProducts = [
    {
      id: 'seed-thermo-dual',
      name: 'Thermometer Dual Readings (24 pieces)',
      slug: 'thermometer-dual',
      status: 'active',
      images: [],
      price: 89.99,
      salePercent: 15,
      saleStart: '2026-05-01',
      saleEnd: '2026-06-30',
      stock: 120,
      description: 'Professional-grade digital thermometers with dual reading capability (Celsius and Fahrenheit). Designed for accurate and reliable temperature measurements in healthcare and pharmacy environments.',
      keyFeatures: [
        'Dual temperature scale display (°C and °F)',
        'Fast 10-second reading time',
        '±0.1°C accuracy for precise measurements',
        'Digital LCD display with backlight',
        'Automatic shut-off to preserve battery life',
        'Memory function stores last reading',
        'Waterproof design for easy cleaning'
      ],
      optionGroups: [
        { label: 'Pack Size', options: [ { value: '24 pieces', price: 89.99 }, { value: '48 pieces', price: 159.99 } ] }
      ]
    },
    {
      id: 'seed-thermo-mono',
      name: 'Digital Thermometer Mono-Reading (12 Pieces)',
      slug: 'thermometer-mono',
      status: 'active',
      images: [],
      price: 49.99,
      salePercent: 0,
      saleStart: '',
      saleEnd: '',
      stock: 60,
      description: 'Compact and reliable digital thermometers with single-scale reading capability. Designed for quick and accurate temperature measurements with your choice of Fahrenheit or Celsius display.',
      keyFeatures: ['Single-scale reading display', 'Fast, accurate measurement', 'Compact and easy to handle', 'Automatic shut-off'],
      optionGroups: [
        { label: 'Scale', options: [ { value: 'Celsius (°C)', price: null }, { value: 'Fahrenheit (°F)', price: null } ] }
      ]
    },
    {
      id: 'seed-gel',
      name: 'Gel Dispenser, Hands-Free',
      slug: 'gel-dispenser',
      status: 'active',
      images: [],
      price: 129.00,
      salePercent: 0,
      saleStart: '',
      saleEnd: '',
      stock: 0,
      description: 'Advanced hands-free gel dispenser designed for optimal hygiene and convenience in professional healthcare environments. Features touchless operation with reliable sensor technology.',
      keyFeatures: ['Touchless sensor operation', 'High-capacity reservoir', 'Wall-mountable design', 'Battery powered'],
      optionGroups: []
    }
  ];

  let productSearch = '';
  let editingProductId = null;

  function uid(){
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function slugify(s){
    return String(s || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function escAttr(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function normalizeProduct(p){
    const d = {};
    d.id = p.id || uid();
    d.name = typeof p.name === 'string' ? p.name : '';
    d.slug = p.slug || slugify(d.name);
    d.status = p.status === 'draft' ? 'draft' : 'active';
    d.images = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
    d.price = Number.isFinite(+p.price) ? +p.price : 0;
    d.salePercent = Number.isFinite(+p.salePercent) ? Math.max(0, Math.min(100, +p.salePercent)) : 0;
    d.saleStart = p.saleStart || '';
    d.saleEnd = p.saleEnd || '';
    d.stock = Number.isFinite(+p.stock) ? Math.max(0, Math.round(+p.stock)) : 0;
    d.cost = Number.isFinite(+p.cost) ? Math.max(0, +p.cost) : 0;
    d.description = typeof p.description === 'string' ? p.description : '';
    d.keyFeatures = Array.isArray(p.keyFeatures) ? p.keyFeatures.filter(Boolean) : [];
    d.optionGroups = Array.isArray(p.optionGroups) ? p.optionGroups.map(g => {
      const hasNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(+v);
      const options = Array.isArray(g && g.options) ? g.options.map(o => ({
        value: o && o.value ? String(o.value) : '',
        price: (o && hasNum(o.price)) ? +o.price : null,
        // null = inherit the product-level sale / stock.
        salePercent: (o && hasNum(o.salePercent)) ? clampPct(o.salePercent) : null,
        stock: (o && hasNum(o.stock)) ? Math.max(0, Math.round(+o.stock)) : null
      })) : [];
      // Back-compat: rows saved before this feature have no `affectsPricing`.
      const affectsPricing = (g && typeof g.affectsPricing === 'boolean')
        ? g.affectsPricing
        : options.some(o => o.price !== null);
      return { label: g && g.label ? String(g.label) : '', affectsPricing: affectsPricing, options: options };
    }) : [];
    d.variants = Array.isArray(p.variants)
      ? p.variants
          .filter(v => v && typeof v.key === 'string' && v.key)
          .map(v => ({ key: v.key, stock: Math.max(0, Math.round(+v.stock || 0)) }))
      : [];
    return d;
  }

  // Sale % is clamped to 0–100 with up to two decimals, everywhere it's entered.
  function clampPct(v){
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(100, Math.round(n * 100) / 100);
  }

  let productsCache = [];

  function readProducts(){
    return productsCache;
  }

  async function loadProducts(){
    try{
      const data = await apiGet(API.products);
      productsCache = (Array.isArray(data) ? data : []).map(normalizeProduct);
    }catch(e){
      console.error('loadProducts', e);
      productsCache = [];
    }
    renderProductList();
  }

  function fmtMoney(n){
    return '$' + (Number(n) || 0).toFixed(2);
  }

  // Sale is live only when a percent is set and "today" falls inside the window.
  function saleState(p, now = new Date()){
    if(!p.salePercent || p.salePercent <= 0) return 'none';
    const start = p.saleStart ? new Date(p.saleStart + 'T00:00:00') : null;
    const end = p.saleEnd ? new Date(p.saleEnd + 'T23:59:59') : null;
    if(start && now < start) return 'scheduled';
    if(end && now > end) return 'expired';
    return 'active';
  }

  function salePrice(p){
    return +(p.price * (1 - p.salePercent / 100)).toFixed(2);
  }

  // ---------- list rendering ----------
  function renderProductList(){
    const grid = document.getElementById('product-list');
    const countEl = document.getElementById('pm-count');
    if(!grid) return;
    const all = readProducts();
    if(countEl){
      countEl.textContent = `${all.length} product${all.length === 1 ? '' : 's'}`;
    }

    const term = productSearch.trim().toLowerCase();
    const products = term ? all.filter(p => p.name.toLowerCase().includes(term) || p.slug.toLowerCase().includes(term)) : all;

    if(!products.length){
      grid.innerHTML = `<div class="pm-empty"><strong>${all.length ? 'No matches' : 'No products yet'}</strong>${all.length ? 'Try a different search term.' : 'Click “Add product” to create your first one.'}</div>`;
      return;
    }

    grid.innerHTML = products.map(p => {
      const onSale = saleState(p) === 'active';
      const main = p.images[0];
      const thumbStyle = main ? ` style="background-image:url('${escAttr(main)}')"` : '';
      const priceHtml = onSale
        ? `<span class="now is-sale">${fmtMoney(salePrice(p))}</span><span class="was">${fmtMoney(p.price)}</span>`
        : `<span class="now">${fmtMoney(p.price)}</span>`;
      const stockClass = p.stock <= 0 ? 'stock-out' : p.stock <= 10 ? 'stock-low' : 'stock-ok';
      const stockLabel = p.stock <= 0 ? 'Sold out' : p.stock <= 10 ? `Low · ${p.stock}` : `In stock · ${p.stock}`;
      const optChip = p.optionGroups.length ? `<span class="pm-chip">${p.optionGroups.length} dropdown${p.optionGroups.length === 1 ? '' : 's'}</span>` : '';
      return `<article class="product-card" data-id="${escAttr(p.id)}">
        <div class="pm-thumb ${main ? '' : 'is-empty'}"${thumbStyle}>
          ${onSale ? `<span class="pm-saletag">-${p.salePercent}%</span>` : ''}
          <span class="pm-status ${p.status === 'active' ? 'is-active' : ''}">${p.status === 'active' ? 'Active' : 'Draft'}</span>
        </div>
        <div class="pm-body">
          <div class="pm-name">${escAttr(p.name) || 'Untitled product'}</div>
          <div class="pm-price">${priceHtml}</div>
          <div class="pm-meta">
            <span class="pm-chip ${stockClass}">${stockLabel}</span>
            ${optChip}
          </div>
        </div>
        <div class="pm-actions">
          <button type="button" class="pm-edit" data-act="edit" data-id="${escAttr(p.id)}">Edit</button>
          <button type="button" class="pm-del" data-act="del" data-id="${escAttr(p.id)}">Remove</button>
        </div>
      </article>`;
    }).join('');
  }

  // ---------- repeater rows ----------
  function readFileAsDataUrl(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  function setImagePreview(preview, url){
    if(url){
      preview.style.backgroundImage = `url('${String(url).replace(/'/g, "\\'")}')`;
      preview.textContent = '';
    }else{
      preview.style.backgroundImage = '';
      preview.textContent = '🖼';
    }
  }

  // --- Image drag-to-reorder ---
  let imageDragRow = null;

  // Flags the first row as the "main" image (shown on the card and as the
  // default product image), updated whenever rows are added/removed/reordered.
  function updateImageMainFlags(){
    Array.from(document.querySelectorAll('#pm-images .pm-img-row'))
      .forEach((row, i) => row.classList.toggle('is-main', i === 0));
  }

  function imageDragAfter(container, y){
    const rows = Array.from(container.querySelectorAll('.pm-img-row:not(.pm-dragging)'));
    let closest = { offset: -Infinity, el: null };
    rows.forEach((row) => {
      const box = row.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset: offset, el: row };
    });
    return closest.el;
  }

  function wireImageReorder(){
    const list = document.getElementById('pm-images');
    if (!list || list._reorderWired) return;
    list._reorderWired = true;
    list.addEventListener('dragover', (e) => {
      if (!imageDragRow) return;
      e.preventDefault();
      const after = imageDragAfter(list, e.clientY);
      if (after == null) list.appendChild(imageDragRow);
      else if (after !== imageDragRow) list.insertBefore(imageDragRow, after);
      updateImageMainFlags();
    });
  }

  // An image row holds its uploaded public URL in row.dataset.url. New files are
  // read locally for an instant preview, then uploaded to Supabase Storage.
  function addImageRow(value = ''){
    const list = document.getElementById('pm-images');
    const row = document.createElement('div');
    row.className = 'pm-repeat-row pm-img-row';
    row.dataset.url = value || '';

    // Drag handle — grabbing it makes the row draggable so the admin can reorder
    // images (the first image is the product's main image).
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'pm-drag-handle';
    handle.setAttribute('aria-label', 'Drag to reorder');
    handle.title = 'Drag to reorder';
    handle.textContent = '⠿';
    handle.addEventListener('mousedown', () => { row.setAttribute('draggable', 'true'); });
    handle.addEventListener('mouseup', () => { row.removeAttribute('draggable'); });
    row.addEventListener('dragstart', (e) => {
      imageDragRow = row;
      row.classList.add('pm-dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('pm-dragging');
      row.removeAttribute('draggable');
      imageDragRow = null;
      updateImageMainFlags();
    });

    const preview = document.createElement('div');
    preview.className = 'pm-img-preview';

    const control = document.createElement('div');
    control.className = 'pm-img-control';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
    fileInput.className = 'pm-file-input';

    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.className = 'pm-file-btn';
    chooseBtn.textContent = value ? 'Replace' : 'Upload from device';

    const status = document.createElement('span');
    status.className = 'pm-img-status';
    status.textContent = value ? 'Current image' : 'No file chosen';

    control.appendChild(chooseBtn);
    control.appendChild(status);
    control.appendChild(fileInput);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'pm-remove';
    remove.textContent = 'Remove';

    const mainFlag = document.createElement('span');
    mainFlag.className = 'pm-main-flag';
    mainFlag.textContent = 'MAIN';

    row.appendChild(handle);
    row.appendChild(preview);
    row.appendChild(control);
    row.appendChild(mainFlag);
    row.appendChild(remove);
    list.appendChild(row);
    updateImageMainFlags();

    setImagePreview(preview, value);

    chooseBtn.addEventListener('click', () => fileInput.click());
    remove.addEventListener('click', () => { row.remove(); updateImageMainFlags(); });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if(!file) return;
      if(file.size > 5 * 1024 * 1024){
        status.textContent = 'Too large (max 5 MB)';
        status.classList.add('is-error');
        fileInput.value = '';
        return;
      }
      status.classList.remove('is-error');
      chooseBtn.disabled = true;
      try{
        const dataUrl = await readFileAsDataUrl(file);
        setImagePreview(preview, dataUrl); // instant local preview
        status.textContent = 'Uploading…';
        const result = await apiSend(API.upload, 'POST', {
          dataBase64: dataUrl,
          filename: file.name,
          contentType: file.type
        });
        row.dataset.url = result.url;
        setImagePreview(preview, result.url);
        chooseBtn.textContent = 'Replace';
        status.textContent = 'Uploaded ✓';
      }catch(e){
        status.textContent = 'Upload failed: ' + e.message;
        status.classList.add('is-error');
      }finally{
        chooseBtn.disabled = false;
        fileInput.value = '';
      }
    });
  }

  function addTextRow(listId, value = '', placeholder = ''){
    const list = document.getElementById(listId);
    const row = document.createElement('div');
    row.className = 'pm-repeat-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pm-rep-input';
    input.value = value;
    input.placeholder = placeholder;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'pm-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => row.remove());
    row.appendChild(input);
    row.appendChild(remove);
    list.appendChild(row);
  }

  // A row carries an option's label and — only on the single pricing dropdown — a
  // price override, a sale %, and a live "after sale" readout. Those price cells are
  // hidden (via the group's `is-stock-only` class) for non-pricing dropdowns.
  // Stock is no longer per-option; it's set per combination in the Inventory matrix.
  function addOptionRow(listEl, opt = { value: '', price: null, salePercent: null }){
    const row = document.createElement('div');
    row.className = 'pm-opt-row';
    row.innerHTML = `
      <input type="text" class="pm-opt-value" placeholder="Option label (e.g. 48 pieces)">
      <span class="pm-opt-price-wrap pm-opt-pricing"><input type="number" class="pm-opt-price" min="0" step="0.01" placeholder="price"></span>
      <span class="pm-opt-pct-wrap pm-opt-pricing"><input type="number" class="pm-opt-sale" min="0" max="100" step="0.01" placeholder="inherit" title="Leave blank to use the product-level sale"></span>
      <span class="pm-opt-saleout pm-opt-pricing" aria-live="polite"></span>
      <button type="button" class="pm-remove" aria-label="Remove option">Remove</button>`;
    row.querySelector('.pm-opt-value').value = opt.value || '';
    row.querySelector('.pm-opt-price').value = (opt.price === null || opt.price === undefined) ? '' : opt.price;
    row.querySelector('.pm-opt-sale').value = (opt.salePercent === null || opt.salePercent === undefined) ? '' : opt.salePercent;
    row.querySelector('.pm-opt-sale').addEventListener('input', clampPctInput);
    row.querySelector('.pm-opt-price').addEventListener('input', () => updateRowSaleOut(row));
    row.querySelector('.pm-opt-sale').addEventListener('input', () => updateRowSaleOut(row));
    // Changing an option's label changes the set of combinations → rebuild the matrix.
    row.querySelector('.pm-opt-value').addEventListener('input', renderStockMatrix);
    row.querySelector('.pm-remove').addEventListener('click', () => { row.remove(); renderStockMatrix(); });
    listEl.appendChild(row);
    updateRowSaleOut(row);
  }

  // Shows the effective price after sale for a pricing-dropdown option, using the
  // option's own price/sale where set and the base Pricing & sale fields otherwise.
  function optionEffective(row){
    const basePrice = +document.getElementById('pm-price').value || 0;
    const baseSale = clampPct(document.getElementById('pm-sale-percent').value);
    const pRaw = row.querySelector('.pm-opt-price').value;
    const sRaw = row.querySelector('.pm-opt-sale').value;
    const price = pRaw === '' ? basePrice : (+pRaw || 0);
    const pct = sRaw === '' ? baseSale : clampPct(sRaw);
    return { price, pct };
  }
  function updateRowSaleOut(row){
    const out = row.querySelector('.pm-opt-saleout');
    if(!out) return;
    const { price, pct } = optionEffective(row);
    if(pct > 0){
      const sale = +(price * (1 - pct / 100)).toFixed(2);
      out.className = 'pm-opt-saleout pm-opt-pricing';
      out.innerHTML = `<span class="was">${fmtMoney(price)}</span>${fmtMoney(sale)}`;
      out.title = `After ${pct}% sale`;
    } else {
      out.className = 'pm-opt-saleout pm-opt-pricing is-none';
      out.textContent = fmtMoney(price);
      out.title = 'No sale';
    }
  }
  function refreshOptionSaleOuts(){
    document.querySelectorAll('#pm-option-groups .pm-optgroup:not(.is-stock-only) .pm-opt-row').forEach(updateRowSaleOut);
  }

  function addOptionGroup(group = {}){
    const wrap = document.getElementById('pm-option-groups');
    const box = document.createElement('div');
    box.className = 'pm-optgroup';
    box.innerHTML = `
      <div class="pm-optgroup-head">
        <div class="pm-field" style="margin:0;">
          <label>Dropdown label</label>
          <input type="text" class="pm-optgroup-label" placeholder="e.g. Pack Size">
        </div>
        <button type="button" class="pm-remove pm-optgroup-remove">Remove dropdown</button>
      </div>
      <label class="pm-toggle">
        <input type="checkbox" class="pm-optgroup-pricing">
        <span>This dropdown sets the price &amp; sale (only one dropdown can)</span>
      </label>
      <div class="pm-opt-list-head">
        <span>Option</span>
        <span class="pm-opt-pricing">Price (CAD)</span>
        <span class="pm-opt-pricing">Sale %</span>
        <span class="pm-opt-pricing">After sale</span>
        <span></span>
      </div>
      <div class="pm-opt-list"></div>
      <button type="button" class="pm-add pm-add-option">+ Add option</button>`;

    box.querySelector('.pm-optgroup-label').value = group.label || '';
    const pricingToggle = box.querySelector('.pm-optgroup-pricing');
    // Checked => this is THE pricing dropdown. Default: the first dropdown added
    // becomes the pricing one; any later dropdown is automatically stock-only.
    const hasPricingAlready = !!document.querySelector('#pm-option-groups .pm-optgroup-pricing:checked');
    pricingToggle.checked = (typeof group.affectsPricing === 'boolean') ? group.affectsPricing : !hasPricingAlready;

    const applyMode = () => {
      box.classList.toggle('is-stock-only', !pricingToggle.checked);
    };
    pricingToggle.addEventListener('change', () => {
      // Only one dropdown may drive price & sale — ticking this unticks the others.
      if (pricingToggle.checked) {
        document.querySelectorAll('#pm-option-groups .pm-optgroup').forEach(other => {
          if (other === box) return;
          const t = other.querySelector('.pm-optgroup-pricing');
          if (t && t.checked) { t.checked = false; other.classList.add('is-stock-only'); }
        });
      }
      applyMode();
      syncPricingMode();
    });

    const list = box.querySelector('.pm-opt-list');
    (group.options && group.options.length ? group.options : [{ value: '', price: null, salePercent: null }])
      .forEach(o => addOptionRow(list, o));

    box.querySelector('.pm-optgroup-remove').addEventListener('click', () => { box.remove(); syncPricingMode(); renderStockMatrix(); });
    box.querySelector('.pm-add-option').addEventListener('click', () => { addOptionRow(list); renderStockMatrix(); });

    wrap.appendChild(box);
    applyMode();
  }

  // ---------- Inventory matrix (stock per option combination) ----------
  // Seeded from the product's stored variants on open and updated as the admin
  // types; survives option edits so entered counts aren't lost on a rebuild.
  let stockByKey = {};

  // The option-value combinations across all dropdowns, in dropdown order, joined
  // by " / " — the same key the cart/order uses for a variation label.
  function combinationKeys(){
    const lists = Array.from(document.querySelectorAll('#pm-option-groups .pm-optgroup'))
      .map(box => Array.from(box.querySelectorAll('.pm-opt-value')).map(i => i.value.trim()).filter(Boolean))
      .filter(vals => vals.length > 0);
    if(!lists.length) return [];
    let combos = [[]];
    lists.forEach(vals => {
      const next = [];
      combos.forEach(c => vals.forEach(v => next.push(c.concat(v))));
      combos = next;
    });
    return combos.map(c => c.join(' / '));
  }

  function captureMatrixInputs(){
    document.querySelectorAll('#pm-matrix-rows .pm-var-stock').forEach(inp => { stockByKey[inp.dataset.key] = inp.value; });
  }

  // Rebuilds the inventory UI: a per-combination grid when there are dropdowns, or
  // the single base "Stock amount" field when there are none.
  function renderStockMatrix(){
    captureMatrixInputs();
    const keys = combinationKeys();
    const matrix = document.getElementById('pm-stock-matrix');
    const baseField = document.getElementById('pm-base-stock-field');
    const rows = document.getElementById('pm-matrix-rows');
    if(!matrix || !baseField || !rows) return;

    if(!keys.length){
      matrix.style.display = 'none';
      baseField.style.display = '';
      updatePricePreview();
      return;
    }
    matrix.style.display = '';
    baseField.style.display = 'none';
    rows.innerHTML = keys.map(key => {
      const v = (stockByKey[key] === undefined || stockByKey[key] === null) ? '' : stockByKey[key];
      return `<div class="pm-matrix-row"><span class="pm-matrix-label">${escAttr(key)}</span>` +
        `<input type="number" class="pm-var-stock" min="0" step="1" placeholder="0" data-key="${escAttr(key)}" value="${escAttr(v)}"></div>`;
    }).join('');
    updatePricePreview();
  }

  function totalMatrixStock(){
    let sum = 0;
    document.querySelectorAll('#pm-matrix-rows .pm-var-stock').forEach(i => { sum += Math.max(0, Math.round(+i.value || 0)); });
    return sum;
  }

  function collectVariants(){
    return Array.from(document.querySelectorAll('#pm-matrix-rows .pm-var-stock'))
      .map(i => ({ key: i.dataset.key, stock: Math.max(0, Math.round(+i.value || 0)) }));
  }

  // Guarantees at most one pricing dropdown (used after loading a product, in
  // case stored/legacy data flagged more than one).
  function enforceSinglePricingGroup(){
    let seen = false;
    document.querySelectorAll('#pm-option-groups .pm-optgroup').forEach(box => {
      const t = box.querySelector('.pm-optgroup-pricing');
      if (!t) return;
      if (t.checked && !seen) { seen = true; box.classList.remove('is-stock-only'); }
      else { t.checked = false; box.classList.add('is-stock-only'); }
    });
  }

  // Clamp a sale-% input to 0–100 / two decimals as the admin types.
  function clampPctInput(e){
    const el = e.target;
    if (el.value === '') return;
    const clamped = clampPct(el.value);
    if (String(clamped) !== el.value) el.value = clamped;
  }

  // Mode awareness: if any dropdown affects pricing, the top "Pricing & sale"
  // section is a fallback only — the first priced option is the default — so we
  // disable and visually mute it to avoid confusion.
  function syncPricingMode(){
    const groups = Array.from(document.querySelectorAll('#pm-option-groups .pm-optgroup'));
    const hasPricingGroup = groups.some(box => box.querySelector('.pm-optgroup-pricing').checked);
    const section = document.getElementById('pm-pricing-section');
    if (!section) return;
    section.classList.toggle('is-disabled', hasPricingGroup);
    // Unit cost is product-level (not per option), so it stays editable in Mode 2.
    section.querySelectorAll('input:not(#pm-cost)').forEach(input => { input.disabled = hasPricingGroup; });
    const note = document.getElementById('pm-pricing-mode-note');
    if (note) note.style.display = hasPricingGroup ? 'block' : 'none';
    updatePricePreview();
  }

  // Reads the default representation: price & sale from the (single) pricing
  // dropdown's first option, and stock as the total across all combinations (the
  // inventory matrix). Returns null when no dropdown is the pricing dropdown.
  function defaultPricingFromGroups(){
    const base = +document.getElementById('pm-price').value || 0;
    const baseSale = clampPct(document.getElementById('pm-sale-percent').value);
    const boxes = Array.from(document.querySelectorAll('#pm-option-groups .pm-optgroup'));
    const pricingBox = boxes.find(box => box.querySelector('.pm-optgroup-pricing').checked);
    if(!pricingBox) return null;
    const firstRow = pricingBox.querySelector('.pm-opt-row');
    if(!firstRow) return null;

    const priceRaw = firstRow.querySelector('.pm-opt-price').value;
    const saleRaw = firstRow.querySelector('.pm-opt-sale').value;
    return {
      groupLabel: pricingBox.querySelector('.pm-optgroup-label').value || 'Option',
      optionLabel: firstRow.querySelector('.pm-opt-value').value || 'first option',
      price: priceRaw === '' ? base : (+priceRaw || 0),
      salePercent: saleRaw === '' ? baseSale : clampPct(saleRaw),
      stock: totalMatrixStock()
    };
  }

  // ---------- price preview ----------
  function updatePricePreview(){
    const el = document.getElementById('pm-price-preview');
    if(!el) return;

    // Mode 2: a dropdown drives pricing — preview the default (first) option.
    const def = defaultPricingFromGroups();
    if(def){
      const source = `set by “${escAttr(def.groupLabel)} → ${escAttr(def.optionLabel)}”`;
      if(def.salePercent <= 0){
        el.innerHTML = `Default: <b>${fmtMoney(def.price)}</b> · ${def.stock} in stock · ${source}`;
      }else{
        const sale = +(def.price * (1 - def.salePercent / 100)).toFixed(2);
        el.innerHTML = `Default: <b>${fmtMoney(def.price)}</b> · Sale <span class="pp-sale">${fmtMoney(sale)}</span> (−${def.salePercent}%) · ${def.stock} in stock · ${source}`;
      }
      return;
    }

    const price = +document.getElementById('pm-price').value || 0;
    const pct = clampPct(document.getElementById('pm-sale-percent').value);
    const draft = {
      price, salePercent: pct,
      saleStart: document.getElementById('pm-sale-start').value,
      saleEnd: document.getElementById('pm-sale-end').value
    };
    if(pct <= 0){
      el.innerHTML = `Price: <b>${fmtMoney(price)}</b> · no sale`;
      return;
    }
    const state = saleState(draft);
    const stateLabel = { active: 'live now', scheduled: 'scheduled', expired: 'expired', none: 'no sale' }[state];
    el.innerHTML = `Base: <b>${fmtMoney(price)}</b> · Sale: <span class="pp-sale">${fmtMoney(salePrice(draft))}</span> (−${pct}%) · <b>${stateLabel}</b>`;
  }

  // ---------- editor open / collect / save ----------
  function openProductEditor(id){
    editingProductId = id || null;
    const products = readProducts();
    const p = id != null ? products.find(x => String(x.id) === String(id)) : null;

    document.getElementById('pm-dialog-eyebrow').textContent = p ? 'Edit product' : 'New product';
    document.getElementById('pm-dialog-title').textContent = p ? 'Edit product' : 'Add product';
    document.getElementById('pm-foot-msg').textContent = '';

    document.getElementById('pm-name').value = p ? p.name : '';
    document.getElementById('pm-slug').value = p ? p.slug : '';
    document.getElementById('pm-slug').dataset.edited = p ? '1' : '';
    document.getElementById('pm-status').value = p ? p.status : 'active';
    document.getElementById('pm-price').value = p ? p.price : '';
    document.getElementById('pm-cost').value = p ? (p.cost || '') : '';
    document.getElementById('pm-sale-percent').value = p ? (p.salePercent || '') : '';
    document.getElementById('pm-sale-start').value = p ? p.saleStart : '';
    document.getElementById('pm-sale-end').value = p ? p.saleEnd : '';
    document.getElementById('pm-stock').value = p ? p.stock : '';
    document.getElementById('pm-description').value = p ? p.description : '';

    // repeaters
    const imgs = document.getElementById('pm-images'); imgs.innerHTML = '';
    (p && p.images.length ? p.images : ['']).forEach(v => addImageRow(v));
    const feats = document.getElementById('pm-features'); feats.innerHTML = '';
    (p && p.keyFeatures.length ? p.keyFeatures : ['']).forEach(v => addTextRow('pm-features', v, 'e.g. 24 pieces per pack'));
    // Seed the inventory matrix from the product's stored combination stock.
    stockByKey = {};
    if (p && Array.isArray(p.variants)) {
      p.variants.forEach(v => { if (v && v.key != null) stockByKey[v.key] = String(v.stock); });
    }

    const groups = document.getElementById('pm-option-groups'); groups.innerHTML = '';
    (p ? p.optionGroups : []).forEach(g => addOptionGroup(g));

    updateImageMainFlags();
    enforceSinglePricingGroup(); // keep at most one pricing dropdown (legacy data safety)
    renderStockMatrix(); // base-stock field vs combination grid
    refreshOptionSaleOuts();
    syncPricingMode(); // also calls updatePricePreview()
    const modal = document.getElementById('product-modal');
    modal.classList.add('is-open');
    modal.querySelector('.pm-dialog-body').scrollTop = 0;
    document.getElementById('pm-name').focus();
  }

  function closeProductEditor(){
    document.getElementById('product-modal').classList.remove('is-open');
    editingProductId = null;
  }

  function collectProductForm(){
    const images = Array.from(document.querySelectorAll('#pm-images .pm-img-row'))
      .map(row => (row.dataset.url || '').trim()).filter(Boolean);
    const keyFeatures = Array.from(document.querySelectorAll('#pm-features .pm-rep-input'))
      .map(i => i.value.trim()).filter(Boolean);
    const optionGroups = Array.from(document.querySelectorAll('#pm-option-groups .pm-optgroup')).map(box => {
      const label = box.querySelector('.pm-optgroup-label').value.trim();
      const affectsPricing = box.querySelector('.pm-optgroup-pricing').checked;
      const options = Array.from(box.querySelectorAll('.pm-opt-row')).map(row => {
        const value = row.querySelector('.pm-opt-value').value.trim();
        const priceRaw = row.querySelector('.pm-opt-price').value;
        const saleRaw = row.querySelector('.pm-opt-sale').value;
        return {
          value,
          price: priceRaw === '' ? null : +priceRaw,
          // Blank sale = inherit the product-level sale (null). Stock is now per
          // combination (see `variants`), not per option.
          salePercent: saleRaw === '' ? null : clampPct(saleRaw)
        };
      }).filter(o => o.value);
      return { label, affectsPricing, options };
    }).filter(g => g.label || g.options.length);

    const name = document.getElementById('pm-name').value.trim();
    return {
      id: editingProductId || null,
      name,
      slug: document.getElementById('pm-slug').value.trim() || slugify(name),
      status: document.getElementById('pm-status').value,
      images,
      price: document.getElementById('pm-price').value,
      cost: document.getElementById('pm-cost').value,
      salePercent: document.getElementById('pm-sale-percent').value,
      saleStart: document.getElementById('pm-sale-start').value,
      saleEnd: document.getElementById('pm-sale-end').value,
      stock: document.getElementById('pm-stock').value,
      description: document.getElementById('pm-description').value,
      keyFeatures,
      optionGroups,
      variants: collectVariants()
    };
  }

  async function saveProductFromForm(){
    const product = collectProductForm();
    const msg = document.getElementById('pm-foot-msg');
    if(!product.name){
      msg.style.color = '#cf4626';
      msg.textContent = 'Product name is required.';
      document.getElementById('pm-name').focus();
      return;
    }
    const saveBtn = document.getElementById('pm-save');
    saveBtn.disabled = true;
    msg.style.color = '#0c7c74';
    msg.textContent = 'Saving…';
    try{
      await apiSend(API.products, 'POST', product);
      await loadProducts();
      closeProductEditor();
    }catch(e){
      msg.style.color = '#cf4626';
      msg.textContent = 'Error: ' + e.message;
    }finally{
      saveBtn.disabled = false;
    }
  }

  async function deleteProduct(id){
    const p = readProducts().find(x => String(x.id) === String(id));
    if(!p) return;
    if(!window.confirm(`Remove “${p.name || 'this product'}”? This cannot be undone.`)) return;
    try{
      await apiSend(`${API.products}?id=${encodeURIComponent(id)}`, 'DELETE');
      await loadProducts();
    }catch(e){
      window.alert('Could not remove product: ' + e.message);
    }
  }

  function wireProductControls(){
    const grid = document.getElementById('product-list');
    if(!grid) return; // products panel not present

    document.getElementById('pm-add-product').addEventListener('click', () => openProductEditor(null));

    const search = document.getElementById('pm-search');
    if(search){
      search.addEventListener('input', () => { productSearch = search.value; renderProductList(); });
    }

    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if(!btn) return;
      if(btn.dataset.act === 'edit') openProductEditor(btn.dataset.id);
      else if(btn.dataset.act === 'del') deleteProduct(btn.dataset.id);
    });

    // modal open/close
    const modal = document.getElementById('product-modal');
    document.getElementById('pm-close').addEventListener('click', closeProductEditor);
    document.getElementById('pm-cancel').addEventListener('click', closeProductEditor);
    modal.addEventListener('click', (e) => { if(e.target === modal) closeProductEditor(); });
    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape' && modal.classList.contains('is-open')) closeProductEditor();
    });

    // repeater add buttons
    document.getElementById('pm-add-image').addEventListener('click', () => addImageRow(''));
    document.getElementById('pm-add-feature').addEventListener('click', () => addTextRow('pm-features', '', 'e.g. 24 pieces per pack'));
    document.getElementById('pm-add-optgroup').addEventListener('click', () => { addOptionGroup(); syncPricingMode(); renderStockMatrix(); });

    wireImageReorder();

    // slug auto-fill + price preview
    const nameEl = document.getElementById('pm-name');
    const slugEl = document.getElementById('pm-slug');
    slugEl.addEventListener('input', () => { slugEl.dataset.edited = '1'; });
    nameEl.addEventListener('input', () => {
      if(!slugEl.dataset.edited) slugEl.value = slugify(nameEl.value);
    });
    ['pm-price', 'pm-sale-percent', 'pm-sale-start', 'pm-sale-end'].forEach(id => {
      document.getElementById(id).addEventListener('input', updatePricePreview);
    });
    // Base price/sale changes also move the per-option "after sale" readouts.
    ['pm-price', 'pm-sale-percent'].forEach(id => {
      document.getElementById(id).addEventListener('input', refreshOptionSaleOuts);
    });
    // Cap the base sale % at 0–100 / two decimals as it's typed.
    document.getElementById('pm-sale-percent').addEventListener('input', clampPctInput);
    // Editing any option field (price/sale/label) refreshes the default preview.
    document.getElementById('pm-option-groups').addEventListener('input', updatePricePreview);
    // Editing combination stock refreshes the default/preview total.
    document.getElementById('pm-matrix-rows').addEventListener('input', (e) => {
      if (e.target.classList.contains('pm-var-stock')) { stockByKey[e.target.dataset.key] = e.target.value; updatePricePreview(); }
    });

    document.getElementById('pm-save').addEventListener('click', saveProductFromForm);
  }

  // ---------------------------------------------------------------------------
  // Orders panel — read-only list of every order with a 24h "lock editing" toggle.
  // ---------------------------------------------------------------------------
  let ordersCache = [];
  let orderSearch = '';
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function loadOrders(){
    try{
      const data = await apiGet(API.orders);
      ordersCache = Array.isArray(data && data.orders) ? data.orders : [];
    }catch(e){
      console.error('loadOrders', e);
      ordersCache = [];
    }
    renderOrders();
  }

  function orderMatches(o, term){
    if(!term) return true;
    const hay = [o.purchase_id, o.customer_first_name, o.customer_last_name, o.customer_email, o.customer_phone]
      .map(v => String(v || '').toLowerCase()).join(' ');
    return hay.includes(term);
  }

  function renderOrders(){
    const host = document.getElementById('admin-orders-list');
    const countEl = document.getElementById('admin-order-count');
    if(!host) return;
    if(countEl) countEl.textContent = `${ordersCache.length} order${ordersCache.length === 1 ? '' : 's'}`;

    const term = orderSearch.trim().toLowerCase();
    const orders = ordersCache.filter(o => orderMatches(o, term));
    if(!orders.length){
      host.innerHTML = `<div class="ao-empty">${ordersCache.length ? 'No orders match your search.' : 'No orders yet.'}</div>`;
      return;
    }
    host.innerHTML = orders.map(renderOrderCard).join('');
  }

  function renderOrderCard(o){
    const money = (c) => fmtMoney((Number(c) || 0) / 100);
    const refunded = String(o.status).toLowerCase() === 'refunded' || (o.amount_refunded_cents || 0) > 0;
    // A refunded order always reads REFUNDED (red), never the original PAID.
    const displayStatus = refunded ? 'refunded' : String(o.status || 'pending').toLowerCase();
    const within24h = (Date.now() - new Date(o.created_at).getTime()) < DAY_MS;
    const created = o.created_at ? new Date(o.created_at).toLocaleString() : '';
    const name = `${o.customer_first_name || ''} ${o.customer_last_name || ''}`.trim() || '—';
    const items = (o.items || []).map(it => {
      const variant = it.variation_label ? ` <span style="color:var(--ink-faint)">(${escAttr(it.variation_label)})</span>` : '';
      return `<li><span>${Number(it.quantity) || 0} × ${escAttr(it.product_name)}${variant}</span><span>${money(it.line_total_cents)}</span></li>`;
    }).join('');

    // Lock-editing control (only meaningful for a live, non-refunded order in its 24h window).
    let lockHtml;
    if(refunded){
      lockHtml = `<span class="ao-lock-note">Refunded — no longer editable</span>`;
    }else if(within24h){
      lockHtml = o.uneditable
        ? `<button type="button" class="ao-lock-btn" data-act="unlock" data-id="${escAttr(o.id)}">Unlock editing</button>`
        : `<button type="button" class="ao-lock-btn" data-act="lock" data-id="${escAttr(o.id)}">Lock editing</button>`;
    }else{
      lockHtml = `<span class="ao-lock-note">Edit window closed${o.uneditable ? ' · was locked' : ''}</span>`;
    }

    // Complete-order control — communicates fulfillment to the customer.
    const completeHtml = refunded
      ? ''
      : (o.completed_at
        ? `<button type="button" class="ao-complete-btn is-done" data-act="uncomplete" data-id="${escAttr(o.id)}">✓ Completed — undo</button>`
        : `<button type="button" class="ao-complete-btn" data-act="complete" data-id="${escAttr(o.id)}">Complete order</button>`);

    const badges = [`<span class="ao-badge is-${displayStatus}">${escAttr(displayStatus)}</span>`];
    if(!refunded && o.completed_at) badges.push(`<span class="ao-badge is-completed">Completed</span>`);
    if(!refunded && o.uneditable) badges.push(`<span class="ao-badge is-locked">Locked</span>`);

    const refundedNote = (o.amount_refunded_cents || 0) > 0
      ? `<span class="ao-refunded">${money(o.amount_refunded_cents)} refunded</span>` : '';

    return `<article class="ao-card">
      <div class="ao-top">
        <span class="ao-pid">#${escAttr(o.purchase_id || '—')}</span>
        <span class="ao-badges">${badges.join('')}</span>
      </div>
      <div class="ao-cred">
        <div><span>Name</span><b>${escAttr(name)}</b></div>
        <div><span>Email</span><b>${escAttr(o.customer_email || '—')}</b></div>
        <div><span>Phone</span><b>${escAttr(o.customer_phone || '—')}</b></div>
        <div><span>Placed</span><b>${escAttr(created)}</b></div>
      </div>
      <ul class="ao-items">${items}</ul>
      <div class="ao-foot">
        <span class="ao-total">Total ${money(o.total_cents)} ${refundedNote}</span>
        <span class="ao-actions">${completeHtml}${lockHtml}</span>
      </div>
    </article>`;
  }

  // Applies an updated order returned by an admin action into the cache + re-renders.
  function applyUpdatedOrder(orderId, updated){
    if(!updated) return;
    const i = ordersCache.findIndex(o => o.id === orderId);
    if(i >= 0) ordersCache[i] = updated;
    renderOrders();
  }

  async function flagOrder(orderId, uneditable){
    try{
      const data = await apiSend(API.flagOrder, 'POST', { orderId, uneditable });
      applyUpdatedOrder(orderId, data && data.order);
    }catch(e){
      window.alert('Could not update the order: ' + e.message);
    }
  }

  async function completeOrder(orderId, completed){
    try{
      const data = await apiSend(API.completeOrder, 'POST', { orderId, completed });
      applyUpdatedOrder(orderId, data && data.order);
    }catch(e){
      window.alert('Could not update the order: ' + e.message);
    }
  }

  function wireOrderControls(){
    const host = document.getElementById('admin-orders-list');
    if(!host) return;
    host.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if(!btn) return;
      if(btn.dataset.act === 'lock') flagOrder(btn.dataset.id, true);
      else if(btn.dataset.act === 'unlock') flagOrder(btn.dataset.id, false);
      else if(btn.dataset.act === 'complete') completeOrder(btn.dataset.id, true);
      else if(btn.dataset.act === 'uncomplete') completeOrder(btn.dataset.id, false);
    });
    const refresh = document.getElementById('admin-order-refresh');
    if(refresh) refresh.addEventListener('click', () => loadOrders());
    const search = document.getElementById('admin-order-search');
    if(search) search.addEventListener('input', () => { orderSearch = search.value; renderOrders(); });
  }

  // ---------------------------------------------------------------------------
  // Dashboard — store statistics with dependency-free charts (CSS bars + conic
  // gradient donuts). Data comes from /api/admin/dashboard (admin only).
  // ---------------------------------------------------------------------------
  const DASH_COLORS = ['#0c7c74', '#5aa9c5', '#6f5acd', '#c98a18', '#2e9e5b', '#cf4626', '#9aa3ad', '#b48ead'];

  function centsMoney(c) { return fmtMoney((Number(c) || 0) / 100); }
  function compactMoney(c) {
    const n = (Number(c) || 0) / 100;
    if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return '$' + Math.round(n);
  }

  async function loadDashboard() {
    const root = document.getElementById('dashboard-root');
    if (!root) return;
    try {
      const stats = await apiGet(API.dashboard);
      renderDashboard(stats);
    } catch (e) {
      console.error('loadDashboard', e);
      root.innerHTML = '<div class="dash-empty">Could not load statistics: ' + escAttr(e.message) + '</div>';
    }
  }

  // Builds a conic-gradient donut + legend from [{label, value}] entries.
  function donutCard(title, note, items, centerLabel) {
    const total = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
    if (total <= 0) {
      return `<div class="dash-card"><h3>${escAttr(title)}</h3><p class="dash-card-note">${escAttr(note)}</p>
        <div class="dash-empty" style="padding:20px;">No data yet.</div></div>`;
    }
    let acc = 0;
    const stops = [];
    const legend = items.map((it, idx) => {
      const color = it.color || DASH_COLORS[idx % DASH_COLORS.length];
      const start = (acc / total) * 100;
      acc += Number(it.value) || 0;
      const end = (acc / total) * 100;
      stops.push(`${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
      const pct = Math.round(((Number(it.value) || 0) / total) * 100);
      return `<li><span class="swatch" style="background:${color}"></span>` +
        `<span class="lg-name">${escAttr(it.label)}</span>` +
        `<span class="lg-val">${escAttr(it.display != null ? it.display : it.value)} · ${pct}%</span></li>`;
    }).join('');
    return `<div class="dash-card">
      <h3>${escAttr(title)}</h3><p class="dash-card-note">${escAttr(note)}</p>
      <div class="dash-pie-wrap">
        <div class="dash-pie donut" style="background:conic-gradient(${stops.join(',')})">
          <div class="dash-pie-center"><b>${escAttr(centerLabel || '')}</b><span>${escAttr(title.split(' ')[0])}</span></div>
        </div>
        <ul class="dash-legend">${legend}</ul>
      </div>
    </div>`;
  }

  function timelineCard(timeline) {
    const max = timeline.reduce((m, t) => Math.max(m, Number(t.cents) || 0), 0);
    const hasData = max > 0;
    const bars = timeline.map((t) => {
      const cents = Number(t.cents) || 0;
      const h = hasData ? Math.max(2, Math.round((cents / max) * 100)) : 2;
      const title = `${t.label}: ${centsMoney(cents)} · ${t.count} order${t.count === 1 ? '' : 's'}`;
      return `<div class="dash-bar" title="${escAttr(title)}">
        <span class="bar-amt">${cents > 0 ? compactMoney(cents) : ''}</span>
        <div class="bar-fill" style="height:${h}%"></div>
        <span class="bar-label">${escAttr(t.label)}</span>
      </div>`;
    }).join('');
    return `<div class="dash-card">
      <h3>Sales — last 12 months</h3><p class="dash-card-note">Paid orders, by month.</p>
      ${hasData ? `<div class="dash-bars">${bars}</div>` : '<div class="dash-empty" style="padding:20px;">No sales yet.</div>'}
    </div>`;
  }

  function rankingCard(topProducts) {
    if (!topProducts.length) {
      return `<div class="dash-card"><h3>Best sellers</h3><p class="dash-card-note">Ranked by units sold.</p>
        <div class="dash-empty" style="padding:20px;">No sales yet.</div></div>`;
    }
    const max = topProducts.reduce((m, p) => Math.max(m, p.qty), 0) || 1;
    const medals = ['🥇', '🥈', '🥉'];
    const rows = topProducts.map((p, i) => {
      const w = Math.max(3, Math.round((p.qty / max) * 100));
      const medal = i < 3 ? medals[i] : (i + 1);
      return `<li>
        <span class="rank-medal top${i + 1}">${typeof medal === 'string' ? medal : '#' + medal}</span>
        <span class="rank-body">
          <div class="rank-name">${escAttr(p.name)}</div>
          <div class="rank-track"><div class="rank-fill" style="width:${w}%"></div></div>
        </span>
        <span class="rank-qty">${p.qty}<small>${centsMoney(p.revenueCents)}</small></span>
      </li>`;
    }).join('');
    return `<div class="dash-card"><h3>Best sellers</h3><p class="dash-card-note">Ranked by units sold.</p>
      <ul class="dash-rank">${rows}</ul></div>`;
  }

  function kpiCard(cls, label, value, sub, neg) {
    return `<div class="kpi ${cls}">
      <div class="kpi-label">${escAttr(label)}</div>
      <div class="kpi-value${neg ? ' neg' : ''}">${escAttr(value)}</div>
      ${sub ? `<div class="kpi-sub">${escAttr(sub)}</div>` : ''}
    </div>`;
  }

  function renderDashboard(stats) {
    const root = document.getElementById('dashboard-root');
    if (!root || !stats) return;
    const t = stats.totals || {};

    const kpis = [
      kpiCard('is-sales', 'Total sales', centsMoney(t.salesCents), `${t.orderCount || 0} paid order${t.orderCount === 1 ? '' : 's'}`),
      kpiCard('is-orders', 'Units sold', String(t.unitsSold || 0), `${centsMoney(t.avgOrderCents)} avg order`),
      kpiCard('is-refunds', 'Refunds', centsMoney(t.refundsValueCents), `${t.refundCount || 0} refunded`),
      kpiCard('is-aov', 'Avg order value', centsMoney(t.avgOrderCents), 'Per paid order'),
    ].join('');

    const revenueItems = (stats.revenueByProduct || []).map((r) => ({
      label: r.name, value: r.revenueCents, display: centsMoney(r.revenueCents),
    }));
    // Semantic label + colour per order status so the donut reads at a glance.
    const STATUS_META = {
      paid: { label: 'Paid', color: '#0c7c74' },
      completed: { label: 'Completed', color: '#5aa9c5' },
      refunded: { label: 'Refunded', color: '#cf4626' },
      failed: { label: 'Failed', color: '#9aa3ad' },
      canceled: { label: 'Canceled', color: '#b48ead' },
    };
    // The status donut compares fulfilled (completed) vs refunded orders only.
    const STATUS_SHOWN = ['completed', 'refunded'];
    const statusItems = (stats.statusBreakdown || [])
      .filter((s) => STATUS_SHOWN.includes(s.status))
      .map((s) => {
        const meta = STATUS_META[s.status] || { label: s.status.charAt(0).toUpperCase() + s.status.slice(1), color: undefined };
        return { label: meta.label, value: s.count, display: String(s.count), color: meta.color };
      });
    const statusTotal = statusItems.reduce((n, i) => n + i.value, 0);

    root.innerHTML =
      `<div class="dash-kpis">${kpis}</div>` +
      '<div class="dash-grid">' +
        '<div>' + timelineCard(stats.salesTimeline || []) + rankingCard(stats.topProducts || []) + '</div>' +
        '<div>' +
          donutCard('Revenue by product', 'Share of sales revenue.', revenueItems, centsMoney(t.salesCents)) +
          donutCard('Orders by status', 'Completed vs refunded.', statusItems, String(statusTotal)) +
        '</div>' +
      '</div>';

    const updated = document.getElementById('dash-updated');
    if (updated) updated.textContent = 'Updated ' + new Date(stats.generatedAt || Date.now()).toLocaleString();
  }

  function wireDashboardControls() {
    const refresh = document.getElementById('dash-refresh');
    if (refresh) refresh.addEventListener('click', () => loadDashboard());
  }

  // ---------------------------------------------------------------------------
  // Auth gate + bootstrap
  // ---------------------------------------------------------------------------
  let appInitialized = false;

  function showAuthGate(message){
    const gate = document.getElementById('auth-gate');
    if(gate) gate.classList.add('is-visible');
    document.body.classList.add('is-locked');
    const msg = document.getElementById('auth-msg');
    if(msg) msg.textContent = message || '';
  }

  function hideAuthGate(){
    const gate = document.getElementById('auth-gate');
    if(gate) gate.classList.remove('is-visible');
    document.body.classList.remove('is-locked');
  }

  async function checkIsAdmin(){
    try{
      const data = await apiGet(API.session);
      return !!(data && data.isAdmin);
    }catch(e){
      return false;
    }
  }

  async function revealApp(){
    hideAuthGate();
    const session = (typeof window.getSession === 'function') ? window.getSession() : null;
    const who = document.getElementById('admin-user-email');
    if(who && session && session.user) who.textContent = session.user.email || 'Signed in';

    if(appInitialized) return;
    appInitialized = true;

    await loadPillars();
    buildEditor();
    setActivePillar(0);

    await loadIncidentReport();
    buildIncidentEditor();

    wireControls();
    wireProductControls();
    await loadProducts();

    wireOrderControls();
    await loadOrders();

    wireDashboardControls();
    await loadDashboard();
  }

  async function handleLogin(event){
    if(event) event.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const msg = document.getElementById('auth-msg');
    const btn = document.getElementById('auth-submit');
    if(!email || !password){ if(msg) msg.textContent = 'Enter your email and password.'; return; }

    btn.disabled = true;
    if(msg) msg.textContent = 'Signing in…';
    try{
      const result = await window.signIn(email, password);
      if(result && result.error){
        if(msg) msg.textContent = result.error.message || 'Sign-in failed.';
        return;
      }
      const isAdmin = await checkIsAdmin();
      if(!isAdmin){
        if(msg) msg.textContent = 'This account does not have admin access.';
        if(window.signOut) await window.signOut();
        return;
      }
      await revealApp();
    }catch(err){
      if(msg) msg.textContent = 'Sign-in error: ' + err.message;
    }finally{
      btn.disabled = false;
    }
  }

  function wireAuthControls(){
    const form = document.getElementById('auth-form');
    if(form) form.addEventListener('submit', handleLogin);
    const signOutBtn = document.getElementById('admin-signout');
    if(signOutBtn){
      signOutBtn.addEventListener('click', async () => {
        if(window.signOut) await window.signOut();
        showAuthGate('You have been signed out.');
      });
    }
  }

  function setupNav(){
    const nav = document.querySelector('.admin-tabs');
    const panels = Array.from(document.querySelectorAll('.admin-panel'));
    const tabs = Array.from(document.querySelectorAll('.admin-tab, .launcher'));

    function showPanel(panelId){
      panels.forEach(panel => panel.classList.toggle('is-active', panel.id === panelId));
      document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.toggle('is-active', tab.dataset.panelTarget === panelId);
      });
      const target = document.getElementById(panelId);
      if(target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if(nav){
      nav.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-panel-target]');
        if(!trigger) return;
        event.preventDefault();
        showPanel(trigger.dataset.panelTarget);
      });
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', (event) => {
        const target = tab.dataset.panelTarget;
        if(!target) return;
        event.preventDefault();
        showPanel(target);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    setupNav();
    wireAuthControls();
    await whenAuthReady();
    const isAdmin = await checkIsAdmin();
    if(isAdmin) revealApp();
    else showAuthGate('');
  });

  // export for debugging
  window.adminPamca = {
    readPillars, savePillars, loadPillars, defaultPillars,
    readIncidentReport, saveIncidentReport, loadIncidentReport, defaultIncidentReport,
    readProducts, loadProducts, defaultProducts
  };

})();
