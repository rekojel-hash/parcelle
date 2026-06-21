// app.js
(function () {
  'use strict';

  const STATUS_LABELS = {
    reperee: 'Repérée',
    contact: 'Contact pris',
    negociation: 'Négociation',
    conclue: 'Conclue / abandonnée'
  };

  let currentDetailId = null;
  let currentProspectId = null;
  let pendingParcelGeoJSON = null;

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // ---------- Online/offline banner ----------
  function updateOnlineBanner() {
    document.getElementById('offline-banner').classList.toggle('hidden', navigator.onLine);
  }
  window.addEventListener('online', updateOnlineBanner);
  window.addEventListener('offline', updateOnlineBanner);
  updateOnlineBanner();

  // ---------- Install prompt ----------
  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!localStorage.getItem('installDismissed')) {
      document.getElementById('install-banner').classList.remove('hidden');
    }
  });
  document.getElementById('install-btn').addEventListener('click', async () => {
    document.getElementById('install-banner').classList.add('hidden');
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    }
  });
  document.getElementById('install-dismiss').addEventListener('click', () => {
    document.getElementById('install-banner').classList.add('hidden');
    localStorage.setItem('installDismissed', '1');
  });

  // ---------- Sauvegarde (export / import / reset) ----------
  document.getElementById('export-btn').addEventListener('click', async () => {
    const data = await DB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mes-parcelles-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('import-status');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await DB.importAll(data);
      const nbParcels = (data.parcels || []).length;
      const nbProspects = (data.prospects || []).length;
      statusEl.textContent =
        'Import réussi : ' + nbParcels + ' parcelle(s) et ' + nbProspects + ' prospection(s) traitées.';
      statusEl.classList.remove('hidden');
      renderList();
      renderProspectList();
      renderBackupSummary();
    } catch (err) {
      statusEl.textContent = "Erreur : fichier invalide, l'import a été annulé.";
      statusEl.classList.remove('hidden');
    }
    e.target.value = '';
  });

  document.getElementById('wipe-btn').addEventListener('click', async () => {
    if (!confirm('Effacer TOUTES les données (parcelles + prospections) sur cet appareil ? Cette action est irréversible.')) return;
    if (!confirm('Dernière confirmation : as-tu bien exporté une sauvegarde si tu en avais besoin ?')) return;
    const all = await DB.exportAll();
    for (const p of all.parcels) await DB.delete(DB.STORE_PARCELS, p.id);
    for (const p of all.prospects) await DB.delete(DB.STORE_PROSPECTS, p.id);
    renderList();
    renderProspectList();
    renderBackupSummary();
    alert('Toutes les données ont été effacées sur cet appareil.');
  });

  async function renderBackupSummary() {
    const all = await DB.exportAll();
    const totalSurface = all.parcels.reduce((s, p) => s + (p.surfaceM2 || 0), 0);
    document.getElementById('backup-summary').textContent =
      all.parcels.length + ' parcelle(s) possédée(s) · ' +
      all.prospects.length + ' en prospection · ' +
      (totalSurface / 10000).toFixed(2) + ' ha au total';
  }

  // ---------- Tabs ----------
  function switchTab(name) {
    ['map', 'list', 'prospect', 'detail', 'pdetail', 'backup'].forEach((t) => {
      document.getElementById('tab-' + t).classList.toggle('hidden', t !== name);
    });
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    if (name === 'list') renderList();
    if (name === 'prospect') renderProspectList();
    if (name === 'backup') renderBackupSummary();
    setTimeout(() => { if (window._map) window._map.invalidateSize(); }, 50);
  }
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });
  document.getElementById('detail-back').addEventListener('click', () => switchTab('list'));
  document.getElementById('pdetail-back').addEventListener('click', () => switchTab('prospect'));

  // ---------- Map ----------
  const map = L.map('map', { zoomControl: true }).setView([45.5256, 5.6814], 14);
  window._map = map;

  const ignPlan = L.tileLayer(
    'https://data.geopf.fr/wmts?LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&EXCEPTIONS=text/xml&FORMAT=image/png&SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { maxZoom: 19, attribution: 'IGN-F/Geoportail' }
  );
  const ignSat = L.tileLayer(
    'https://data.geopf.fr/wmts?LAYER=ORTHOIMAGERY.ORTHOPHOTOS&EXCEPTIONS=text/xml&FORMAT=image/jpeg&SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { maxZoom: 19, attribution: 'IGN-F/Geoportail' }
  );
  const cadastre = L.tileLayer(
    'https://data.geopf.fr/wmts?LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&EXCEPTIONS=text/xml&FORMAT=image/png&SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&STYLE=PCI vecteur&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { maxZoom: 19, attribution: 'Cadastre - DGFiP', opacity: 0.8 }
  );

  ignPlan.addTo(map);
  cadastre.addTo(map);

  document.getElementById('btn-ign').addEventListener('click', function () {
    map.removeLayer(ignSat);
    map.addLayer(ignPlan);
    this.classList.add('active');
    document.getElementById('btn-sat').classList.remove('active');
    if (map.hasLayer(cadastre)) cadastre.bringToFront();
  });
  document.getElementById('btn-sat').addEventListener('click', function () {
    map.removeLayer(ignPlan);
    map.addLayer(ignSat);
    this.classList.add('active');
    document.getElementById('btn-ign').classList.remove('active');
    if (map.hasLayer(cadastre)) cadastre.bringToFront();
  });
  document.getElementById('btn-cadastre').addEventListener('click', function () {
    if (map.hasLayer(cadastre)) {
      map.removeLayer(cadastre);
      this.classList.remove('active');
    } else {
      map.addLayer(cadastre);
      cadastre.bringToFront();
      this.classList.add('active');
    }
  });
  document.getElementById('btn-locate').addEventListener('click', () => {
    map.locate({ setView: true, maxZoom: 17 });
  });
  map.on('locationfound', (e) => {
    L.marker(e.latlng).addTo(map).bindPopup('Vous êtes ici').openPopup();
  });
  map.on('locationerror', () => {
    alert('Géolocalisation indisponible (vérifie les autorisations de localisation).');
  });

  function doSearch() {
    const q = document.getElementById('search-input').value;
    if (!q) return;
    fetch('https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(q) + '&limit=1')
      .then((r) => r.json())
      .then((data) => {
        if (data.features && data.features.length) {
          const coords = data.features[0].geometry.coordinates;
          map.setView([coords[1], coords[0]], 16);
        }
      })
      .catch(() => {});
  }
  document.getElementById('search-btn').addEventListener('click', doSearch);
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // État du mode dessin manuel (déclaré ici, utilisé par le gestionnaire de clic ci-dessous)
  let drawMode = false;
  let drawPoints = [];
  let drawMarkers = [];

  let parcelLayer = null;
  map.on('click', (e) => {
    if (drawMode) {
      const ll = e.latlng;
      drawPoints.push(ll);
      const marker = L.circleMarker(ll, { radius: 6, color: '#0f6e56', fillColor: '#0f6e56', fillOpacity: 1 }).addTo(map);
      drawMarkers.push(marker);
      redrawDrawLayer();
      updateDrawHint();
      return;
    }

    const lat = e.latlng.lat, lon = e.latlng.lng;
    const url =
      'https://apicarto.ign.fr/api/cadastre/parcelle?geom=' +
      encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] })) +
      '&_limit=1';

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (!data.features || !data.features.length) {
          document.getElementById('parcel-card').classList.add('hidden');
          return;
        }
        const f = data.features[0];
        const p = f.properties;
        pendingParcelGeoJSON = f;

        if (parcelLayer) map.removeLayer(parcelLayer);
        parcelLayer = L.geoJSON(f, { style: { color: '#D85A30', weight: 2, fillOpacity: 0.15 } }).addTo(map);

        document.getElementById('parcel-title').textContent =
          'Parcelle ' + (p.section || '') + ' ' + (p.numero || '');
        const surface = p.contenance ? (p.contenance / 10000).toFixed(2) + ' ha' : 'N/A';
        document.getElementById('parcel-body').innerHTML =
          '<div class="info-row"><span>Commune</span><span>' + (p.nom_com || p.code_com || 'N/A') + '</span></div>' +
          '<div class="info-row"><span>Section</span><span>' + (p.section || 'N/A') + '</span></div>' +
          '<div class="info-row"><span>Numéro</span><span>' + (p.numero || 'N/A') + '</span></div>' +
          '<div class="info-row"><span>Surface</span><span>' + surface + '</span></div>' +
          '<div class="info-row"><span>Réf. cadastrale</span><span>' + (p.id || 'N/A') + '</span></div>';
        document.getElementById('parcel-card').classList.remove('hidden');
      })
      .catch(() => {
        document.getElementById('parcel-body').innerHTML =
          '<div class="info-row"><span>Erreur</span><span>service indisponible (hors-ligne ?)</span></div>';
        document.getElementById('parcel-card').classList.remove('hidden');
      });
  });

  document.getElementById('parcel-close').addEventListener('click', () => {
    document.getElementById('parcel-card').classList.add('hidden');
    if (parcelLayer) { map.removeLayer(parcelLayer); parcelLayer = null; }
  });

  // ---------- Dessin manuel d'une parcelle (hors cadastre) ----------
  let drawPolyline = null;
  let drawPolygon = null;
  let pendingDrawnGeoJSON = null;

  function metersToHa(m2) { return (m2 / 10000).toFixed(2); }

  // Calcul de surface d'un polygone (formule du lacet, projection simple)
  // Suffisant pour des parcelles de quelques hectares ; pas géodésique exact.
  function computePolygonAreaM2(latlngs) {
    if (latlngs.length < 3) return 0;
    const R = 6378137; // rayon terrestre moyen en m
    const toRad = (d) => (d * Math.PI) / 180;
    const pts = latlngs.map((ll) => ({
      x: R * toRad(ll.lng) * Math.cos(toRad(latlngs[0].lat)),
      y: R * toRad(ll.lat)
    }));
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(area / 2);
  }

  function resetDrawState() {
    drawPoints = [];
    drawMarkers.forEach((m) => map.removeLayer(m));
    drawMarkers = [];
    if (drawPolyline) { map.removeLayer(drawPolyline); drawPolyline = null; }
    if (drawPolygon) { map.removeLayer(drawPolygon); drawPolygon = null; }
    updateDrawHint();
  }

  function updateDrawHint() {
    const hint = document.getElementById('draw-hint');
    if (drawPoints.length === 0) {
      hint.innerHTML = '<i class="ti ti-info-circle" aria-hidden="true"></i> Touche la carte pour placer le premier point.';
    } else if (drawPoints.length < 3) {
      hint.innerHTML = '<i class="ti ti-info-circle" aria-hidden="true"></i> Encore au moins ' + (3 - drawPoints.length) + ' point(s) avant de pouvoir terminer.';
    } else {
      hint.innerHTML = '<i class="ti ti-info-circle" aria-hidden="true"></i> ' + drawPoints.length + ' points placés. Continue ou appuie sur « Terminer ».';
    }
  }

  function redrawDrawLayer() {
    if (drawPolyline) { map.removeLayer(drawPolyline); drawPolyline = null; }
    if (drawPolygon) { map.removeLayer(drawPolygon); drawPolygon = null; }
    if (drawPoints.length >= 2) {
      drawPolyline = L.polyline(drawPoints, { color: '#0f6e56', weight: 3, dashArray: '6 6' }).addTo(map);
    }
    if (drawPoints.length >= 3) {
      drawPolygon = L.polygon(drawPoints, { color: '#0f6e56', weight: 2, fillOpacity: 0.15 }).addTo(map);
    }
  }

  document.getElementById('btn-draw').addEventListener('click', function () {
    drawMode = !drawMode;
    this.classList.toggle('active', drawMode);
    document.getElementById('draw-bar').classList.toggle('hidden', !drawMode);
    document.getElementById('parcel-card').classList.add('hidden');
    document.getElementById('drawn-card').classList.add('hidden');
    if (parcelLayer) { map.removeLayer(parcelLayer); parcelLayer = null; }
    resetDrawState();
  });

  document.getElementById('draw-undo').addEventListener('click', () => {
    if (!drawPoints.length) return;
    drawPoints.pop();
    const lastMarker = drawMarkers.pop();
    if (lastMarker) map.removeLayer(lastMarker);
    redrawDrawLayer();
    updateDrawHint();
  });

  document.getElementById('draw-cancel').addEventListener('click', () => {
    drawMode = false;
    document.getElementById('btn-draw').classList.remove('active');
    document.getElementById('draw-bar').classList.add('hidden');
    resetDrawState();
  });

  document.getElementById('draw-finish').addEventListener('click', () => {
    if (drawPoints.length < 3) {
      alert('Il faut au moins 3 points pour former un contour.');
      return;
    }
    const areaM2 = computePolygonAreaM2(drawPoints);
    const ring = drawPoints.map((ll) => [ll.lng, ll.lat]);
    ring.push(ring[0]); // fermer le polygone
    pendingDrawnGeoJSON = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] }
    };

    document.getElementById('drawn-surface').textContent = metersToHa(areaM2) + ' ha (' + Math.round(areaM2) + ' m²)';
    document.getElementById('drawn-points').textContent = drawPoints.length;
    document.getElementById('drawn-card').classList.remove('hidden');

    drawMode = false;
    document.getElementById('btn-draw').classList.remove('active');
    document.getElementById('draw-bar').classList.add('hidden');
    drawMarkers.forEach((m) => map.removeLayer(m));
    drawMarkers = [];
    if (drawPolyline) { map.removeLayer(drawPolyline); drawPolyline = null; }
    // le polygone reste affiché comme aperçu jusqu'à fermeture de la carte
  });

  document.getElementById('drawn-close').addEventListener('click', () => {
    document.getElementById('drawn-card').classList.add('hidden');
    if (drawPolygon) { map.removeLayer(drawPolygon); drawPolygon = null; }
    pendingDrawnGeoJSON = null;
    drawPoints = [];
  });

  function buildRecordFromDrawn() {
    const areaM2 = computePolygonAreaM2(drawPoints);
    const id = 'manuel_' + Date.now();
    return {
      id,
      refCadastrale: '',
      commune: '',
      section: '',
      numero: '',
      surfaceM2: Math.round(areaM2),
      geometry: pendingDrawnGeoJSON.geometry,
      dessineeManuel: true
    };
  }

  document.getElementById('drawn-add').addEventListener('click', async () => {
    if (!pendingDrawnGeoJSON) return;
    const base = buildRecordFromDrawn();
    const record = Object.assign(base, {
      nom: '', type: 'bois', essence: '', notesGenerales: '', carnet: [],
      createdAt: new Date().toISOString()
    });
    try {
      await DB.put(DB.STORE_PARCELS, record);
      document.getElementById('drawn-card').classList.add('hidden');
      if (drawPolygon) { map.removeLayer(drawPolygon); drawPolygon = null; }
      pendingDrawnGeoJSON = null;
      drawPoints = [];
      switchTab('list');
      openDetail(record.id);
    } catch (err) { alert('Erreur lors de la sauvegarde.'); }
  });

  document.getElementById('drawn-prospect').addEventListener('click', async () => {
    if (!pendingDrawnGeoJSON) return;
    const base = buildRecordFromDrawn();
    const record = Object.assign(base, {
      nom: '', statut: 'reperee', notes: '', carnet: [],
      createdAt: new Date().toISOString()
    });
    try {
      await DB.put(DB.STORE_PROSPECTS, record);
      document.getElementById('drawn-card').classList.add('hidden');
      if (drawPolygon) { map.removeLayer(drawPolygon); drawPolygon = null; }
      pendingDrawnGeoJSON = null;
      drawPoints = [];
      switchTab('prospect');
      openProspectDetail(record.id);
    } catch (err) { alert('Erreur lors de la sauvegarde.'); }
  });

  function buildRecordFromPending() {
    const p = pendingParcelGeoJSON.properties;
    const id = (p.id || 'p_' + Date.now()) + '_' + Date.now();
    return {
      id,
      refCadastrale: p.id || '',
      commune: p.nom_com || p.code_com || '',
      section: p.section || '',
      numero: p.numero || '',
      surfaceM2: p.contenance || 0,
      geometry: pendingParcelGeoJSON.geometry
    };
  }

  document.getElementById('parcel-add').addEventListener('click', async () => {
    if (!pendingParcelGeoJSON) return;
    const base = buildRecordFromPending();
    const record = Object.assign(base, {
      nom: '', type: 'bois', essence: '', notesGenerales: '', carnet: [],
      createdAt: new Date().toISOString()
    });
    try {
      await DB.put(DB.STORE_PARCELS, record);
      document.getElementById('parcel-card').classList.add('hidden');
      if (parcelLayer) { map.removeLayer(parcelLayer); parcelLayer = null; }
      switchTab('list');
      openDetail(record.id);
    } catch (err) {
      alert('Erreur lors de la sauvegarde.');
    }
  });

  document.getElementById('parcel-prospect').addEventListener('click', async () => {
    if (!pendingParcelGeoJSON) return;
    const base = buildRecordFromPending();
    const record = Object.assign(base, {
      nom: '', statut: 'reperee', notes: '', carnet: [],
      createdAt: new Date().toISOString()
    });
    try {
      await DB.put(DB.STORE_PROSPECTS, record);
      document.getElementById('parcel-card').classList.add('hidden');
      if (parcelLayer) { map.removeLayer(parcelLayer); parcelLayer = null; }
      switchTab('prospect');
      openProspectDetail(record.id);
    } catch (err) {
      alert('Erreur lors de la sauvegarde.');
    }
  });

  // ---------- Mes parcelles : liste ----------
  async function renderList() {
    const parcels = await DB.getAll(DB.STORE_PARCELS);
    const container = document.getElementById('plist-container');
    let totalSurface = 0;
    const communes = {};
    parcels.forEach((p) => { totalSurface += p.surfaceM2 || 0; if (p.commune) communes[p.commune] = true; });

    document.getElementById('stat-count').textContent = parcels.length;
    document.getElementById('stat-surface').textContent = (totalSurface / 10000).toFixed(2) + ' ha';
    document.getElementById('stat-communes').textContent = Object.keys(communes).length;

    if (!parcels.length) {
      container.innerHTML =
        '<div class="empty-state"><i class="ti ti-map-off" aria-hidden="true"></i>Aucune parcelle enregistrée.<br>Va dans l\'onglet carte et clique sur une parcelle pour l\'ajouter.</div>';
      return;
    }
    container.innerHTML = '';
    parcels.sort((a, b) => (a.nom || a.refCadastrale || a.id).localeCompare(b.nom || b.refCadastrale || b.id));
    parcels.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'plist-item';
      const iconName = p.dessineeManuel ? 'ti-pencil' : (p.type === 'bois' ? 'ti-tree' : p.type === 'terrain' ? 'ti-plant-2' : 'ti-map-pin');
      const surfaceHa = ((p.surfaceM2 || 0) / 10000).toFixed(2);
      const fallbackName = p.dessineeManuel ? 'Parcelle dessinée' : ('Parcelle ' + p.section + ' ' + p.numero);
      const subLabel = p.commune || (p.dessineeManuel ? 'Contour manuel' : '');
      div.innerHTML =
        '<div class="plist-icon"><i class="ti ' + iconName + '" aria-hidden="true"></i></div>' +
        '<div style="flex:1;"><p class="plist-name">' + escapeHtml(p.nom || fallbackName) + '</p>' +
        '<p class="plist-sub">' + escapeHtml(subLabel) + ' · ' + surfaceHa + ' ha</p></div>' +
        '<i class="ti ti-chevron-right" aria-hidden="true" style="color:var(--text-secondary);"></i>';
      div.addEventListener('click', () => { switchTab('detail'); openDetail(p.id); });
      container.appendChild(div);
    });
  }

  async function openDetail(id) {
    currentDetailId = id;
    const p = await DB.get(DB.STORE_PARCELS, id);
    if (!p) return;
    document.getElementById('d-name').value = p.nom || '';
    document.getElementById('d-type').value = p.type || 'bois';
    document.getElementById('d-essence').value = p.essence || '';
    document.getElementById('d-commune').textContent = p.commune || (p.dessineeManuel ? 'Non renseignée' : '-');
    document.getElementById('d-section').textContent = p.dessineeManuel ? 'N/A (contour manuel)' : (p.section || '-') + ' / ' + (p.numero || '-');
    document.getElementById('d-surface').textContent = p.surfaceM2 ? (p.surfaceM2 / 10000).toFixed(2) + ' ha' : '-';
    document.getElementById('d-ref').textContent = p.dessineeManuel ? 'N/A' : (p.refCadastrale || '-');
    document.getElementById('d-notes').value = p.notesGenerales || '';
    document.getElementById('d-origin-badge').classList.toggle('hidden', !p.dessineeManuel);
    renderNoteList('d-notes-list', p.carnet || []);
  }

  function renderNoteList(elId, carnet) {
    const el = document.getElementById(elId);
    if (!carnet.length) {
      el.innerHTML = '<p style="font-size:13px; color:var(--text-secondary); margin:4px 0;">Aucune entrée pour le moment.</p>';
      return;
    }
    el.innerHTML = '';
    carnet.slice().reverse().forEach((n) => {
      const div = document.createElement('div');
      div.className = 'note-item';
      const d = new Date(n.date);
      div.innerHTML =
        '<p class="note-date">' + d.toLocaleDateString('fr-FR') + '</p><p class="note-text">' + escapeHtml(n.text) + '</p>';
      el.appendChild(div);
    });
  }

  document.getElementById('d-save').addEventListener('click', async () => {
    if (!currentDetailId) return;
    const p = await DB.get(DB.STORE_PARCELS, currentDetailId);
    p.nom = document.getElementById('d-name').value;
    p.type = document.getElementById('d-type').value;
    p.essence = document.getElementById('d-essence').value;
    p.notesGenerales = document.getElementById('d-notes').value;
    try {
      await DB.put(DB.STORE_PARCELS, p);
      flashSaved('d-save');
    } catch (err) { alert('Erreur lors de la sauvegarde.'); }
  });

  document.getElementById('d-note-add').addEventListener('click', async () => {
    const input = document.getElementById('d-note-input');
    const text = input.value.trim();
    if (!text || !currentDetailId) return;
    const p = await DB.get(DB.STORE_PARCELS, currentDetailId);
    p.carnet = p.carnet || [];
    p.carnet.push({ date: new Date().toISOString(), text });
    try {
      await DB.put(DB.STORE_PARCELS, p);
      input.value = '';
      renderNoteList('d-notes-list', p.carnet);
    } catch (err) { alert('Erreur lors de la sauvegarde.'); }
  });
  document.getElementById('d-note-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('d-note-add').click();
  });

  document.getElementById('d-delete').addEventListener('click', async () => {
    if (!currentDetailId) return;
    if (!confirm('Supprimer définitivement cette parcelle ?')) return;
    try {
      await DB.delete(DB.STORE_PARCELS, currentDetailId);
      switchTab('list');
    } catch (err) { alert('Erreur lors de la suppression.'); }
  });

  // ---------- Prospection : liste ----------
  async function renderProspectList() {
    const parcels = await DB.getAll(DB.STORE_PROSPECTS);
    const container = document.getElementById('prospect-container');
    let totalSurface = 0;
    let negoCount = 0;
    parcels.forEach((p) => {
      totalSurface += p.surfaceM2 || 0;
      if (p.statut === 'negociation') negoCount++;
    });
    document.getElementById('pstat-count').textContent = parcels.length;
    document.getElementById('pstat-surface').textContent = (totalSurface / 10000).toFixed(2) + ' ha';
    document.getElementById('pstat-nego').textContent = negoCount;

    if (!parcels.length) {
      container.innerHTML =
        '<div class="empty-state"><i class="ti ti-target-arrow" aria-hidden="true"></i>Aucune parcelle en prospection.<br>Va dans l\'onglet carte, clique sur une parcelle, puis « Prospection ».</div>';
      return;
    }
    container.innerHTML = '';
    const order = { reperee: 0, contact: 1, negociation: 2, conclue: 3 };
    parcels.sort((a, b) => (order[a.statut] || 0) - (order[b.statut] || 0));
    parcels.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'plist-item';
      const surfaceHa = ((p.surfaceM2 || 0) / 10000).toFixed(2);
      const iconName = p.dessineeManuel ? 'ti-pencil' : 'ti-target-arrow';
      const fallbackName = p.dessineeManuel ? 'Parcelle dessinée' : ('Parcelle ' + p.section + ' ' + p.numero);
      const subLabel = p.commune || (p.dessineeManuel ? 'Contour manuel' : '');
      div.innerHTML =
        '<div class="plist-icon prospect"><i class="ti ' + iconName + '" aria-hidden="true"></i></div>' +
        '<div style="flex:1;"><p class="plist-name">' + escapeHtml(p.nom || fallbackName) + '</p>' +
        '<p class="plist-sub">' + escapeHtml(subLabel) + ' · ' + surfaceHa + ' ha</p></div>' +
        '<span class="status-badge">' + (STATUS_LABELS[p.statut] || 'Repérée') + '</span>';
      div.addEventListener('click', () => { switchTab('pdetail'); openProspectDetail(p.id); });
      container.appendChild(div);
    });
  }

  function setStatusPill(status) {
    document.querySelectorAll('.status-pill').forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.status === status);
    });
  }
  document.querySelectorAll('.status-pill').forEach((btn) => {
    btn.addEventListener('click', () => setStatusPill(btn.dataset.status));
  });

  async function openProspectDetail(id) {
    currentProspectId = id;
    const p = await DB.get(DB.STORE_PROSPECTS, id);
    if (!p) return;
    document.getElementById('p-name').value = p.nom || '';
    setStatusPill(p.statut || 'reperee');
    document.getElementById('p-commune').textContent = p.commune || (p.dessineeManuel ? 'Non renseignée' : '-');
    document.getElementById('p-section').textContent = p.dessineeManuel ? 'N/A (contour manuel)' : (p.section || '-') + ' / ' + (p.numero || '-');
    document.getElementById('p-surface').textContent = p.surfaceM2 ? (p.surfaceM2 / 10000).toFixed(2) + ' ha' : '-';
    document.getElementById('p-ref').textContent = p.dessineeManuel ? 'N/A' : (p.refCadastrale || '-');
    document.getElementById('p-notes').value = p.notes || '';
    document.getElementById('p-origin-badge').classList.toggle('hidden', !p.dessineeManuel);
    renderNoteList('p-notes-list', p.carnet || []);
  }

  document.getElementById('p-save').addEventListener('click', async () => {
    if (!currentProspectId) return;
    const p = await DB.get(DB.STORE_PROSPECTS, currentProspectId);
    p.nom = document.getElementById('p-name').value;
    const selected = document.querySelector('.status-pill.selected');
    p.statut = selected ? selected.dataset.status : 'reperee';
    p.notes = document.getElementById('p-notes').value;
    try {
      await DB.put(DB.STORE_PROSPECTS, p);
      flashSaved('p-save');
    } catch (err) { alert('Erreur lors de la sauvegarde.'); }
  });

  document.getElementById('p-note-add').addEventListener('click', async () => {
    const input = document.getElementById('p-note-input');
    const text = input.value.trim();
    if (!text || !currentProspectId) return;
    const p = await DB.get(DB.STORE_PROSPECTS, currentProspectId);
    p.carnet = p.carnet || [];
    p.carnet.push({ date: new Date().toISOString(), text });
    try {
      await DB.put(DB.STORE_PROSPECTS, p);
      input.value = '';
      renderNoteList('p-notes-list', p.carnet);
    } catch (err) { alert('Erreur lors de la sauvegarde.'); }
  });
  document.getElementById('p-note-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('p-note-add').click();
  });

  document.getElementById('p-promote').addEventListener('click', async () => {
    if (!currentProspectId) return;
    if (!confirm('Marquer cette parcelle comme acquise et la déplacer dans « Mes parcelles » ?')) return;
    const p = await DB.get(DB.STORE_PROSPECTS, currentProspectId);
    const newRecord = {
      id: p.id, refCadastrale: p.refCadastrale, commune: p.commune, section: p.section, numero: p.numero,
      surfaceM2: p.surfaceM2, geometry: p.geometry, dessineeManuel: !!p.dessineeManuel,
      nom: p.nom, type: 'bois', essence: '', notesGenerales: p.notes || '', carnet: p.carnet || [],
      createdAt: new Date().toISOString()
    };
    try {
      await DB.put(DB.STORE_PARCELS, newRecord);
      await DB.delete(DB.STORE_PROSPECTS, currentProspectId);
      switchTab('list');
    } catch (err) { alert('Erreur lors du transfert.'); }
  });

  document.getElementById('p-delete').addEventListener('click', async () => {
    if (!currentProspectId) return;
    if (!confirm('Supprimer définitivement ce repérage ?')) return;
    try {
      await DB.delete(DB.STORE_PROSPECTS, currentProspectId);
      switchTab('prospect');
    } catch (err) { alert('Erreur lors de la suppression.'); }
  });

  // ---------- Helpers ----------
  function flashSaved(btnId) {
    const btn = document.getElementById(btnId);
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Enregistré';
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  renderList();
  renderBackupSummary();
})();
