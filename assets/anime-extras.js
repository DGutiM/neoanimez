// Optional static data: nothing here blocks catalogue, account or progress loading.
let animeExtrasIndexPromise = null;
const animeExtrasBlocks = new Map();
let animeExtrasRenderToken = 0;

async function loadAnimeExtrasIndex() {
  if (!animeExtrasIndexPromise) {
    animeExtrasIndexPromise = fetchCatalogJson(withCatalogVersion('anime-extras-index.json'), { preferCache: true, timeout: 7000 })
      .then(index => {
        if (index?.version !== 1 || !Array.isArray(index.files) || !index.entries) throw new Error('Índice de extras no válido');
        return index;
      }).catch(error => { animeExtrasIndexPromise = null; throw error; });
  }
  return animeExtrasIndexPromise;
}

async function loadAnimeExtraBlock(index, id) {
  const entry = index.entries[String(id)];
  const file = index.files[entry?.block];
  if (!/^anime-extras\/extras-\d{2}\.json$/.test(file || '')) throw new Error('Bloque de extras no válido');
  if (!animeExtrasBlocks.has(file)) {
    const promise = fetchCatalogJson(withCatalogVersion(file), { preferCache: true, timeout: 8000 })
      .then(payload => {
        if (payload?.version !== 1 || !payload.entries) throw new Error('Extras no válidos');
        return payload;
      }).catch(error => { animeExtrasBlocks.delete(file); throw error; });
    animeExtrasBlocks.set(file, promise);
  }
  const payload = await animeExtrasBlocks.get(file);
  const result = payload.entries[String(id)];
  if (Number(result?.mal_id) !== id) throw new Error('La ficha de extras no coincide');
  return result;
}

function extraSourceFooter(id, resource) {
  const date = new Date(resource?.fetched_at || '');
  const stamp = Number.isNaN(date.getTime()) ? '' : ` · ${date.toLocaleDateString('es-ES')}`;
  return `<div class="extra-source"><a href="https://myanimelist.net/anime/${id}" target="_blank" rel="noopener noreferrer">Fuente: MyAnimeList</a>${escapeHtml(stamp)}</div>`;
}

async function renderAnimeExtras(anime) {
  const container = document.getElementById('animeExtras');
  if (!container) return;
  const id = Number(anime?.mal_id);
  const token = ++animeExtrasRenderToken;
  container.hidden = true;
  container.replaceChildren();
  const isCurrent = () => token === animeExtrasRenderToken && Number(currentModalAnime?.mal_id) === id;
  try {
    const index = await loadAnimeExtrasIndex();
    if (!isCurrent()) return;
    const flags = index.entries[String(id)];
    if (!flags) return;
    for (const [kind, title] of [['recommendations', 'Si te gustó este anime'], ['episodes', 'Guía de episodios'], ['themes', 'Openings y endings']]) {
      if (!flags[kind]) continue;
      const details = document.createElement('details');
      details.className = `anime-extra-section extra-${kind}`;
      details.dataset.extra = kind;
      const summary = document.createElement('summary');
      summary.textContent = title;
      const body = document.createElement('div');
      body.className = 'anime-extra-content';
      details.append(summary, body);
      let loaded = false;
      let busy = false;
      const load = async () => {
        if (loaded || busy || !details.open || !isCurrent()) return;
        busy = true;
        body.textContent = 'Cargando…';
        body.setAttribute('aria-busy', 'true');
        try {
          const extras = await loadAnimeExtraBlock(index, id);
          if (!isCurrent()) return;
          if (kind === 'recommendations') renderRelatedAnime(body, extras.recommendations, id);
          if (kind === 'episodes') renderEpisodeGuide(body, extras.episodes, id);
          if (kind === 'themes') renderAnimeSongs(body, extras.themes, id);
          loaded = true;
        } catch {
          if (!isCurrent()) return;
          body.innerHTML = '<span>No disponible en este momento.</span> <button class="load-retry-btn" type="button">Reintentar</button>';
          body.querySelector('button').addEventListener('click', load);
        } finally {
          busy = false;
          body.removeAttribute('aria-busy');
        }
      };
      details.addEventListener('toggle', load);
      container.appendChild(details);
    }
    container.hidden = !container.childElementCount;
  } catch {
    if (!isCurrent()) return;
    container.hidden = false;
    container.innerHTML = '<div class="extra-source">Extras no disponibles. <button type="button" class="load-retry-btn">Reintentar</button></div>';
    container.querySelector('button').addEventListener('click', () => renderAnimeExtras(anime));
  }
}

function renderRelatedAnime(body, resource, id) {
  const seen = new Set([id]);
  const items = (resource?.items || []).map(row => getAnimeById(Number(row.mal_id)))
    .filter(anime => {
      if (!anime || seen.has(anime.mal_id) || !isAnimeVisible(anime) || isUpcomingAnime(anime)) return false;
      seen.add(anime.mal_id);
      return true;
    }).slice(0, 6);
  body.innerHTML = '<div class="extra-related-grid"></div>';
  const grid = body.firstElementChild;
  items.forEach(anime => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'extra-related-card';
    const title = getAnimeDisplayTitle(anime);
    card.innerHTML = `<img src="${EMPTY_IMAGE}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml([anime.year, formatAnimeTimelineType(anime.type)].filter(Boolean).join(' · '))}</small></span>`;
    card.addEventListener('click', () => openAnimeModal(anime));
    grid.appendChild(card);
    loadAnimeImageElement(card.querySelector('img'), anime, 0);
  });
  if (!items.length) grid.textContent = 'No hay recomendaciones disponibles en el catálogo.';
  body.insertAdjacentHTML('beforeend', extraSourceFooter(id, resource));
}

