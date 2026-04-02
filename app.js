(function initializeDiplomaMap() {
  const districtMeta = window.DISTRICT_META || {};
  const units = [...(window.UNITS_DATA || [])];
  const sourceDistricts = window.FEDERAL_DISTRICTS || { type: 'FeatureCollection', features: [] };
  const numberFormatter = new Intl.NumberFormat('ru-RU');

  const elements = {
    districtList: document.getElementById('districtList'),
    districtsChip: document.getElementById('districtsChip'),
    summaryStrip: document.getElementById('summaryStrip'),
    unitsChip: document.getElementById('unitsChip'),
    unitsList: document.getElementById('unitsList'),
    unitsCount: document.getElementById('unitsCount'),
    inspectorTitle: document.getElementById('inspectorTitle'),
    inspectorText: document.getElementById('inspectorText'),
    inspectorMetrics: document.getElementById('inspectorMetrics'),
    selectionStatus: document.getElementById('selectionStatus'),
    searchForm: document.getElementById('searchForm'),
    searchInput: document.getElementById('searchInput'),
    searchSuggestions: document.getElementById('searchSuggestions'),
    resetButton: document.getElementById('resetButton'),
    selectionPanelTag: document.getElementById('selectionPanelTag'),
    selectionPanelTitle: document.getElementById('selectionPanelTitle'),
    selectionPanelText: document.getElementById('selectionPanelText'),
    selectionPanelMeta: document.getElementById('selectionPanelMeta'),
    selectionActionPrimary: document.getElementById('selectionActionPrimary'),
    selectionActionSecondary: document.getElementById('selectionActionSecondary'),
    toast: document.getElementById('toast')
  };

  if (window.location.protocol === 'file:') {
    window.setTimeout(() => {
      showToast('Откройте проект через локальный сервер: файл file:// блокирует подложку OSM с подписями городов.');
    }, 500);
  }

  const state = {
    selectedDistrict: null,
    selectedUnitId: null,
    toastTimer: null,
    suggestionHideTimer: null
  };

  const normalizedDistricts = normalizeDistrictGeometries(sourceDistricts);
  const districts = {
    ...normalizedDistricts,
    features: normalizedDistricts.features.map((feature) => {
      const meta = districtMeta[feature.properties.key] || {};
      return {
        ...feature,
        properties: {
          ...feature.properties,
          ...meta,
          name: meta.name || feature.properties.name
        }
      };
    })
  };

  const map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    minZoom: 3.25,
    maxZoom: 7,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 140,
    worldCopyJump: false,
    maxBoundsViscosity: 1,
    preferCanvas: true
  });

  map.createPane('districtPane');
  map.getPane('districtPane').style.zIndex = '380';

  map.createPane('labelPane');
  map.getPane('labelPane').style.zIndex = '430';
  map.getPane('labelPane').style.pointerEvents = 'none';

  map.createPane('unitPane');
  map.getPane('unitPane').style.zIndex = '520';

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control
    .attribution({
      position: 'bottomright',
      prefix: false
    })
    .addAttribution('Leaflet')
    .addAttribution('OpenStreetMap')
    .addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    opacity: 0.94,
    updateWhenZooming: false,
    updateWhenIdle: true
  }).addTo(map);

  const districtBounds = new Map();
  const districtLayers = new Map();
  const districtLabels = new Map();
  const districtLabelLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const markersById = new Map();

  const districtLayer = L.geoJSON(districts, {
    pane: 'districtPane',
    style: getDistrictStyle,
    onEachFeature(feature, layer) {
      const key = feature.properties.key;
      districtBounds.set(key, layer.getBounds());
      districtLayers.set(key, layer);

      layer.on({
        mouseover() {
          layer.setStyle({
            weight: 3.2,
            fillOpacity: state.selectedDistrict === key ? 0.22 : 0.16
          });
        },
        mouseout() {
          refreshDistrictStyles();
        },
        click() {
          selectDistrict(feature.properties.key);
        }
      });
    }
  }).addTo(map);

  const overallBounds = districtLayer.getBounds().pad(0.04);
  map.fitBounds(overallBounds, {
    padding: getBoundsPadding()
  });
  map.setMaxBounds(overallBounds.pad(0.02));

  buildDistrictLabels();
  buildUnitMarkers();
  bindControls();
  syncInterface();

  function bindControls() {
    elements.searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = elements.searchInput.value.trim();

      if (!query) {
        showToast('Введите номер части, город или гарнизон для поиска.');
        return;
      }

      const normalized = query.toLowerCase();
      const match = units.find((unit) => {
        if (/^\d{5}$/.test(normalized)) {
          return unit.id === normalized;
        }

        return [unit.id, unit.name, unit.city, unit.garrison, unit.specialization]
          .join(' ')
          .toLowerCase()
          .includes(normalized);
      });

      if (!match) {
        showToast(`По запросу "${query}" ничего не найдено.`);
        return;
      }

      focusUnit(match.id);
    });

    elements.searchInput.addEventListener('input', () => {
      renderSearchSuggestions(elements.searchInput.value.trim());
    });

    elements.searchInput.addEventListener('focus', () => {
      renderSearchSuggestions(elements.searchInput.value.trim());
    });

    elements.searchInput.addEventListener('blur', () => {
      if (state.suggestionHideTimer) {
        window.clearTimeout(state.suggestionHideTimer);
      }

      state.suggestionHideTimer = window.setTimeout(() => {
        elements.searchSuggestions.innerHTML = '';
        elements.searchSuggestions.classList.remove('is-visible');
      }, 140);
    });

    elements.resetButton.addEventListener('click', () => {
      map.closePopup();
      state.selectedDistrict = null;
      state.selectedUnitId = null;
      elements.searchInput.value = '';
      elements.searchSuggestions.innerHTML = '';
      elements.searchSuggestions.classList.remove('is-visible');
      syncInterface();
      zoomToCurrentSelection();
    });

    elements.selectionActionPrimary.addEventListener('click', () => {
      if (state.selectedUnitId) {
        focusUnit(state.selectedUnitId);
        return;
      }

      zoomToCurrentSelection();
    });

    elements.selectionActionSecondary.addEventListener('click', () => {
      map.closePopup();
      state.selectedDistrict = null;
      state.selectedUnitId = null;
      elements.searchInput.value = '';
      elements.searchSuggestions.innerHTML = '';
      elements.searchSuggestions.classList.remove('is-visible');
      syncInterface();
      zoomToCurrentSelection();
    });

    map.on('click', (event) => {
      if (event.originalEvent?.__unitHandled) {
        return;
      }

      const districtKey = findDistrictKeyByLatLng(event.latlng);
      if (districtKey) {
        selectDistrict(districtKey);
      }
    });

    window.addEventListener('resize', () => {
      map.invalidateSize();
    });
  }

  function selectDistrict(districtKey) {
    map.closePopup();
    elements.searchSuggestions.innerHTML = '';
    elements.searchSuggestions.classList.remove('is-visible');
    state.selectedDistrict = districtKey;
    state.selectedUnitId = null;
    syncInterface();

    const layer = districtLayers.get(districtKey);
    if (layer) {
      layer.bringToFront();
    }

    zoomToCurrentSelection();
  }

  function findDistrictKeyByLatLng(latlng) {
    for (const feature of districts.features) {
      if (isLatLngInsideFeature(latlng, feature)) {
        return feature.properties.key;
      }
    }

    return null;
  }

  function isLatLngInsideFeature(latlng, feature) {
    const { geometry } = feature;
    if (!geometry) {
      return false;
    }

    if (geometry.type === 'Polygon') {
      return isLatLngInsidePolygon(latlng, geometry.coordinates);
    }

    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.some((polygon) => isLatLngInsidePolygon(latlng, polygon));
    }

    return false;
  }

  function isLatLngInsidePolygon(latlng, polygon) {
    if (!polygon.length) {
      return false;
    }

    const outerRing = polygon[0];
    if (!isPointInRing(latlng, outerRing)) {
      return false;
    }

    return !polygon.slice(1).some((holeRing) => isPointInRing(latlng, holeRing));
  }

  function isPointInRing(latlng, ring) {
    let inside = false;
    const pointLat = latlng.lat;
    const pointLng = normalizePointLngForRing(latlng.lng, ring);

    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const [currentLng, currentLat] = ring[index];
      const [previousLng, previousLat] = ring[previous];

      const intersects =
        currentLat > pointLat !== previousLat > pointLat &&
        pointLng <
          ((previousLng - currentLng) * (pointLat - currentLat)) / (previousLat - currentLat) + currentLng;

      if (intersects) {
        inside = !inside;
      }
    }

    return inside;
  }

  function normalizePointLngForRing(pointLng, ring) {
    const hasWrappedLng = ring.some(([lng]) => lng > 180);
    if (hasWrappedLng && pointLng < 0) {
      return pointLng + 360;
    }

    return pointLng;
  }

  function normalizeDistrictGeometries(collection) {
    return {
      ...collection,
      features: collection.features.map((feature) => ({
        ...feature,
        geometry: normalizeGeometry(feature.geometry)
      }))
    };
  }

  function normalizeGeometry(geometry) {
    if (geometry.type === 'Polygon') {
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((ring) => normalizeRing(ring))
      };
    }

    if (geometry.type === 'MultiPolygon') {
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => normalizeRing(ring)))
      };
    }

    return geometry;
  }

  function normalizeRing(ring) {
    return ring.map(([lng, lat]) => [lng < 0 ? lng + 360 : lng, lat]);
  }

  function buildDistrictLabels() {
    districts.features.forEach((feature) => {
      const key = feature.properties.key;
      const bounds = districtBounds.get(key);
      if (!bounds) {
        return;
      }

      const label = L.marker(bounds.getCenter(), {
        interactive: false,
        keyboard: false,
        pane: 'labelPane',
        icon: L.divIcon({
          className: 'district-label',
          html: `
            <span class="district-label__badge" style="--district-color:${feature.properties.color}">
              ${feature.properties.shortName || feature.properties.name}
            </span>
          `,
          iconSize: [120, 32],
          iconAnchor: [60, 16]
        })
      });

      districtLabels.set(key, label);
      districtLabelLayer.addLayer(label);
    });
  }

  function buildUnitMarkers() {
    units.forEach((unit) => {
      const marker = L.circleMarker([unit.lat, unit.lng], {
        ...getMarkerStyle(unit),
        pane: 'unitPane',
        bubblingMouseEvents: false
      });

      marker.bindPopup(buildPopupMarkup(unit), {
        className: 'unit-popup',
        maxWidth: 320
      });

      marker.on('click', (event) => {
        if (event.originalEvent) {
          event.originalEvent.__unitHandled = true;
        }
        L.DomEvent.stopPropagation(event);
        state.selectedDistrict = unit.districtKey;
        state.selectedUnitId = unit.id;
        syncInterface();
        window.setTimeout(() => {
          marker.openPopup();
        }, 0);
      });

      markersById.set(unit.id, marker);
      markerLayer.addLayer(marker);
      marker.bringToFront();
    });
  }

  function getDistrictStyle(feature) {
    const key = feature.properties.key;
    const isActive = state.selectedDistrict === key;
    const isDimmed = Boolean(state.selectedDistrict) && !isActive;

    return {
      color: feature.properties.color || '#2a5bff',
      weight: isActive ? 5.6 : 2.2,
      fillColor: feature.properties.color || '#2a5bff',
      fillOpacity: isDimmed ? 0.015 : isActive ? 0.24 : 0.09,
      opacity: isDimmed ? 0.2 : 1,
      dashArray: isActive ? '' : '10 10'
    };
  }

  function getMarkerStyle(unit) {
    const baseColor = districtMeta[unit.districtKey]?.color || '#2a5bff';
    const isSelected = state.selectedUnitId === unit.id;
    const isDimmed = Boolean(state.selectedDistrict) && state.selectedDistrict !== unit.districtKey;

    return {
      radius: isSelected ? 9.5 : 6.8,
      color: '#eef4ff',
      weight: isSelected ? 3 : 1.8,
      fillColor: baseColor,
      fillOpacity: isDimmed ? 0.22 : isSelected ? 0.98 : 0.86,
      opacity: isDimmed ? 0.22 : 1
    };
  }

  function buildPopupMarkup(unit) {
    const meta = districtMeta[unit.districtKey] || {};
    const rank = unit.rank || unit.curatorRank || 'Не указано';
    const fio = unit.fio || unit.curatorName || 'Не указано';

    return `
      <div class="popup-shell">
        <p class="popup-kicker">${meta.shortName || ''} · ${unit.city}</p>
        <h3>${unit.name}</h3>
        <p class="popup-specialization">Номер части: ${unit.id} · ${unit.garrison}</p>
        <div class="popup-grid">
          <div>
            <span>Номер части</span>
            <strong>${unit.name}</strong>
          </div>
          <div>
            <span>Военная прокуратура</span>
            <strong>${unit.prosecutor}</strong>
          </div>
          <div>
            <span>Должность</span>
            <strong>${rank}</strong>
          </div>
          <div>
            <span>ФИО</span>
            <strong>${fio}</strong>
          </div>
          <div>
            <span>Телефон</span>
            <strong>${unit.phone}</strong>
          </div>
        </div>
        <div class="popup-prosecutor">
          <span>Дополнительная информация</span>
          <strong>${unit.specialization}</strong>
          <p>Личный состав: ${numberFormatter.format(unit.personnel)} чел.</p>
          <p>Готовность: ${unit.readiness}% · Статус: ${unit.status}</p>
          <p>Последняя проверка: ${unit.lastInspection}</p>
        </div>
      </div>
    `;
  }

  function getSearchMatches(query, limit = 6) {
    if (!query) {
      return [];
    }

    const normalized = query.toLowerCase();
    return units
      .filter((unit) =>
        [unit.id, unit.name, unit.city, unit.garrison, unit.specialization, unit.prosecutor]
          .join(' ')
          .toLowerCase()
          .includes(normalized)
      )
      .slice(0, limit);
  }

  function renderSearchSuggestions(query) {
    const matches = getSearchMatches(query);

    if (!query || matches.length === 0) {
      elements.searchSuggestions.innerHTML = '';
      elements.searchSuggestions.classList.remove('is-visible');
      return;
    }

    elements.searchSuggestions.innerHTML = matches
      .map(
        (unit) => `
          <button type="button" class="search-suggestion" data-unit-id="${unit.id}">
            <strong>${unit.name}</strong>
            <span>${unit.city} · ${unit.garrison}</span>
          </button>
        `
      )
      .join('');

    elements.searchSuggestions.classList.add('is-visible');

    elements.searchSuggestions.querySelectorAll('.search-suggestion').forEach((button) => {
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });

      button.addEventListener('click', () => {
        const unitId = button.dataset.unitId;
        const unit = units.find((entry) => entry.id === unitId);
        if (!unit) {
          return;
        }

        elements.searchInput.value = `${unit.name} · ${unit.city}`;
        elements.searchSuggestions.innerHTML = '';
        elements.searchSuggestions.classList.remove('is-visible');
        focusUnit(unitId);
      });
    });
  }

  function getFilteredUnits() {
    if (!state.selectedDistrict) {
      return [...units];
    }

    return units.filter((unit) => unit.districtKey === state.selectedDistrict);
  }

  function getSummary(unitsSubset) {
    const prosecutors = new Set(unitsSubset.map((unit) => unit.prosecutor));
    const garrisons = new Set(unitsSubset.map((unit) => unit.garrison));
    const personnel = unitsSubset.reduce((total, unit) => total + unit.personnel, 0);
    const readinessAverage =
      unitsSubset.length > 0
        ? Math.round(unitsSubset.reduce((total, unit) => total + unit.readiness, 0) / unitsSubset.length)
        : 0;

    return {
      count: unitsSubset.length,
      personnel,
      readinessAverage,
      prosecutors: prosecutors.size,
      garrisons: garrisons.size
    };
  }

  function renderDistrictFilters() {
    const summaryByDistrict = Object.keys(districtMeta).map((key) => ({
      key,
      count: units.filter((unit) => unit.districtKey === key).length,
      meta: districtMeta[key]
    }));

    elements.districtList.innerHTML = '';

    const allButton = document.createElement('button');
    allButton.type = 'button';
    allButton.className = 'district-pill';
    allButton.dataset.key = '';
    allButton.innerHTML = `
      <span class="district-pill__swatch" style="background: linear-gradient(135deg, #1d293d, #60708a)"></span>
      <span class="district-pill__text">
        <strong>Все округа</strong>
        <small>${units.length} объектов</small>
      </span>
    `;
    allButton.addEventListener('click', () => {
      map.closePopup();
      state.selectedDistrict = null;
      state.selectedUnitId = null;
      syncInterface();
      zoomToCurrentSelection();
    });
    elements.districtList.append(allButton);

    summaryByDistrict.forEach(({ key, count, meta }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'district-pill';
      button.dataset.key = key;
      button.innerHTML = `
        <span class="district-pill__swatch" style="background:${meta.color}"></span>
        <span class="district-pill__text">
          <strong>${meta.shortName}</strong>
          <small>${count} частей</small>
        </span>
      `;

      button.addEventListener('click', () => {
        selectDistrict(key);
      });

      elements.districtList.append(button);
    });
  }

  function renderSummary(unitsSubset) {
    const summary = getSummary(unitsSubset);
    const cards = [
      { label: 'Воинские части', value: numberFormatter.format(summary.count) },
      { label: 'Личный состав', value: `${numberFormatter.format(summary.personnel)} чел.` },
      { label: 'Средняя готовность', value: `${summary.readinessAverage}%` },
      { label: 'Гарнизоны', value: numberFormatter.format(summary.garrisons) }
    ];

    elements.summaryStrip.innerHTML = cards
      .map(
        (card) => `
          <article class="metric-tile">
            <span>${card.label}</span>
            <strong>${card.value}</strong>
          </article>
        `
      )
      .join('');
  }

  function renderUnitList(unitsSubset) {
    const ordered = [...unitsSubset].sort((left, right) => right.readiness - left.readiness);
    elements.unitsCount.textContent = `${ordered.length} записей`;
    elements.unitsList.innerHTML = '';
    ordered.forEach((unit) => {
      const meta = districtMeta[unit.districtKey] || {};
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'unit-row';
      item.dataset.id = unit.id;

      if (state.selectedUnitId === unit.id) {
        item.classList.add('is-active');
      }

      item.innerHTML = `
        <span class="unit-row__accent" style="background:${meta.color}"></span>
        <span class="unit-row__body">
          <span class="unit-row__heading">
            <strong>${unit.name}</strong>
            <small>${unit.readiness}%</small>
          </span>
          <span class="unit-row__meta">${unit.city} · ${unit.specialization}</span>
          <span class="unit-row__meta">${unit.garrison}</span>
        </span>
      `;

      item.addEventListener('click', () => focusUnit(unit.id));
      elements.unitsList.append(item);

      if (state.selectedUnitId === unit.id) {
        window.requestAnimationFrame(() => {
          item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
      }
    });
  }

  function renderUnitTable(unitsSubset) {
    const table = document.createElement('div');
    table.className = 'units-table';
    table.innerHTML = `
      <div class="units-table__head">
        <span>Часть</span>
        <span>Город</span>
        <span>Гарнизон</span>
        <span>Готовность</span>
      </div>
      <div class="units-table__body"></div>
    `;

    const body = table.querySelector('.units-table__body');

    unitsSubset.forEach((unit) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'units-table__row';
      row.dataset.id = unit.id;

      if (state.selectedUnitId === unit.id) {
        row.classList.add('is-active');
      }

      row.innerHTML = `
        <span><strong>${unit.name}</strong></span>
        <span>${unit.city}</span>
        <span>${unit.garrison}</span>
        <span>${unit.readiness}%</span>
      `;

      row.addEventListener('click', () => focusUnit(unit.id));
      body.append(row);

      if (state.selectedUnitId === unit.id) {
        window.requestAnimationFrame(() => {
          row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
      }
    });

    elements.unitsList.append(table);
  }

  function renderSelectionPanel(unitsSubset) {
    if (state.selectedUnitId) {
      const unit = units.find((entry) => entry.id === state.selectedUnitId);
      const rank = unit.rank || unit.curatorRank || 'Не указано';
      const fio = unit.fio || unit.curatorName || 'Не указано';

      elements.selectionPanelTag.textContent = 'часть';
      elements.selectionPanelTitle.textContent = `${unit.name} · ${unit.city}`;
      elements.selectionPanelText.textContent = `${unit.prosecutor}. ${rank}, ${fio}. Телефон для связи: ${unit.phone}.`;
      elements.selectionPanelMeta.innerHTML = `
        <div><span>Гарнизон</span><strong>${unit.garrison}</strong></div>
        <div><span>Готовность</span><strong>${unit.readiness}%</strong></div>
        <div><span>Проверка</span><strong>${unit.lastInspection}</strong></div>
      `;
      elements.selectionActionPrimary.textContent = 'Открыть на карте';
      elements.selectionActionSecondary.textContent = 'Снять выбор';
      return;
    }

    if (state.selectedDistrict) {
      const meta = districtMeta[state.selectedDistrict];
      const summary = getSummary(unitsSubset);
      elements.selectionPanelTag.textContent = 'округ';
      elements.selectionPanelTitle.textContent = meta.name;
      elements.selectionPanelText.textContent = `${meta.summary} Опорный центр: ${meta.hub}. В текущую выборку включены все объекты округа.`;
      elements.selectionPanelMeta.innerHTML = `
        <div><span>Части</span><strong>${summary.count}</strong></div>
        <div><span>Прокуратуры</span><strong>${summary.prosecutors}</strong></div>
        <div><span>Личный состав</span><strong>${numberFormatter.format(summary.personnel)} чел.</strong></div>
      `;
      elements.selectionActionPrimary.textContent = 'Показать округ';
      elements.selectionActionSecondary.textContent = 'Сбросить фильтр';
      return;
    }

    elements.selectionPanelTag.textContent = 'навигация';
    elements.selectionPanelTitle.textContent = 'Общий обзор';
    elements.selectionPanelText.textContent =
      'Выберите округ или часть на карте, либо воспользуйтесь поиском, чтобы быстро перейти к нужному объекту без ручного просмотра всего списка.';
    elements.selectionPanelMeta.innerHTML = `
      <div><span>Округа</span><strong>${Object.keys(districtMeta).length}</strong></div>
      <div><span>Объекты</span><strong>${units.length}</strong></div>
      <div><span>Поиск</span><strong>по номеру, городу, гарнизону</strong></div>
    `;
    elements.selectionActionPrimary.textContent = 'Обзор карты';
    elements.selectionActionSecondary.textContent = 'Сбросить';
  }

  function renderInspector(unitsSubset) {
    const summary = getSummary(unitsSubset);

    if (state.selectedUnitId) {
      const unit = units.find((entry) => entry.id === state.selectedUnitId);
      const meta = districtMeta[unit.districtKey] || {};
      const fio = unit.fio || unit.curatorName || 'Не указано';
      elements.inspectorTitle.textContent = `${unit.name} · ${unit.city}`;
      elements.inspectorText.textContent = `${meta.name}. Прокурорское сопровождение: ${unit.prosecutor}. Ответственное лицо: ${fio}.`;
      elements.inspectorMetrics.innerHTML = `
        <div><span>Личный состав</span><strong>${numberFormatter.format(unit.personnel)} чел.</strong></div>
        <div><span>Готовность</span><strong>${unit.readiness}%</strong></div>
        <div><span>ФИО</span><strong>${fio}</strong></div>
        <div><span>Проверка</span><strong>${unit.lastInspection}</strong></div>
      `;
      return;
    }

    if (state.selectedDistrict) {
      const meta = districtMeta[state.selectedDistrict];
      const cities = [...new Set(unitsSubset.map((unit) => unit.city))].slice(0, 3).join(', ');
      elements.inspectorTitle.textContent = meta.name;
      elements.inspectorText.textContent = `${meta.summary} Опорный центр: ${meta.hub}. Ключевой профиль: ${meta.profile.toLowerCase()}.`;
      elements.inspectorMetrics.innerHTML = `
        <div><span>Части</span><strong>${summary.count}</strong></div>
        <div><span>Личный состав</span><strong>${numberFormatter.format(summary.personnel)} чел.</strong></div>
        <div><span>Средняя готовность</span><strong>${summary.readinessAverage}%</strong></div>
        <div><span>Ключевые города</span><strong>${cities}</strong></div>
      `;
      return;
    }

    elements.inspectorTitle.textContent = 'Все федеральные округа';
    elements.inspectorText.textContent =
      'Карта сфокусирована на территории России и отображает окружную структуру размещения объектов учета без дробления на уровень отдельных регионов.';
    elements.inspectorMetrics.innerHTML = `
      <div><span>Округа</span><strong>${Object.keys(districtMeta).length}</strong></div>
      <div><span>Воинские части</span><strong>${summary.count}</strong></div>
      <div><span>Военные прокуратуры</span><strong>${summary.prosecutors}</strong></div>
      <div><span>Средняя готовность</span><strong>${summary.readinessAverage}%</strong></div>
    `;
  }

  function renderStatus(unitsSubset) {
    if (state.selectedUnitId) {
      const unit = units.find((entry) => entry.id === state.selectedUnitId);
      elements.selectionStatus.textContent = `Фокус: ${unit.name} · ${unit.city}`;
      return;
    }

    if (state.selectedDistrict) {
      elements.selectionStatus.textContent = `Показан ${districtMeta[state.selectedDistrict].shortName}`;
      return;
    }

    elements.selectionStatus.textContent = `Показаны все округа · ${unitsSubset.length} объектов`;
  }

  function refreshDistrictStyles() {
    districtLayer.setStyle((feature) => getDistrictStyle(feature));

    districtLayers.forEach((layer, key) => {
      if (state.selectedDistrict === key) {
        layer.bringToFront();
        return;
      }

      layer.bringToBack();
    });
  }

  function refreshDistrictLabels() {
    districtLabels.forEach((label, key) => {
      const labelElement = label.getElement();
      if (!labelElement) {
        return;
      }

      const isActive = state.selectedDistrict === key;
      const isDimmed = Boolean(state.selectedDistrict) && !isActive;
      labelElement.classList.toggle('is-active', isActive);
      labelElement.classList.toggle('is-dimmed', isDimmed);
    });
  }

  function refreshMarkers(unitsSubset) {
    markerLayer.clearLayers();
    const visibleIds = new Set(unitsSubset.map((unit) => unit.id));

    markersById.forEach((marker, id) => {
      const unit = units.find((entry) => entry.id === id);
      marker.setStyle(getMarkerStyle(unit));
      if (visibleIds.has(id)) {
        markerLayer.addLayer(marker);
        marker.bringToFront();
      }
    });
  }

  function updateTopChips() {
    elements.districtsChip.textContent = `${Object.keys(districtMeta).length} федеральных округов`;
    elements.unitsChip.textContent = `${units.length} объектов в реестре`;
  }

  function syncInterface() {
    const filteredUnits = getFilteredUnits();
    refreshDistrictStyles();
    refreshDistrictLabels();
    refreshMarkers(filteredUnits);
    renderDistrictFilters();
    renderSelectionPanel(filteredUnits);
    renderSummary(filteredUnits);
    renderUnitList(filteredUnits);
    renderInspector(filteredUnits);
    renderStatus(filteredUnits);
    updateTopChips();
    updateFilterSelection();
  }

  function updateFilterSelection() {
    elements.districtList.querySelectorAll('.district-pill').forEach((button) => {
      const key = button.dataset.key;
      const isActive = key ? key === state.selectedDistrict : !state.selectedDistrict;
      button.classList.toggle('is-active', isActive);
    });
  }

  function focusUnit(id) {
    const unit = units.find((entry) => entry.id === id);

    if (!unit) {
      showToast('Не удалось открыть карточку выбранной части.');
      return;
    }

    state.selectedDistrict = unit.districtKey;
    state.selectedUnitId = id;
    elements.searchSuggestions.innerHTML = '';
    elements.searchSuggestions.classList.remove('is-visible');
    syncInterface();

    const marker = markersById.get(id);
    map.closePopup();
    map.flyTo([unit.lat, unit.lng], 5.6, { duration: 0.95 });

    window.setTimeout(() => {
      marker.openPopup();
    }, 260);
  }

  function zoomToCurrentSelection() {
    if (state.selectedDistrict && districtBounds.has(state.selectedDistrict)) {
      map.flyToBounds(districtBounds.get(state.selectedDistrict), {
        padding: getBoundsPadding(true),
        maxZoom: 5.8,
        duration: 0.95
      });
      return;
    }

    map.flyToBounds(overallBounds, {
      padding: getBoundsPadding(),
      maxZoom: 4.3,
      duration: 0.95
    });
  }

  function getBoundsPadding(isDistrictView = false) {
    const isMobile = window.innerWidth < 760;
    if (isMobile) {
      return isDistrictView ? [28, 28] : [20, 20];
    }

    return isDistrictView ? [34, 34] : [26, 26];
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('is-visible');

    if (state.toastTimer) {
      window.clearTimeout(state.toastTimer);
    }

    state.toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove('is-visible');
    }, 3200);
  }
})();