function episodeMark(episode) {
  if (episode.filler === true && episode.recap === true) return { kind: 'filler', label: 'Relleno / resumen' };
  if (episode.filler === true) return { kind: 'filler', label: 'Relleno' };
  if (episode.recap === true) return { kind: 'recap', label: 'Resumen' };
  return { kind: 'unmarked', label: episode.filler === false && episode.recap === false ? 'Sin marca' : 'Sin datos' };
}

function renderEpisodeGuide(body, resource, id) {
  const rows = resource?.items || [];
  body.innerHTML = `
    <div class="extra-guide-controls">
      <label>Tipo<select data-episode-filter><option value="all">Todos</option><option value="filler">Relleno</option><option value="recap">Resumen</option></select></label>
      <label>Tramo<select data-episode-page></select></label>
    </div>
    <p class="extra-guide-note">Marcas de MyAnimeList. «Sin marca» no significa canon.</p>
    <div class="extra-guide-count" role="status"></div>
    <ol class="extra-episode-grid" aria-label="Episodios"></ol>
    ${extraSourceFooter(id, resource)}`;
  const filter = body.querySelector('[data-episode-filter]');
  const page = body.querySelector('[data-episode-page]');
  const grid = body.querySelector('ol');
  let filtered = rows;
  const draw = () => {
    const offset = Number(page.value) || 0;
    const progress = Number(getDisplayProgress(getAnimeById(id), userAnimeMap.get(id))?.episode_number) || 0;
    grid.innerHTML = filtered.slice(offset, offset + 50).map(episode => {
      const mark = episodeMark(episode);
      return `<li class="episode-${mark.kind}${episode.number === progress ? ' episode-current' : ''}" aria-label="Episodio ${episode.number}: ${mark.label}${episode.number === progress ? ', tu progreso' : ''}"><strong>${episode.number}</strong><span>${mark.label}</span></li>`;
    }).join('');
    body.querySelector('.extra-guide-count').textContent = filtered.length
      ? `${filtered.length} episodios${resource.coverage === 'partial' ? ' · cobertura parcial' : ''}`
      : 'Sin episodios con esta marca.';
  };
  const reset = () => {
    filtered = rows.filter(row => filter.value === 'all' || row[filter.value] === true);
    page.replaceChildren();
    for (let offset = 0; offset < filtered.length; offset += 50) {
      const option = document.createElement('option');
      option.value = String(offset);
      option.textContent = `${filtered[offset].number}–${filtered[Math.min(offset + 49, filtered.length - 1)].number}`;
      page.appendChild(option);
    }
    page.disabled = filtered.length <= 50;
    draw();
  };
  filter.addEventListener('change', reset);
  page.addEventListener('change', draw);
  reset();
}

function renderAnimeSongs(body, resource, id) {
  const groups = [['openings', 'Aperturas'], ['endings', 'Cierres']];
  body.innerHTML = '<div class="extra-song-columns">' + groups.map(([kind, label]) => {
    const songs = resource?.[kind] || [];
    if (!songs.length) return '';
    return `<section><h3>${label}</h3><ol>${songs.map(song => `<li><strong>${escapeHtml(song.title)}</strong>${song.artist ? `<span>${escapeHtml(song.artist)}</span>` : ''}${song.episodes ? `<small>Episodios ${escapeHtml(song.episodes)}</small>` : ''}</li>`).join('')}</ol></section>`;
  }).join('') + '</div>' + extraSourceFooter(id, resource);
}

function readSharedSagaId(href = window.location.href) {
  try {
    const raw = new URL(href).searchParams.get('saga') || '';
    return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : 0;
  } catch { return 0; }
}

function getSagaShareLink(id) {
  if (!Number.isSafeInteger(id) || id <= 0) return '';
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('saga', String(id));
  return url.href;
}

async function shareAnimeSaga() {
  const link = getSagaShareLink(activeAnimeTimelineCurrentId);
  const feedback = document.getElementById('sagaShareFeedback');
  const input = document.getElementById('sagaShareLink');
  if (!link || !feedback || !input) return;
  input.value = link;
  input.hidden = true;
  try {
    await navigator.clipboard.writeText(link);
    feedback.textContent = 'Enlace copiado';
  } catch {
    feedback.textContent = 'Enlace del mapa';
    input.hidden = false;
    input.focus({ preventScroll: true });
    input.select();
  }
}

async function openSharedSagaRoute(id = readSharedSagaId()) {
  if (!id) return;
  const anime = getAnimeById(id);
  showScreen('search');
  if (!anime || !isAnimeVisible(anime)) {
    const notice = document.getElementById('searchResultsSummary');
    if (notice) notice.textContent = 'La saga compartida no está disponible en el catálogo visible.';
    return;
  }
  openAnimeModal(anime);
  await openAnimeTimeline(anime);
}

function clearSharedSagaRoute() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('saga')) return;
  url.searchParams.delete('saga');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
