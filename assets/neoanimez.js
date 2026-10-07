if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
  document.documentElement.classList.add('standalone-ios');
  document.addEventListener('DOMContentLoaded', () => document.body.classList.add('standalone-ios'));
}

let DB = [];
const RANKING_DATA = [
  {"title": "One Piece", "mal_id": 21},
  {"title": "Hajime no Ippo", "mal_id": 263},
  {"title": "Dragon Ball Z", "mal_id": 813},
  {"title": "Attack on Titan", "mal_id": 16498},
  {"title": "Naruto", "mal_id": 20},
  {"title": "Rurouni Kenshin", "mal_id": 45},
  {"title": "Hunter x Hunter (2011)", "mal_id": 11061},
  {"title": "Death Note", "mal_id": 1535},
  {"title": "Frieren", "mal_id": 52991},
  {"title": "Demon Slayer", "mal_id": 38000}
];

const imgCache = {};
const imgRequests = {};
const imageProbeCache = {};
const imageResolveRequests = {};
const imageLoadQueue = [];
const IMAGE_LOAD_TIMEOUT = 8500;
const IMAGE_RETRY_DELAY = 1600;
const MAX_PARALLEL_IMAGE_LOADS = 4;
let activeImageLoads = 0;
let imageObserver = null;
const TITLE_TO_MAL_ID = {
  'Demon Slayer': 38000,
  'Kimetsu no Yaiba': 38000,
  'Attack on Titan': 16498,
  'Shingeki no Kyojin': 16498,
  'One Piece': 21,
  'Naruto': 20,
  'Death Note': 1535,
  'Frieren': 52991,
  'Hajime no Ippo': 263,
  'Dragon Ball Z': 813,
  'Rurouni Kenshin': 45,
  'Hunter x Hunter (2011)': 11061
};

const BLANK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='50' height='70'%3E%3Crect width='50' height='70' fill='%23141426'/%3E%3Ctext x='50%25' y='55%25' text-anchor='middle' fill='%236b6b8a' font-size='22'%3E%F0%9F%8E%8C%3C/text%3E%3C/svg%3E";
const EMPTY_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const SUPABASE_URL = 'https://edygetjrdnbziidcmuww.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FhmkdfUHZ_KO17VcpoTBAA_nwEXJI5k';
const AUTH_REDIRECT_URL = 'https://neoanimez.com';
const ANALYTICS_ID = 'G-SF806D05CQ';
const COOKIE_CONSENT_KEY = 'neoanimez_cookie_consent_v1';
const TITLE_DISPLAY_MODE_KEY = 'neoanimez_title_display_mode_v1';
const ADULT_CONTENT_KEY = 'neoanimez_adult_content_v1';
const APP_VERSION = '20261007-monthly-data';
const CATALOG_VERSION = APP_VERSION;
const CATALOG_DETAIL_BLOCKS = 24;
const CATALOG_INDEX_URL = `anime-index.json?v=${CATALOG_VERSION}`;
const CATALOG_FALLBACK_URL = `anime-lista.json?v=${CATALOG_VERSION}`;
const UPCOMING_URL = `anime-upcoming.json?v=${CATALOG_VERSION}`;
const SCHEDULE_URL = `anime-schedule.json?v=${CATALOG_VERSION}`;
const NEWS_URL = `anime-news.json?v=${CATALOG_VERSION}`;
const RELATIONS_URL = `anime-relations.json?v=${CATALOG_VERSION}`;
const TIMELINE_INDEX_URL = `anime-timeline-index.json?v=${CATALOG_VERSION}`;
const PUBLIC_PROFILE_SLUG_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;
const SUPABASE_LOCK_TIMEOUT_MS = 4500;
const SUPABASE_PROJECT_REF = (() => {
  try {
    return new URL(SUPABASE_URL).hostname.split('.')[0] || '';
  } catch {
    return '';
  }
})();
const SUPABASE_AUTH_STORAGE_KEY = SUPABASE_PROJECT_REF ? `sb-${SUPABASE_PROJECT_REF}-auth-token` : '';

async function supabaseAuthLock(name, acquireTimeout, fn) {
  if (!navigator.locks?.request) return fn();

  const timeout = Math.min(
    Math.max(Number(acquireTimeout) > 0 ? Number(acquireTimeout) : SUPABASE_LOCK_TIMEOUT_MS, 1200),
    SUPABASE_LOCK_TIMEOUT_MS
  );
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeout) {
    try {
      const result = await navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) return { locked: false };
        return { locked: true, value: await fn() };
      });
      if (result?.locked) return result.value;
    } catch (error) {
      lastError = error;
      break;
    }
    await sleep(120);
  }

  console.warn('Supabase auth lock agotado; continuamos sin bloqueo del navegador.', name, lastError || '');
  return fn();
}

function createNeoAnimeSupabaseClient() {
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      lock: supabaseAuthLock,
      lockAcquireTimeout: SUPABASE_LOCK_TIMEOUT_MS
    }
  });
}

const supabaseClient = createNeoAnimeSupabaseClient();
const STATUS_LABELS = {
  pending: 'Pendientes',
  watching: 'En progreso',
  completed: 'Completados',
  dropped: 'Droppeados'
};
const STATUS_ORDER = ['watching', 'completed', 'pending', 'dropped'];
const RESULTS_PAGE_SIZE = 20;
const COMMUNITY_PRIOR_SCORE = 7;
const COMMUNITY_PRIOR_WEIGHT = 20;
const ARCADE_DEFAULT_GAME_KEY = 'neonave_dash';
const ARCADE_GAMES = {
  neonave_dash: {
    key: 'neonave_dash',
    kind: 'ship',
    kicker: 'NeoNave Dash',
    title: 'Pilota la N',
    action: 'Impulsar',
    startTitle: 'Toca para despegar',
    startSub: 'Móvil: toca la pantalla. Ordenador: clic, espacio o flecha arriba.',
    instructions: 'Pilota la nave para cruzar portales y recoger orbes. Cada portal suma 1 punto y cada orbe suma 2. Si tocas un borde o una sombra, termina la partida.'
  },
  neorunner_rush: {
    key: 'neorunner_rush',
    kind: 'runner',
    kicker: 'NeoRunner Rush',
    title: 'Salta el Rift',
    action: 'Saltar',
    startTitle: 'Toca para correr',
    startSub: 'Corre solo: tú solo decides cuándo saltar.',
    instructions: 'El runner avanza siempre. Toca para saltar prismas, recoge núcleos de neón y aguanta cada vez más velocidad. Si chocas, termina la partida.'
  }
};
const ARCADE_LOCAL_BEST_KEY = 'neoanimez_arcade_neowave_best_v1';
const ARCADE_PLAYER_KEY = 'neoanimez_arcade_player_key_v1';
let currentUser = null;
let currentModalAnime = null;
let currentRecommendationReason = '';
let userAnimeMap = new Map();
let userStatusUpdatedMap = new Map();
let userRatingMap = new Map();
let userProgressMap = new Map();
let userDataOwnerId = '';
let userPublicProfile = null;
let communityRatingMap = new Map();
let communityRankingMode = 'selection';
let upcomingAnimeMap = new Map();
let upcomingPayload = null;
let activeScreenName = 'intro';
let lastScreenName = 'intro';
let needsCatalogReset = false;
let needsSearchReset = false;
let isCleaningHeavyResults = false;
let isPasswordRecoveryFlow = false;
let pendingAuthNotice = '';
let ratingsFeatureAvailable = true;
let progressFeatureAvailable = true;
let publicProfileFeatureAvailable = true;
let communityFeatureAvailable = true;
let userAnimeBundleFeatureAvailable = true;
let communityRole = '';
let communityAdminTab = 'list';
let communityBoardLoaded = false;
let activeCommunityThread = null;
let communityThreads = [];
let communityReplies = [];
let animeSchedulePayload = null;
let animeScheduleLoaded = false;
let monthlyNewsPayload = null;
let monthlyNewsLoaded = false;
let userScheduleMode = 'mine';
let userScheduleSelectedDateKey = '';
let userScheduleSelectedMonthKey = '';
let arcadeScores = [];
let arcadeFeatureAvailable = true;
let arcadeGame = null;
let arcadeAnimationFrame = 0;
let arcadeLastFrame = 0;
let arcadeCanvasInitialized = false;
let arcadeSubmitting = false;
let activeArcadeGameKey = ARCADE_DEFAULT_GAME_KEY;
let catalogResultsCache = [];
let catalogVisibleCount = 0;
let searchResultsCache = [];
let searchVisibleCount = 0;
let titleSearchDebounce = null;
let analyticsLoaded = false;
let titleDisplayMode = readTitleDisplayMode();
let adultContentEnabled = readAdultContentPreference();
let splitCatalogEnabled = false;
let animeRelationsLoaded = false;
let animeRelationsLoadPromise = null;
const animeRelationsMap = new Map();
let animeTimelineIndexLoaded = false;
let animeTimelineIndexLoadPromise = null;
let animeTimelineFiles = [];
const animeTimelineNavigationMap = new Map();
const animeTimelineBlockCache = new Map();
let activeAnimeTimeline = null;
let activeAnimeTimelineNodes = new Map();
let activeAnimeTimelineCurrentId = 0;
let activeAnimeTimelineDisplayEdges = [];
let activeAnimeTimelineNarrativeIds = new Set();
let activeAnimeRouteChoice = null;
let animeTimelineMode = 'continuity';
let animeTimelineDrawFrame = 0;
let animeTimelineResizeTimer = 0;
const screenScrollPositions = {};
const detailBlockCache = new Map();
const detailBlockRequests = new Map();
const animeDetailCache = new Map();

window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}


const SUPABASE_TIMEOUT_MS = 9000;
const SUPABASE_RETRY_DELAY_MS = 650;
const supabaseLocks = new Set();
let resumeRefreshTimer = null;
let resumeRefreshRunning = false;
let lastResumeRefreshAt = 0;
let lastAppHiddenAt = 0;
let lastSupabaseWriteWakeAt = 0;
let supabaseWriteWakePromise = null;
let pendingWriteSyncTimer = null;
let pendingWriteSyncRunning = false;
let communityThreadRetryTimer = null;
let communityReplyRetryTimer = null;
let communityRatingsRetryTimer = null;
let clientEventLoggingAvailable = true;
const clientEventLogTimes = new Map();

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') return;

  const register = () => {
    navigator.serviceWorker.register(`service-worker.js?v=${APP_VERSION}`)
      .then(registration => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      })
      .catch(error => {
        console.warn('No se pudo activar la caché de app:', error);
      });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

registerServiceWorker();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeClientEventMessage(error) {
  const message = String(error?.message || error || '').replace(/\s+/g, ' ').trim();
  return message.slice(0, 500);
}

function logClientEvent(eventType, label, error = '', meta = {}) {
  if (!clientEventLoggingAvailable || !supabaseClient?.rpc) return;
  const safeLabel = String(label || 'unknown').slice(0, 160);
  const throttleKey = `${eventType}:${safeLabel}`;
  const now = Date.now();
  if (now - (clientEventLogTimes.get(throttleKey) || 0) < 60000) return;
  clientEventLogTimes.set(throttleKey, now);

  const payload = {
    p_event_type: String(eventType || 'client_event').slice(0, 80),
    p_label: safeLabel,
    p_message: normalizeClientEventMessage(error),
    p_app_version: APP_VERSION,
    p_screen: activeScreenName || '',
    p_is_online: navigator.onLine,
    p_visibility_state: document.visibilityState || '',
    p_meta: meta && typeof meta === 'object' ? meta : {}
  };

  Promise.resolve(
    supabaseClient.rpc('log_client_event', payload)
  ).then(({ error: rpcError }) => {
    if (rpcError && isMissingSupabaseResourceError(rpcError)) clientEventLoggingAvailable = false;
  }).catch(error => {
    if (isMissingSupabaseResourceError(error)) clientEventLoggingAvailable = false;
  });
}

async function withTimeout(promise, ms = SUPABASE_TIMEOUT_MS, label = 'operación') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function safeSupabase(label, operation, options = {}) {
  const {
    timeout = SUPABASE_TIMEOUT_MS,
    retries = 1,
    retryDelay = SUPABASE_RETRY_DELAY_MS
  } = options;

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await withTimeout(operation(), timeout, label);
      if (result?.error) throw result.error;
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`[Supabase:${label}] intento ${attempt + 1}/${retries + 1} fallido`, error);
      if (attempt < retries) await sleep(retryDelay);
    }
  }

  logClientEvent('supabase_error', label, lastError, {
    attempts: retries + 1,
    timeout,
    transient: isTransientSupabaseError(lastError),
    missing_resource: isMissingSupabaseResourceError(lastError)
  });
  throw lastError;
}

async function refreshSupabaseSessionForWrite(label = 'auth.refreshSession.write') {
  const { data } = await safeSupabase(
    label,
    () => supabaseClient.auth.refreshSession(),
    { timeout: 7500, retries: 0 }
  );
  const user = data?.session?.user || null;
  if (user?.id) {
    setCurrentUser(user);
    return user;
  }
  return null;
}

async function ensureSupabaseWriteReady() {
  if (!navigator.onLine) throw new Error('neoanimez_offline');
  if (supabaseWriteWakePromise) return supabaseWriteWakePromise;

  supabaseWriteWakePromise = (async () => {
    let session = null;
    let sessionError = null;

    try {
      const { data } = await safeSupabase(
        'auth.getSession.write',
        () => supabaseClient.auth.getSession(),
        { timeout: 5500, retries: 0 }
      );
      session = data?.session || null;
    } catch (error) {
      sessionError = error;
      if (!isTransientSupabaseError(error)) throw error;
    }

    let user = session?.user || currentUser || readStoredSupabaseUser();
    const expiresAtMs = Number(session?.expires_at) * 1000;
    const sessionIsExpiring = Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() < 120000;
    const recentlyResumed = lastAppHiddenAt > 0 && Date.now() - lastAppHiddenAt < 180000;
    const writeWakeIsOld = Date.now() - lastSupabaseWriteWakeAt > 45000;
    const needsResumeRefresh = recentlyResumed && Date.now() - lastSupabaseWriteWakeAt > 10000;
    const shouldRefresh = !session?.user || sessionIsExpiring || needsResumeRefresh || writeWakeIsOld || !!sessionError;

    if (shouldRefresh) {
      try {
        user = await refreshSupabaseSessionForWrite() || user;
      } catch (error) {
        if (!user?.id || !isTransientSupabaseError(error)) throw error;
        scheduleResumeRefresh(1200);
      }
    }

    if (!user?.id) throw new Error('Auth session missing');
    setCurrentUser(user);
    hydrateCachedUserAnimeData(user.id);
    lastSupabaseWriteWakeAt = Date.now();
    return user;
  })();

  try {
    return await supabaseWriteWakePromise;
  } finally {
    supabaseWriteWakePromise = null;
  }
}

async function safeSupabaseMutation(label, operation, options = {}) {
  const {
    timeout = 10000,
    retries = 1,
    retryDelay = SUPABASE_RETRY_DELAY_MS
  } = options;

  await ensureSupabaseWriteReady();

  try {
    return await safeSupabase(label, operation, { timeout, retries, retryDelay });
  } catch (error) {
    if (!isTransientSupabaseError(error)) throw error;
    await refreshSupabaseSessionForWrite(`${label}.refresh`);
    return safeSupabase(`${label}.retry`, operation, { timeout, retries: 0, retryDelay });
  }
}

async function runLocked(lockKey, task) {
  if (supabaseLocks.has(lockKey)) return null;
  supabaseLocks.add(lockKey);
  try {
    return await task();
  } finally {
    supabaseLocks.delete(lockKey);
  }
}

function setElementsBusy(selector, busy) {
  document.querySelectorAll(selector).forEach(el => {
    el.disabled = !!busy;
    el.classList.toggle('is-saving', !!busy);
  });
}

function setButtonBusy(button, busy, busyText = '', idleText = '') {
  if (!button) return;
  if (!button.dataset.idleText) button.dataset.idleText = button.textContent || '';
  button.disabled = !!busy;
  button.style.opacity = busy ? '0.7' : '';
  button.textContent = busy ? (busyText || button.dataset.idleText) : (idleText || button.dataset.idleText);
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isTimeoutError(error) {
  return String(error?.message || '').includes('timeout:');
}

function isMissingSupabaseResourceError(error) {
  const text = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  return code === '42P01' ||
    code === 'PGRST202' ||
    text.includes('does not exist') ||
    text.includes('could not find the table') ||
    text.includes('could not find the function') ||
    text.includes('schema cache');
}

function isTransientSupabaseError(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return isTimeoutError(error) ||
    !navigator.onLine ||
    text.includes('failed to fetch') ||
    text.includes('load failed') ||
    text.includes('network') ||
    text.includes('connection') ||
    text.includes('abort') ||
    text.includes('temporarily');
}

function userFacingSupabaseError(error, fallback = 'No se pudo completar la operación.') {
  const text = String(error?.message || error || '').toLowerCase();
  if (!navigator.onLine || text.includes('neoanimez_offline')) return 'No hay conexión. Inténtalo cuando vuelva internet.';
  if (isTimeoutError(error)) return 'La conexión tardó demasiado. Vuelve a intentarlo.';
  return formatAuthError(error?.message || fallback);
}

function readCookieConsent() {
  try {
    return localStorage.getItem(COOKIE_CONSENT_KEY) || '';
  } catch {
    return '';
  }
}

function writeCookieConsent(value) {
  try {
    localStorage.setItem(COOKIE_CONSENT_KEY, value);
  } catch {}
}

function readTitleDisplayMode() {
  try {
    const value = localStorage.getItem(TITLE_DISPLAY_MODE_KEY);
    return ['original', 'english', 'spanish'].includes(value) ? value : 'original';
  } catch {
    return 'original';
  }
}

function readAdultContentPreference() {
  try {
    return localStorage.getItem(ADULT_CONTENT_KEY) === 'enabled';
  } catch {
    return false;
  }
}

function isAdultAnime(anime = {}) {
  const values = [
    ...(Array.isArray(anime.genres) ? anime.genres : []),
    ...(Array.isArray(anime.explicit_genres) ? anime.explicit_genres : []),
    ...(Array.isArray(anime.source_tags_original) ? anime.source_tags_original : []),
    anime.rating
  ]
    .filter(Boolean)
    .map(value => String(value).trim().toLowerCase());

  return values.some(value => value === 'hentai' || value.includes('rx - hentai'));
}

function isAnimeVisible(anime = {}) {
  return adultContentEnabled || !isAdultAnime(anime);
}

function updateAdultContentUI() {
  const toggle = document.getElementById('adultContentToggle');
  const feedback = document.getElementById('adultContentFeedback');
  if (toggle) toggle.checked = adultContentEnabled;

  document.querySelectorAll('option[data-adult-only]').forEach(option => {
    option.hidden = !adultContentEnabled;
    option.disabled = !adultContentEnabled;
  });

  if (!adultContentEnabled) {
    document.querySelectorAll('.genre-select').forEach(select => {
      if (select.value === 'Hentai') select.value = '';
    });
  }

  if (feedback) {
    const adultCount = DB.filter(isAdultAnime).length;
    feedback.textContent = adultContentEnabled
      ? `Contenido 18+ visible${adultCount ? ` · ${adultCount} títulos` : ''}.`
      : 'Contenido 18+ oculto en toda la web.';
  }
}

function refreshAdultContentSurfaces() {
  const hadCatalogResults = catalogResultsCache.length > 0;
  const query = document.getElementById('titleSearchInput')?.value?.trim() || '';

  catalogResultsCache = [];
  searchResultsCache = [];
  if (hadCatalogResults) applyFilters().catch(error => console.warn('No se pudo refrescar el catálogo:', error));
  if (query.length >= 2) performTitleSearch();
  renderCommunityRanking();
  if (upcomingPayload) loadUpcomingRanking().catch(error => console.warn('No se pudo refrescar Más esperados:', error));
  renderUserLists();
}

function setAdultContentEnabled(enabled, { confirmAge = true } = {}) {
  const shouldEnable = !!enabled;
  if (shouldEnable && confirmAge) {
    const confirmed = window.confirm('Confirma que tienes al menos 18 años para mostrar contenido adulto.');
    if (!confirmed) {
      updateAdultContentUI();
      return false;
    }
  }

  adultContentEnabled = shouldEnable;
  try {
    localStorage.setItem(ADULT_CONTENT_KEY, shouldEnable ? 'enabled' : 'disabled');
  } catch {}

  if (!shouldEnable) {
    if (activeAnimeTimeline) closeAnimeTimeline();
    if (activeAnimeRouteChoice) closeAnimeRouteChooser();
    if (currentModalAnime && isAdultAnime(currentModalAnime)) closeAnimeModal();
  }

  updateAdultContentUI();
  refreshAdultContentSurfaces();
  return true;
}

function getAnimeDisplayTitle(anime = {}) {
  if (titleDisplayMode === 'spanish') {
    return anime.title_es || anime.title || anime.title_english || 'Anime';
  }
  if (titleDisplayMode === 'english') {
    return anime.title_english || anime.title || anime.title_es || 'Anime';
  }
  return anime.title || anime.title_english || anime.title_es || 'Anime';
}

function getAnimePreferredTitle(anime = {}) {
  if (titleDisplayMode === 'spanish') {
    return anime.title_es || anime.title || anime.title_english || 'Anime';
  }
  if (titleDisplayMode === 'english') {
    return anime.title_english || anime.title || anime.title_es || 'Anime';
  }
  return anime.title || anime.title_english || anime.title_es || 'Anime';
}

function updateTitleModeUI() {
  document.querySelectorAll('[data-title-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.titleMode === titleDisplayMode);
  });
}

function toggleTitleLanguagePanel(forceOpen = null) {
  const panel = document.getElementById('titleLanguagePanel');
  const toggle = document.getElementById('titleLanguageToggle');
  if (!panel || !toggle) return;
  const shouldOpen = forceOpen === null ? panel.classList.contains('hidden') : !!forceOpen;
  panel.classList.toggle('hidden', !shouldOpen);
  toggle.setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen && currentUser) loadMyPublicProfile({ silent: true });
}

function toggleUserSettingsPanel(forceOpen = null) {
  const panel = document.getElementById('userSettingsPanel');
  const toggle = document.getElementById('userSettingsToggle');
  if (!panel || !toggle) return;
  const shouldOpen = forceOpen === null ? panel.classList.contains('hidden') : !!forceOpen;
  panel.classList.toggle('hidden', !shouldOpen);
  toggle.setAttribute('aria-expanded', String(shouldOpen));
}

function refreshVisibleAnimeTitles() {
  document.querySelectorAll('.fcard[data-anime-id]').forEach(card => {
    const anime = getAnimeById(Number(card.dataset.animeId));
    const titleEl = card.querySelector('.fcard-title');
    const imgEl = card.querySelector('.fcard-img');
    if (!anime) return;
    const displayTitle = getAnimeDisplayTitle(anime);
    if (titleEl) titleEl.textContent = displayTitle;
    if (imgEl) imgEl.alt = displayTitle;
  });

  document.querySelectorAll('.rcard[data-anime-id]').forEach(card => {
    const anime = getAnimeById(Number(card.dataset.animeId));
    const titleEl = card.querySelector('.rtitle, .upcoming-title');
    const imgEl = card.querySelector('.rimg');
    if (!anime) return;
    const displayTitle = getAnimeDisplayTitle(anime);
    if (titleEl) titleEl.textContent = displayTitle;
    if (imgEl) imgEl.alt = displayTitle;
  });

  if (currentModalAnime) {
    const title = document.getElementById('animeModalTitle');
    if (title) title.textContent = getAnimeDisplayTitle(currentModalAnime);
    renderAnimeRelations(currentModalAnime);
  }
  if (activeAnimeTimeline) {
    const currentNode = activeAnimeTimelineNodes.get(activeAnimeTimelineCurrentId);
    const timelineTitle = document.getElementById('animeTimelineTitle');
    if (timelineTitle && currentNode) timelineTitle.textContent = `Mapa de ${getAnimeTimelineNodeTitle(currentNode)}`;
    renderAnimeTimelineGraph();
  }
}

function setTitleDisplayMode(mode) {
  if (!['original', 'english', 'spanish'].includes(mode)) return;
  titleDisplayMode = mode;
  try {
    localStorage.setItem(TITLE_DISPLAY_MODE_KEY, mode);
  } catch {}
  updateTitleModeUI();
  refreshVisibleAnimeTitles();
  renderUserLists();
  toggleTitleLanguagePanel(false);
}

function loadAnalytics() {
  if (analyticsLoaded || !ANALYTICS_ID) return;
  analyticsLoaded = true;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ANALYTICS_ID)}`;
  document.head.appendChild(script);

  gtag('js', new Date());
  gtag('config', ANALYTICS_ID);
}

function hideCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  banner?.classList.remove('show');
  document.body.classList.remove('cookie-banner-visible');
  document.documentElement.style.setProperty('--cookie-banner-height', '0px');
}

function syncCookieBannerLayout() {
  const banner = document.getElementById('cookieBanner');
  const visible = !!banner?.classList.contains('show');
  document.body.classList.toggle('cookie-banner-visible', visible);
  document.documentElement.style.setProperty(
    '--cookie-banner-height',
    visible ? `${Math.ceil(banner.getBoundingClientRect().height)}px` : '0px'
  );
}

function showCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  if (!banner) return;
  banner.classList.add('show');
  syncCookieBannerLayout();
  window.requestAnimationFrame(syncCookieBannerLayout);
}

function setCookieConsent(value) {
  writeCookieConsent(value);
  hideCookieBanner();
  if (value === 'accepted') loadAnalytics();
}

function initCookieBanner() {
  const consent = readCookieConsent();
  if (consent === 'accepted') {
    loadAnalytics();
    return;
  }
  if (consent === 'rejected') return;

  showCookieBanner();
  document.getElementById('cookieAcceptBtn')?.addEventListener('click', () => setCookieConsent('accepted'));
  document.getElementById('cookieRejectBtn')?.addEventListener('click', () => setCookieConsent('rejected'));
  window.addEventListener('resize', syncCookieBannerLayout, { passive: true });
}

const APP_STATE_KEY = 'neoanimez_app_state_v2';
const MOBILE_INTRO_SESSION_KEY = 'neoanimez_mobile_intro_seen_session_v1';
const USER_DATA_CACHE_PREFIX = 'neoanimez_user_data_v1:';
const PENDING_WRITES_CACHE_PREFIX = 'neoanimez_pending_writes_v1:';
const COMMUNITY_RATINGS_CACHE_KEY = 'neoanimez_community_ratings_v1';
const COMMUNITY_THREADS_CACHE_KEY = 'neoanimez_community_threads_v1';
const AUTH_FLASH_MESSAGE_KEY = 'neoanimez_auth_flash_message';
const APP_DEFAULT_STATE = {
  introDismissed: false,
  activeScreen: 'intro'
};
const PASSWORD_SUCCESS_MESSAGE_KEY = 'neoanimez_password_success_message';
function readAppState() {
  try {
    const raw = localStorage.getItem(APP_STATE_KEY);
    if (!raw) return { ...APP_DEFAULT_STATE };
    return { ...APP_DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...APP_DEFAULT_STATE };
  }
}

function writeAppState(patch = {}) {
  try {
    const next = { ...readAppState(), ...patch };
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return { ...APP_DEFAULT_STATE, ...patch };
  }
}

function isMobileExperience() {
  return window.matchMedia('(max-width: 720px)').matches ||
    /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || '');
}

function hasSeenIntroInCurrentMobileSession() {
  if (!isMobileExperience()) return true;
  try {
    return sessionStorage.getItem(MOBILE_INTRO_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markIntroSeenInCurrentMobileSession() {
  if (!isMobileExperience()) return;
  try {
    sessionStorage.setItem(MOBILE_INTRO_SESSION_KEY, '1');
  } catch {}
}

function shouldRestoreSavedAppScreen(savedAppState, passwordJustUpdated = false) {
  if (passwordJustUpdated) return false;
  if (!savedAppState?.introDismissed) return false;
  if (!['filter', 'ranking', 'user', 'search', 'info'].includes(savedAppState.activeScreen)) return false;
  return hasSeenIntroInCurrentMobileSession();
}

function readStoredSupabaseUser() {
  if (!SUPABASE_AUTH_STORAGE_KEY) return null;
  try {
    const raw = localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const candidates = [
      parsed,
      parsed?.currentSession,
      parsed?.session,
      Array.isArray(parsed) ? parsed[0] : null
    ].filter(Boolean);
    for (const candidate of candidates) {
      const user = candidate?.user;
      if (user?.id) return user;
    }
  } catch {}
  return null;
}

function readJsonCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonCache(key, payload) {
  try {
    localStorage.setItem(key, JSON.stringify({
      saved_at: new Date().toISOString(),
      ...payload
    }));
    return true;
  } catch (error) {
    console.warn('No se pudo guardar una caché local:', error);
    return false;
  }
}

function getUserDataCacheKey(userId = currentUser?.id) {
  return userId ? `${USER_DATA_CACHE_PREFIX}${userId}` : '';
}

function getPendingWritesCacheKey(userId = currentUser?.id) {
  return userId ? `${PENDING_WRITES_CACHE_PREFIX}${userId}` : '';
}

function serializeProgressValue(value = {}) {
  return {
    season_number: Number(value.season_number) || 1,
    episode_number: Number(value.episode_number) || 0,
    total_episodes: Number(value.total_episodes) || null,
    updated_at: value.updated_at || value.client_updated_at || null,
    order_hint: Number.isFinite(Number(value.order_hint)) ? Number(value.order_hint) : null
  };
}

function resetUserAnimeData() {
  userAnimeMap = new Map();
  userStatusUpdatedMap = new Map();
  userRatingMap = new Map();
  userProgressMap = new Map();
}

function setCurrentUser(user) {
  const nextUser = user || null;
  const nextUserId = nextUser?.id || '';
  currentUser = nextUser;
  if (userDataOwnerId !== nextUserId) {
    userDataOwnerId = nextUserId;
    resetUserAnimeData();
    if (nextUserId) hydrateCachedUserAnimeData(nextUserId);
  }
}

function readCachedUserAnimeData(userId = currentUser?.id) {
  const key = getUserDataCacheKey(userId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function hydrateCachedUserAnimeData(userId = currentUser?.id) {
  const cached = readCachedUserAnimeData(userId);
  if (!cached) return false;

  userAnimeMap = new Map((cached.statuses || []).map(([animeId, status]) => [Number(animeId), status]));
  userStatusUpdatedMap = new Map((cached.statuses || [])
    .map(([animeId, , updatedAt]) => [Number(animeId), updatedAt || null])
    .filter(([, updatedAt]) => !!updatedAt));
  userRatingMap = new Map((cached.ratings || []).map(([animeId, rating]) => [Number(animeId), Number(rating)]));
  userProgressMap = new Map((cached.progress || []).map(([animeId, progress]) => [Number(animeId), serializeProgressValue(progress)]));
  renderUserLists();
  return true;
}

function persistCachedUserAnimeData() {
  const key = getUserDataCacheKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      saved_at: new Date().toISOString(),
      statuses: Array.from(userAnimeMap.entries()).map(([animeId, status]) => [animeId, status, userStatusUpdatedMap.get(Number(animeId)) || null]),
      ratings: Array.from(userRatingMap.entries()),
      progress: Array.from(userProgressMap.entries()).map(([animeId, progress]) => [animeId, serializeProgressValue(progress)])
    }));
  } catch (error) {
    console.warn('No se pudo guardar la caché local de tu lista:', error);
  }
}

function readPendingWrites(userId = currentUser?.id) {
  const key = getPendingWritesCacheKey(userId);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingWrites(items, userId = currentUser?.id) {
  const key = getPendingWritesCacheKey(userId);
  if (!key) return false;
  try {
    localStorage.setItem(key, JSON.stringify(items));
    return true;
  } catch (error) {
    console.warn('No se pudo guardar la cola local de Supabase:', error);
    return false;
  }
}

function getPendingWriteGroup(item = {}) {
  const animeId = Number(item.payload?.anime_id) || 0;
  if (item.type?.startsWith('status_')) return `status:${animeId}`;
  if (item.type?.startsWith('rating_')) return `rating:${animeId}`;
  if (item.type?.startsWith('progress_')) return `progress:${animeId}`;
  return `${item.type || 'write'}:${animeId}:${item.id || ''}`;
}

function enqueuePendingWrite(type, payload = {}) {
  const userId = payload.user_id || currentUser?.id;
  if (!userId) return false;
  const item = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    payload: { ...payload, user_id: userId },
    created_at: new Date().toISOString()
  };
  const group = getPendingWriteGroup(item);
  const next = readPendingWrites(userId).filter(existing => getPendingWriteGroup(existing) !== group);
  next.push(item);
  writePendingWrites(next.slice(-80), userId);
  schedulePendingWriteSync(1800);
  return true;
}

async function applyPendingWrite(item) {
  const payload = item?.payload || {};
  if (!payload.user_id || !payload.anime_id) return true;

  if (item.type === 'status_upsert') {
    await safeSupabaseMutation(
      'pending.user_anime_status.upsert',
      () => supabaseClient
        .from('user_anime_status')
        .upsert(payload, { onConflict: 'user_id,anime_id' }),
      { timeout: 10000, retries: 1 }
    );
    return true;
  }

  if (item.type === 'status_delete') {
    await safeSupabaseMutation(
      'pending.user_anime_status.delete',
      () => supabaseClient
        .from('user_anime_status')
        .delete()
        .eq('user_id', payload.user_id)
        .eq('anime_id', payload.anime_id),
      { timeout: 10000, retries: 1 }
    );
    return true;
  }

  if (item.type === 'rating_upsert') {
    await safeSupabaseMutation(
      'pending.user_anime_ratings.upsert',
      () => supabaseClient
        .from('user_anime_ratings')
        .upsert(payload, { onConflict: 'user_id,anime_id' }),
      { timeout: 10000, retries: 1 }
    );
    return true;
  }

  if (item.type === 'rating_delete') {
    await safeSupabaseMutation(
      'pending.user_anime_ratings.delete',
      () => supabaseClient
        .from('user_anime_ratings')
        .delete()
        .eq('user_id', payload.user_id)
        .eq('anime_id', payload.anime_id),
      { timeout: 10000, retries: 1 }
    );
    return true;
  }

  if (item.type === 'progress_upsert') {
    await safeSupabaseMutation(
      'pending.user_anime_progress.upsert',
      () => supabaseClient
        .from('user_anime_progress')
        .upsert(payload, { onConflict: 'user_id,anime_id' }),
      { timeout: 10000, retries: 1 }
    );
    return true;
  }

  if (item.type === 'progress_delete') {
    await safeSupabaseMutation(
      'pending.user_anime_progress.delete',
      () => supabaseClient
        .from('user_anime_progress')
        .delete()
        .eq('user_id', payload.user_id)
        .eq('anime_id', payload.anime_id),
      { timeout: 10000, retries: 1 }
    );
    return true;
  }

  return true;
}

async function processPendingWrites({ silent = true } = {}) {
  if (pendingWriteSyncRunning || !currentUser?.id || !navigator.onLine) return false;
  const userId = currentUser.id;
  const pending = readPendingWrites(userId);
  if (!pending.length) return true;

  pendingWriteSyncRunning = true;
  const remaining = [];
  try {
    for (const item of pending) {
      try {
        await applyPendingWrite(item);
      } catch (error) {
        if (isTransientSupabaseError(error)) {
          remaining.push(item);
          continue;
        }
        logClientEvent('pending_write_dropped', item.type, error, {
          anime_id: Number(item.payload?.anime_id) || 0
        });
      }
    }
    writePendingWrites(remaining, userId);
    if (remaining.length) {
      schedulePendingWriteSync(5000);
      return false;
    }
    if (!silent) setModalStatusMessage('Cambios sincronizados.', 'success');
    await refreshUserAnimeData({ silent: true });
    return true;
  } finally {
    pendingWriteSyncRunning = false;
  }
}

function schedulePendingWriteSync(delay = 2500) {
  clearTimeout(pendingWriteSyncTimer);
  if (!navigator.onLine || document.visibilityState === 'hidden') return;
  pendingWriteSyncTimer = setTimeout(() => {
    processPendingWrites({ silent: true }).catch(error => {
      console.warn('No se pudo sincronizar la cola local:', error);
      if (isTransientSupabaseError(error)) schedulePendingWriteSync(6000);
    });
  }, delay);
}

function keepOptimisticWriteOnTransient(error, type, payload, setMessage, successMessage) {
  if (!isTransientSupabaseError(error)) return false;
  enqueuePendingWrite(type, payload);
  persistCachedUserAnimeData();
  renderUserLists();
  if (typeof setMessage === 'function') {
    setMessage(successMessage || 'Guardado en este dispositivo. Se sincronizará cuando Supabase responda.', 'success');
  }
  return true;
}

function hydrateCachedCommunityRatings() {
  const cached = readJsonCache(COMMUNITY_RATINGS_CACHE_KEY);
  const ratings = Array.isArray(cached?.ratings) ? cached.ratings : [];
  if (!ratings.length) return false;
  communityRatingMap = new Map(ratings.map(([animeId, rating]) => [Number(animeId), {
    average: Number(rating?.average) || 0,
    count: Number(rating?.count) || 0,
    weighted: Number(rating?.weighted) || 0
  }]).filter(([, rating]) => Number.isFinite(rating.average) && Number.isFinite(rating.count) && rating.count > 0));
  renderCommunityRanking();
  return communityRatingMap.size > 0;
}

function persistCachedCommunityRatings() {
  writeJsonCache(COMMUNITY_RATINGS_CACHE_KEY, {
    ratings: Array.from(communityRatingMap.entries())
  });
}

function hydrateCachedCommunityThreads() {
  const cached = readJsonCache(COMMUNITY_THREADS_CACHE_KEY);
  const threads = Array.isArray(cached?.threads) ? cached.threads : [];
  if (!threads.length) return false;
  communityThreads = threads;
  renderCommunityThreads();
  return true;
}

function persistCachedCommunityThreads() {
  writeJsonCache(COMMUNITY_THREADS_CACHE_KEY, {
    threads: communityThreads
  });
}

function setAuthFlashMessage(message = '') {
  try {
    if (!message) sessionStorage.removeItem(AUTH_FLASH_MESSAGE_KEY);
    else sessionStorage.setItem(AUTH_FLASH_MESSAGE_KEY, message);
  } catch {}
}

function consumeAuthFlashMessage() {
  try {
    const message = sessionStorage.getItem(AUTH_FLASH_MESSAGE_KEY) || '';
    sessionStorage.removeItem(AUTH_FLASH_MESSAGE_KEY);
    return message;
  } catch {
    return '';
  }
}

function setPasswordSuccessMessage(message = '') {
  try {
    if (!message) sessionStorage.removeItem(PASSWORD_SUCCESS_MESSAGE_KEY);
    else sessionStorage.setItem(PASSWORD_SUCCESS_MESSAGE_KEY, message);
  } catch {}
}

function consumePasswordSuccessMessage() {
  try {
    const message = sessionStorage.getItem(PASSWORD_SUCCESS_MESSAGE_KEY) || '';
    sessionStorage.removeItem(PASSWORD_SUCCESS_MESSAGE_KEY);
    return message;
  } catch {
    return '';
  }
}

function renderIntroFlashMessage(messageOverride = '') {
  const introSub = document.querySelector('.intro-sub');
  if (!introSub) return;
  if (!introSub.dataset.defaultText) {
    introSub.dataset.defaultText = introSub.textContent || '';
  }
  const message = messageOverride || consumeAuthFlashMessage() || consumePasswordSuccessMessage();
  introSub.textContent = message || introSub.dataset.defaultText;
  introSub.style.color = message ? '#8ff0ff' : '';
}

function persistActiveScreen(name) {
  writeAppState({
    introDismissed: name !== 'intro',
    activeScreen: name || 'intro'
  });
}

function saveScreenScrollPosition(name = activeScreenName) {
  if (!name || name === 'intro') return;
  screenScrollPositions[name] = window.scrollY || document.documentElement.scrollTop || 0;
}

function restoreScreenScrollPosition(name, { instant = true } = {}) {
  if (!name || name === 'intro') return;
  const top = Number(screenScrollPositions[name]) || 0;
  const behavior = instant ? 'instant' : 'smooth';
  requestAnimationFrame(() => {
    window.scrollTo({ top, behavior });
  });
}

function resetAuthForms() {
  document.getElementById('loginForm')?.reset();
  document.getElementById('signupForm')?.reset();
  document.getElementById('changePasswordForm')?.reset();
}

async function forceLocalSignOut() {
  try {
    await supabaseClient.auth.signOut({ scope: 'local' });
  } catch (err) {
    console.error('Error al cerrar sesión localmente:', err);
  }

  setCurrentUser(null);
  isPasswordRecoveryFlow = false;
  toggleUserSettingsPanel(false);
  updateAccountModeUI();
  resetAuthForms();
  switchAuthTab('login');
  renderUserScreen();
  renderUserLists();
  updateUserTriggers();
}

function cleanupAuthRedirectUrl() {
  try {
    const currentUrl = new URL(window.location.href);
    const hadHashTokens = /access_token|refresh_token|type=/.test(currentUrl.hash || '');
    const hadQueryCode = currentUrl.searchParams.has('code');
    if (!hadHashTokens && !hadQueryCode) return;

    currentUrl.hash = '';
    currentUrl.searchParams.delete('code');
    currentUrl.searchParams.delete('type');
    currentUrl.searchParams.delete('token');
    currentUrl.searchParams.delete('token_hash');
    currentUrl.searchParams.delete('hash');
    currentUrl.searchParams.delete('error');
    currentUrl.searchParams.delete('error_code');
    currentUrl.searchParams.delete('error_description');
    window.history.replaceState({}, document.title, currentUrl.pathname + currentUrl.search);
  } catch {}
}

function getAuthUrlState() {
  try {
    const currentUrl = new URL(window.location.href);
    const hashParams = new URLSearchParams((currentUrl.hash || '').replace(/^#/, ''));
    const queryHashParams = new URLSearchParams((currentUrl.searchParams.get('hash') || '').replace(/^#/, ''));
    return {
      url: currentUrl,
      type: currentUrl.searchParams.get('type') || hashParams.get('type') || queryHashParams.get('type') || '',
      code: currentUrl.searchParams.get('code') || '',
      accessToken: hashParams.get('access_token') || queryHashParams.get('access_token') || '',
      refreshToken: hashParams.get('refresh_token') || queryHashParams.get('refresh_token') || ''
    };
  } catch {
    return { url: null, type: '', code: '', accessToken: '', refreshToken: '' };
  }
}

function isRecoveryUrl() {
  const state = getAuthUrlState();
  return state.type === 'recovery';
}

async function bootstrapAuthFromUrl() {
  const state = getAuthUrlState();
  let session = null;
  let recoveryDetected = state.type === 'recovery';
  const authRedirectDetected = !!(state.code || (state.accessToken && state.refreshToken));

  if (state.code) {
    const { data, error } = await supabaseClient.auth.exchangeCodeForSession(state.code);
    if (!error && data?.session) {
      session = data.session;
      recoveryDetected = recoveryDetected || data.session.user?.recovery_sent_at != null || state.type === 'recovery';
    } else if (error) {
      console.error('Error intercambiando code por sesión:', error);
    }
  }

  if (!session && state.accessToken && state.refreshToken) {
    const { data, error } = await supabaseClient.auth.setSession({
      access_token: state.accessToken,
      refresh_token: state.refreshToken
    });
    if (!error && data?.session) {
      session = data.session;
    } else if (error) {
      console.error('Error restaurando sesión desde hash:', error);
    }
  }

  if (recoveryDetected) {
    isPasswordRecoveryFlow = true;
  } else if (session && authRedirectDetected) {
    pendingAuthNotice = 'Email confirmado. Tu cuenta ya está activa en NeoAnimeZ.';
    setAuthFlashMessage(pendingAuthNotice);
  }

  return session;
}


function getAnimeById(animeId) {
  return DB.find(a => Number(a.mal_id) === Number(animeId)) || upcomingAnimeMap.get(Number(animeId)) || null;
}

function formatAuthError(message = '') {
  const text = String(message || '').trim();
  if (!text) return 'Ha ocurrido un error. Inténtalo otra vez.';
  if (text.toLowerCase().includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (text.toLowerCase().includes('email rate limit exceeded')) return 'Has intentado demasiadas veces. Espera un poco y vuelve a probar.';
  if (text.toLowerCase().includes('password should be at least 6 characters')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (text.toLowerCase().includes('user already registered')) return 'Ese correo ya está registrado.';
  if (text.toLowerCase().includes('auth session missing')) return 'La sesión de cambio de contraseña se perdió. Abre otra vez el enlace del correo o vuelve a iniciar sesión.';
  return text;
}

function setAuthFeedback(message = '', type = '') {
  ['authFeedback', 'accountFeedback'].forEach(id => {
    const box = document.getElementById(id);
    if (!box) return;
    box.textContent = message;
    box.className = 'auth-feedback';
    if (type) box.classList.add(type);
  });
}

function setModalStatusMessage(message = '', type = '') {
  const box = document.getElementById('modalStatusMessage');
  if (!box) return;
  box.textContent = message;
  box.className = 'modal-status-message';
  if (type) box.classList.add(type);
}

function updateAccountModeUI() {
  const title = document.getElementById('accountSettingsTitle');
  const helper = document.getElementById('accountHelper');
  const submitBtn = document.querySelector('#changePasswordForm button[type="submit"]');
  const passwordSection = document.getElementById('accountPasswordSection');
  if (!title || !helper || !submitBtn) return;

  if (isPasswordRecoveryFlow) {
    if (passwordSection) passwordSection.open = true;
    title.textContent = 'Restablecer contraseña';
    helper.textContent = 'Has entrado desde el correo de recuperación. Escribe una contraseña nueva y repítela para restablecer tu acceso.';
    submitBtn.textContent = 'Restablecer contraseña';
  } else {
    title.textContent = 'Cambiar contraseña';
    helper.textContent = 'Escribe una nueva contraseña y repítela para actualizar tu cuenta.';
    submitBtn.textContent = 'Guardar contraseña';
  }
}

async function getActiveSessionUser() {
  if (currentUser?.id) {
    return currentUser;
  }

  try {
    const { data: sessionData } = await safeSupabase(
      'auth.getSession',
      () => supabaseClient.auth.getSession(),
      { timeout: 6500, retries: 1 }
    );
    if (sessionData?.session?.user) {
      return sessionData.session.user;
    }
  } catch (sessionErr) {
    console.warn('No se pudo leer la sesión activa:', sessionErr);
  }

  const bootstrappedSession = await bootstrapAuthFromUrl();
  if (bootstrappedSession?.user) {
    return bootstrappedSession.user;
  }

  try {
    const { data: refreshedData } = await safeSupabase(
      'auth.refreshSession',
      () => supabaseClient.auth.refreshSession(),
      { timeout: 6500, retries: 1 }
    );
    if (refreshedData?.session?.user) {
      return refreshedData.session.user;
    }
  } catch (refreshErr) {
    console.error('Error refrescando sesión activa:', refreshErr);
  }

  try {
    const { data: finalSessionData } = await safeSupabase(
      'auth.getSession.final',
      () => supabaseClient.auth.getSession(),
      { timeout: 6500, retries: 0 }
    );
    return finalSessionData?.session?.user || null;
  } catch {
    return null;
  }
}

async function updatePasswordWithRecoveryFallback(newPassword) {
  let lastError = null;

  const tryUpdate = async () => {
    const result = await supabaseClient.auth.updateUser({ password: newPassword });
    if (result?.error) lastError = result.error;
    return result;
  };

  let result = await tryUpdate();
  if (!result?.error) return result;

  const errorText = String(result.error?.message || '').toLowerCase();
  const authState = getAuthUrlState();

  if (errorText.includes('auth session missing') || errorText.includes('session missing') || errorText.includes('jwt')) {
    if (authState.accessToken && authState.refreshToken) {
      try {
        const restored = await supabaseClient.auth.setSession({
          access_token: authState.accessToken,
          refresh_token: authState.refreshToken
        });
        if (!restored?.error && restored?.data?.session) {
          setCurrentUser(restored.data.session.user || currentUser);
          result = await tryUpdate();
          if (!result?.error) return result;
        }
      } catch (restoreErr) {
        console.error('Error reponiendo sesión desde hash antes de actualizar contraseña:', restoreErr);
      }
    }

    try {
      const refreshed = await supabaseClient.auth.refreshSession();
      if (!refreshed?.error && refreshed?.data?.session) {
        setCurrentUser(refreshed.data.session.user || currentUser);
        result = await tryUpdate();
        if (!result?.error) return result;
      }
    } catch (refreshErr) {
      console.error('Error refrescando sesión antes de actualizar contraseña:', refreshErr);
    }
  }

  return result?.error ? result : { data: null, error: lastError || new Error('unknown') };
}

function switchAuthTab(tab) {
  const loginTab = document.getElementById('authTabLogin');
  const signupTab = document.getElementById('authTabSignup');
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  if (!loginTab || !signupTab || !loginForm || !signupForm) return;
  const loginActive = tab !== 'signup';
  loginTab.classList.toggle('active', loginActive);
  signupTab.classList.toggle('active', !loginActive);
  loginForm.classList.toggle('hidden', !loginActive);
  signupForm.classList.toggle('hidden', loginActive);
  setAuthFeedback('');
}

function updateUserTriggers() {
  const navBtn = document.getElementById('nav-user');
  const tasteBtn = document.getElementById('tasteAnimeButton');
  if (currentUser) {
    navBtn?.classList.add('user-active');
    tasteBtn?.classList.remove('hidden');
  } else {
    navBtn?.classList.remove('user-active');
    tasteBtn?.classList.add('hidden');
  }
}

function updateModalStatusUI() {
  const buttons = document.querySelectorAll('[data-status-btn]');
  const statusBox = document.querySelector('.modal-status-box');
  const statusGrid = document.querySelector('.modal-status-grid');
  const statePill = document.getElementById('modalStatePill');
  const currentStatus = currentModalAnime ? userAnimeMap.get(Number(currentModalAnime.mal_id)) : null;
  const upcomingOnly = isUpcomingAnime(currentModalAnime);

  statusBox?.classList.toggle('upcoming-only', upcomingOnly);
  statusGrid?.classList.toggle('upcoming-only', upcomingOnly);
  buttons.forEach(btn => {
    const blocked = upcomingOnly && btn.dataset.statusBtn !== 'pending';
    btn.classList.toggle('active', btn.dataset.statusBtn === currentStatus);
    btn.disabled = blocked;
  });

  if (statePill) {
    STATUS_ORDER.forEach(statusName => statePill.classList.remove(`status-${statusName}`));
    if (currentModalAnime && currentUser && currentStatus && STATUS_LABELS[currentStatus]) {
      statePill.classList.remove('hidden');
      statePill.classList.add(`status-${currentStatus}`);
      statePill.innerHTML = `${buildStatusBadge(currentStatus, 'modal-status-mark')}<span>${STATUS_LABELS[currentStatus]}</span>`;
    } else {
      statePill.classList.add('hidden');
      statePill.innerHTML = '';
    }
  }

  if (!currentModalAnime) {
    statusBox?.classList.remove('hidden');
    setModalStatusMessage('Selecciona un anime.', '');
    return;
  }
  if (!currentUser) {
    statusBox?.classList.add('hidden');
    return;
  }

  statusBox?.classList.remove('hidden');
  if (currentStatus) {
    if (currentStatus === 'pending' && hasAnimePremiered(currentModalAnime)) {
      setModalStatusMessage('Este anime ya se estrenó. Pulsa En progreso cuando empieces a verlo.', 'success');
    } else {
      setModalStatusMessage(`Estado actual: ${STATUS_LABELS[currentStatus]}.`, 'success');
    }
  } else if (upcomingOnly) {
    setModalStatusMessage('Este estreno aún no está disponible: puedes guardarlo en Pendientes.', '');
  } else {
    setModalStatusMessage('Este anime todavía no está en tu lista.', '');
  }
}

function isUpcomingAnime(anime = null) {
  if (!anime) return false;
  const airingStatus = String(anime.airing_status || '').trim().toLowerCase();
  const premiereValue = anime.aired_from || anime.airing_start || anime.start_date || anime.premiere_date;
  const premiereTime = Date.parse(String(premiereValue || ''));
  if (anime.ongoing === true || airingStatus === 'currently airing' || airingStatus === 'finished airing') return false;
  // La fecha conocida manda sobre un estado remoto que puede tardar en actualizarse.
  if (Number.isFinite(premiereTime)) return premiereTime > Date.now();
  if (airingStatus === 'not yet aired') return true;
  const releaseYear = Number(anime.year || anime.upcoming_year);
  if (Number.isInteger(releaseYear) && releaseYear > new Date().getFullYear()) return true;
  return anime._update_status === 'jikan_upcoming' || !!anime.upcoming_season || !!anime.upcoming_year;
}

function hasAnimePremiered(anime = null) {
  return !!anime && !isUpcomingAnime(anime);
}

function setModalRatingMessage(message = '', type = '') {
  const box = document.getElementById('modalRatingMessage');
  if (!box) return;
  box.textContent = message;
  box.className = 'modal-tool-message';
  if (type) box.classList.add(type);
}

function setModalProgressMessage(message = '', type = '') {
  const box = document.getElementById('modalProgressMessage');
  if (!box) return;
  box.textContent = message;
  box.className = 'modal-tool-message';
  if (type) box.classList.add(type);
}

function getAnimeTotalEpisodes(anime = currentModalAnime) {
  if (hasOpenEpisodeCount(anime)) return null;
  const episodes = Number(anime?.episodes);
  return Number.isInteger(episodes) && episodes > 0 ? episodes : null;
}

function hasOpenEpisodeCount(anime = currentModalAnime) {
  const episodes = Number(anime?.episodes);
  return anime?.type === 'TV' && anime?.ongoing === true && (!Number.isFinite(episodes) || episodes <= 1);
}

function getAnimeEpisodeLabel(anime, { long = false } = {}) {
  if (anime?.type === 'Movie') return 'Película';
  if (hasOpenEpisodeCount(anime)) return 'En emisión';
  const total = getAnimeTotalEpisodes(anime);
  if (total) return long ? `${total} episodios` : `${total} ep`;
  return long ? 'Episodios sin confirmar' : '? ep';
}

function getProgressLabel(progress, anime = null) {
  if (!progress) return '';
  const episode = Number(progress.episode_number) || 0;
  const total = Number(progress.total_episodes) || getAnimeTotalEpisodes(anime);
  if (!episode) return '';
  if (!total) return `Episodio ${episode}`;
  return `${episode} / ${total} ep`;
}

function getProgressPercent(progress, anime = null) {
  if (!progress) return 0;
  const episode = Number(progress.episode_number) || 0;
  const total = Number(progress.total_episodes) || getAnimeTotalEpisodes(anime);
  if (!episode || !total) return 0;
  return Math.max(0, Math.min(100, Math.round((episode / total) * 100)));
}

function getStatusIconMarkup(status) {
  return {
    watching: `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="status-icon-fill" d="M8.3 5.4v13.2c0 .9 1 1.42 1.74.9l9.1-6.6a1.1 1.1 0 0 0 0-1.8l-9.1-6.6c-.74-.52-1.74 0-1.74.9Z"></path></svg>`,
    completed: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.6l4.1 4.1L19.5 6.5"></path></svg>`,
    pending: `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="status-icon-fill" d="M7 3h10a1.1 1.1 0 0 1 0 2.2h-.25c-.36 2.25-1.35 4.04-2.9 5.25 1.55 1.21 2.54 3 2.9 5.25H17A1.1 1.1 0 0 1 17 18H7a1.1 1.1 0 0 1 0-2.2h.25c.36-2.25 1.35-4.04 2.9-5.25-1.55-1.21-2.54-3-2.9-5.25H7A1.1 1.1 0 0 1 7 3Zm2.62 2.2c.34 1.7 1.18 3.02 2.38 3.82 1.2-.8 2.04-2.12 2.38-3.82H9.62Zm4.76 10.6c-.34-1.7-1.18-3.02-2.38-3.82-1.2.8-2.04 2.12-2.38 3.82h4.76Z"></path></svg>`,
    dropped: `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="status-icon-fill" d="M12 2.7c-4.55 0-8.05 3.2-8.05 7.55 0 2.72 1.28 4.8 3.44 6.12v2.06c0 1.58 1.23 2.87 2.75 2.87h3.72c1.52 0 2.75-1.29 2.75-2.87v-2.06c2.16-1.32 3.44-3.4 3.44-6.12 0-4.35-3.5-7.55-8.05-7.55Z"></path><circle class="status-icon-hole" cx="8.9" cy="10.5" r="1.75"></circle><circle class="status-icon-hole" cx="15.1" cy="10.5" r="1.75"></circle><path class="status-icon-hole" d="M12 13.45l1.36 2.1h-2.72L12 13.45Z"></path><rect class="status-icon-hole" x="9.6" y="17.45" width="4.8" height="1.25" rx=".45"></rect></svg>`
  }[status] || '';
}

function buildStatusBadge(status, extraClass = '') {
  const icon = getStatusIconMarkup(status);
  const label = STATUS_LABELS[status] || '';
  if (!icon || !label) return '';
  return `<span class="status-badge ${extraClass}" role="img" aria-label="${label}" title="${label}">${icon}</span>`;
}

function refreshAnimeStatusMarkers() {
  document.querySelectorAll('.fcard[data-anime-id]').forEach(card => {
    const animeId = Number(card.dataset.animeId);
    const status = userAnimeMap.get(animeId) || '';
    const hasStatus = !!STATUS_LABELS[status];
    card.classList.toggle('has-user-status', hasStatus);
    STATUS_ORDER.forEach(statusName => {
      card.classList.toggle(`status-${statusName}`, status === statusName);
    });

    const titleRow = card.querySelector('.fcard-title-row');
    const existing = card.querySelector('.fcard-status-mark');
    if (hasStatus && titleRow) {
      if (existing) existing.outerHTML = buildStatusBadge(status, 'fcard-status-mark');
      else titleRow.insertAdjacentHTML('beforeend', buildStatusBadge(status, 'fcard-status-mark'));
    } else if (existing) {
      existing.remove();
    }
  });
}

function getDisplayProgress(anime, status = null) {
  const animeId = Number(anime?.mal_id);
  const savedProgress = animeId ? userProgressMap.get(animeId) : null;
  const total = getAnimeTotalEpisodes(anime);

  if (status === 'completed' && total) {
    return {
      ...(savedProgress || {}),
      episode_number: total,
      total_episodes: total,
      derived_from_status: !savedProgress
    };
  }

  return savedProgress || null;
}

function confirmRemoveAnimeFromList(anime, status = '') {
  const title = getAnimeDisplayTitle(anime) || 'este anime';
  const statusLabel = STATUS_LABELS[status] ? ` de ${STATUS_LABELS[status]}` : ' de tu lista';
  return window.confirm(`¿Seguro que quieres quitar "${title}"${statusLabel}? Podrás volver a añadirlo después.`);
}

function updateModalRatingUI() {
  const ratingBox = document.getElementById('modalRatingBox');
  const buttons = document.querySelectorAll('[data-rating-btn]');
  const clearBtn = document.querySelector('.rating-clear-btn');
  const rating = currentModalAnime ? userRatingMap.get(Number(currentModalAnime.mal_id)) : null;

  buttons.forEach(btn => {
    const value = Number(btn.dataset.ratingBtn);
    btn.classList.toggle('active', Number(rating) === value);
    btn.disabled = !currentUser || !ratingsFeatureAvailable;
  });
  if (clearBtn) clearBtn.disabled = !currentUser || !ratingsFeatureAvailable || rating == null;

  if (!currentModalAnime || !currentUser || isUpcomingAnime(currentModalAnime)) {
    ratingBox?.classList.add('hidden');
    return;
  }

  ratingBox?.classList.remove('hidden');
  if (!ratingsFeatureAvailable) {
    setModalRatingMessage('Falta activar las puntuaciones en Supabase.', 'error');
  } else if (rating != null) {
    setModalRatingMessage(`Tu nota actual: ${Number(rating).toFixed(0)}/10.`, 'success');
  } else {
    setModalRatingMessage('Elige una nota del 1 al 10.');
  }
}

function updateModalProgressUI() {
  const progressBox = document.getElementById('modalProgressBox');
  const episodeInput = document.getElementById('modalProgressEpisode');
  const totalText = document.getElementById('modalProgressTotal');
  const saveBtn = document.querySelector('.progress-save-btn');
  const clearBtn = document.querySelector('.progress-clear-btn');
  const animeId = Number(currentModalAnime?.mal_id);
  const savedProgress = currentModalAnime ? userProgressMap.get(animeId) : null;
  const currentStatus = currentModalAnime ? userAnimeMap.get(animeId) : null;
  const progress = currentModalAnime ? getDisplayProgress(currentModalAnime, currentStatus) : null;
  const total = getAnimeTotalEpisodes(currentModalAnime);
  const canUseProgress = !!currentUser && !!currentModalAnime && currentModalAnime.type !== 'Movie' && !isUpcomingAnime(currentModalAnime);

  if (!canUseProgress) {
    progressBox?.classList.add('hidden');
    return;
  }

  progressBox?.classList.remove('hidden');
  if (episodeInput && document.activeElement !== episodeInput) {
    episodeInput.value = progress?.episode_number || '';
    if (total) episodeInput.max = String(total);
    else episodeInput.removeAttribute('max');
  }
  if (totalText) totalText.textContent = total ? `/ ${total}` : '';
  if (saveBtn) saveBtn.disabled = !progressFeatureAvailable;
  if (clearBtn) clearBtn.disabled = !progressFeatureAvailable || !savedProgress;

  if (!progressFeatureAvailable) {
    setModalProgressMessage('Falta activar el progreso en Supabase.', 'error');
  } else if (progress?.derived_from_status) {
    setModalProgressMessage(`Marcado como completado: ${getProgressLabel(progress, currentModalAnime)}.`, 'success');
  } else if (progress) {
    setModalProgressMessage(`Progreso guardado: ${getProgressLabel(progress, currentModalAnime)}.`, 'success');
  } else if (hasOpenEpisodeCount(currentModalAnime)) {
    setModalProgressMessage('Serie en emisión: guarda el episodio por el que vas.');
  } else {
    setModalProgressMessage(total ? `Este título tiene ${total} episodios registrados.` : 'Guarda por qué episodio vas.');
  }
}

function clampModalProgressInput({ forceMinimum = false } = {}) {
  const input = document.getElementById('modalProgressEpisode');
  if (!input) return;
  const raw = input.value;
  if (raw === '') return;
  let value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    input.value = '';
    return;
  }
  const total = getAnimeTotalEpisodes(currentModalAnime);
  if (total && value > total) value = total;
  if (forceMinimum && value < 1) value = 1;
  input.value = String(value);
}

function buildUserAnimeCard(anime, status) {
  const row = document.createElement('div');
  row.className = `user-anime-row status-${status}`;
  const animeId = Number(anime.mal_id);
  const displayTitle = getAnimeDisplayTitle(anime);
  const rating = userRatingMap.get(animeId);
  const progress = getDisplayProgress(anime, status);
  const extra = [
    rating != null ? `Nota ${Number(rating).toFixed(0)}/10` : '',
    status !== 'completed' && progress && !getAnimeTotalEpisodes(anime) ? getProgressLabel(progress, anime) : ''
  ].filter(Boolean).join(' · ');
  const progressPercent = getProgressPercent(progress, anime);
  const progressLabel = getProgressLabel(progress, anime);
  const showProgressBar = status !== 'completed' && progress && getAnimeTotalEpisodes(anime);
  const statusMark = buildStatusBadge(status, 'user-status-mark');
  const totalEpisodes = getAnimeTotalEpisodes(anime);
  const currentEpisode = Number(progress?.episode_number) || 0;
  const canAdjustEpisode =
    currentUser &&
    status !== 'completed' &&
    status !== 'dropped' &&
    anime.type !== 'Movie' &&
    !isUpcomingAnime(anime);
  const canIncrementEpisode =
    canAdjustEpisode &&
    (!totalEpisodes || currentEpisode < totalEpisodes);
  const canDecrementEpisode = canAdjustEpisode && currentEpisode > 0;
  const minusLabel = currentEpisode > 1
    ? `Restar a episodio ${currentEpisode - 1} en ${displayTitle}`
    : `Quitar progreso de episodios en ${displayTitle}`;
  const plusLabel = totalEpisodes
    ? `Sumar episodio ${Math.min(currentEpisode + 1, totalEpisodes)} de ${totalEpisodes} en ${displayTitle}`
    : `Sumar un episodio visto en ${displayTitle}`;
  const hasPremieredPending = status === 'pending' && hasAnimePremiered(anime);
  row.classList.toggle('has-premiered', hasPremieredPending);

  row.innerHTML = `
    ${status === 'watching' ? `<img class="user-anime-cover" src="${EMPTY_IMAGE}" alt="${escapeHtml(displayTitle)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
    <div class="user-anime-main">
      <div class="user-anime-title-row">
        <div class="user-anime-name">${displayTitle}</div>
        ${statusMark}
      </div>
      ${extra ? `<div class="user-anime-extra">${extra}</div>` : ''}
      ${hasPremieredPending ? `
        <div class="user-anime-release-row">
          <span class="user-anime-release-badge">Ya estrenado</span>
          <button type="button" class="user-start-watching-btn" aria-label="Empezar a ver ${escapeHtml(displayTitle)}">Empezar</button>
        </div>` : ''}
      ${showProgressBar ? `
        <div class="user-progress-line" aria-label="Progreso ${progressLabel}">
          <div class="user-progress-bar"><div class="user-progress-fill" style="width:${progressPercent}%"></div></div>
          <div class="user-progress-text">${progressLabel}</div>
        </div>` : ''}
    </div>
    <div class="user-row-actions">
      ${status !== 'completed' && status !== 'dropped' && anime.type !== 'Movie' && !isUpcomingAnime(anime) ? `
        <button type="button" class="user-episode-step-btn user-episode-minus-btn" aria-label="${minusLabel}" title="Restar episodio" ${canDecrementEpisode ? '' : 'disabled'}>-</button>
        <button type="button" class="user-episode-step-btn user-episode-plus-btn" aria-label="${plusLabel}" title="Sumar episodio" ${canIncrementEpisode ? '' : 'disabled'}>+</button>
      ` : ''}
      <button type="button" class="user-remove-btn" aria-label="Quitar ${displayTitle} de ${STATUS_LABELS[status]}">×</button>
    </div>
  `;

  row.addEventListener('click', () => {
    const imgNow = row.querySelector('.user-anime-cover')?.src || anime.image || BLANK;
    openAnimeModal(anime, imgNow);
  });

  if (status === 'watching') {
    loadAnimeImageElement(row.querySelector('.user-anime-cover'), anime, 0);
  }

  row.querySelector('.user-remove-btn')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (!confirmRemoveAnimeFromList(anime, status)) return;
    await clearAnimeStatus(anime);
  });

  row.querySelector('.user-episode-plus-btn')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await incrementAnimeProgress(anime);
  });

  row.querySelector('.user-episode-minus-btn')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await decrementAnimeProgress(anime);
  });

  row.querySelector('.user-start-watching-btn')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await saveAnimeStatus(anime, 'watching');
  });

  return row;
}

function getUserStatusCounts() {
  const counts = {
    watching: 0,
    completed: 0,
    pending: 0,
    dropped: 0
  };

  userAnimeMap.forEach((status, animeId) => {
    const anime = getAnimeById(animeId);
    if (!anime || !isAnimeVisible(anime)) return;
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
  });

  return counts;
}

function setDailyCount(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value || 0);
}

function getTimestamp(value) {
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

function getContinueWatchingItems(limit = 5) {
  return Array.from(userAnimeMap.entries())
    .filter(([, status]) => status === 'watching')
    .map(([animeId, status]) => {
      const anime = getAnimeById(animeId);
      if (!anime || !isAnimeVisible(anime)) return null;
      const progress = getDisplayProgress(anime, status);
      const episode = Number(progress?.episode_number) || 0;
      const progressUpdatedAt = progress?.updated_at || '';
      const statusUpdatedAt = userStatusUpdatedMap.get(Number(animeId)) || '';
      return {
        anime,
        status,
        progress,
        episode,
        percent: getProgressPercent(progress, anime),
        lastTouchedAt: Math.max(getTimestamp(progressUpdatedAt), getTimestamp(statusUpdatedAt)),
        orderHint: Number.isFinite(Number(progress?.order_hint)) ? Number(progress.order_hint) : 9999
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const touchedDiff = b.lastTouchedAt - a.lastTouchedAt;
      if (touchedDiff) return touchedDiff;
      const orderDiff = a.orderHint - b.orderHint;
      if (orderDiff) return orderDiff;
      return String(getAnimeDisplayTitle(a.anime)).localeCompare(String(getAnimeDisplayTitle(b.anime)), 'es', { sensitivity: 'base' });
    })
    .slice(0, limit);
}

function getSchedulePreviewDayLabel(dayKey) {
  const distance = getScheduleDayDistance(dayKey);
  if (distance === 0) return 'Hoy';
  if (distance === 1) return 'Mañana';
  return SCHEDULE_DAY_LABELS[dayKey] || 'Próximo';
}

function getUpcomingUserSchedulePreview(limit = 3) {
  const seen = new Set();
  return getPersonalScheduleEntries()
    .filter(entry => {
      if (!entry?.animeId || seen.has(entry.animeId)) return false;
      seen.add(entry.animeId);
      return true;
    })
    .sort((a, b) => {
      const dayDiff = getScheduleDayDistance(a.dayKey) - getScheduleDayDistance(b.dayKey);
      if (dayDiff) return dayDiff;
      const statusDiff = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      if (statusDiff) return statusDiff;
      return String(getAnimeDisplayTitle(a.anime)).localeCompare(String(getAnimeDisplayTitle(b.anime)), 'es', { sensitivity: 'base' });
    })
    .slice(0, limit);
}

function buildDailyContinueCard(item) {
  const anime = item.anime;
  const animeId = Number(anime.mal_id);
  const title = getAnimeDisplayTitle(anime);
  const progress = item.progress;
  const totalEpisodes = getAnimeTotalEpisodes(anime);
  const currentEpisode = Number(progress?.episode_number) || 0;
  const progressPercent = getProgressPercent(progress, anime);
  const progressLabel = getProgressLabel(progress, anime);
  const showProgressBar = progress && totalEpisodes;
  const canAdjustEpisode =
    currentUser &&
    anime.type !== 'Movie' &&
    !isUpcomingAnime(anime);
  const canIncrementEpisode = canAdjustEpisode && (!totalEpisodes || currentEpisode < totalEpisodes);
  const canDecrementEpisode = canAdjustEpisode && currentEpisode > 0;
  const minusLabel = currentEpisode > 1
    ? `Restar a episodio ${currentEpisode - 1} en ${title}`
    : `Quitar progreso de episodios en ${title}`;
  const plusLabel = totalEpisodes
    ? `Sumar episodio ${Math.min(currentEpisode + 1, totalEpisodes)} de ${totalEpisodes} en ${title}`
    : `Sumar un episodio visto en ${title}`;

  const card = document.createElement('div');
  card.className = 'daily-continue-card status-watching';
  card.dataset.animeId = String(animeId);
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Abrir ${title}`);
  card.innerHTML = `
    <img class="daily-continue-cover" src="${EMPTY_IMAGE}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
    <div class="daily-continue-main">
      <div class="daily-continue-title">${escapeHtml(title)}</div>
      <div class="daily-continue-meta">${escapeHtml(progressLabel || 'Sin episodio guardado')}</div>
      ${showProgressBar ? `
        <div class="daily-continue-progress" aria-label="Progreso ${escapeHtml(progressLabel)}">
          <div class="user-progress-bar"><div class="user-progress-fill" style="width:${progressPercent}%"></div></div>
          <div class="user-progress-text">${escapeHtml(progressLabel)}</div>
        </div>
      ` : ''}
    </div>
    <div class="daily-continue-actions">
      <button type="button" class="user-episode-step-btn user-episode-minus-btn" aria-label="${escapeHtml(minusLabel)}" title="Restar episodio" ${canDecrementEpisode ? '' : 'disabled'}>-</button>
      <button type="button" class="user-episode-step-btn user-episode-plus-btn" aria-label="${escapeHtml(plusLabel)}" title="Sumar episodio" ${canIncrementEpisode ? '' : 'disabled'}>+</button>
    </div>
  `;

  card.addEventListener('click', () => {
    const imgNow = card.querySelector('.daily-continue-cover')?.src || anime.image || BLANK;
    openAnimeModal(anime, imgNow);
  });

  card.addEventListener('keydown', (event) => {
    if (event.target.closest('button')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const imgNow = card.querySelector('.daily-continue-cover')?.src || anime.image || BLANK;
    openAnimeModal(anime, imgNow);
  });

  card.querySelector('.user-episode-plus-btn')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await incrementAnimeProgress(anime);
  });

  card.querySelector('.user-episode-minus-btn')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await decrementAnimeProgress(anime);
  });

  loadAnimeImageElement(card.querySelector('.daily-continue-cover'), anime, 0);
  return card;
}

function buildDailyScheduleCard(entry, index = 0) {
  const anime = entry.anime;
  const title = getAnimeDisplayTitle(anime);
  const broadcast = getScheduleBroadcastText(entry.item);
  const dayLabel = getSchedulePreviewDayLabel(entry.dayKey);
  const statusLabel = entry.status === 'pending' && hasAnimePremiered(anime)
    ? 'Ya estrenado'
    : (STATUS_LABELS[entry.status] || 'Mi lista');
  const meta = [dayLabel, broadcast].filter(Boolean).join(' · ');

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'daily-schedule-card';
  card.innerHTML = `
    <img class="daily-schedule-cover" src="${EMPTY_IMAGE}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
    <div class="daily-schedule-main">
      <div class="daily-schedule-title">${escapeHtml(title)}</div>
      <div class="daily-schedule-meta">${escapeHtml(meta || 'Emisión semanal')}</div>
    </div>
    <div class="daily-schedule-badge">${escapeHtml(statusLabel)}</div>
  `;

  card.addEventListener('click', () => {
    const imgNow = card.querySelector('.daily-schedule-cover')?.src || anime.image || BLANK;
    openAnimeModal(anime, imgNow);
  });

  loadAnimeImageElement(card.querySelector('.daily-schedule-cover'), anime, index * 25);
  return card;
}

function getStickyHeaderOffset(extra = 14) {
  const header = document.querySelector('header');
  const rect = header?.getBoundingClientRect();
  const bottom = rect && rect.bottom > 0 ? rect.bottom : 0;
  return Math.round(bottom + extra);
}

function scrollElementBelowStickyHeader(element, { behavior = 'smooth', extra = 14 } = {}) {
  if (!element) return;
  const top = element.getBoundingClientRect().top + window.scrollY - getStickyHeaderOffset(extra);
  window.scrollTo({
    top: Math.max(0, top),
    behavior
  });
}

function showAllWatchingFromDailyPanel() {
  const hub = document.getElementById('userAnimeHub');
  const accordion = document.getElementById('userWatchingAccordion') || document.querySelector('.user-list-accordion.status-watching');
  if (!accordion) return;
  if (hub) hub.open = true;
  accordion.open = true;
  window.requestAnimationFrame(() => {
    const summary = accordion.querySelector('summary');
    scrollElementBelowStickyHeader(summary || accordion, { extra: 16 });
    if (summary) {
      summary.tabIndex = -1;
      summary.focus({ preventScroll: true });
    }
  });
}

function renderUserDailyPanel() {
  const panel = document.getElementById('userDailyPanel');
  const continueSection = document.getElementById('dailyContinueSection');
  const scheduleSection = document.getElementById('dailyScheduleSection');
  const continueList = document.getElementById('dailyContinueList');
  const scheduleList = document.getElementById('dailyScheduleList');
  const showAllWatchingBtn = document.getElementById('dailyShowAllWatchingBtn');
  const empty = document.getElementById('dailyPanelEmpty');
  if (!panel) return;

  if (!currentUser) {
    panel.classList.add('hidden');
    if (continueList) continueList.innerHTML = '';
    if (scheduleList) scheduleList.innerHTML = '';
    showAllWatchingBtn?.classList.add('hidden');
    return;
  }

  const counts = getUserStatusCounts();
  const totalSaved = counts.watching + counts.completed + counts.pending + counts.dropped;
  setDailyCount('dailyCountWatching', counts.watching);
  setDailyCount('dailyCountPending', counts.pending);
  setDailyCount('dailyCountCompleted', counts.completed);
  setDailyCount('dailyCountDropped', counts.dropped);

  panel.classList.remove('hidden');

  const continueItems = getContinueWatchingItems(5);
  showAllWatchingBtn?.classList.toggle('hidden', counts.watching <= continueItems.length);
  if (continueList) {
    continueList.innerHTML = '';
    if (continueItems.length) {
      continueItems.forEach(item => continueList.appendChild(buildDailyContinueCard(item)));
    } else {
      continueList.innerHTML = '<div class="user-daily-soft-empty">Cuando tengas animes en progreso, aparecerán aquí para seguir rápido.</div>';
    }
  }
  continueSection?.classList.toggle('hidden', totalSaved === 0);

  const scheduleItems = animeSchedulePayload ? getUpcomingUserSchedulePreview(3) : [];
  if (scheduleList) {
    scheduleList.innerHTML = '';
    if (scheduleItems.length) {
      scheduleItems.forEach((entry, index) => scheduleList.appendChild(buildDailyScheduleCard(entry, index)));
    } else {
      const message = animeScheduleLoaded
        ? 'No hay emisiones próximas de tus animes en progreso o pendientes.'
        : 'Cargando emisiones de tu lista...';
      scheduleList.innerHTML = `<div class="user-daily-soft-empty">${message}</div>`;
    }
  }
  scheduleSection?.classList.toggle('hidden', totalSaved === 0);
  empty?.classList.toggle('hidden', totalSaved !== 0);
}

function normalizePublicSlug(value = '') {
  return normalizeLoose(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function getDefaultPublicSlug() {
  const emailName = String(currentUser?.email || 'neoanimez').split('@')[0] || 'neoanimez';
  const base = normalizePublicSlug(emailName) || 'neoanimez';
  return base.length >= 3 ? base : `${base}123`.slice(0, 30);
}

function getPublicProfileLink(slug = userPublicProfile?.slug) {
  const clean = normalizePublicSlug(slug);
  if (!clean) return '';
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('perfil', clean);
    return url.toString();
  } catch {
    return `https://neoanimez.com/?perfil=${encodeURIComponent(clean)}`;
  }
}

function setPublicProfileFeedback(message = '', type = '') {
  const box = document.getElementById('publicProfileFeedback');
  if (!box) return;
  box.textContent = message;
  box.className = 'auth-feedback';
  if (type) box.classList.add(type);
}

function renderPublicProfileSettings() {
  const nameInput = document.getElementById('publicProfileName');
  const slugInput = document.getElementById('publicProfileSlug');
  const enabledInput = document.getElementById('publicProfileEnabled');
  const linkText = document.getElementById('publicProfileLinkText');
  if (!nameInput || !slugInput || !enabledInput || !linkText) return;

  const profile = userPublicProfile || {};
  if (document.activeElement !== nameInput) nameInput.value = profile.display_name || 'NeoAnimeZ Fan';
  if (document.activeElement !== slugInput) slugInput.value = profile.slug || getDefaultPublicSlug();
  enabledInput.checked = !!profile.is_public;

  const link = getPublicProfileLink(profile.slug || slugInput.value);
  linkText.textContent = profile.is_public && link
    ? link
    : 'Activa el perfil para generar un enlace público.';
}

async function loadMyPublicProfile({ silent = false } = {}) {
  if (!currentUser || !publicProfileFeatureAvailable) {
    userPublicProfile = null;
    renderPublicProfileSettings();
    return false;
  }

  try {
    const { data } = await safeSupabase(
      'public_profiles.select.mine',
      () => supabaseClient
        .from('public_profiles')
        .select('slug, display_name, is_public, show_progress, show_ratings, updated_at')
        .eq('user_id', currentUser.id)
        .maybeSingle(),
      { timeout: 9000, retries: 1 }
    );
    userPublicProfile = data || null;
    renderPublicProfileSettings();
    return true;
  } catch (error) {
    if (isMissingSupabaseResourceError(error)) {
      publicProfileFeatureAvailable = false;
      if (!silent) setPublicProfileFeedback('Falta activar los perfiles públicos en Supabase.', 'error');
    } else if (!silent) {
      setPublicProfileFeedback(userFacingSupabaseError(error, 'No se pudo cargar tu perfil público.'), 'error');
    }
    renderPublicProfileSettings();
    return false;
  }
}

async function savePublicProfileSettings() {
  if (!currentUser) {
    setPublicProfileFeedback('Inicia sesión para compartir tu lista.', 'error');
    return;
  }

  const nameInput = document.getElementById('publicProfileName');
  const slugInput = document.getElementById('publicProfileSlug');
  const enabledInput = document.getElementById('publicProfileEnabled');
  const displayName = String(nameInput?.value || '').trim().slice(0, 40) || 'NeoAnimeZ Fan';
  const slug = normalizePublicSlug(slugInput?.value || getDefaultPublicSlug());

  if (!PUBLIC_PROFILE_SLUG_RE.test(slug)) {
    setPublicProfileFeedback('El enlace debe tener entre 3 y 30 caracteres: letras, números o guiones.', 'error');
    return;
  }

  const payload = {
    user_id: currentUser.id,
    slug,
    display_name: displayName,
    is_public: !!enabledInput?.checked,
    show_progress: true,
    show_ratings: true,
    updated_at: new Date().toISOString()
  };

  try {
    setPublicProfileFeedback('Guardando perfil público...');
    const sessionUser = await ensureSupabaseWriteReady();
    if (!sessionUser) {
      setPublicProfileFeedback('Tu sesión no está activa. Inicia sesión otra vez.', 'error');
      return;
    }
    await safeSupabaseMutation(
      'public_profiles.upsert',
      () => supabaseClient
        .from('public_profiles')
        .upsert(payload, { onConflict: 'user_id' }),
      { timeout: 9000, retries: 1 }
    );
    userPublicProfile = payload;
    publicProfileFeatureAvailable = true;
    renderPublicProfileSettings();
    setPublicProfileFeedback(payload.is_public ? 'Perfil público guardado. Ya puedes compartir el enlace.' : 'Perfil guardado como privado.', 'success');
  } catch (error) {
    console.error('Error guardando perfil público:', error);
    if (isMissingSupabaseResourceError(error)) {
      publicProfileFeatureAvailable = false;
      setPublicProfileFeedback('Falta activar los perfiles públicos en Supabase.', 'error');
      return;
    }
    const text = String(error?.message || '').toLowerCase();
    if (text.includes('duplicate') || text.includes('unique') || text.includes('23505')) {
      setPublicProfileFeedback('Ese enlace ya está usado. Prueba con otro nombre.', 'error');
      return;
    }
    setPublicProfileFeedback(userFacingSupabaseError(error, 'No se pudo guardar el perfil público.'), 'error');
  }
}

async function copyPublicProfileLink() {
  const slug = normalizePublicSlug(document.getElementById('publicProfileSlug')?.value || userPublicProfile?.slug || '');
  const link = getPublicProfileLink(slug);
  if (!link || !userPublicProfile?.is_public || slug !== normalizePublicSlug(userPublicProfile.slug)) {
    setPublicProfileFeedback('Activa y guarda el perfil público antes de copiar el enlace.', 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(link);
    setPublicProfileFeedback('Enlace copiado.', 'success');
  } catch {
    setPublicProfileFeedback(link, 'success');
  }
}

function readPublicProfileSlugFromUrl() {
  try {
    const url = new URL(window.location.href);
    return normalizePublicSlug(url.searchParams.get('perfil') || url.searchParams.get('u') || '');
  } catch {
    return '';
  }
}

function buildPublicProfileAnimeCard(item, options = {}) {
  const anime = getAnimeById(item.anime_id);
  if (!anime || !isAnimeVisible(anime)) return null;
  const status = item.status || 'pending';
  const title = getAnimeDisplayTitle(anime);
  const progress = {
    episode_number: Number(item.episode_number) || 0,
    total_episodes: Number(item.total_episodes) || getAnimeTotalEpisodes(anime)
  };
  const progressLabel = options.showProgress ? getProgressLabel(progress, anime) : '';
  const rating = options.showRatings && item.rating != null ? Number(item.rating) : null;
  const extra = [
    rating != null && Number.isFinite(rating) ? `Nota ${rating.toFixed(0)}` : '',
    status !== 'completed' && progressLabel ? progressLabel : ''
  ].filter(Boolean).join(' · ');

  const row = document.createElement('div');
  row.className = `user-anime-row status-${status}`;
  row.innerHTML = `
    <div class="user-anime-main">
      <div class="user-anime-title-row">
        <div class="user-anime-name">${escapeHtml(title)}</div>
        ${buildStatusBadge(status, 'user-status-mark')}
      </div>
      ${extra ? `<div class="user-anime-extra">${escapeHtml(extra)}</div>` : ''}
    </div>
  `;
  row.addEventListener('click', () => openAnimeModal(anime, anime.image || BLANK));
  return row;
}

function renderPublicProfileView(payload = null) {
  const title = document.getElementById('publicProfileViewTitle');
  const sub = document.getElementById('publicProfileViewSub');
  const summary = document.getElementById('publicProfileSummary');
  const lists = document.getElementById('publicProfileLists');
  if (!title || !sub || !summary || !lists) return;

  if (!payload?.profile) {
    title.textContent = 'Lista no disponible';
    sub.textContent = 'Puede que el perfil no exista, sea privado o falte activar Supabase.';
    summary.innerHTML = '';
    lists.innerHTML = '<div class="public-profile-empty">No he podido cargar esta lista compartida.</div>';
    return;
  }

  const profile = payload.profile;
  const items = (Array.isArray(payload.items) ? payload.items : [])
    .filter(item => {
      const anime = getAnimeById(item.anime_id);
      return anime && isAnimeVisible(anime);
    });
  const counts = { watching: 0, pending: 0, completed: 0, dropped: 0 };
  items.forEach(item => {
    if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1;
  });

  title.textContent = profile.display_name || 'Lista NeoAnimeZ';
  sub.textContent = `@${profile.slug} · Lista pública de NeoAnimeZ`;
  summary.innerHTML = `
    <div class="user-daily-summary-pill status-watching"><span>${counts.watching}</span><small>En progreso</small></div>
    <div class="user-daily-summary-pill status-pending"><span>${counts.pending}</span><small>Pendientes</small></div>
    <div class="user-daily-summary-pill status-completed"><span>${counts.completed}</span><small>Completados</small></div>
    <div class="user-daily-summary-pill status-dropped"><span>${counts.dropped}</span><small>Droppeados</small></div>
  `;

  lists.innerHTML = '';
  if (!items.length) {
    lists.innerHTML = '<div class="public-profile-empty">Esta lista pública aún no tiene animes visibles.</div>';
    return;
  }

  STATUS_ORDER.forEach(status => {
    const statusItems = items.filter(item => item.status === status);
    if (!statusItems.length) return;
    const section = document.createElement('details');
    section.className = `user-list-accordion status-${status}`;
    section.innerHTML = `
      <summary>
        <span class="user-list-summary-main"><span class="user-section-title">${STATUS_LABELS[status]}</span></span>
        <span class="user-list-summary-meta"><span class="user-list-count">${statusItems.length}</span><span class="user-list-chevron">+</span></span>
      </summary>
      <div class="user-list-body"></div>
    `;
    const body = section.querySelector('.user-list-body');
    statusItems.forEach(item => {
      const card = buildPublicProfileAnimeCard(item, {
        showProgress: true,
        showRatings: true
      });
      if (card) body.appendChild(card);
    });
    if (body.children.length) lists.appendChild(section);
  });

  if (!lists.children.length) {
    lists.innerHTML = '<div class="public-profile-empty">Esta lista pública usa animes que no están en el catálogo local.</div>';
  }
}

async function loadPublicProfileBySlug(slug) {
  const clean = normalizePublicSlug(slug);
  if (!clean) return false;
  renderPublicProfileView(null);
  try {
    const { data } = await safeSupabase(
      'get_public_profile_list',
      () => supabaseClient.rpc('get_public_profile_list', { p_slug: clean }),
      { timeout: 12000, retries: 1 }
    );
    renderPublicProfileView(data || null);
    return true;
  } catch (error) {
    console.error('Error cargando perfil público:', error);
    renderPublicProfileView(null);
    return false;
  }
}

function openPublicProfileRoute(slug) {
  const clean = normalizePublicSlug(slug);
  if (!clean) return false;
  dismissIntroIfNeeded(false);
  setActiveScreen('public-profile-screen', null, false);
  loadPublicProfileBySlug(clean);
  return true;
}

const SCHEDULE_DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'unknown'];
const SCHEDULE_CALENDAR_DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SCHEDULE_JS_DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SCHEDULE_PERSONAL_STATUSES = new Set(['watching', 'pending']);
const SCHEDULE_FEATURED_LIMIT = 12;
const SCHEDULE_NEXT_MONTH_PREVIEW_DAYS = 10;
const SCHEDULE_DAY_LABELS = {
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
  sunday: 'Domingo',
  unknown: 'Sin día'
};
const SCHEDULE_WEEKDAY_SHORT = {
  monday: 'L',
  tuesday: 'M',
  wednesday: 'X',
  thursday: 'J',
  friday: 'V',
  saturday: 'S',
  sunday: 'D'
};

function normalizeScheduleDay(day = '') {
  const clean = normalizeLoose(day);
  if (clean.includes('monday') || clean.includes('lunes')) return 'monday';
  if (clean.includes('tuesday') || clean.includes('martes')) return 'tuesday';
  if (clean.includes('wednesday') || clean.includes('miercoles')) return 'wednesday';
  if (clean.includes('thursday') || clean.includes('jueves')) return 'thursday';
  if (clean.includes('friday') || clean.includes('viernes')) return 'friday';
  if (clean.includes('saturday') || clean.includes('sabado')) return 'saturday';
  if (clean.includes('sunday') || clean.includes('domingo')) return 'sunday';
  return 'unknown';
}

function getScheduleDayDistance(dayKey) {
  const today = new Date().getDay();
  const todayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][today] || 'unknown';
  const current = SCHEDULE_DAY_ORDER.indexOf(todayKey);
  const target = SCHEDULE_DAY_ORDER.indexOf(dayKey);
  if (target < 0 || current < 0 || dayKey === 'unknown') return 8;
  return (target - current + 7) % 7;
}

function formatScheduleDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseScheduleDateKey(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function getScheduleDateDayKey(date) {
  return SCHEDULE_JS_DAY_KEYS[date.getDay()] || 'unknown';
}

function getScheduleMonthTitle(date = new Date()) {
  return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

function formatScheduleMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function parseScheduleMonthKey(monthKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1, 12);
}

function getScheduleCalendarBaseDates(reference = new Date()) {
  const currentMonth = new Date(reference.getFullYear(), reference.getMonth(), 1, 12);
  const daysInCurrentMonth = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate();
  const shouldShowNextMonth = reference.getDate() >= daysInCurrentMonth - SCHEDULE_NEXT_MONTH_PREVIEW_DAYS + 1;
  if (!shouldShowNextMonth) return [currentMonth];
  return [currentMonth, new Date(reference.getFullYear(), reference.getMonth() + 1, 1, 12)];
}

function capitalizeFirst(value = '') {
  const text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function formatDataUpdatedLabel(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  const formatted = date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  return `Actualizado el ${formatted}`;
}

function renderDataUpdatedLabel(elementId, value) {
  const element = document.getElementById(elementId);
  if (!element) return;
  const label = formatDataUpdatedLabel(value);
  element.textContent = label;
  element.classList.toggle('hidden', !label);
}

function getScheduleItems(payload = animeSchedulePayload) {
  if (!payload) return [];
  if (Array.isArray(payload.items)) return payload.items;
  const days = payload.days || payload.schedule || {};
  return Object.entries(days).flatMap(([day, items]) => {
    if (!Array.isArray(items)) return [];
    return items.map(item => ({ ...item, day: item.day || day }));
  });
}

function getScheduleAnimeId(item = {}) {
  return Number(item.mal_id || item.anime_id || item.id || item.entry?.mal_id || 0);
}

function getScheduleAnime(item = {}) {
  const animeId = getScheduleAnimeId(item);
  const fromCatalog = animeId ? getAnimeById(animeId) : null;
  if (fromCatalog) return fromCatalog;
  const entry = item.entry || {};
  return normalizeAnimeRecord({
    mal_id: animeId,
    title: item.title || entry.title || '',
    title_english: item.title_english || entry.title_english || '',
    title_es: item.title_es || '',
    image: item.image || entry.image || entry.images?.jpg?.large_image_url || entry.images?.jpg?.image_url || '',
    type: item.type || entry.type || '',
    episodes: item.episodes || entry.episodes || null
  });
}

function getScheduleBroadcastText(item = {}) {
  const broadcast = item.broadcast || {};
  return item.broadcast_string || broadcast.string || [broadcast.day, broadcast.time].filter(Boolean).join(' · ') || '';
}

function getScheduleEntries() {
  return getScheduleItems()
    .map(item => {
      const animeId = getScheduleAnimeId(item);
      const anime = getScheduleAnime(item);
      const dayKey = normalizeScheduleDay(item.day || item.broadcast?.day || item.broadcast_string);
      return { item, animeId, anime, dayKey, status: userAnimeMap.get(Number(animeId)) || '' };
    })
    .filter(entry => entry.animeId && entry.dayKey !== 'unknown' && isAnimeVisible(entry.anime));
}

function getPersonalScheduleEntries() {
  return getScheduleEntries().filter(entry => SCHEDULE_PERSONAL_STATUSES.has(entry.status));
}

function getScheduleEntryScore(entry) {
  const anime = entry?.anime || {};
  const item = entry?.item || {};
  const score = Number(anime.score || item.score) || 0;
  const votes = Number(anime.scored_by || anime.votes || item.scored_by || item.members || 0) || 0;
  if (!score) return 0;
  const prior = 7;
  const weight = 15000;
  const bayesian = ((score * votes) + (prior * weight)) / (votes + weight);
  return bayesian + Math.min(Math.log10(votes + 1), 6) * 0.035;
}

function getFeaturedScheduleEntries(limit = SCHEDULE_FEATURED_LIMIT) {
  const seen = new Set();
  return getScheduleEntries()
    .filter(entry => {
      if (seen.has(entry.animeId)) return false;
      seen.add(entry.animeId);
      return getScheduleEntryScore(entry) > 0;
    })
    .sort((a, b) => {
      const scoreDiff = getScheduleEntryScore(b) - getScheduleEntryScore(a);
      if (scoreDiff) return scoreDiff;
      return String(getAnimeDisplayTitle(a.anime)).localeCompare(String(getAnimeDisplayTitle(b.anime)), 'es', { sensitivity: 'base' });
    })
    .slice(0, limit);
}

function getActiveScheduleEntries() {
  return userScheduleMode === 'featured' ? getFeaturedScheduleEntries() : getPersonalScheduleEntries();
}

function getScheduleEntriesForDate(date, entries = getActiveScheduleEntries()) {
  const dayKey = getScheduleDateDayKey(date);
  return entries
    .filter(entry => entry.dayKey === dayKey)
    .sort((a, b) => {
      if (userScheduleMode === 'featured') {
        const scoreDiff = getScheduleEntryScore(b) - getScheduleEntryScore(a);
        if (scoreDiff) return scoreDiff;
      }
      return String(getAnimeDisplayTitle(a.anime)).localeCompare(String(getAnimeDisplayTitle(b.anime)), 'es', { sensitivity: 'base' });
    });
}

function findBestScheduleDate(entries, baseDate = new Date()) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const startDay = today.getFullYear() === year && today.getMonth() === month ? today.getDate() : 1;

  for (let day = startDay; day <= daysInMonth; day++) {
    const date = new Date(year, month, day, 12);
    if (getScheduleEntriesForDate(date, entries).length) return date;
  }

  for (let day = 1; day < startDay; day++) {
    const date = new Date(year, month, day, 12);
    if (getScheduleEntriesForDate(date, entries).length) return date;
  }

  return new Date(year, month, startDay, 12);
}

function isSameScheduleMonth(date, baseDate) {
  return !!date && !!baseDate && date.getFullYear() === baseDate.getFullYear() && date.getMonth() === baseDate.getMonth();
}

function ensureScheduleSelectedMonth(baseDates = getScheduleCalendarBaseDates()) {
  const selectedMonth = parseScheduleMonthKey(userScheduleSelectedMonthKey);
  if (selectedMonth && baseDates.some(baseDate => isSameScheduleMonth(selectedMonth, baseDate))) {
    return selectedMonth;
  }

  const selectedDate = parseScheduleDateKey(userScheduleSelectedDateKey);
  const dateMonth = baseDates.find(baseDate => isSameScheduleMonth(selectedDate, baseDate));
  const nextMonth = dateMonth || baseDates[0] || new Date();
  userScheduleSelectedMonthKey = formatScheduleMonthKey(nextMonth);
  return nextMonth;
}

function ensureScheduleSelectedDate(entries, baseDates = getScheduleCalendarBaseDates()) {
  const selected = parseScheduleDateKey(userScheduleSelectedDateKey);
  if (selected && baseDates.some(baseDate => isSameScheduleMonth(selected, baseDate))) {
    return selected;
  }

  const bestWithItems = baseDates
    .map(baseDate => findBestScheduleDate(entries, baseDate))
    .find(date => getScheduleEntriesForDate(date, entries).length);
  const nextDate = bestWithItems || findBestScheduleDate(entries, baseDates[0] || new Date());
  userScheduleSelectedDateKey = formatScheduleDateKey(nextDate);
  return nextDate;
}

function setUserScheduleMode(mode) {
  userScheduleMode = mode === 'featured' ? 'featured' : 'mine';
  userScheduleSelectedDateKey = '';
  renderUserSchedule();
}

function setUserScheduleMonth(monthKey) {
  const baseDate = parseScheduleMonthKey(monthKey);
  const allowedMonths = getScheduleCalendarBaseDates();
  if (!baseDate || !allowedMonths.some(month => isSameScheduleMonth(baseDate, month))) return;
  userScheduleSelectedMonthKey = formatScheduleMonthKey(baseDate);
  userScheduleSelectedDateKey = '';
  renderUserSchedule();
}

function selectUserScheduleDate(dateKey) {
  userScheduleSelectedDateKey = dateKey;
  renderUserSchedule();
  openScheduleDayModal(dateKey);
}

function updateScheduleModeButtons() {
  document.querySelectorAll('[data-schedule-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.scheduleMode === userScheduleMode);
  });
}

function appendScheduleMonthCalendar(container, entries, selectedDate, baseDate) {
  const block = document.createElement('section');
  block.className = 'user-calendar-block';

  const blockTitle = document.createElement('div');
  blockTitle.className = 'user-calendar-block-title';
  blockTitle.textContent = capitalizeFirst(getScheduleMonthTitle(baseDate));
  block.appendChild(blockTitle);

  const grid = document.createElement('div');
  grid.className = 'user-calendar-grid';
  block.appendChild(grid);

  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1, 12);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = (firstDay.getDay() + 6) % 7;
  const todayKey = formatScheduleDateKey(new Date());
  const selectedKey = formatScheduleDateKey(selectedDate);

  SCHEDULE_CALENDAR_DAY_ORDER.forEach(dayKey => {
    const header = document.createElement('div');
    header.className = 'user-calendar-weekday';
    header.textContent = SCHEDULE_WEEKDAY_SHORT[dayKey] || '';
    grid.appendChild(header);
  });

  for (let i = 0; i < leadingBlanks; i++) {
    const blank = document.createElement('div');
    blank.className = 'user-calendar-day is-outside';
    blank.setAttribute('aria-hidden', 'true');
    grid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day, 12);
    const dateKey = formatScheduleDateKey(date);
    const dayEntries = getScheduleEntriesForDate(date, entries);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = [
      'user-calendar-day',
      dayEntries.length ? 'has-items' : '',
      userScheduleMode === 'featured' ? 'is-featured' : '',
      dateKey === todayKey ? 'is-today' : '',
      dateKey === selectedKey ? 'selected' : ''
    ].filter(Boolean).join(' ');
    button.dataset.dateKey = dateKey;
    const previewItems = dayEntries.slice(0, 2).map(entry => getAnimeDisplayTitle(entry.anime));
    const remainingItems = Math.max(0, dayEntries.length - previewItems.length);
    button.innerHTML = `
      <span class="user-calendar-number">${day}</span>
      ${previewItems.length ? `<span class="user-calendar-preview">${previewItems.map(title => `<span class="user-calendar-preview-line">${escapeHtml(title)}</span>`).join('')}${remainingItems ? `<span class="user-calendar-preview-more">+${remainingItems}</span>` : ''}</span>` : ''}
      ${dayEntries.length ? `<span class="user-calendar-dot">${dayEntries.length}</span>` : ''}
    `;
    button.addEventListener('click', () => selectUserScheduleDate(dateKey));
    grid.appendChild(button);
  }

  container.appendChild(block);
}

function renderScheduleCalendar(entries, selectedDate, baseDates = getScheduleCalendarBaseDates(), visibleBaseDate = ensureScheduleSelectedMonth(baseDates)) {
  const calendar = document.getElementById('userScheduleCalendar');
  const monthTitle = document.getElementById('userScheduleMonthTitle');
  const monthSelect = document.getElementById('userScheduleMonthSelect');
  const legend = document.getElementById('userScheduleLegend');
  if (!calendar) return;

  if (monthTitle) monthTitle.textContent = baseDates.length > 1 ? 'Elegir mes' : capitalizeFirst(getScheduleMonthTitle(visibleBaseDate));
  if (monthSelect) {
    monthSelect.innerHTML = baseDates.map(baseDate => {
      const key = formatScheduleMonthKey(baseDate);
      const label = capitalizeFirst(getScheduleMonthTitle(baseDate));
      return `<option value="${key}">${escapeHtml(label)}</option>`;
    }).join('');
    monthSelect.value = formatScheduleMonthKey(visibleBaseDate);
    monthSelect.classList.toggle('hidden', baseDates.length <= 1);
  }
  if (legend) legend.textContent = userScheduleMode === 'featured' ? 'Top semanal' : 'Día con emisión';

  calendar.innerHTML = '';
  appendScheduleMonthCalendar(calendar, entries, selectedDate, visibleBaseDate);
}

function buildScheduleEntryRow(entry) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'user-schedule-row schedule-day-row';
  const anime = entry.anime;
  const title = getAnimeDisplayTitle(anime);
  const broadcast = getScheduleBroadcastText(entry.item);
  const score = Number(anime.score || entry.item?.score);
  const meta = [anime.type, broadcast, userScheduleMode === 'featured' && score ? `Nota ${score.toFixed(1)}` : ''].filter(Boolean).join(' · ');
  const personalBadge = entry.status === 'pending' && hasAnimePremiered(anime)
    ? 'Ya estrenado'
    : (STATUS_LABELS[entry.status] || 'Mi lista');
  const badge = userScheduleMode === 'featured' ? 'Top semanal' : personalBadge;

  row.innerHTML = `
    <img class="user-schedule-img" src="${EMPTY_IMAGE}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
    <div>
      <div class="user-schedule-name">${escapeHtml(title)}</div>
      <div class="user-schedule-meta">${escapeHtml(meta || 'Emisión semanal')}</div>
    </div>
    <div class="user-schedule-day">${escapeHtml(badge)}</div>
  `;

  row.addEventListener('click', () => {
    const imgNow = row.querySelector('.user-schedule-img')?.src || anime.image || BLANK;
    closeScheduleDayModal();
    openAnimeModal(anime, imgNow);
  });

  return row;
}

function openScheduleDayModal(dateKey = userScheduleSelectedDateKey) {
  const modal = document.getElementById('scheduleDayModal');
  const title = document.getElementById('scheduleDayModalTitle');
  const kicker = document.getElementById('scheduleDayModalKicker');
  const sub = document.getElementById('scheduleDayModalSub');
  const list = document.getElementById('scheduleDayModalList');
  const selectedDate = parseScheduleDateKey(dateKey);
  if (!modal || !list || !selectedDate) return;

  const entries = getActiveScheduleEntries();
  const dayEntries = getScheduleEntriesForDate(selectedDate, entries);
  const dayLabel = selectedDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const modeLabel = userScheduleMode === 'featured' ? 'Destacados' : 'Mi lista';

  if (kicker) kicker.textContent = modeLabel;
  if (title) title.textContent = capitalizeFirst(dayLabel);
  if (sub) {
    sub.textContent = dayEntries.length
      ? 'Toca un anime para abrir su ficha.'
      : userScheduleMode === 'featured'
        ? 'No hay destacados marcados para este día.'
        : 'No hay emisiones de tu lista este día.';
  }

  list.innerHTML = '';
  if (!dayEntries.length) {
    list.innerHTML = '<div class="schedule-day-empty">Prueba con otro día marcado en el calendario.</div>';
  } else {
    dayEntries.forEach((entry, index) => {
      const row = buildScheduleEntryRow(entry);
      list.appendChild(row);
      loadAnimeImageElement(row.querySelector('.user-schedule-img'), entry.anime, index * 25);
    });
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  resetAnimeModalScroll(modal);
}

function closeScheduleDayModal() {
  const modal = document.getElementById('scheduleDayModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  resetAnimeModalScroll(modal);
  document.body.style.overflow = '';
}

function renderUserSchedule() {
  const card = document.getElementById('userScheduleCard');
  const list = document.getElementById('userScheduleList');
  const sub = document.getElementById('userScheduleSub');
  const dayTitle = document.getElementById('userScheduleDayTitle');
  if (!card || !list) return;
  if (!currentUser || !animeSchedulePayload) {
    card.classList.add('hidden');
    list.innerHTML = '';
    renderDataUpdatedLabel('userScheduleUpdated', '');
    renderUserDailyPanel();
    return;
  }

  card.classList.remove('hidden');
  updateScheduleModeButtons();

  const entries = getActiveScheduleEntries();
  const scheduleBaseDates = getScheduleCalendarBaseDates();
  const visibleBaseDate = ensureScheduleSelectedMonth(scheduleBaseDates);
  const selectedDate = ensureScheduleSelectedDate(entries, [visibleBaseDate]);
  renderScheduleCalendar(entries, selectedDate, scheduleBaseDates, visibleBaseDate);
  renderDataUpdatedLabel('userScheduleUpdated', animeSchedulePayload.generated_at);

  if (sub) {
    sub.textContent = userScheduleMode === 'featured'
      ? 'Top semanal de emisiones destacadas, filtrado para que no salga una lista enorme.'
      : 'Emisiones de tus animes en progreso y pendientes.';
  }

  if (dayTitle) {
    dayTitle.textContent = 'Toca un día marcado para ver sus emisiones.';
  }
  list.classList.toggle('hidden', true);
  list.innerHTML = '';

  if (userScheduleMode === 'mine' && !entries.length) {
    list.classList.toggle('hidden', false);
    list.innerHTML = '<div class="user-schedule-empty">Añade animes en progreso o pendientes para ver aquí tu calendario personalizado.</div>';
    renderUserDailyPanel();
    return;
  }

  renderUserDailyPanel();
}

async function loadAnimeSchedule({ force = false } = {}) {
  if (animeScheduleLoaded && !force) {
    renderUserSchedule();
    return true;
  }
  try {
    animeSchedulePayload = await fetchCatalogJson(SCHEDULE_URL, { preferCache: !force, timeout: 9000 });
    animeScheduleLoaded = true;
    renderUserSchedule();
    return true;
  } catch (error) {
    animeSchedulePayload = null;
    animeScheduleLoaded = true;
    document.getElementById('userScheduleCard')?.classList.add('hidden');
    renderUserDailyPanel();
    if (force) console.warn('No se pudo cargar anime-schedule.json:', error);
    return false;
  }
}

function renderUserLists() {
  const buckets = {
    watching: [],
    completed: [],
    pending: [],
    dropped: []
  };

  userAnimeMap.forEach((status, animeId) => {
    const anime = getAnimeById(animeId);
    if (!anime || !isAnimeVisible(anime) || !buckets[status]) return;
    buckets[status].push(anime);
  });

  const totalCount = Object.values(buckets).reduce((sum, list) => sum + list.length, 0);
  const totalCountEl = document.getElementById('countAllUserAnime');
  if (totalCountEl) totalCountEl.textContent = String(totalCount);

  Object.entries({
    watching: 'userWatchingList',
    completed: 'userCompletedList',
    pending: 'userPendingList',
    dropped: 'userDroppedList'
  }).forEach(([status, elementId]) => {
    const container = document.getElementById(elementId);
    const count = document.getElementById('count' + status.charAt(0).toUpperCase() + status.slice(1));
    if (!container) return;
    const list = buckets[status].sort((a,b) => String(getAnimeDisplayTitle(a)).localeCompare(String(getAnimeDisplayTitle(b)), 'es', {sensitivity:'base'}));
    if (count) count.textContent = String(list.length);
    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = `<div class="user-empty">No tienes animes en <strong>${STATUS_LABELS[status]}</strong>.</div>`;
      return;
    }
    list.forEach(anime => container.appendChild(buildUserAnimeCard(anime, status)));
  });

  updateModalStatusUI();
  updateModalRatingUI();
  updateModalProgressUI();
  refreshAnimeStatusMarkers();
  renderUserSchedule();
}

function applyUserAnimeBundle(payload = {}) {
  const statuses = Array.isArray(payload.statuses) ? payload.statuses : [];
  const ratings = Array.isArray(payload.ratings) ? payload.ratings : [];
  const progress = Array.isArray(payload.progress) ? payload.progress : [];

  userAnimeMap = new Map(statuses.map(row => [Number(row.anime_id), row.status]));
  userStatusUpdatedMap = new Map(statuses
    .map(row => [Number(row.anime_id), row.updated_at || null])
    .filter(([, updatedAt]) => !!updatedAt));
  userRatingMap = new Map(ratings.map(row => [Number(row.anime_id), Number(row.rating)]));
  userProgressMap = new Map(progress.map((row, index) => [Number(row.anime_id), {
    season_number: Number(row.season_number) || 1,
    episode_number: Number(row.episode_number) || 0,
    total_episodes: Number(row.total_episodes) || null,
    updated_at: row.updated_at || null,
    order_hint: index
  }]));

  ratingsFeatureAvailable = true;
  progressFeatureAvailable = true;
  persistCachedUserAnimeData();
  renderUserLists();
}

async function fetchUserAnimeBundle({ silent = false } = {}) {
  if (!currentUser || !userAnimeBundleFeatureAvailable) return false;

  try {
    const { data } = await safeSupabase(
      'get_my_anime_data',
      () => supabaseClient.rpc('get_my_anime_data'),
      { timeout: 12000, retries: 1 }
    );
    applyUserAnimeBundle(data || {});
    return true;
  } catch (error) {
    if (isMissingSupabaseResourceError(error)) {
      userAnimeBundleFeatureAvailable = false;
      return false;
    }
    console.warn('No se pudo cargar el paquete de usuario:', error);
    if (!silent && !isTransientSupabaseError(error)) {
      setModalStatusMessage(userFacingSupabaseError(error, 'No se pudo actualizar tu lista.'), 'error');
    }
    return false;
  }
}

async function fetchUserStatuses({ silent = false } = {}) {
  if (!currentUser) {
    userAnimeMap = new Map();
    userStatusUpdatedMap = new Map();
    renderUserLists();
    return true;
  }

  try {
    const { data } = await safeSupabase(
      'user_anime_status.select',
      () => supabaseClient
        .from('user_anime_status')
        .select('anime_id, status, updated_at')
        .eq('user_id', currentUser.id)
        .order('updated_at', { ascending: false }),
      { timeout: 12000, retries: 1 }
    );

    userAnimeMap = new Map((data || []).map(row => [Number(row.anime_id), row.status]));
    userStatusUpdatedMap = new Map((data || [])
      .map(row => [Number(row.anime_id), row.updated_at || null])
      .filter(([, updatedAt]) => !!updatedAt));
    persistCachedUserAnimeData();
    renderUserLists();
    return true;
  } catch (error) {
    console.error('Error cargando estados:', error);
    if (!silent) {
      setModalStatusMessage(userFacingSupabaseError(error, 'No se pudo actualizar tu lista.'), 'error');
    }
    renderUserLists();
    return false;
  }
}

async function fetchUserRatings({ silent = false } = {}) {
  if (!currentUser) {
    userRatingMap = new Map();
    renderUserLists();
    return true;
  }

  try {
    const { data } = await safeSupabase(
      'user_anime_ratings.select.mine',
      () => supabaseClient
        .from('user_anime_ratings')
        .select('anime_id, rating')
        .eq('user_id', currentUser.id),
      { timeout: 12000, retries: 1 }
    );

    ratingsFeatureAvailable = true;
    userRatingMap = new Map((data || []).map(row => [Number(row.anime_id), Number(row.rating)]));
    persistCachedUserAnimeData();
    renderUserLists();
    return true;
  } catch (error) {
    console.error('Error cargando puntuaciones:', error);
    if (isMissingSupabaseResourceError(error)) {
      ratingsFeatureAvailable = false;
      userRatingMap = new Map();
      if (!silent) setModalRatingMessage('Falta activar la tabla de puntuaciones en Supabase.', 'error');
    } else {
      ratingsFeatureAvailable = true;
      if (!silent) setModalRatingMessage(userFacingSupabaseError(error, 'No se pudieron actualizar tus puntuaciones.'), 'error');
    }
    updateModalRatingUI();
    renderUserLists();
    return false;
  }
}

async function fetchUserProgress({ silent = false } = {}) {
  if (!currentUser) {
    userProgressMap = new Map();
    renderUserLists();
    return true;
  }

  try {
    const { data } = await safeSupabase(
      'user_anime_progress.select.mine',
      () => supabaseClient
        .from('user_anime_progress')
        .select('anime_id, season_number, episode_number, total_episodes, updated_at')
        .eq('user_id', currentUser.id)
        .order('updated_at', { ascending: false }),
      { timeout: 12000, retries: 1 }
    );

    progressFeatureAvailable = true;
    userProgressMap = new Map((data || []).map((row, index) => [Number(row.anime_id), {
      season_number: Number(row.season_number) || 1,
      episode_number: Number(row.episode_number) || 0,
      total_episodes: Number(row.total_episodes) || null,
      updated_at: row.updated_at || null,
      order_hint: index
    }]));
    persistCachedUserAnimeData();
    renderUserLists();
    return true;
  } catch (error) {
    console.error('Error cargando progreso:', error);
    if (isMissingSupabaseResourceError(error)) {
      progressFeatureAvailable = false;
      userProgressMap = new Map();
      if (!silent) setModalProgressMessage('Falta activar la tabla de progreso en Supabase.', 'error');
    } else {
      progressFeatureAvailable = true;
      if (!silent) setModalProgressMessage(userFacingSupabaseError(error, 'No se pudo actualizar tu progreso.'), 'error');
    }
    updateModalProgressUI();
    renderUserLists();
    return false;
  }
}

async function fetchCommunityRatings({ silent = false } = {}) {
  try {
    const { data } = await safeSupabase(
      'get_community_anime_ratings',
      () => supabaseClient.rpc('get_community_anime_ratings'),
      { timeout: 12000, retries: 1 }
    );

    ratingsFeatureAvailable = true;
    clearTimeout(communityRatingsRetryTimer);
    communityRatingMap = new Map((data || []).map(row => {
      const animeId = Number(row.anime_id);
      const avg = Number(row.average_rating);
      const count = Number(row.rating_count);
      if (!animeId || !Number.isFinite(avg) || !Number.isFinite(count) || count < 1) return null;
      const weighted = ((avg * count) + (COMMUNITY_PRIOR_SCORE * COMMUNITY_PRIOR_WEIGHT)) / (count + COMMUNITY_PRIOR_WEIGHT);
      return [animeId, { average: avg, count, weighted }];
    }).filter(Boolean));
    persistCachedCommunityRatings();
    renderCommunityRanking();
    return true;
  } catch (error) {
    console.error('Error cargando ranking comunidad:', error);
    if (isMissingSupabaseResourceError(error)) {
      if (!silent) setModalRatingMessage('Falta activar la tabla de puntuaciones en Supabase.', 'error');
      communityRatingMap = new Map();
      renderCommunityRanking('Falta activar la lectura agregada de puntuaciones en Supabase.');
    } else if (isTransientSupabaseError(error)) {
      if (!communityRatingMap.size) {
        const hydrated = hydrateCachedCommunityRatings();
        if (!hydrated) {
          renderCommunityRanking('Conectando con las puntuaciones de la comunidad...');
        }
      }
      scheduleCommunityRatingsRetry();
    } else if (!silent) {
      setModalRatingMessage(userFacingSupabaseError(error, 'No se pudo actualizar el ranking de comunidad.'), 'error');
    }
    return false;
  }
}

function isCommunityModerator() {
  return communityRole === 'owner' || communityRole === 'moderator';
}

function setCommunityFeedback(targetId, message = '', type = '') {
  const box = document.getElementById(targetId);
  if (!box) return;
  box.textContent = message;
  box.className = `community-feedback${type ? ` ${type}` : ''}`;
}

function formatCommunityDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('es-ES', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function getCommunityKindLabel(post = {}) {
  if (post.kind === 'question') return post.is_official ? 'Pregunta NeoAnimeZ' : 'Pregunta';
  if (post.kind === 'reply') return 'Respuesta';
  return 'Pregunta';
}

function userFacingCommunityError(error, fallback = 'No se pudo completar la acción.') {
  const text = String(error?.message || error || '').toLowerCase();
  if (text.includes('permission denied')) return 'Faltan permisos del tablón. Ejecuta de nuevo el SQL actualizado en Supabase.';
  if (text.includes('login_required')) return 'Inicia sesión para usar el tablón.';
  if (text.includes('moderator_required')) return 'Solo los moderadores pueden crear preguntas.';
  if (text.includes('delete_not_allowed')) return 'No tienes permiso para borrar este mensaje.';
  if (text.includes('invalid_body_length')) return 'El mensaje debe tener entre 2 y 700 caracteres.';
  if (text.includes('thread_not_found')) return 'No se encontró esta conversación.';
  return userFacingSupabaseError(error, fallback);
}

function updateCommunityCounts() {
  const postBody = document.getElementById('communityPostBody');
  const postCount = document.getElementById('communityPostCount');
  if (postBody && postCount) postCount.textContent = `${postBody.value.length}/700`;

  const replyBody = document.getElementById('communityReplyBody');
  const replyCount = document.getElementById('communityReplyCount');
  if (replyBody && replyCount) replyCount.textContent = `${replyBody.value.length}/700`;
}

function setCommunityAdminTab(tab = 'list') {
  communityAdminTab = tab === 'new' ? 'new' : 'list';
  updateCommunityComposerUI();
}

function updateCommunityComposerUI() {
  const guestComposer = document.getElementById('communityGuestComposer');
  const memberNotice = document.getElementById('communityMemberNotice');
  const adminPanel = document.getElementById('communityAdminPanel');
  const composer = document.getElementById('communityComposer');
  const replyComposer = document.getElementById('communityReplyComposer');
  const replyGuest = document.getElementById('communityReplyGuest');
  const textarea = document.getElementById('communityPostBody');
  const moderator = isCommunityModerator();

  guestComposer?.classList.toggle('hidden', !!currentUser);
  memberNotice?.classList.toggle('hidden', !currentUser || moderator);
  adminPanel?.classList.toggle('hidden', !moderator);
  composer?.classList.toggle('hidden', !moderator || communityAdminTab !== 'new');
  replyComposer?.classList.toggle('hidden', !currentUser);
  replyGuest?.classList.toggle('hidden', !!currentUser);

  document.querySelectorAll('[data-community-admin-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.communityAdminTab === communityAdminTab);
  });

  if (textarea) {
    textarea.placeholder = 'Escribe una pregunta oficial para la comunidad...';
  }

  updateCommunityCounts();
}

async function fetchCommunityRole({ silent = false } = {}) {
  if (!currentUser) {
    communityRole = '';
    updateCommunityComposerUI();
    return '';
  }

  try {
    const { data } = await safeSupabase(
      'get_my_community_role',
      () => supabaseClient.rpc('get_my_community_role'),
      { timeout: 6500, retries: 0 }
    );
    communityRole = String(data || '');
    communityFeatureAvailable = true;
  } catch (error) {
    communityRole = '';
    if (isMissingSupabaseResourceError(error)) {
      communityFeatureAvailable = false;
      if (!silent) setCommunityFeedback('communityFeedback', 'Falta activar el tablón en Supabase.', 'error');
    } else if (!silent) {
      setCommunityFeedback('communityFeedback', userFacingSupabaseError(error, 'No se pudo comprobar tu rol de comunidad.'), 'error');
    }
  }

  updateCommunityComposerUI();
  return communityRole;
}

function scheduleCommunityThreadsRetry(delay = 3500) {
  clearTimeout(communityThreadRetryTimer);
  if (!navigator.onLine || document.visibilityState === 'hidden') return;
  communityThreadRetryTimer = setTimeout(() => {
    loadCommunityThreads({ silent: true });
  }, delay);
}

function scheduleCommunityRepliesRetry(threadId, delay = 3500) {
  clearTimeout(communityReplyRetryTimer);
  if (!navigator.onLine || document.visibilityState === 'hidden') return;
  communityReplyRetryTimer = setTimeout(() => {
    if (activeCommunityThread && String(activeCommunityThread.id) === String(threadId)) {
      loadCommunityReplies(threadId, { silent: true });
    }
  }, delay);
}

function scheduleCommunityRatingsRetry(delay = 3000) {
  clearTimeout(communityRatingsRetryTimer);
  if (!navigator.onLine || document.visibilityState === 'hidden') return;
  communityRatingsRetryTimer = setTimeout(() => {
    fetchCommunityRatings({ silent: true });
  }, delay);
}

function createCommunityPostElement(post, { focus = false, reply = false } = {}) {
  const item = {
    ...post,
    id: String(post.id || ''),
    body: String(post.body || ''),
    kind: post.kind || (reply ? 'reply' : 'opinion'),
    is_official: !!post.is_official,
    pinned: !!post.pinned,
    can_delete: !!post.can_delete,
    reply_count: Number(post.reply_count) || 0,
    upvotes: Number(post.upvotes) || 0,
    downvotes: Number(post.downvotes) || 0,
    my_vote: Number(post.my_vote) || 0
  };
  const article = document.createElement('article');
  article.className = `${focus ? 'community-thread-focus' : reply ? 'community-reply-card' : 'community-thread-card'}${item.is_official ? ' is-official' : ''}`;
  article.dataset.postId = item.id;

  const author = item.is_official ? 'NeoAnimeZ' : 'Usuario NeoAnimeZ';
  const date = formatCommunityDate(item.created_at);
  const repliesLabel = item.reply_count === 1 ? '1 respuesta' : `${item.reply_count} respuestas`;
  const actions = [];
  actions.push(`
    <span class="community-vote-bar" aria-label="Votos">
      <button class="community-vote-btn up${item.my_vote === 1 ? ' active' : ''}" type="button" data-vote-post="${escapeHtml(item.id)}" data-vote-value="1" aria-label="Me gusta">
        <span class="community-vote-icon">👍</span><span data-vote-count="up">${item.upvotes}</span>
      </button>
      <button class="community-vote-btn down${item.my_vote === -1 ? ' active' : ''}" type="button" data-vote-post="${escapeHtml(item.id)}" data-vote-value="-1" aria-label="No me gusta">
        <span class="community-vote-icon">👎</span><span data-vote-count="down">${item.downvotes}</span>
      </button>
    </span>
  `);
  if (!focus && !reply) actions.push(`<button class="community-small-btn" type="button" data-open-thread="${escapeHtml(item.id)}">Abrir</button>`);
  if (!reply) actions.push(`<span class="community-reply-count">${repliesLabel}</span>`);
  if (item.can_delete) actions.push(`<button class="community-small-btn community-delete-btn" type="button" data-delete-post="${escapeHtml(item.id)}">Borrar</button>`);

  article.innerHTML = `
    <div class="community-post-head">
      <div class="community-post-meta">
        <span class="community-author-pill${item.is_official ? ' official' : ''}">${author}</span>
        <span class="community-kind-pill">${getCommunityKindLabel(item)}</span>
        ${date ? `<span class="community-date">${date}</span>` : ''}
      </div>
    </div>
    <div class="community-body">${escapeHtml(item.body)}</div>
    ${actions.length ? `<div class="community-thread-actions">${actions.join('')}</div>` : ''}
  `;

  if (!focus && !reply) {
    article.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      openCommunityThread(item.id);
    });
  }

  article.querySelector('[data-open-thread]')?.addEventListener('click', event => {
    event.stopPropagation();
    openCommunityThread(item.id);
  });

  article.querySelector('[data-delete-post]')?.addEventListener('click', event => {
    event.stopPropagation();
    deleteCommunityPost(item.id);
  });

  article.querySelectorAll('[data-vote-post]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.stopPropagation();
      saveCommunityVote(item.id, Number(btn.dataset.voteValue));
    });
  });

  return article;
}

function updateCommunityVoteState(postId, voteData = {}) {
  const normalized = {
    upvotes: Number(voteData.upvotes) || 0,
    downvotes: Number(voteData.downvotes) || 0,
    my_vote: Number(voteData.my_vote) || 0
  };

  const updateItem = item => {
    if (String(item?.id) !== String(postId)) return item;
    return { ...item, ...normalized };
  };

  communityThreads = communityThreads.map(updateItem);
  communityReplies = communityReplies.map(updateItem);
  if (activeCommunityThread && String(activeCommunityThread.id) === String(postId)) {
    activeCommunityThread = updateItem(activeCommunityThread);
  }

  if (document.getElementById('communityBoardView') && !document.getElementById('communityBoardView').classList.contains('hidden')) {
    renderCommunityThreads();
  }
  if (activeCommunityThread && !document.getElementById('communityThreadView')?.classList.contains('hidden')) {
    renderActiveCommunityThreadFocus();
    renderCommunityReplies();
  }
}

async function saveCommunityVote(postId, vote) {
  await runLocked(`community:vote:${postId}`, async () => {
    try {
      const sessionUser = await ensureSupabaseWriteReady();
      if (!sessionUser) {
        setCommunityFeedback(activeCommunityThread ? 'communityReplyFeedback' : 'communityFeedback', 'Inicia sesión para votar.', 'error');
        return;
      }
      const { data } = await safeSupabaseMutation(
        'vote_community_post',
        () => supabaseClient.rpc('vote_community_post', { p_post_id: postId, p_vote: vote }),
        { timeout: 9000, retries: 1 }
      );
      const voteData = Array.isArray(data) ? data[0] : data;
      if (voteData) updateCommunityVoteState(postId, voteData);
    } catch (error) {
      setCommunityFeedback(
        activeCommunityThread ? 'communityReplyFeedback' : 'communityFeedback',
        userFacingCommunityError(error, 'No se pudo guardar tu voto.'),
        'error'
      );
    }
  });
}

function renderCommunityThreads(emptyMessage = '') {
  const list = document.getElementById('communityThreadList');
  if (!list) return;
  list.innerHTML = '';

  if (emptyMessage) {
    list.innerHTML = `<div class="ranking-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  if (!communityThreads.length) {
    list.innerHTML = '<div class="ranking-empty">Todavía no hay preguntas en el tablón.</div>';
    return;
  }

  communityThreads.forEach(post => {
    list.appendChild(createCommunityPostElement(post));
  });
}

function renderCommunityReplies(emptyMessage = '') {
  const list = document.getElementById('communityReplyList');
  if (!list) return;
  list.innerHTML = '';

  if (emptyMessage) {
    list.innerHTML = `<div class="ranking-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  if (!communityReplies.length) {
    list.innerHTML = '<div class="ranking-empty">Aún no hay respuestas en esta conversación.</div>';
    return;
  }

  communityReplies.forEach(reply => {
    list.appendChild(createCommunityPostElement({ ...reply, kind: 'reply' }, { reply: true }));
  });
}

function renderActiveCommunityThreadFocus() {
  if (!activeCommunityThread) return;
  const focus = document.getElementById('communityThreadFocus');
  if (!focus) return;
  focus.innerHTML = '';
  focus.appendChild(createCommunityPostElement(activeCommunityThread, { focus: true }));
}

async function loadCommunityThreads({ silent = false } = {}) {
  const list = document.getElementById('communityThreadList');
  if (list && !silent) list.innerHTML = '<div class="ranking-empty">Cargando tablón...</div>';

  try {
    const { data } = await safeSupabase(
      'get_community_threads',
      () => supabaseClient.rpc('get_community_threads', { p_limit: 50 }),
      { timeout: 12000, retries: 1 }
    );
    communityFeatureAvailable = true;
    clearTimeout(communityThreadRetryTimer);
    communityThreads = Array.isArray(data) ? data : [];
    persistCachedCommunityThreads();
    if (activeCommunityThread) {
      const freshThread = communityThreads.find(post => String(post.id) === String(activeCommunityThread.id));
      if (freshThread) {
        activeCommunityThread = freshThread;
        renderActiveCommunityThreadFocus();
      }
    }
    renderCommunityThreads();
    return true;
  } catch (error) {
    console.error('Error cargando tablón:', error);
    if (isTransientSupabaseError(error)) {
      if (!communityThreads.length) hydrateCachedCommunityThreads();
      if (!silent && list && !communityThreads.length) {
        list.innerHTML = '<div class="ranking-empty">Cargando tablón...</div>';
      }
      scheduleCommunityThreadsRetry();
      return false;
    }

    communityThreads = [];
    if (isMissingSupabaseResourceError(error)) {
      communityFeatureAvailable = false;
      renderCommunityThreads('Falta activar el tablón en Supabase.');
    } else {
      renderCommunityThreads(userFacingSupabaseError(error, 'No se pudo cargar el tablón.'));
    }
    return false;
  }
}

async function loadCommunityReplies(threadId, { silent = false } = {}) {
  const list = document.getElementById('communityReplyList');
  if (list && !silent) list.innerHTML = '<div class="ranking-empty">Cargando respuestas...</div>';

  try {
    const { data } = await safeSupabase(
      'get_community_replies',
      () => supabaseClient.rpc('get_community_replies', { p_thread_id: threadId, p_limit: 80 }),
      { timeout: 12000, retries: 1 }
    );
    communityFeatureAvailable = true;
    clearTimeout(communityReplyRetryTimer);
    communityReplies = Array.isArray(data) ? data : [];
    renderCommunityReplies();
    return true;
  } catch (error) {
    console.error('Error cargando respuestas:', error);
    if (isTransientSupabaseError(error)) {
      if (!silent && list && !communityReplies.length) {
        list.innerHTML = '<div class="ranking-empty">Cargando respuestas...</div>';
      }
      scheduleCommunityRepliesRetry(threadId);
      return false;
    }

    communityReplies = [];
    if (isMissingSupabaseResourceError(error)) {
      communityFeatureAvailable = false;
      renderCommunityReplies('Falta activar el tablón en Supabase.');
    } else {
      renderCommunityReplies(userFacingSupabaseError(error, 'No se pudieron cargar las respuestas.'));
    }
    return false;
  }
}

function openCommunityBoard() {
  document.getElementById('communityOverview')?.classList.add('hidden');
  document.getElementById('communityThreadView')?.classList.add('hidden');
  document.getElementById('communityArcadeView')?.classList.add('hidden');
  document.getElementById('communityBoardView')?.classList.remove('hidden');
  stopNeoArcadeLoop();
  activeCommunityThread = null;
  updateCommunityComposerUI();
  fetchCommunityRole({ silent: true });
  if (!communityThreads.length) hydrateCachedCommunityThreads();
  loadCommunityThreads({ silent: communityBoardLoaded });
  communityBoardLoaded = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeCommunityBoard() {
  document.getElementById('communityBoardView')?.classList.add('hidden');
  document.getElementById('communityThreadView')?.classList.add('hidden');
  document.getElementById('communityArcadeView')?.classList.add('hidden');
  document.getElementById('communityOverview')?.classList.remove('hidden');
  stopNeoArcadeLoop();
  activeCommunityThread = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openNeoArcadeGame() {
  document.getElementById('communityOverview')?.classList.add('hidden');
  document.getElementById('communityBoardView')?.classList.add('hidden');
  document.getElementById('communityThreadView')?.classList.add('hidden');
  document.getElementById('communityArcadeView')?.classList.remove('hidden');
  activeCommunityThread = null;
  showNeoArcadeMenu();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeNeoArcadeGame() {
  document.getElementById('communityArcadeView')?.classList.add('hidden');
  document.getElementById('communityOverview')?.classList.remove('hidden');
  stopNeoArcadeLoop();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getActiveArcadeGame() {
  return ARCADE_GAMES[activeArcadeGameKey] || ARCADE_GAMES[ARCADE_DEFAULT_GAME_KEY];
}

function isNeoRunnerGame() {
  return getActiveArcadeGame().kind === 'runner';
}

function getNeoArcadeBestKey() {
  return `${ARCADE_LOCAL_BEST_KEY}:${getActiveArcadeGame().key}`;
}

function showNeoArcadeMenu() {
  stopNeoArcadeLoop();
  document.getElementById('neoArcadeMenu')?.classList.remove('hidden');
  document.getElementById('neoArcadeGameArea')?.classList.add('hidden');
  document.getElementById('neoArcadeSubmitForm')?.classList.add('hidden');
  setNeoArcadeFeedback('');
  arcadeGame = null;
}

function backToNeoArcadeGames() {
  showNeoArcadeMenu();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startNeoArcadeGame(gameKey = ARCADE_DEFAULT_GAME_KEY) {
  activeArcadeGameKey = ARCADE_GAMES[gameKey] ? gameKey : ARCADE_DEFAULT_GAME_KEY;
  updateNeoArcadeGameLabels();
  document.getElementById('neoArcadeMenu')?.classList.add('hidden');
  document.getElementById('neoArcadeGameArea')?.classList.remove('hidden');
  initNeoArcadeGame();
  resetNeoWaveGame();
  loadNeoArcadeLeaderboard();
  window.setTimeout(() => document.getElementById('neoArcadeGameArea')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

function updateNeoArcadeGameLabels() {
  const game = getActiveArcadeGame();
  const kicker = document.getElementById('neoArcadeGameKicker');
  const title = document.getElementById('neoArcadeGameTitle');
  const instructions = document.getElementById('neoArcadeInstructionsText');
  const canvas = document.getElementById('neoWaveCanvas');
  if (kicker) kicker.textContent = game.kicker;
  if (title) title.textContent = game.title;
  if (instructions) instructions.textContent = game.instructions;
  if (canvas) canvas.setAttribute('aria-label', game.kicker);
}

function readNeoArcadeBest() {
  const value = Number(localStorage.getItem(getNeoArcadeBestKey()));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function writeNeoArcadeBest(score) {
  const normalized = Math.max(0, Math.floor(Number(score) || 0));
  localStorage.setItem(getNeoArcadeBestKey(), String(normalized));
}

function getNeoArcadePlayerKey() {
  let key = localStorage.getItem(ARCADE_PLAYER_KEY);
  if (!key) {
    key = crypto?.randomUUID?.() || `neo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(ARCADE_PLAYER_KEY, key);
  }
  return key;
}

function sanitizeArcadeInitials(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3);
}

function setNeoArcadeFeedback(message = '', type = '') {
  const feedback = document.getElementById('neoArcadeFeedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle('error', type === 'error');
}

function setNeoWaveOverlay(title = '', subtitle = '', hidden = false) {
  const overlay = document.getElementById('neoWaveOverlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', hidden);
  if (hidden) return;
  overlay.innerHTML = `
    <div class="neo-wave-overlay-title">${escapeHtml(title)}</div>
    <div class="neo-wave-overlay-sub">${escapeHtml(subtitle)}</div>
  `;
}

function updateNeoArcadeHud() {
  const score = arcadeGame?.score || 0;
  const best = arcadeGame?.best || readNeoArcadeBest();
  const topScore = arcadeScores[0]?.score;
  const scoreEl = document.getElementById('neoArcadeScore');
  const bestEl = document.getElementById('neoArcadeBest');
  const topEl = document.getElementById('neoArcadeTop');
  const actionBtn = document.getElementById('neoWaveActionBtn');
  if (scoreEl) scoreEl.textContent = String(score);
  if (bestEl) bestEl.textContent = String(best);
  if (topEl) topEl.textContent = Number.isFinite(Number(topScore)) ? String(topScore) : '--';
  if (actionBtn && arcadeGame) {
    actionBtn.textContent = arcadeGame.running ? getActiveArcadeGame().action : arcadeGame.gameOver ? 'Reintentar' : 'Empezar';
  }
}

function renderNeoArcadeLeaderboard(message = '') {
  const list = document.getElementById('neoArcadeLeaderboard');
  if (!list) return;
  if (message) {
    list.innerHTML = `<div class="ranking-empty">${escapeHtml(message)}</div>`;
    updateNeoArcadeHud();
    updateNeoArcadeSubmitPrompt();
    return;
  }
  if (!arcadeScores.length) {
    list.innerHTML = '<div class="ranking-empty">Todavía no hay marcas. La primera partida puede ser tuya.</div>';
    updateNeoArcadeHud();
    updateNeoArcadeSubmitPrompt();
    return;
  }
  const rankIcons = ['🏆', '🥈', '🥉'];
  list.innerHTML = arcadeScores.slice(0, 10).map((row, index) => `
    <div class="neo-arcade-rank-row${index < 3 ? ` top-rank-${index + 1}` : ''}">
      <span class="neo-arcade-rank-pos">${rankIcons[index] || `#${index + 1}`}</span>
      <span class="neo-arcade-rank-name">${escapeHtml(row.initials || 'NEO')}</span>
      <span class="neo-arcade-rank-score">${Number(row.score) || 0}</span>
    </div>
  `).join('');
  updateNeoArcadeHud();
  updateNeoArcadeSubmitPrompt();
}

async function loadNeoArcadeLeaderboard() {
  renderNeoArcadeLeaderboard('Cargando ranking...');
  try {
    const { data } = await safeSupabase(
      'get_arcade_leaderboard',
      () => supabaseClient.rpc('get_arcade_leaderboard', { p_game_key: getActiveArcadeGame().key, p_limit: 10 }),
      { timeout: 9000, retries: 1 }
    );
    arcadeFeatureAvailable = true;
    arcadeScores = Array.isArray(data) ? data : [];
    renderNeoArcadeLeaderboard();
  } catch (error) {
    arcadeScores = [];
    if (isMissingSupabaseResourceError(error)) {
      arcadeFeatureAvailable = false;
      renderNeoArcadeLeaderboard('Falta activar el ranking arcade en Supabase.');
      return;
    }
    renderNeoArcadeLeaderboard(userFacingSupabaseError(error, 'No se pudo cargar el ranking ahora mismo.'));
  }
}

function isNeoArcadeTopTenScore(score) {
  const normalized = Math.floor(Number(score) || 0);
  if (normalized <= 0 || !arcadeFeatureAvailable) return false;
  if (arcadeScores.length < 10) return true;
  const lowestTopScore = Math.min(...arcadeScores.slice(0, 10).map(row => Number(row.score) || 0));
  return normalized > lowestTopScore;
}

function updateNeoArcadeSubmitPrompt() {
  const submitForm = document.getElementById('neoArcadeSubmitForm');
  if (!submitForm || !arcadeGame?.gameOver) return;
  const score = Math.floor(Number(arcadeGame.score) || 0);
  const shouldShow = isNeoArcadeTopTenScore(score);
  submitForm.classList.toggle('hidden', !shouldShow);
  if (!shouldShow && score > 0) {
    if (!arcadeFeatureAvailable) setNeoArcadeFeedback('Falta activar el ranking arcade en Supabase.', 'error');
    else setNeoArcadeFeedback('Buena partida. Para subir marca necesitas entrar en el Top 10.');
  }
}

async function submitNeoArcadeScore(event) {
  event?.preventDefault?.();
  if (arcadeSubmitting) return;
  const score = Math.floor(Number(arcadeGame?.score) || 0);
  const initialsInput = document.getElementById('neoArcadeInitials');
  const initials = sanitizeArcadeInitials(initialsInput?.value || '');
  if (!score) {
    setNeoArcadeFeedback('Haz una partida antes de subir marca.', 'error');
    return;
  }
  if (initials.length !== 3) {
    setNeoArcadeFeedback('Usa exactamente 3 letras o números.', 'error');
    initialsInput?.focus();
    return;
  }

  arcadeSubmitting = true;
  setNeoArcadeFeedback('Subiendo marca...');
  try {
    await safeSupabase(
      'submit_arcade_score',
      () => supabaseClient.rpc('submit_arcade_score', {
        p_game_key: getActiveArcadeGame().key,
        p_initials: initials,
        p_score: score,
        p_player_key: getNeoArcadePlayerKey()
      }),
      { timeout: 9000, retries: 1 }
    );
    setNeoArcadeFeedback('Marca guardada en el Top Comunidad.');
    await loadNeoArcadeLeaderboard();
  } catch (error) {
    if (isMissingSupabaseResourceError(error)) {
      arcadeFeatureAvailable = false;
      setNeoArcadeFeedback('Falta activar el ranking arcade en Supabase.', 'error');
    } else {
      setNeoArcadeFeedback(userFacingSupabaseError(error, 'No se pudo subir tu marca.'), 'error');
    }
  } finally {
    arcadeSubmitting = false;
  }
}

function createNeoWaveState() {
  if (isNeoRunnerGame()) return createNeoRunnerState();
  return {
    running: false,
    gameOver: false,
    score: 0,
    best: readNeoArcadeBest(),
    width: 900,
    height: 420,
    playerX: 150,
    playerY: 210,
    velocity: 0,
    radius: 17,
    obstacles: [],
    particles: [],
    combo: 0,
    bestCombo: 0,
    lastBonus: '',
    lastBonusTtl: 0,
    spawnTimer: 0,
    elapsed: 0
  };
}

function initNeoArcadeGame() {
  const canvas = document.getElementById('neoWaveCanvas');
  if (!canvas) return;
  if (!arcadeGame) arcadeGame = createNeoWaveState();
  updateNeoArcadeGameLabels();
  resizeNeoWaveCanvas();
  updateNeoArcadeHud();
  if (!arcadeCanvasInitialized) {
    canvas.addEventListener('pointerdown', event => {
      event.preventDefault();
      handleNeoWaveAction();
    }, { passive: false });
    window.addEventListener('resize', resizeNeoWaveCanvas);
    document.addEventListener('keydown', event => {
      const arcadeOpen = !document.getElementById('communityArcadeView')?.classList.contains('hidden');
      if (!arcadeOpen) return;
      if (event.code === 'Space' || event.key === 'ArrowUp') {
        event.preventDefault();
        handleNeoWaveAction();
      }
    });
    document.getElementById('neoArcadeInitials')?.addEventListener('input', event => {
      event.currentTarget.value = sanitizeArcadeInitials(event.currentTarget.value);
    });
    arcadeCanvasInitialized = true;
  }
  startNeoArcadeLoop();
}

function resizeNeoWaveCanvas() {
  const canvas = document.getElementById('neoWaveCanvas');
  if (!canvas || !arcadeGame) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, Math.floor(rect.width || 900));
  const height = Math.max(260, Math.floor(rect.height || 420));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  arcadeGame.width = width;
  arcadeGame.height = height;
  if (isNeoRunnerGame()) {
    resizeNeoRunnerGame();
    drawNeoWaveGame();
    return;
  }
  arcadeGame.playerX = Math.max(74, Math.min(150, width * .22));
  arcadeGame.radius = width < 520 ? 15 : 17;
  if (!arcadeGame.running) arcadeGame.playerY = height * .48;
  arcadeGame.playerY = Math.max(arcadeGame.radius + 4, Math.min(height - arcadeGame.radius - 4, arcadeGame.playerY));
  drawNeoWaveGame();
}

function resetNeoWaveGame() {
  if (isNeoRunnerGame()) return resetNeoRunnerGame();
  arcadeGame = {
    ...createNeoWaveState(),
    width: arcadeGame?.width || 900,
    height: arcadeGame?.height || 420
  };
  arcadeGame.playerX = Math.max(74, Math.min(150, arcadeGame.width * .22));
  arcadeGame.playerY = arcadeGame.height * .48;
  document.getElementById('neoArcadeSubmitForm')?.classList.add('hidden');
  setNeoArcadeFeedback('');
  const game = getActiveArcadeGame();
  setNeoWaveOverlay(game.startTitle, game.startSub);
  updateNeoArcadeHud();
  resizeNeoWaveCanvas();
  startNeoArcadeLoop();
}

function startNeoWaveGame() {
  if (isNeoRunnerGame()) return startNeoRunnerGame();
  if (!arcadeGame) arcadeGame = createNeoWaveState();
  arcadeGame.running = true;
  arcadeGame.gameOver = false;
  arcadeGame.score = 0;
  arcadeGame.velocity = -260;
  arcadeGame.obstacles = [];
  arcadeGame.particles = [];
  arcadeGame.combo = 0;
  arcadeGame.bestCombo = 0;
  arcadeGame.lastBonus = '';
  arcadeGame.lastBonusTtl = 0;
  arcadeGame.spawnTimer = .75;
  arcadeGame.elapsed = 0;
  document.getElementById('neoArcadeSubmitForm')?.classList.add('hidden');
  setNeoArcadeFeedback('');
  setNeoWaveOverlay('', '', true);
  addNeoWaveParticles(arcadeGame.playerX - 6, arcadeGame.playerY, 12, 'rgba(255,45,120,.88)');
  updateNeoArcadeHud();
  startNeoArcadeLoop();
}

function addNeoWaveParticles(x, y, count = 8, color = 'rgba(114,247,255,.95)') {
  if (!arcadeGame) return;
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 145;
    arcadeGame.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed - 55,
      vy: Math.sin(angle) * speed,
      life: .34 + Math.random() * .34,
      ttl: .34 + Math.random() * .34,
      size: 2 + Math.random() * 4,
      color
    });
  }
  if (arcadeGame.particles.length > 90) arcadeGame.particles.splice(0, arcadeGame.particles.length - 90);
}

function handleNeoWaveAction() {
  if (isNeoRunnerGame()) return handleNeoRunnerAction();
  if (!arcadeGame || arcadeGame.gameOver) {
    resetNeoWaveGame();
    startNeoWaveGame();
    return;
  }
  if (!arcadeGame.running) {
    startNeoWaveGame();
    return;
  }
  arcadeGame.velocity = -335;
  addNeoWaveParticles(arcadeGame.playerX - 10, arcadeGame.playerY + 8, 5, 'rgba(0,212,255,.92)');
}

function endNeoWaveGame() {
  if (!arcadeGame || arcadeGame.gameOver) return;
  arcadeGame.running = false;
  arcadeGame.gameOver = true;
  if (arcadeGame.score > arcadeGame.best) {
    arcadeGame.best = arcadeGame.score;
    writeNeoArcadeBest(arcadeGame.best);
  }
  const submitForm = document.getElementById('neoArcadeSubmitForm');
  submitForm?.classList.add('hidden');
  const initialsInput = document.getElementById('neoArcadeInitials');
  if (initialsInput && !initialsInput.value) initialsInput.value = 'NEO';
  const topTen = isNeoArcadeTopTenScore(arcadeGame.score);
  setNeoWaveOverlay(
    `Partida terminada: ${arcadeGame.score} pts`,
    topTen ? 'Has entrado en zona Top 10: guarda tu marca con 3 iniciales.' : 'Buena partida. Vuelve a intentarlo para entrar en el Top 10.'
  );
  updateNeoArcadeSubmitPrompt();
  updateNeoArcadeHud();
}

function spawnNeoWaveObstacle() {
  if (!arcadeGame) return;
  const gap = Math.max(116, Math.min(166, arcadeGame.height * .34));
  const margin = 52;
  const range = Math.max(30, arcadeGame.height - gap - margin * 2);
  const gapTop = margin + Math.random() * range;
  arcadeGame.obstacles.push({
    x: arcadeGame.width + 34,
    width: arcadeGame.width < 520 ? 48 : 58,
    gapTop,
    gapBottom: gapTop + gap,
    orbY: gapTop + gap * (.38 + Math.random() * .24),
    orbCollected: false,
    passed: false
  });
}

function updateNeoWaveGame(dt) {
  if (isNeoRunnerGame()) return updateNeoRunnerGame(dt);
  if (!arcadeGame?.running) return;
  arcadeGame.elapsed += dt;
  arcadeGame.velocity += 760 * dt;
  arcadeGame.playerY += arcadeGame.velocity * dt;
  arcadeGame.lastBonusTtl = Math.max(0, arcadeGame.lastBonusTtl - dt);
  arcadeGame.particles.forEach(particle => {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 90 * dt;
    particle.life -= dt;
  });
  arcadeGame.particles = arcadeGame.particles.filter(particle => particle.life > 0);
  arcadeGame.spawnTimer -= dt;
  if (arcadeGame.spawnTimer <= 0) {
    spawnNeoWaveObstacle();
    arcadeGame.spawnTimer = Math.max(1.04, 1.52 - arcadeGame.score * .012);
  }

  const speed = Math.min(255, 170 + arcadeGame.score * 2.4);
  arcadeGame.obstacles.forEach(obstacle => {
    obstacle.x -= speed * dt;
    const orbX = obstacle.x + obstacle.width / 2;
    if (!obstacle.orbCollected) {
      const dx = arcadeGame.playerX - orbX;
      const dy = arcadeGame.playerY - obstacle.orbY;
      if (Math.hypot(dx, dy) < arcadeGame.radius + 13) {
        obstacle.orbCollected = true;
        arcadeGame.combo += 1;
        arcadeGame.bestCombo = Math.max(arcadeGame.bestCombo, arcadeGame.combo);
        arcadeGame.score += 2;
        arcadeGame.lastBonus = arcadeGame.combo >= 3 ? `combo x${arcadeGame.combo}` : '+2 orbe';
        arcadeGame.lastBonusTtl = .9;
        addNeoWaveParticles(orbX, obstacle.orbY, 15, 'rgba(255,214,102,.95)');
        updateNeoArcadeHud();
      }
    }
    if (!obstacle.passed && obstacle.x + obstacle.width < arcadeGame.playerX - arcadeGame.radius) {
      obstacle.passed = true;
      arcadeGame.score += 1;
      updateNeoArcadeHud();
    }
  });
  arcadeGame.obstacles = arcadeGame.obstacles.filter(obstacle => obstacle.x + obstacle.width > -40);

  const topHit = arcadeGame.playerY - arcadeGame.radius <= 0;
  const bottomHit = arcadeGame.playerY + arcadeGame.radius >= arcadeGame.height;
  if (topHit || bottomHit) {
    arcadeGame.combo = 0;
    endNeoWaveGame();
    return;
  }

  for (const obstacle of arcadeGame.obstacles) {
    const withinX = arcadeGame.playerX + arcadeGame.radius > obstacle.x && arcadeGame.playerX - arcadeGame.radius < obstacle.x + obstacle.width;
    const outsideGap = arcadeGame.playerY - arcadeGame.radius < obstacle.gapTop || arcadeGame.playerY + arcadeGame.radius > obstacle.gapBottom;
    if (withinX && outsideGap) {
      arcadeGame.combo = 0;
      endNeoWaveGame();
      return;
    }
  }
}

function drawNeoWaveGame() {
  if (isNeoRunnerGame()) return drawNeoRunnerGame();
  const canvas = document.getElementById('neoWaveCanvas');
  if (!canvas || !arcadeGame) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = arcadeGame;
  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#080a18');
  bg.addColorStop(.54, '#090716');
  bg.addColorStop(1, '#150819');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = .28;
  for (let i = 0; i < 18; i += 1) {
    const y = (i * 47 + arcadeGame.elapsed * 18) % height;
    ctx.strokeStyle = i % 2 ? 'rgba(255,45,120,.13)' : 'rgba(0,212,255,.14)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y - 42);
    ctx.stroke();
  }
  ctx.restore();

  arcadeGame.obstacles.forEach(obstacle => drawNeoWaveObstacle(ctx, obstacle));
  drawNeoWaveParticles(ctx);
  drawNeoWavePlayer(ctx);
  drawNeoWaveBonus(ctx);
}

function neoArcadeRoundRectPath(ctx, x, y, width, height, radius) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function drawNeoWaveObstacle(ctx, obstacle) {
  const drawSegment = (y, h) => {
    const gradient = ctx.createLinearGradient(obstacle.x, y, obstacle.x + obstacle.width, y);
    gradient.addColorStop(0, 'rgba(0,212,255,.16)');
    gradient.addColorStop(.5, 'rgba(255,45,120,.44)');
    gradient.addColorStop(1, 'rgba(114,247,255,.18)');
    ctx.fillStyle = gradient;
    ctx.strokeStyle = 'rgba(255,75,147,.62)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    neoArcadeRoundRectPath(ctx, obstacle.x, y, obstacle.width, h, 16);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = 'rgba(255,45,120,.38)';
    ctx.shadowBlur = 14;
    ctx.strokeRect(obstacle.x + 8, y + 8, obstacle.width - 16, Math.max(0, h - 16));
    ctx.shadowBlur = 0;
  };
  drawSegment(-18, obstacle.gapTop + 18);
  drawSegment(obstacle.gapBottom, arcadeGame.height - obstacle.gapBottom + 18);
  if (!obstacle.orbCollected) {
    const orbX = obstacle.x + obstacle.width / 2;
    const pulse = Math.sin(arcadeGame.elapsed * 9 + orbX * .02) * 2;
    ctx.save();
    ctx.shadowColor = 'rgba(255,214,102,.78)';
    ctx.shadowBlur = 18;
    const orbGradient = ctx.createRadialGradient(orbX - 3, obstacle.orbY - 3, 2, orbX, obstacle.orbY, 15 + pulse);
    orbGradient.addColorStop(0, '#fff9c9');
    orbGradient.addColorStop(.55, '#ffd666');
    orbGradient.addColorStop(1, 'rgba(255,45,120,.16)');
    ctx.fillStyle = orbGradient;
    ctx.beginPath();
    ctx.arc(orbX, obstacle.orbY, 10 + pulse * .25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.65)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

function drawNeoWaveParticles(ctx) {
  if (!arcadeGame?.particles?.length) return;
  ctx.save();
  arcadeGame.particles.forEach(particle => {
    const alpha = Math.max(0, particle.life / particle.ttl);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.shadowColor = particle.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawNeoWaveBonus(ctx) {
  if (!arcadeGame?.lastBonus || arcadeGame.lastBonusTtl <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, arcadeGame.lastBonusTtl * 1.4);
  ctx.font = '700 14px Orbitron, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = arcadeGame.combo >= 3 ? '#ffd666' : '#72f6ff';
  ctx.shadowColor = arcadeGame.combo >= 3 ? 'rgba(255,214,102,.75)' : 'rgba(0,212,255,.75)';
  ctx.shadowBlur = 14;
  ctx.fillText(arcadeGame.lastBonus.toUpperCase(), arcadeGame.playerX + 24, arcadeGame.playerY - 22);
  ctx.restore();
}

function drawNeoWavePlayer(ctx) {
  const { playerX, playerY, radius, elapsed } = arcadeGame;
  ctx.save();
  ctx.translate(playerX, playerY);
  const bob = Math.sin(elapsed * 12) * 2;
  ctx.rotate(Math.max(-.45, Math.min(.45, arcadeGame.velocity / 720)));
  ctx.shadowColor = 'rgba(0,212,255,.82)';
  ctx.shadowBlur = 20;
  const body = ctx.createLinearGradient(-radius - 14, 0, radius + 22, 0);
  body.addColorStop(0, '#eaffff');
  body.addColorStop(.35, '#59ecff');
  body.addColorStop(.72, '#287dff');
  body.addColorStop(1, '#ff2d78');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(radius + 24, 0);
  ctx.quadraticCurveTo(5, -radius - 14 + bob, -radius - 18, -radius * .58);
  ctx.quadraticCurveTo(-radius - 8, 0, -radius - 18, radius * .58);
  ctx.quadraticCurveTo(5, radius + 14 - bob, radius + 24, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,252,255,.76)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.shadowColor = 'rgba(255,45,120,.56)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(4,8,24,.74)';
  ctx.beginPath();
  ctx.ellipse(1, 0, radius * .82, radius * .58, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(114,247,255,.85)';
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#dffbff';
  ctx.font = '800 18px Orbitron, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 1, 1);

  ctx.shadowColor = 'rgba(0,212,255,.72)';
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.moveTo(-radius - 18, -7);
  ctx.lineTo(-radius - 34, 0);
  ctx.lineTo(-radius - 18, 7);
  ctx.strokeStyle = 'rgba(114,247,255,.62)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function createNeoRunnerState() {
  return {
    running: false,
    gameOver: false,
    score: 0,
    best: readNeoArcadeBest(),
    width: 900,
    height: 420,
    playerX: 122,
    runnerY: 300,
    runnerVy: 0,
    runnerW: 34,
    runnerH: 46,
    groundY: 350,
    onGround: true,
    obstacles: [],
    particles: [],
    combo: 0,
    bestCombo: 0,
    lastBonus: '',
    lastBonusTtl: 0,
    spawnTimer: 0,
    elapsed: 0
  };
}

function resizeNeoRunnerGame() {
  if (!arcadeGame) return;
  arcadeGame.playerX = Math.max(78, Math.min(136, arcadeGame.width * .18));
  arcadeGame.runnerW = arcadeGame.width < 520 ? 31 : 36;
  arcadeGame.runnerH = arcadeGame.width < 520 ? 42 : 48;
  arcadeGame.groundY = arcadeGame.height - (arcadeGame.height < 340 ? 46 : 60);
  if (!arcadeGame.running || arcadeGame.onGround) {
    arcadeGame.runnerY = arcadeGame.groundY - arcadeGame.runnerH;
    arcadeGame.onGround = true;
  }
}

function resetNeoRunnerGame() {
  arcadeGame = {
    ...createNeoRunnerState(),
    width: arcadeGame?.width || 900,
    height: arcadeGame?.height || 420
  };
  resizeNeoRunnerGame();
  document.getElementById('neoArcadeSubmitForm')?.classList.add('hidden');
  setNeoArcadeFeedback('');
  const game = getActiveArcadeGame();
  setNeoWaveOverlay(game.startTitle, game.startSub);
  updateNeoArcadeHud();
  resizeNeoWaveCanvas();
  startNeoArcadeLoop();
}

function startNeoRunnerGame() {
  if (!arcadeGame) arcadeGame = createNeoRunnerState();
  arcadeGame.running = true;
  arcadeGame.gameOver = false;
  arcadeGame.score = 0;
  arcadeGame.runnerVy = 0;
  arcadeGame.obstacles = [];
  arcadeGame.particles = [];
  arcadeGame.combo = 0;
  arcadeGame.bestCombo = 0;
  arcadeGame.lastBonus = '';
  arcadeGame.lastBonusTtl = 0;
  arcadeGame.spawnTimer = .8;
  arcadeGame.elapsed = 0;
  arcadeGame.onGround = true;
  arcadeGame.runnerY = arcadeGame.groundY - arcadeGame.runnerH;
  document.getElementById('neoArcadeSubmitForm')?.classList.add('hidden');
  setNeoArcadeFeedback('');
  setNeoWaveOverlay('', '', true);
  addNeoWaveParticles(arcadeGame.playerX, arcadeGame.runnerY + arcadeGame.runnerH, 12, 'rgba(255,214,102,.92)');
  updateNeoArcadeHud();
  startNeoArcadeLoop();
}

function handleNeoRunnerAction() {
  if (!arcadeGame || arcadeGame.gameOver) {
    resetNeoRunnerGame();
    startNeoRunnerGame();
    return;
  }
  if (!arcadeGame.running) {
    startNeoRunnerGame();
    return;
  }
  if (arcadeGame.onGround) {
    arcadeGame.runnerVy = -520;
    arcadeGame.onGround = false;
    addNeoWaveParticles(arcadeGame.playerX + 4, arcadeGame.groundY - 2, 10, 'rgba(0,212,255,.88)');
  }
}

function spawnNeoRunnerObstacle() {
  if (!arcadeGame) return;
  const tall = Math.random() > .62;
  const width = tall ? 30 + Math.random() * 14 : 38 + Math.random() * 18;
  const height = tall ? 52 + Math.random() * 24 : 30 + Math.random() * 18;
  const obstacle = {
    x: arcadeGame.width + 40,
    y: arcadeGame.groundY - height,
    width,
    height,
    passed: false,
    coreCollected: false,
    coreX: arcadeGame.width + 40 + width + 36 + Math.random() * 26,
    coreY: arcadeGame.groundY - height - 38 - Math.random() * 34
  };
  arcadeGame.obstacles.push(obstacle);
}

function neoArcadeRectsOverlap(a, b) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

function updateNeoRunnerGame(dt) {
  if (!arcadeGame?.running) return;
  arcadeGame.elapsed += dt;
  arcadeGame.lastBonusTtl = Math.max(0, arcadeGame.lastBonusTtl - dt);
  const speed = Math.min(355, 210 + arcadeGame.score * 2.1);

  arcadeGame.runnerVy += 1120 * dt;
  arcadeGame.runnerY += arcadeGame.runnerVy * dt;
  if (arcadeGame.runnerY + arcadeGame.runnerH >= arcadeGame.groundY) {
    arcadeGame.runnerY = arcadeGame.groundY - arcadeGame.runnerH;
    arcadeGame.runnerVy = 0;
    arcadeGame.onGround = true;
  }

  arcadeGame.particles.forEach(particle => {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 120 * dt;
    particle.life -= dt;
  });
  arcadeGame.particles = arcadeGame.particles.filter(particle => particle.life > 0);

  arcadeGame.spawnTimer -= dt;
  if (arcadeGame.spawnTimer <= 0) {
    spawnNeoRunnerObstacle();
    arcadeGame.spawnTimer = Math.max(.86, 1.34 - arcadeGame.score * .008) + Math.random() * .34;
  }

  const playerBox = {
    x: arcadeGame.playerX - arcadeGame.runnerW * .42,
    y: arcadeGame.runnerY + 4,
    width: arcadeGame.runnerW * .84,
    height: arcadeGame.runnerH - 6
  };

  arcadeGame.obstacles.forEach(obstacle => {
    obstacle.x -= speed * dt;
    obstacle.coreX -= speed * dt;

    if (!obstacle.passed && obstacle.x + obstacle.width < arcadeGame.playerX - arcadeGame.runnerW / 2) {
      obstacle.passed = true;
      arcadeGame.score += 1;
      updateNeoArcadeHud();
    }

    if (!obstacle.coreCollected) {
      const dx = arcadeGame.playerX - obstacle.coreX;
      const dy = (arcadeGame.runnerY + arcadeGame.runnerH * .45) - obstacle.coreY;
      if (Math.hypot(dx, dy) < 24) {
        obstacle.coreCollected = true;
        arcadeGame.combo += 1;
        arcadeGame.score += 2;
        arcadeGame.lastBonus = arcadeGame.combo >= 3 ? `combo x${arcadeGame.combo}` : '+2 núcleo';
        arcadeGame.lastBonusTtl = .9;
        addNeoWaveParticles(obstacle.coreX, obstacle.coreY, 14, 'rgba(255,214,102,.95)');
        updateNeoArcadeHud();
      }
    }

    if (neoArcadeRectsOverlap(playerBox, obstacle)) {
      arcadeGame.combo = 0;
      endNeoWaveGame();
    }
  });

  arcadeGame.obstacles = arcadeGame.obstacles.filter(obstacle => obstacle.x + obstacle.width > -60 || obstacle.coreX > -40);
}

function drawNeoRunnerGame() {
  const canvas = document.getElementById('neoWaveCanvas');
  if (!canvas || !arcadeGame) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = arcadeGame;
  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#070917');
  bg.addColorStop(.58, '#0d0718');
  bg.addColorStop(1, '#180912');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = .34;
  for (let i = 0; i < 14; i += 1) {
    const x = (i * 95 - arcadeGame.elapsed * 85) % (width + 120);
    ctx.strokeStyle = i % 2 ? 'rgba(255,45,120,.18)' : 'rgba(0,212,255,.18)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - 95, height);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  const ground = ctx.createLinearGradient(0, arcadeGame.groundY, 0, height);
  ground.addColorStop(0, 'rgba(0,212,255,.26)');
  ground.addColorStop(1, 'rgba(255,45,120,.08)');
  ctx.fillStyle = ground;
  ctx.fillRect(0, arcadeGame.groundY, width, height - arcadeGame.groundY);
  ctx.strokeStyle = 'rgba(114,247,255,.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, arcadeGame.groundY + .5);
  ctx.lineTo(width, arcadeGame.groundY + .5);
  ctx.stroke();
  ctx.restore();

  arcadeGame.obstacles.forEach(obstacle => {
    drawNeoRunnerObstacle(ctx, obstacle);
    if (!obstacle.coreCollected) drawNeoRunnerCore(ctx, obstacle);
  });
  drawNeoWaveParticles(ctx);
  drawNeoRunnerPlayer(ctx);
  drawNeoWaveBonus(ctx);
}

function drawNeoRunnerObstacle(ctx, obstacle) {
  ctx.save();
  const gradient = ctx.createLinearGradient(obstacle.x, obstacle.y, obstacle.x + obstacle.width, obstacle.y + obstacle.height);
  gradient.addColorStop(0, 'rgba(255,45,120,.74)');
  gradient.addColorStop(.56, 'rgba(123,79,255,.52)');
  gradient.addColorStop(1, 'rgba(0,212,255,.34)');
  ctx.fillStyle = gradient;
  ctx.strokeStyle = 'rgba(255,130,175,.72)';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(255,45,120,.42)';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(obstacle.x + obstacle.width * .5, obstacle.y);
  ctx.lineTo(obstacle.x + obstacle.width, obstacle.y + obstacle.height);
  ctx.lineTo(obstacle.x, obstacle.y + obstacle.height);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawNeoRunnerCore(ctx, obstacle) {
  const pulse = Math.sin(arcadeGame.elapsed * 10 + obstacle.coreX * .02) * 2;
  ctx.save();
  ctx.shadowColor = 'rgba(255,214,102,.78)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffd666';
  ctx.strokeStyle = 'rgba(255,255,255,.70)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(obstacle.coreX, obstacle.coreY, 9 + pulse * .25, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawNeoRunnerPlayer(ctx) {
  const { playerX, runnerY, runnerW, runnerH, elapsed } = arcadeGame;
  const foot = arcadeGame.onGround ? Math.sin(elapsed * 22) * 3 : 0;
  ctx.save();
  ctx.translate(playerX, runnerY);
  ctx.shadowColor = 'rgba(0,212,255,.80)';
  ctx.shadowBlur = 18;
  const body = ctx.createLinearGradient(-runnerW / 2, 0, runnerW / 2, runnerH);
  body.addColorStop(0, '#eaffff');
  body.addColorStop(.42, '#55e8ff');
  body.addColorStop(.78, '#2c7dff');
  body.addColorStop(1, '#ff2d78');
  ctx.fillStyle = body;
  ctx.beginPath();
  neoArcadeRoundRectPath(ctx, -runnerW / 2, 2, runnerW, runnerH - 8, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,252,255,.72)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(5,8,22,.82)';
  ctx.beginPath();
  ctx.arc(0, runnerH * .42, runnerW * .30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(114,247,255,.82)';
  ctx.stroke();
  ctx.fillStyle = '#eaffff';
  ctx.font = '800 13px Orbitron, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, runnerH * .43);

  ctx.strokeStyle = 'rgba(114,247,255,.82)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-runnerW * .22, runnerH - 5);
  ctx.lineTo(-runnerW * .38, runnerH + foot);
  ctx.moveTo(runnerW * .22, runnerH - 5);
  ctx.lineTo(runnerW * .38, runnerH - foot);
  ctx.stroke();
  ctx.restore();
}

function startNeoArcadeLoop() {
  if (arcadeAnimationFrame) return;
  arcadeLastFrame = 0;
  const tick = timestamp => {
    if (!arcadeLastFrame) arcadeLastFrame = timestamp;
    const dt = Math.min(.034, Math.max(0, (timestamp - arcadeLastFrame) / 1000));
    arcadeLastFrame = timestamp;
    updateNeoWaveGame(dt);
    drawNeoWaveGame();
    arcadeAnimationFrame = requestAnimationFrame(tick);
  };
  arcadeAnimationFrame = requestAnimationFrame(tick);
}

function stopNeoArcadeLoop() {
  if (arcadeAnimationFrame) cancelAnimationFrame(arcadeAnimationFrame);
  arcadeAnimationFrame = 0;
  arcadeLastFrame = 0;
}

async function openCommunityThread(threadId) {
  const thread = communityThreads.find(post => String(post.id) === String(threadId));
  if (!thread) return;
  activeCommunityThread = thread;

  renderActiveCommunityThreadFocus();

  document.getElementById('communityBoardView')?.classList.add('hidden');
  document.getElementById('communityOverview')?.classList.add('hidden');
  document.getElementById('communityArcadeView')?.classList.add('hidden');
  document.getElementById('communityThreadView')?.classList.remove('hidden');
  stopNeoArcadeLoop();
  updateCommunityComposerUI();
  await loadCommunityReplies(thread.id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function backToCommunityBoard() {
  document.getElementById('communityThreadView')?.classList.add('hidden');
  document.getElementById('communityBoardView')?.classList.remove('hidden');
  activeCommunityThread = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function createCommunityThread(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const submitBtn = form.querySelector('button[type="submit"]');
  const textarea = document.getElementById('communityPostBody');
  const body = textarea?.value.trim() || '';
  if (body.length < 2) {
    setCommunityFeedback('communityFeedback', 'Escribe al menos 2 caracteres.', 'error');
    return;
  }

  await runLocked('community:create-thread', async () => {
    setButtonBusy(submitBtn, true, 'Publicando...');
    setCommunityFeedback('communityFeedback', 'Publicando...');
    try {
      const sessionUser = await ensureSupabaseWriteReady();
      if (!sessionUser) {
        setCommunityFeedback('communityFeedback', 'Inicia sesión para publicar.', 'error');
        return;
      }
      await fetchCommunityRole({ silent: true });
      if (!isCommunityModerator()) {
        setCommunityFeedback('communityFeedback', 'Solo los moderadores pueden crear preguntas.', 'error');
        return;
      }
      await safeSupabaseMutation(
        'create_community_question',
        () => supabaseClient.rpc('create_community_question', { p_body: body }),
        { timeout: 9000, retries: 1 }
      );
      textarea.value = '';
      updateCommunityCounts();
      setCommunityFeedback('communityFeedback', 'Pregunta publicada como NeoAnimeZ.', 'success');
      setCommunityAdminTab('list');
      await loadCommunityThreads({ silent: true });
    } catch (error) {
      setCommunityFeedback('communityFeedback', userFacingCommunityError(error, 'No se pudo publicar. Revisa que el SQL del tablón esté ejecutado.'), 'error');
    } finally {
      setButtonBusy(submitBtn, false);
    }
  });
}

async function createCommunityReply(event) {
  event.preventDefault();
  if (!activeCommunityThread) {
    setCommunityFeedback('communityReplyFeedback', 'Inicia sesión para responder.', 'error');
    return;
  }

  const form = event.currentTarget;
  const submitBtn = form.querySelector('button[type="submit"]');
  const textarea = document.getElementById('communityReplyBody');
  const body = textarea?.value.trim() || '';
  if (body.length < 2) {
    setCommunityFeedback('communityReplyFeedback', 'Escribe al menos 2 caracteres.', 'error');
    return;
  }

  await runLocked(`community:reply:${activeCommunityThread.id}`, async () => {
    setButtonBusy(submitBtn, true, 'Respondiendo...');
    setCommunityFeedback('communityReplyFeedback', 'Publicando respuesta...');
    try {
      const sessionUser = await ensureSupabaseWriteReady();
      if (!sessionUser) {
        setCommunityFeedback('communityReplyFeedback', 'Inicia sesión para responder.', 'error');
        return;
      }
      await safeSupabaseMutation(
        'create_community_reply',
        () => supabaseClient.rpc('create_community_reply', { p_thread_id: activeCommunityThread.id, p_body: body }),
        { timeout: 9000, retries: 1 }
      );
      textarea.value = '';
      updateCommunityCounts();
      setCommunityFeedback('communityReplyFeedback', 'Respuesta publicada.', 'success');
      await loadCommunityReplies(activeCommunityThread.id, { silent: true });
      await loadCommunityThreads({ silent: true });
    } catch (error) {
      setCommunityFeedback('communityReplyFeedback', userFacingCommunityError(error, 'No se pudo responder. Revisa que el SQL del tablón esté ejecutado.'), 'error');
    } finally {
      setButtonBusy(submitBtn, false);
    }
  });
}

async function deleteCommunityPost(postId) {
  if (!postId) return;
  if (!window.confirm('¿Borrar este mensaje del tablón?')) return;

  await runLocked(`community:delete:${postId}`, async () => {
    try {
      const sessionUser = await ensureSupabaseWriteReady();
      if (!sessionUser) return;
      await safeSupabaseMutation(
        'delete_community_post',
        () => supabaseClient.rpc('delete_community_post', { p_post_id: postId }),
        { timeout: 9000, retries: 1 }
      );
      if (activeCommunityThread && String(activeCommunityThread.id) === String(postId)) {
        backToCommunityBoard();
      }
      await loadCommunityThreads({ silent: true });
      if (activeCommunityThread) await loadCommunityReplies(activeCommunityThread.id, { silent: true });
    } catch (error) {
      setCommunityFeedback(
        activeCommunityThread ? 'communityReplyFeedback' : 'communityFeedback',
        userFacingCommunityError(error, 'No se pudo borrar el mensaje.'),
        'error'
      );
    }
  });
}

async function refreshUserAnimeData({ silent = false } = {}) {
  if (!currentUser) {
    setCurrentUser(null);
    renderUserLists();
    return true;
  }

  hydrateCachedUserAnimeData(currentUser.id);
  if (await fetchUserAnimeBundle({ silent: true })) {
    renderUserLists();
    return true;
  }

  const results = await Promise.allSettled([
    fetchUserStatuses({ silent }),
    fetchUserRatings({ silent: true }),
    fetchUserProgress({ silent: true })
  ]);
  renderUserLists();
  return results.every(result => result.status === 'fulfilled' && result.value !== false);
}

async function refreshAfterResume() {
  if (resumeRefreshRunning || document.visibilityState === 'hidden' || !DB.length) return;
  if (Date.now() - lastResumeRefreshAt < 2500) return;
  lastResumeRefreshAt = Date.now();
  if (!navigator.onLine) return;

  resumeRefreshRunning = true;
  try {
    let sessionUser = null;
    let sessionChecked = false;

    try {
      const { data } = await safeSupabase(
        'auth.getSession.resume',
        () => supabaseClient.auth.getSession(),
        { timeout: 6500, retries: 1 }
      );
      sessionChecked = true;
      sessionUser = data?.session?.user || null;
    } catch (error) {
      if (isTransientSupabaseError(error)) {
        scheduleResumeRefresh(2500);
        return;
      }
      console.warn('No se pudo leer la sesión al volver a la app:', error);
    }

    if (!sessionUser && !currentUser?.id) {
      sessionUser = readStoredSupabaseUser();
    }

    if (!sessionUser && currentUser?.id) {
      try {
        const { data } = await safeSupabase(
          'auth.refreshSession.resume',
          () => supabaseClient.auth.refreshSession(),
          { timeout: 6500, retries: 1 }
        );
        sessionUser = data?.session?.user || null;
      } catch (error) {
        if (isTransientSupabaseError(error)) {
          scheduleResumeRefresh(2500);
          return;
        }
        console.warn('No se pudo refrescar la sesión al volver a la app:', error);
      }
    }

    if (sessionUser) {
      setCurrentUser(sessionUser);
      hydrateCachedUserAnimeData(sessionUser.id);
    } else if (sessionChecked && currentUser?.id) {
      scheduleResumeRefresh(2500);
      return;
    }

    renderUserScreen();
    const refreshTasks = [
      fetchCommunityRole({ silent: true }),
      refreshUserAnimeData({ silent: true }),
      fetchCommunityRatings({ silent: true }),
      processPendingWrites({ silent: true })
    ];
    if (communityBoardLoaded) refreshTasks.push(loadCommunityThreads({ silent: true }));
    if (activeCommunityThread) refreshTasks.push(loadCommunityReplies(activeCommunityThread.id, { silent: true }));
    await Promise.allSettled(refreshTasks);
    updateModalStatusUI();
    updateModalRatingUI();
    updateModalProgressUI();
  } finally {
    resumeRefreshRunning = false;
  }
}

function scheduleResumeRefresh(delay = 300) {
  clearTimeout(resumeRefreshTimer);
  resumeRefreshTimer = setTimeout(() => {
    refreshAfterResume().catch(error => {
      console.warn('No se pudo reconectar al volver a la app:', error);
    });
  }, delay);
}

function renderUserScreen() {
  const guest = document.getElementById('userGuestView');
  const logged = document.getElementById('userLoggedView');
  const email = document.getElementById('userEmailText');
  const passwordForm = document.getElementById('changePasswordForm');
  if (!guest || !logged) return;
  guest.style.display = currentUser ? 'none' : '';
  logged.style.display = currentUser ? '' : 'none';
  if (email) email.innerHTML = currentUser ? `Sesión iniciada con <span class="user-email-highlight">${currentUser.email}</span>` : '';
  if (!currentUser) toggleUserSettingsPanel(false);
  if (passwordForm && !currentUser) {
    passwordForm.reset();
  }
  updateUserTriggers();
  updateModalStatusUI();
  updateModalRatingUI();
  updateModalProgressUI();
  updateAccountModeUI();
  updateTitleModeUI();
  updateCommunityComposerUI();
  renderPublicProfileSettings();
  if (currentUser) renderUserLists();
  else renderUserDailyPanel();
}

async function syncAuthState() {
  const bootstrappedSession = await bootstrapAuthFromUrl();
  const optimisticUser = bootstrappedSession?.user || readStoredSupabaseUser();
  if (optimisticUser?.id) {
    setCurrentUser(optimisticUser);
    hydrateCachedUserAnimeData(optimisticUser.id);
    renderUserScreen();
  }

  let data = null;
  let sessionReadFailed = false;
  let sessionReadWasTransient = false;
  try {
    const result = await safeSupabase(
      'auth.getSession.sync',
      () => supabaseClient.auth.getSession(),
      { timeout: 9000, retries: 2, retryDelay: 900 }
    );
    data = result?.data || null;
  } catch (error) {
    sessionReadFailed = true;
    sessionReadWasTransient = isTransientSupabaseError(error);
    console.warn('No se pudo sincronizar la sesión inicial:', error);
  }

  const confirmedUser = bootstrappedSession?.user || data?.session?.user || null;
  if (confirmedUser) {
    setCurrentUser(confirmedUser);
  } else if (sessionReadFailed && sessionReadWasTransient && optimisticUser?.id) {
    setCurrentUser(optimisticUser);
    scheduleResumeRefresh(1800);
  } else {
    setCurrentUser(null);
  }

  if (isRecoveryUrl() && currentUser) {
    isPasswordRecoveryFlow = true;
  }
  if (currentUser) hydrateCachedUserAnimeData(currentUser.id);
  renderUserScreen();
  if (pendingAuthNotice) {
    renderIntroFlashMessage(pendingAuthNotice);
    if (currentUser) {
      dismissIntroIfNeeded(false);
      setActiveScreen('user-screen', 'nav-user', false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    setAuthFeedback(pendingAuthNotice, 'success');
    pendingAuthNotice = '';
  }
  await Promise.allSettled([
    fetchCommunityRole({ silent: true }),
    refreshUserAnimeData({ silent: true }),
    fetchCommunityRatings({ silent: true }),
    processPendingWrites({ silent: true })
  ]);
  if (sessionReadFailed && sessionReadWasTransient && currentUser) scheduleResumeRefresh(3500);
  if (communityBoardLoaded) loadCommunityThreads({ silent: true });
  if (activeCommunityThread) loadCommunityReplies(activeCommunityThread.id, { silent: true });
  if (isPasswordRecoveryFlow && currentUser) {
    showScreen('user');
    toggleUserSettingsPanel(true);
    updateAccountModeUI();
    setAuthFeedback('Has entrado en modo recuperación. Restablece tu contraseña desde ajustes.', 'success');
    setTimeout(() => document.getElementById('changePasswordNew')?.focus(), 50);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = document.getElementById('loginForm');
  const submitBtn = form?.querySelector('button[type="submit"]');
  const email = document.getElementById('loginEmail')?.value?.trim() || '';
  const password = document.getElementById('loginPassword')?.value || '';

  await runLocked('auth:login', async () => {
    setButtonBusy(submitBtn, true, 'Entrando...');
    setAuthFeedback('Entrando...');
    try {
      await safeSupabase(
        'auth.signInWithPassword',
        () => supabaseClient.auth.signInWithPassword({ email, password }),
        { timeout: 9000, retries: 0 }
      );
      form?.reset();
      setAuthFeedback('Sesión iniciada.', 'success');
    } catch (error) {
      setAuthFeedback(userFacingSupabaseError(error, 'No se pudo iniciar sesión.'), 'error');
    } finally {
      setButtonBusy(submitBtn, false);
    }
  });
}

async function handleSignup(event) {
  event.preventDefault();
  const form = document.getElementById('signupForm');
  const submitBtn = form?.querySelector('button[type="submit"]');
  const email = document.getElementById('signupEmail')?.value?.trim() || '';
  const password = document.getElementById('signupPassword')?.value || '';
  const confirmPassword = document.getElementById('signupPasswordConfirm')?.value || '';

  if (password.length < 6) {
    setAuthFeedback('La contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }
  if (password !== confirmPassword) {
    setAuthFeedback('Las contraseñas no coinciden.', 'error');
    return;
  }

  await runLocked('auth:signup', async () => {
    setButtonBusy(submitBtn, true, 'Creando...');
    setAuthFeedback('Creando cuenta...');
    try {
      const { data } = await safeSupabase(
        'auth.signUp',
        () => supabaseClient.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: AUTH_REDIRECT_URL }
        }),
        { timeout: 10000, retries: 0 }
      );
      form?.reset();
      if (data?.session) {
        setAuthFeedback('Cuenta creada. Ya tienes la sesión iniciada.', 'success');
      } else {
        setAuthFeedback('Cuenta creada. Revisa tu correo para confirmarla y pulsa el enlace. Si no lo ves, mira en Spam, Promociones o correo no deseado.', 'success');
      }
    } catch (error) {
      setAuthFeedback(userFacingSupabaseError(error, 'No se pudo crear la cuenta.'), 'error');
    } finally {
      setButtonBusy(submitBtn, false);
    }
  });
}

async function handleLogout() {
  await runLocked('auth:logout', async () => {
    setAuthFeedback('Cerrando sesión...');
    await forceLocalSignOut();
    setAuthFeedback('Sesión cerrada.', 'success');
  });
}

async function handleForgotPasswordRequest() {
  const email = document.getElementById('loginEmail')?.value?.trim() || '';
  if (!email) {
    setAuthFeedback('Escribe tu correo en el campo de inicio de sesión para enviarte el enlace.', 'error');
    return;
  }

  await runLocked('auth:forgot-password', async () => {
    setAuthFeedback('Enviando enlace de recuperación...');
    try {
      await safeSupabase(
        'auth.resetPasswordForEmail',
        () => supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: AUTH_REDIRECT_URL }),
        { timeout: 10000, retries: 0 }
      );
      setAuthFeedback('Te hemos enviado un correo para restablecer tu contraseña.', 'success');
    } catch (error) {
      setAuthFeedback(userFacingSupabaseError(error, 'No se pudo enviar el correo de recuperación.'), 'error');
    }
  });
}

function getCleanAppUrl() {
  try {
    const currentUrl = new URL(window.location.href);
    currentUrl.hash = '';
    currentUrl.searchParams.delete('code');
    currentUrl.searchParams.delete('type');
    currentUrl.searchParams.delete('token');
    currentUrl.searchParams.delete('token_hash');
    currentUrl.searchParams.delete('error');
    currentUrl.searchParams.delete('error_code');
    currentUrl.searchParams.delete('error_description');
    currentUrl.searchParams.delete('password_updated');
    return currentUrl.pathname + currentUrl.search;
  } catch {
    return window.location.pathname;
  }
}

function hardResetAfterPasswordChange(message) {
  cleanupAuthRedirectUrl();
  setPasswordSuccessMessage(message || 'Contraseña cambiada correctamente. Vuelve a iniciar sesión para continuar.');

  try {
    const pendingSignOut = supabaseClient.auth.signOut({ scope: 'local' });
    Promise.resolve(pendingSignOut).catch(err => {
      console.error('Error cerrando sesión tras cambiar contraseña:', err);
    });
  } catch (err) {
    console.error('Error iniciando cierre de sesión tras cambiar contraseña:', err);
  }

  setCurrentUser(null);
  isPasswordRecoveryFlow = false;
  resetAuthForms();
  switchAuthTab('login');
  renderUserScreen();
  renderUserLists();
  updateUserTriggers();
  closeAnimeModal();
  setResetCursor(false);

  const cleanUrl = getCleanAppUrl();
  window.location.replace(cleanUrl + (cleanUrl.includes('?') ? '&' : '?') + 'password_updated=1');
}

async function completePasswordChangeSuccess(form) {
  form?.reset();
  hardResetAfterPasswordChange('Contraseña cambiada correctamente. Vuelve a iniciar sesión para continuar.');
}

async function handleChangePassword(event) {
  event.preventDefault();

  const form = document.getElementById('changePasswordForm');
  const submitBtn = form?.querySelector('button[type="submit"]');
  const newPassword = document.getElementById('changePasswordNew')?.value || '';
  const confirmPassword = document.getElementById('changePasswordConfirm')?.value || '';
  const wasRecoveryFlow = isPasswordRecoveryFlow;
  const idleLabel = wasRecoveryFlow ? 'Restablecer contraseña' : 'Guardar contraseña';
  const busyLabel = wasRecoveryFlow ? 'Restableciendo...' : 'Actualizando...';

  if (newPassword.length < 6) {
    setAuthFeedback('La nueva contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    setAuthFeedback('Las nuevas contraseñas no coinciden.', 'error');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';
    submitBtn.textContent = busyLabel;
  }

  setAuthFeedback(wasRecoveryFlow ? 'Restableciendo contraseña...' : 'Actualizando contraseña...');

  const restoreSubmit = () => {
    if (!submitBtn) return;
    submitBtn.disabled = false;
    submitBtn.style.opacity = '';
    submitBtn.textContent = idleLabel;
  };

  try {
    const sessionUser = await getActiveSessionUser();

    if (!sessionUser) {
      await forceLocalSignOut();
      showScreen('user');
      setAuthFeedback(
        wasRecoveryFlow
          ? 'No se detectó una sesión válida de recuperación. Abre otra vez el enlace del correo.'
          : 'Tu sesión no está activa. Inicia sesión otra vez para cambiar la contraseña.',
        'error'
      );
      return;
    }

    setCurrentUser(sessionUser);

    const timeoutMs = 6500;
    const timeoutResult = { timedOut: true };
    const result = await Promise.race([
      updatePasswordWithRecoveryFallback(newPassword),
      new Promise(resolve => setTimeout(() => resolve(timeoutResult), timeoutMs))
    ]);

    if (result === timeoutResult) {
      console.warn('Timeout esperando confirmación de cambio de contraseña; se fuerza cierre local.');
      await completePasswordChangeSuccess(form);
      return;
    }

    const { data, error } = result || {};

    if (error) {
      setAuthFeedback(formatAuthError(error.message), 'error');
      return;
    }

    if (!data?.user) {
      setAuthFeedback('Supabase no confirmó el cambio de contraseña. Vuelve a intentarlo.', 'error');
      return;
    }

    await completePasswordChangeSuccess(form);
  } catch (err) {
    console.error('Error actualizando contraseña:', err);
    setAuthFeedback('No se pudo actualizar la contraseña.', 'error');
  } finally {
    restoreSubmit();
  }
}

async function saveAnimeStatus(anime, status) {
  if (!anime?.mal_id) return;
  if (isUpcomingAnime(anime) && status !== 'pending') {
    setModalStatusMessage('Los próximos estrenos solo pueden guardarse en Pendientes.', 'error');
    return;
  }

  const animeId = Number(anime.mal_id);
  const previousStatus = userAnimeMap.get(animeId) || null;
  const previousStatusUpdatedAt = userStatusUpdatedMap.get(animeId) || null;

  await runLocked(`anime-status:${animeId}`, async () => {
    setElementsBusy('[data-status-btn], .status-clear-btn, .user-start-watching-btn', true);
    setModalStatusMessage('Guardando estado...', '');
    let queuedPayload = null;

    try {
      const sessionUser = await ensureSupabaseWriteReady();
      if (!sessionUser) {
        setCurrentUser(null);
        renderUserScreen();
        renderUserLists();
        setModalStatusMessage('Tu sesión no está activa. Inicia sesión otra vez.', 'error');
        showScreen('user');
        return;
      }

      setCurrentUser(sessionUser);

      const payload = {
        user_id: currentUser.id,
        anime_id: animeId,
        status,
        updated_at: new Date().toISOString()
      };
      queuedPayload = payload;

      // Actualización optimista: la UI responde al instante, pero luego se confirma con Supabase.
      userAnimeMap.set(animeId, status);
      userStatusUpdatedMap.set(animeId, payload.updated_at);
      persistCachedUserAnimeData();
      renderUserLists();

      await safeSupabaseMutation(
        'user_anime_status.upsert',
        () => supabaseClient
          .from('user_anime_status')
          .upsert(payload, { onConflict: 'user_id,anime_id' }),
        { timeout: 9000, retries: 1 }
      );

      const refreshed = await fetchUserStatuses({ silent: true });
      if (!refreshed) {
        setModalStatusMessage('Guardado, pero no se pudo refrescar tu lista. Recarga si no lo ves.', 'error');
        return;
      }

      setModalStatusMessage(`Guardado en ${STATUS_LABELS[status]}.`, 'success');
    } catch (error) {
      console.error('Error guardando estado:', error);
      if (queuedPayload && keepOptimisticWriteOnTransient(
        error,
        'status_upsert',
        queuedPayload,
        setModalStatusMessage,
        `Guardado en ${STATUS_LABELS[status]}. Se sincronizará en segundo plano.`
      )) return;
      if (previousStatus) {
        userAnimeMap.set(animeId, previousStatus);
        if (previousStatusUpdatedAt) userStatusUpdatedMap.set(animeId, previousStatusUpdatedAt);
      } else {
        userAnimeMap.delete(animeId);
        userStatusUpdatedMap.delete(animeId);
      }
      persistCachedUserAnimeData();
      renderUserLists();
      setModalStatusMessage(userFacingSupabaseError(error, 'No se pudo guardar el estado.'), 'error');
    } finally {
      setElementsBusy('[data-status-btn], .status-clear-btn, .user-start-watching-btn', false);
    }
  });
}

async function clearAnimeStatus(anime) {
  if (!anime?.mal_id) return;

  const animeId = Number(anime.mal_id);
  const previousStatus = userAnimeMap.get(animeId) || null;
  const previousStatusUpdatedAt = userStatusUpdatedMap.get(animeId) || null;

  await runLocked(`anime-status:${animeId}`, async () => {
    setElementsBusy('[data-status-btn], .status-clear-btn, .user-remove-btn', true);
    setModalStatusMessage('Quitando anime...', '');
    let queuedPayload = null;

    try {
      const sessionUser = await ensureSupabaseWriteReady();
      if (!sessionUser) {
        setCurrentUser(null);
        renderUserScreen();
        renderUserLists();
        setModalStatusMessage('Tu sesión no está activa. Inicia sesión otra vez.', 'error');
        showScreen('user');
        return;
      }

      setCurrentUser(sessionUser);
      queuedPayload = { user_id: currentUser.id, anime_id: animeId };

      userAnimeMap.delete(animeId);
      userStatusUpdatedMap.delete(animeId);
      persistCachedUserAnimeData();
      renderUserLists();

      await safeSupabaseMutation(
        'user_anime_status.delete',
        () => supabaseClient
          .from('user_anime_status')
          .delete()
          .eq('user_id', currentUser.id)
          .eq('anime_id', animeId),
        { timeout: 9000, retries: 1 }
      );

      const refreshed = await fetchUserStatuses({ silent: true });
      if (!refreshed) {
        setModalStatusMessage('Quitado, pero no se pudo refrescar tu lista. Recarga si no lo ves.', 'error');
        return;
      }

      setModalStatusMessage('Anime quitado de tu lista.', 'success');
    } catch (error) {
      console.error('Error borrando estado:', error);
      if (queuedPayload && keepOptimisticWriteOnTransient(
        error,
        'status_delete',
        queuedPayload,
        setModalStatusMessage,
        'Anime quitado en este dispositivo. Se sincronizará en segundo plano.'
      )) return;
      if (previousStatus) {
        userAnimeMap.set(animeId, previousStatus);
        if (previousStatusUpdatedAt) userStatusUpdatedMap.set(animeId, previousStatusUpdatedAt);
      }
      persistCachedUserAnimeData();
      renderUserLists();
      setModalStatusMessage(userFacingSupabaseError(error, 'No se pudo quitar de tu lista.'), 'error');
    } finally {
      setElementsBusy('[data-status-btn], .status-clear-btn, .user-remove-btn', false);
    }
  });
}

async function saveAnimeRating(anime, rating) {
  if (!anime?.mal_id) return;

  const animeId = Number(anime.mal_id);
  const value = Number(rating);
  if (!Number.isFinite(value) || value < 1 || value > 10) {
    setModalRatingMessage('Elige una nota válida del 1 al 10.', 'error');
    return;
  }

  const previousRating = userRatingMap.get(animeId);

  await runLocked(`anime-rating:${animeId}`, async () => {
    setElementsBusy('[data-rating-btn], .rating-clear-btn', true);
    setModalRatingMessage('Guardando nota...', '');
    let queuedPayload = null;

    try {
      const sessionUser = await ensureSupabaseWriteReady();
      if (!sessionUser) {
        setCurrentUser(null);
        renderUserScreen();
        renderUserLists();
        setModalRatingMessage('Tu sesión no está activa. Inicia sesión otra vez.', 'error');
        showScreen('user');
        return;
      }

      setCurrentUser(sessionUser);
      ratingsFeatureAvailable = true;

      const payload = {
        user_id: currentUser.id,
        anime_id: animeId,
        rating: value,
        updated_at: new Date().toISOString()
      };
      queuedPayload = payload;

      userRatingMap.set(animeId, value);
      persistCachedUserAnimeData();
      renderUserLists();
      updateModalRatingUI();

      await safeSupabaseMutation(
        'user_anime_ratings.upsert',
        () => supabaseClient
          .from('user_anime_ratings')
          .upsert(payload, { onConflict: 'user_id,anime_id' }),
        { timeout: 9000, retries: 1 }
      );

      await fetchUserRatings({ silent: true });
      await fetchCommunityRatings({ silent: true });
      setModalRatingMessage(`Nota guardada: ${value}/10.`, 'success');
    } catch (error) {
      console.error('Error guardando puntuación:', error);
      if (queuedPayload && keepOptimisticWriteOnTransient(
        error,
        'rating_upsert',
        queuedPayload,
        setModalRatingMessage,
        `Nota guardada: ${value}/10. Se sincronizará en segundo plano.`
      )) return;
      if (previousRating != null) userRatingMap.set(animeId, previousRating);
      else userRatingMap.delete(animeId);
      persistCachedUserAnimeData();
      ratingsFeatureAvailable = !String(error?.message || '').toLowerCase().includes('user_anime_ratings');
      renderUserLists();
      updateModalRatingUI();
      setModalRatingMessage(userFacingSupabaseError(error, 'No se pudo guardar la nota. Revisa que la tabla exista en Supabase.'), 'error');
    } finally {
      setElementsBusy('[data-rating-btn], .rating-clear-btn', false);
    }
  });
}

async function clearAnimeRating(anime) {
  if (!anime?.mal_id) return;

  const animeId = Number(anime.mal_id);
  const previousRating = userRatingMap.get(animeId);

  await runLocked(`anime-rating:${animeId}`, async () => {
    setElementsBusy('[data-rating-btn], .rating-clear-btn', true);
    setModalRatingMessage('Quitando nota...', '');
    let queuedPayload = null;

    try {
      const sessionUser = await ensureSupabaseWriteReady();
      if (!sessionUser) {
        setCurrentUser(null);
        renderUserScreen();
        renderUserLists();
        setModalRatingMessage('Tu sesión no está activa. Inicia sesión otra vez.', 'error');
        showScreen('user');
        return;
      }

      setCurrentUser(sessionUser);
      queuedPayload = { user_id: currentUser.id, anime_id: animeId };
      userRatingMap.delete(animeId);
      persistCachedUserAnimeData();
      renderUserLists();
      updateModalRatingUI();

      await safeSupabaseMutation(
        'user_anime_ratings.delete',
        () => supabaseClient
          .from('user_anime_ratings')
          .delete()
          .eq('user_id', currentUser.id)
          .eq('anime_id', animeId),
        { timeout: 9000, retries: 1 }
      );

      await fetchUserRatings({ silent: true });
      await fetchCommunityRatings({ silent: true });
      setModalRatingMessage('Nota quitada.', 'success');
    } catch (error) {
      console.error('Error borrando puntuación:', error);
      if (queuedPayload && keepOptimisticWriteOnTransient(
        error,
        'rating_delete',
        queuedPayload,
        setModalRatingMessage,
        'Nota quitada en este dispositivo. Se sincronizará en segundo plano.'
      )) return;
      if (previousRating != null) userRatingMap.set(animeId, previousRating);
      persistCachedUserAnimeData();
      renderUserLists();
      updateModalRatingUI();
      setModalRatingMessage(userFacingSupabaseError(error, 'No se pudo quitar la nota.'), 'error');
    } finally {
      setElementsBusy('[data-rating-btn], .rating-clear-btn', false);
    }
  });
}

async function saveAnimeProgress(anime, episodeNumber) {
  if (!anime?.mal_id) return;

  const animeId = Number(anime.mal_id);
  const episode = Number.parseInt(episodeNumber, 10);
  const total = getAnimeTotalEpisodes(anime);
  const previousProgress = userProgressMap.get(animeId);

  if (!Number.isInteger(episode) || episode < 1) {
    setModalProgressMessage('El episodio debe ser 1 o superior.', 'error');
    return;
  }
  if (total && episode > total) {
    setModalProgressMessage(`Este anime tiene ${total} episodios registrados.`, 'error');
    return;
  }

  await runLocked(`anime-progress:${animeId}`, async () => {
    setElementsBusy('.progress-save-btn, .progress-clear-btn, .user-episode-step-btn', true);
    setModalProgressMessage('Guardando progreso...', '');
    let queuedPayload = null;

    try {
      const sessionUser = await ensureSupabaseWriteReady();
      if (!sessionUser) {
        setCurrentUser(null);
        renderUserScreen();
        renderUserLists();
        setModalProgressMessage('Tu sesión no está activa. Inicia sesión otra vez.', 'error');
        showScreen('user');
        return;
      }

      setCurrentUser(sessionUser);
      progressFeatureAvailable = true;
      const statusBeforeProgress = userAnimeMap.get(animeId) || null;

      const payload = {
        user_id: currentUser.id,
        anime_id: animeId,
        season_number: 1,
        episode_number: episode,
        total_episodes: total,
        updated_at: new Date().toISOString()
      };
      queuedPayload = payload;

      userProgressMap.set(animeId, payload);
      persistCachedUserAnimeData();
      renderUserLists();
      updateModalProgressUI();

      await safeSupabaseMutation(
        'user_anime_progress.upsert',
        () => supabaseClient
          .from('user_anime_progress')
          .upsert(payload, { onConflict: 'user_id,anime_id' }),
        { timeout: 9000, retries: 1 }
      );

      await fetchUserProgress({ silent: true });
      if (statusBeforeProgress === 'pending' || statusBeforeProgress === 'dropped') {
        updateModalStatusUI();
        refreshAnimeStatusMarkers();
      } else if (total && episode >= total) {
        await saveAnimeStatus(anime, 'completed');
      } else {
        await saveAnimeStatus(anime, 'watching');
      }
      setModalProgressMessage(`Progreso guardado: ${getProgressLabel(payload, anime)}.`, 'success');
    } catch (error) {
      console.error('Error guardando progreso:', error);
      if (queuedPayload && keepOptimisticWriteOnTransient(
        error,
        'progress_upsert',
        queuedPayload,
        setModalProgressMessage,
        `Progreso guardado: ${getProgressLabel(queuedPayload, anime)}. Se sincronizará en segundo plano.`
      )) return;
      if (previousProgress) userProgressMap.set(animeId, previousProgress);
      else userProgressMap.delete(animeId);
      persistCachedUserAnimeData();
      progressFeatureAvailable = !String(error?.message || '').toLowerCase().includes('user_anime_progress');
      renderUserLists();
      updateModalProgressUI();
      setModalProgressMessage(userFacingSupabaseError(error, 'No se pudo guardar el progreso. Revisa que la tabla exista en Supabase.'), 'error');
    } finally {
      setElementsBusy('.progress-save-btn, .progress-clear-btn, .user-episode-step-btn', false);
    }
  });
}

async function clearAnimeProgress(anime) {
  if (!anime?.mal_id) return;

  const animeId = Number(anime.mal_id);
  const previousProgress = userProgressMap.get(animeId);

  await runLocked(`anime-progress:${animeId}`, async () => {
    setElementsBusy('.progress-save-btn, .progress-clear-btn, .user-episode-step-btn', true);
    setModalProgressMessage('Quitando progreso...', '');
    let queuedPayload = null;

    try {
      const sessionUser = await ensureSupabaseWriteReady();
      if (!sessionUser) {
        setCurrentUser(null);
        renderUserScreen();
        renderUserLists();
        setModalProgressMessage('Tu sesión no está activa. Inicia sesión otra vez.', 'error');
        showScreen('user');
        return;
      }

      setCurrentUser(sessionUser);
      queuedPayload = { user_id: currentUser.id, anime_id: animeId };
      userProgressMap.delete(animeId);
      persistCachedUserAnimeData();
      renderUserLists();
      updateModalProgressUI();

      await safeSupabaseMutation(
        'user_anime_progress.delete',
        () => supabaseClient
          .from('user_anime_progress')
          .delete()
          .eq('user_id', currentUser.id)
          .eq('anime_id', animeId),
        { timeout: 9000, retries: 1 }
      );

      await fetchUserProgress({ silent: true });
      setModalProgressMessage('Progreso quitado.', 'success');
    } catch (error) {
      console.error('Error borrando progreso:', error);
      if (queuedPayload && keepOptimisticWriteOnTransient(
        error,
        'progress_delete',
        queuedPayload,
        setModalProgressMessage,
        'Progreso quitado en este dispositivo. Se sincronizará en segundo plano.'
      )) return;
      if (previousProgress) userProgressMap.set(animeId, previousProgress);
      persistCachedUserAnimeData();
      renderUserLists();
      updateModalProgressUI();
      setModalProgressMessage(userFacingSupabaseError(error, 'No se pudo quitar el progreso.'), 'error');
    } finally {
      setElementsBusy('.progress-save-btn, .progress-clear-btn, .user-episode-step-btn', false);
    }
  });
}

async function incrementAnimeProgress(anime) {
  if (!anime?.mal_id) return;
  if (anime.type === 'Movie' || isUpcomingAnime(anime)) return;

  const animeId = Number(anime.mal_id);
  const status = userAnimeMap.get(animeId) || null;
  if (status === 'completed' || status === 'dropped') return;

  const progress = getDisplayProgress(anime, status);
  const total = getAnimeTotalEpisodes(anime);
  const currentEpisode = Number(progress?.episode_number) || 0;

  if (total && currentEpisode >= total) {
    setModalProgressMessage('Ya está marcado con todos los episodios registrados.', 'success');
    return;
  }

  await saveAnimeProgress(anime, currentEpisode + 1);
}

async function decrementAnimeProgress(anime) {
  if (!anime?.mal_id) return;
  if (anime.type === 'Movie' || isUpcomingAnime(anime)) return;

  const animeId = Number(anime.mal_id);
  const status = userAnimeMap.get(animeId) || null;
  if (status === 'completed' || status === 'dropped') return;

  const progress = getDisplayProgress(anime, status);
  const currentEpisode = Number(progress?.episode_number) || 0;
  if (currentEpisode <= 0) {
    setModalProgressMessage('No hay episodios guardados para restar.', 'error');
    return;
  }

  const nextEpisode = currentEpisode - 1;
  if (nextEpisode < 1) {
    await clearAnimeProgress(anime);
    return;
  }

  await saveAnimeProgress(anime, nextEpisode);
}

async function saveAnimeStatusFromModal(status) {
  if (!currentModalAnime) return;
  await saveAnimeStatus(currentModalAnime, status);
}

async function clearAnimeStatusFromModal() {
  if (!currentModalAnime) return;
  const animeId = Number(currentModalAnime.mal_id);
  const status = userAnimeMap.get(animeId) || '';
  if (!confirmRemoveAnimeFromList(currentModalAnime, status)) return;
  await clearAnimeStatus(currentModalAnime);
}

async function saveAnimeRatingFromModal(rating) {
  if (!currentModalAnime) return;
  await saveAnimeRating(currentModalAnime, rating);
}

async function clearAnimeRatingFromModal() {
  if (!currentModalAnime) return;
  await clearAnimeRating(currentModalAnime);
}

async function saveAnimeProgressFromModal() {
  if (!currentModalAnime) return;
  clampModalProgressInput({ forceMinimum: true });
  const episode = document.getElementById('modalProgressEpisode')?.value || '';
  await saveAnimeProgress(currentModalAnime, episode);
}

async function clearAnimeProgressFromModal() {
  if (!currentModalAnime) return;
  await clearAnimeProgress(currentModalAnime);
}

function withCatalogVersion(path) {
  const separator = String(path).includes('?') ? '&' : '?';
  return `${path}${separator}v=${encodeURIComponent(CATALOG_VERSION)}`;
}

function cleanDescriptionCredits(text = '') {
  let cleaned = String(text || '').trim();
  if (!cleaned) return '';

  const patterns = [
    /\s*\[(?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\]\s*$/i,
    /\s*\((?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\)\s*$/i,
    /\s*(?:-|--|—|–)\s*(?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\s*$/i,
    /\s*(?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\s*$/i,
    /\s*\[(?:Source|Fuente):?\s*[^\]\n]+?\]\s*$/i,
    /\s*\((?:Source|Fuente):?\s*[^)\n]+?\)\s*$/i
  ];
  const standalonePatterns = [
    /\n+\s*\[(?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\]\s*\n+/gi,
    /\n+\s*\((?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\)\s*\n+/gi,
    /\n+\s*\[(?:Source|Fuente):?\s*[^\]\n]+?\]\s*\n+/gi,
    /\n+\s*\((?:Source|Fuente):?\s*[^)\n]+?\)\s*\n+/gi
  ];
  const inlinePatterns = [
    /\s*\[(?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\]\s*/gi,
    /\s*\((?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\)\s*/gi,
    /\s*\[(?:Source|Fuente):?\s*[^\]\n]+?\]\s*/gi,
    /\s*\((?:Source|Fuente):?\s*[^)\n]+?\)\s*/gi
  ];

  standalonePatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '\n\n').trim();
  });
  inlinePatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, ' ').trim();
  });

  let changed = true;
  while (changed) {
    changed = false;
    patterns.forEach(pattern => {
      const next = cleaned.replace(pattern, '').trim();
      if (next !== cleaned) {
        cleaned = next;
        changed = true;
      }
    });
  }

  return cleaned
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeAnimeRecord(anime = {}) {
  const descriptionEs = cleanDescriptionCredits(anime.description_es);
  const description = cleanDescriptionCredits(anime.description);
  const descriptionPreview = cleanDescriptionCredits(anime.description_preview);
  return {
    ...anime,
    image: normalizeAnimeImageUrl(anime.image),
    description_es: descriptionEs,
    description: descriptionEs || description || '',
    description_preview: descriptionPreview || descriptionEs || description || ''
  };
}

function getAnimeDescription(anime = {}, { preview = false, loading = false } = {}) {
  const full = anime.description_es || anime.description || '';
  const short = anime.description_preview || full;
  if (preview) return short || 'Sin descripción disponible.';
  if (loading) return short || 'Cargando descripción...';
  return full || short || 'Sin descripción disponible.';
}

async function getRuntimeCache() {
  if (!('caches' in window)) return null;
  try {
    return await caches.open(`neoanimez-data-${APP_VERSION}`);
  } catch {
    return null;
  }
}

async function fetchCatalogJson(path, options = {}) {
  const {
    preferCache = false,
    timeout = 14000
  } = options;
  const cache = await getRuntimeCache();
  const cached = cache ? await cache.match(path) : null;

  const fetchAndCache = async () => {
    const res = await fetch(path, { cache: preferCache ? 'default' : 'reload' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (cache) {
      try {
        await cache.put(path, res.clone());
      } catch (cacheError) {
        console.warn('No se pudo guardar catálogo en caché:', cacheError);
      }
    }
    return res.json();
  };

  if (preferCache && cached) {
    fetchAndCache().catch(error => {
      console.warn('No se pudo actualizar catálogo en segundo plano:', error);
    });
    return cached.clone().json();
  }

  try {
    return await withTimeout(fetchAndCache(), timeout, `catalog:${path}`);
  } catch (error) {
    if (cached) {
      console.warn('Usando catálogo desde caché local:', path, error);
      return cached.clone().json();
    }
    throw error;
  }
}

async function loadAnimeRelations({ force = false } = {}) {
  if (animeRelationsLoaded && !force) return animeRelationsMap;
  if (animeRelationsLoadPromise && !force) return animeRelationsLoadPromise;

  const request = (async () => {
    const payload = await fetchCatalogJson(RELATIONS_URL, {
      preferCache: !force,
      timeout: 10000
    });
    const relations = payload?.relations;
    if (!relations || typeof relations !== 'object' || Array.isArray(relations)) {
      throw new Error('anime-relations.json no contiene un mapa de relaciones valido.');
    }

    animeRelationsMap.clear();
    Object.entries(relations).forEach(([animeId, value]) => {
      const id = Number(animeId);
      if (!Number.isFinite(id) || id <= 0 || !value || typeof value !== 'object') return;
      const normalizeIds = items => [...new Set(
        (Array.isArray(items) ? items : [])
          .map(Number)
          .filter(targetId => Number.isFinite(targetId) && targetId > 0 && targetId !== id)
      )];
      animeRelationsMap.set(id, {
        prequels: normalizeIds(value.prequels),
        sequels: normalizeIds(value.sequels)
      });
    });
    animeRelationsLoaded = true;
    return animeRelationsMap;
  })();

  animeRelationsLoadPromise = request;
  try {
    return await request;
  } finally {
    animeRelationsLoadPromise = null;
  }
}

async function loadAnimeTimelineIndex({ force = false } = {}) {
  if (animeTimelineIndexLoaded && !force) return animeTimelineNavigationMap;
  if (animeTimelineIndexLoadPromise && !force) return animeTimelineIndexLoadPromise;

  const request = (async () => {
    const payload = await fetchCatalogJson(TIMELINE_INDEX_URL, {
      preferCache: !force,
      timeout: 10000
    });
    const files = Array.isArray(payload?.files) ? payload.files.filter(Boolean).map(String) : [];
    const navigation = payload?.navigation;
    if (!files.length || !navigation || typeof navigation !== 'object' || Array.isArray(navigation)) {
      throw new Error('anime-timeline-index.json no contiene un índice válido.');
    }

    animeTimelineFiles = files;
    animeTimelineNavigationMap.clear();
    Object.entries(navigation).forEach(([animeId, value]) => {
      const id = Number(animeId);
      const timelineId = Number(Array.isArray(value) ? value[0] : value?.timeline_id);
      const blockIndex = Number(Array.isArray(value) ? value[1] : value?.block_index);
      const file = files[blockIndex];
      if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(timelineId) || timelineId <= 0 || !file) return;
      animeTimelineNavigationMap.set(id, { timelineId, blockIndex, file });
    });
    animeTimelineIndexLoaded = true;
    return animeTimelineNavigationMap;
  })();

  animeTimelineIndexLoadPromise = request;
  try {
    return await request;
  } finally {
    animeTimelineIndexLoadPromise = null;
  }
}

async function loadAnimeTimelineBlock(file, { force = false } = {}) {
  const cleanFile = String(file || '').trim();
  if (!cleanFile || !animeTimelineFiles.includes(cleanFile)) {
    throw new Error('Bloque del mapa de saga desconocido.');
  }
  if (animeTimelineBlockCache.has(cleanFile) && !force) {
    return animeTimelineBlockCache.get(cleanFile);
  }

  const versionedFile = `${cleanFile}${cleanFile.includes('?') ? '&' : '?'}v=${CATALOG_VERSION}`;
  const payload = await fetchCatalogJson(versionedFile, {
    preferCache: !force,
    timeout: 12000
  });
  if (!payload?.timelines || !payload?.nodes) {
    throw new Error('El bloque del mapa de saga no contiene datos válidos.');
  }
  animeTimelineBlockCache.set(cleanFile, payload);
  return payload;
}

async function loadDB() {
  try {
    let rawDB;
    try {
      rawDB = await fetchCatalogJson(CATALOG_INDEX_URL, { preferCache: true, timeout: 14000 });
      splitCatalogEnabled = true;
      console.log('✅ Catálogo ligero cargado:', rawDB.length);
    } catch (indexError) {
      console.warn('No se pudo cargar anime-index.json; usando anime-lista.json completo.', indexError);
      rawDB = await fetchCatalogJson(CATALOG_FALLBACK_URL, { preferCache: true, timeout: 18000 });
      splitCatalogEnabled = false;
      console.log('✅ JSON completo cargado:', rawDB.length);
    }

    DB = rawDB.map(a => normalizeAnimeRecord(a));
    detailBlockCache.clear();
    detailBlockRequests.clear();
    animeDetailCache.clear();

    console.log('✅ Catálogo activo:', DB.length, splitCatalogEnabled ? 'modo dividido' : 'modo completo');
  } catch (e) {
    console.error('❌ Error cargando catálogo de anime', e);
    DB = [];
    splitCatalogEnabled = false;
    const container = document.getElementById('filterResults');
    if (container) {
      container.innerHTML = '<div class="no-res">No se pudo cargar el catálogo de anime.<br><small>Comprueba que anime-index.json o anime-lista.json están junto a index.html.</small></div>';
    }
  }
}

function getCatalogDetailFile(anime = {}) {
  if (anime.detail_file) return anime.detail_file;
  const animeId = Number(anime.mal_id);
  if (!splitCatalogEnabled || !Number.isFinite(animeId) || animeId <= 0) return '';
  const block = ((animeId % CATALOG_DETAIL_BLOCKS) + CATALOG_DETAIL_BLOCKS) % CATALOG_DETAIL_BLOCKS;
  return `anime-details/details-${String(block).padStart(2, '0')}.json`;
}

async function loadAnimeDetails(anime) {
  if (!anime || !splitCatalogEnabled) return anime;

  const animeId = Number(anime.mal_id);
  if (!animeId) return anime;
  if (anime._details_loaded) return anime;
  if (animeDetailCache.has(animeId)) return animeDetailCache.get(animeId);

  const detailFile = getCatalogDetailFile(anime);
  if (!detailFile) return anime;
  try {
    let blockPromise = detailBlockRequests.get(detailFile);
    if (!blockPromise) {
      blockPromise = fetchCatalogJson(withCatalogVersion(detailFile), { preferCache: true, timeout: 12000 });
      detailBlockRequests.set(detailFile, blockPromise);
    }

    const payload = detailBlockCache.get(detailFile) || await blockPromise;
    detailBlockCache.set(detailFile, payload);
    const items = Array.isArray(payload) ? payload : (payload.items || []);
    const detail = items.find(item => Number(item.mal_id) === animeId);
    if (!detail) throw new Error(`No existe mal_id=${animeId} en ${detailFile}`);

    const merged = normalizeAnimeRecord({
      ...anime,
      ...detail,
      detail_file: detailFile,
      _details_loaded: true
    });

    animeDetailCache.set(animeId, merged);
    const index = DB.findIndex(item => Number(item.mal_id) === animeId);
    if (index >= 0) DB[index] = merged;
    return merged;
  } catch (error) {
    console.warn('No se pudo cargar el detalle del anime:', animeId, error);
    return {
      ...anime,
      _details_error: true
    };
  }
}


function normalizeTitle(title = '') {
  return String(title).trim().toLowerCase();
}

function normalizeLoose(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSearchAliases(anime = {}) {
  const raw = [
    anime.title,
    anime.franchise,
    anime.title_es,
    anime.title_english,
    anime.title_japanese,
    ...(anime.title_synonyms || []),
    ...(anime.search_titles_es || []),
    ...(anime.search_titles || [])
  ].filter(Boolean);

  const seen = new Set();
  const aliases = [];
  raw.forEach(value => {
    const cleaned = normalizeLoose(value);
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    aliases.push({ raw: String(value), clean: cleaned });
  });
  return aliases;
}

function getSearchTitleCandidates(anime = {}) {
  const candidates = [
    { value: anime.title, weight: 34 },
    { value: anime.title_english, weight: 36 },
    { value: anime.title_es, weight: 38 },
    { value: anime.franchise, weight: 18 },
    ...(anime.title_synonyms || []).map(value => ({ value, weight: 20 })),
    ...(anime.search_titles_es || []).map(value => ({ value, weight: 24 })),
    ...(anime.search_titles || []).map(value => ({ value, weight: 18 }))
  ];

  const seen = new Set();
  return candidates
    .filter(item => item.value)
    .map(item => ({ ...item, clean: normalizeLoose(item.value) }))
    .filter(item => {
      if (!item.clean || seen.has(item.clean)) return false;
      seen.add(item.clean);
      return true;
    });
}

function scoreTitleCandidateMatch(text, normalizedQuery) {
  if (!text || !normalizedQuery) return -1;
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  let score = -1;

  if (text === normalizedQuery) score = 1000;
  else if (text.startsWith(normalizedQuery)) score = 830;
  else if (text.includes(` ${normalizedQuery}`)) score = 760;
  else if (queryTokens.length > 1 && queryTokens.every(token => text.includes(token))) score = 650;
  else if (normalizedQuery.length >= 4 && text.includes(normalizedQuery)) score = 520;

  if (score < 0) return -1;

  const compactText = text.replace(/\s+/g, '');
  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  if (compactText.startsWith(compactQuery)) score += 80;
  if (compactText.includes(compactQuery)) score += 30;
  score -= Math.min(140, Math.max(0, text.length - normalizedQuery.length) * 2);
  return score;
}

function getSearchDisplayTitle(anime = {}, query = '') {
  const normalizedQuery = normalizeLoose(query);
  if (!normalizedQuery) return '';

  const currentTitle = getAnimePreferredTitle(anime);
  const currentClean = normalizeLoose(currentTitle);
  const candidates = getSearchTitleCandidates(anime);
  const best = candidates
    .map(candidate => ({
      ...candidate,
      score: scoreTitleCandidateMatch(candidate.clean, normalizedQuery) + candidate.weight
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < 620) return '';
  const currentScore = scoreTitleCandidateMatch(currentClean, normalizedQuery);
  if (currentScore >= best.score - 70) return '';

  const value = String(best.value || '').trim();
  if (!value || normalizeLoose(value) === currentClean) return '';
  return value;
}

function normalizeAnimeImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  return raw.replace('https://myanimelist.net/images/', 'https://cdn.myanimelist.net/images/');
}

function getOriginalAnimeImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  return raw.replace('https://cdn.myanimelist.net/images/', 'https://myanimelist.net/images/');
}

function uniqueImageUrls(urls) {
  const seen = new Set();
  return urls
    .map(url => String(url || '').trim())
    .filter(Boolean)
    .filter(url => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function cacheBustImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.searchParams.set('neo_retry', Date.now());
    return parsed.toString();
  } catch {
    return raw + (raw.includes('?') ? '&' : '?') + 'neo_retry=' + Date.now();
  }
}

function getAnimeImageCandidates(anime) {
  const raw = String(anime?.image || '').trim();
  return uniqueImageUrls([
    normalizeAnimeImageUrl(raw),
    getOriginalAnimeImageUrl(raw)
  ]);
}

function getBestAnimeImage(anime) {
  return getAnimeImageCandidates(anime)[0] || '';
}

function markImageMissing(img) {
  if (!img) return;
  img.classList.remove('is-image-loading');
  img.classList.add('is-image-missing');
  img.src = BLANK;
}

function resetAnimeImageState(img) {
  if (!img) return;
  if (imageObserver) imageObserver.unobserve(img);
  delete img.dataset.imageStarted;
  delete img.dataset.imageLoaded;
  delete img.dataset.imageRetry;
  img.classList.remove('is-image-missing');
  img.classList.add('is-image-loading');
  img.src = EMPTY_IMAGE;
}

function setLoadedAnimeImage(img, url) {
  if (!img || !url) return;
  img.classList.remove('is-image-loading', 'is-image-missing');
  img.dataset.imageLoaded = '1';
  img.src = url;
}

function probeImageUrl(url, timeout = IMAGE_LOAD_TIMEOUT) {
  const src = String(url || '').trim();
  if (!src) return Promise.resolve(false);
  if (imageProbeCache[src]) return Promise.resolve(true);

  return new Promise(resolve => {
    const probe = new Image();
    let settled = false;

    const finish = ok => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      probe.onload = null;
      probe.onerror = null;
      if (ok) imageProbeCache[src] = true;
      resolve(ok);
    };

    const timer = window.setTimeout(() => finish(false), timeout);
    probe.decoding = 'async';
    probe.referrerPolicy = 'no-referrer';
    probe.onload = () => finish(Boolean(probe.naturalWidth || probe.width));
    probe.onerror = () => finish(false);
    probe.src = src;
    if (probe.complete) finish(Boolean(probe.naturalWidth || probe.width));
  });
}

async function resolveAnimeImageUrl(anime, { forceFresh = false } = {}) {
  const cacheKey = anime?.mal_id ? 'anime-' + anime.mal_id : 'title-' + (anime?.title || '');
  if (!forceFresh && imgCache[cacheKey]) return imgCache[cacheKey];
  if (!forceFresh && imageResolveRequests[cacheKey]) return imageResolveRequests[cacheKey];

  const task = (async () => {
    const candidates = getAnimeImageCandidates(anime);

    for (const candidate of candidates) {
      const src = forceFresh ? cacheBustImageUrl(candidate) : candidate;
      if (await probeImageUrl(src)) {
        imgCache[cacheKey] = src;
        return src;
      }
    }

    const malId = anime?.mal_id || TITLE_TO_MAL_ID[anime?.title] || TITLE_TO_MAL_ID[anime?.title_japanese];
    const apiUrl = malId ? await getImgById(malId) : await getImg(anime);
    if (apiUrl) {
      const src = forceFresh ? cacheBustImageUrl(apiUrl) : apiUrl;
      if (await probeImageUrl(src)) {
        imgCache[cacheKey] = src;
        return src;
      }
    }

    return '';
  })().finally(() => {
    delete imageResolveRequests[cacheKey];
  });

  if (!forceFresh) imageResolveRequests[cacheKey] = task;
  return task;
}

function ensureImageObserver() {
  if (imageObserver || !('IntersectionObserver' in window)) return imageObserver;

  imageObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      imageObserver.unobserve(img);
      if (typeof img._neoStartImageLoad === 'function') img._neoStartImageLoad();
    });
  }, { rootMargin: '700px 0px' });

  return imageObserver;
}

function enqueueAnimeImageLoad(img, anime, delay = 0) {
  if (!img || img.dataset.imageStarted === '1') return;
  img.dataset.imageStarted = '1';

  window.setTimeout(() => {
    if (!img.isConnected) return;
    imageLoadQueue.push({ img, anime });
    processAnimeImageQueue();
  }, delay);
}

function processAnimeImageQueue() {
  while (activeImageLoads < MAX_PARALLEL_IMAGE_LOADS && imageLoadQueue.length) {
    const job = imageLoadQueue.shift();
    if (!job?.img?.isConnected) continue;

    activeImageLoads += 1;
    loadAnimeImageNow(job.img, job.anime)
      .finally(() => {
        activeImageLoads -= 1;
        processAnimeImageQueue();
      });
  }
}

async function loadAnimeImageNow(img, anime) {
  if (!img?.isConnected || img.dataset.imageLoaded === '1') return;

  let url = await resolveAnimeImageUrl(anime);
  if (url && img.isConnected) {
    setLoadedAnimeImage(img, url);
    return;
  }

  await new Promise(resolve => window.setTimeout(resolve, IMAGE_RETRY_DELAY));
  url = await resolveAnimeImageUrl(anime, { forceFresh: true });
  if (url && img.isConnected) {
    setLoadedAnimeImage(img, url);
  } else if (img.isConnected) {
    markImageMissing(img);
  }
}

function loadAnimeImageElement(img, anime, delay = 0) {
  if (!img) return;
  resetAnimeImageState(img);
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';

  img.onerror = async () => {
    if (img.dataset.imageRetry === '1') {
      img.onerror = null;
      markImageMissing(img);
      return;
    }

    img.dataset.imageRetry = '1';
    const retryUrl = await resolveAnimeImageUrl(anime, { forceFresh: true });
    if (retryUrl && img.isConnected) {
      setLoadedAnimeImage(img, retryUrl);
    } else {
      img.onerror = null;
      markImageMissing(img);
    }
  };

  const observer = ensureImageObserver();
  const startLoad = () => enqueueAnimeImageLoad(img, anime, delay);
  img._neoStartImageLoad = startLoad;

  if (observer) observer.observe(img);
  else startLoad();
}

function loadAnimeImageById(id, anime, delay = 0) {
  loadAnimeImageElement(document.getElementById(id), anime, delay);
}

function findAnimeByTitle(title) {
  const target = normalizeLoose(title);
  if (!target) return null;
  return DB.find(a => getSearchAliases(a).some(alias => alias.clean === target)) || null;
}


async function getImgById(id) {
  if (!id) return '';
  const key = 'id-' + id;
  if (imgCache[key]) return imgCache[key];
  if (imgRequests[key]) return imgRequests[key];

  imgRequests[key] = (async () => {
    try {
      const r = await fetch('https://api.jikan.moe/v4/anime/' + id);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const url = normalizeAnimeImageUrl(d?.data?.images?.jpg?.large_image_url || d?.data?.images?.jpg?.image_url || '');
      if (url) imgCache[key] = url;
      return url;
    } catch {
      return '';
    } finally {
      delete imgRequests[key];
    }
  })();

  return imgRequests[key];
}

async function getImg(animeOrTitle) {
  const anime = typeof animeOrTitle === 'object' ? animeOrTitle : findAnimeByTitle(animeOrTitle) || { title: animeOrTitle };
  const cacheKey = anime.mal_id ? 'anime-' + anime.mal_id : 'title-' + (anime.title || '');
  if (imgCache[cacheKey]) return imgCache[cacheKey];

  const directUrl = getBestAnimeImage(anime);
  if (directUrl) {
    imgCache[cacheKey] = directUrl;
    return directUrl;
  }

  if (imgRequests[cacheKey]) return imgRequests[cacheKey];

  imgRequests[cacheKey] = (async () => {
    try {
      const malId = anime.mal_id || TITLE_TO_MAL_ID[anime.title] || TITLE_TO_MAL_ID[anime.title_japanese];
      if (malId) {
        const byId = await getImgById(malId);
        if (byId) {
          imgCache[cacheKey] = byId;
          return byId;
        }
      }

      await new Promise(r => setTimeout(r, 350));
      const query = anime.title_japanese || anime.title || '';
      const r = await fetch('https://api.jikan.moe/v4/anime?q=' + encodeURIComponent(query) + '&limit=1');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const url = normalizeAnimeImageUrl(d?.data?.[0]?.images?.jpg?.large_image_url || d?.data?.[0]?.images?.jpg?.image_url || '');
      if (url) imgCache[cacheKey] = url;
      return url;
    } catch {
      return '';
    } finally {
      delete imgRequests[cacheKey];
    }
  })();

  return imgRequests[cacheKey];
}

let hasStarted = false;

function setResetCursor(active) {
  document.documentElement.classList.toggle('is-resetting-results', !!active);
}

function clearCatalogResults({ preserveFilters = true } = {}) {
  const container = document.getElementById('filterResults');
  if (container) {
    container.innerHTML = '<div class="pre-search-note">Selecciona tus filtros y pulsa <strong>Buscar anime</strong> para ver resultados.</div>';
  }
  catalogResultsCache = [];
  catalogVisibleCount = 0;
  updateResultsSummary(0);

  if (!preserveFilters) {
    document.getElementById('f-demo') && (document.getElementById('f-demo').value = '');
    document.getElementById('f-type') && (document.getElementById('f-type').value = '');
    document.getElementById('f-year') && (document.getElementById('f-year').value = '');

    const genreSelects = [...document.querySelectorAll('.genre-select')];
    genreSelects.forEach((select, index) => {
      if (index === 0) select.value = '';
      else select.closest('.genre-row')?.remove();
    });

    const themeSelects = [...document.querySelectorAll('.theme-select')];
    themeSelects.forEach((select, index) => {
      if (index === 0) select.value = '';
      else select.closest('.theme-row')?.remove();
    });

    ensureGenreRemoveButtons();
    ensureThemeRemoveButtons();
  }
}

function clearSearchResults({ preserveQuery = false } = {}) {
  const input = document.getElementById('titleSearchInput');
  const container = document.getElementById('titleSearchResults');
  if (input && !preserveQuery) input.value = '';
  if (container) {
    container.innerHTML = '<div class="pre-search-note">Escribe al menos <strong>2 letras</strong> para buscar coincidencias por título, alias o nombre alternativo.</div>';
  }
  searchResultsCache = [];
  searchVisibleCount = 0;
  updateSimpleSummary('searchResultsSummary', 0);
  toggleSearchClearButton();
  updateAccountModeUI();
  updateTitleModeUI();
}

function scheduleHeavyScreenReset(fromScreen, toScreen) {
  if (fromScreen === 'filter' && toScreen !== 'filter') {
    needsCatalogReset = true;
  }
  if (fromScreen === 'search' && toScreen !== 'search') {
    needsSearchReset = true;
  }
  if (fromScreen === 'user' && toScreen === 'filter') {
    needsCatalogReset = true;
  }
  if (fromScreen === 'user' && toScreen === 'search') {
    needsSearchReset = true;
  }
}

function flushPendingScreenResets(targetName) {
  if (isCleaningHeavyResults) return;
  const needsAnyReset = (targetName === 'filter' && needsCatalogReset) || (targetName === 'search' && needsSearchReset);
  if (!needsAnyReset) return;

  isCleaningHeavyResults = true;
  setResetCursor(true);

  requestAnimationFrame(() => {
    if (targetName === 'filter' && needsCatalogReset) {
      clearCatalogResults({ preserveFilters: true });
      needsCatalogReset = false;
    }
    if (targetName === 'search' && needsSearchReset) {
      clearSearchResults({ preserveQuery: false });
      needsSearchReset = false;
    }

    requestAnimationFrame(() => {
      isCleaningHeavyResults = false;
      setResetCursor(false);
    });
  });
}

function flushBackgroundScreenResets(targetName) {
  if (isCleaningHeavyResults) return;
  const shouldClearCatalog = targetName !== 'filter' && needsCatalogReset;
  const shouldClearSearch = targetName !== 'search' && needsSearchReset;
  if (!shouldClearCatalog && !shouldClearSearch) return;

  isCleaningHeavyResults = true;
  requestAnimationFrame(() => {
    if (shouldClearCatalog) {
      clearCatalogResults({ preserveFilters: true });
      needsCatalogReset = false;
    }
    if (shouldClearSearch) {
      clearSearchResults({ preserveQuery: false });
      needsSearchReset = false;
    }
    requestAnimationFrame(() => {
      isCleaningHeavyResults = false;
      setResetCursor(false);
    });
  });
}

function openIntro(noAnimation = false) {
  const intro = document.getElementById('intro-screen');
  if (!intro) return;

  closeAnimeModal();
  document.querySelectorAll('.nbtn').forEach(b => b.classList.remove('active'));
  document.body.classList.add('intro-open');

  const current = [...document.querySelectorAll('.screen')].find(s => s.classList.contains('active'));

  if (noAnimation) {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active', 'fade-in', 'fade-out');
    });
    lastScreenName = activeScreenName;
    activeScreenName = 'intro';
    persistActiveScreen('intro');
    intro.classList.remove('fade-in', 'fade-out');
    intro.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }

  document.body.classList.add('screen-transitioning');
  if (current) current.classList.add('fade-out');
  if (intro.classList.contains('active')) return;

  setTimeout(() => {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active', 'fade-in', 'fade-out');
    });
    lastScreenName = activeScreenName;
    activeScreenName = 'intro';
    persistActiveScreen('intro');
    intro.classList.remove('fade-out');
    intro.classList.add('active', 'fade-in');
    setTimeout(() => {
      intro.classList.remove('fade-in');
      document.body.classList.remove('screen-transitioning');
    }, 300);
  }, current ? 170 : 0);

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function dismissIntroIfNeeded(animate = false) {
  const intro = document.getElementById('intro-screen');
  if (!intro || !intro.classList.contains('active')) {
    document.body.classList.remove('intro-open');
    hasStarted = true;
    markIntroSeenInCurrentMobileSession();
    return;
  }

  hasStarted = true;
  markIntroSeenInCurrentMobileSession();
  document.body.classList.remove('intro-open');

  if (!animate) {
    intro.classList.remove('active', 'fade-in', 'fade-out');
    return;
  }

  intro.classList.remove('fade-in');
  intro.classList.add('fade-out');
  setTimeout(() => {
    intro.classList.remove('active', 'fade-out');
  }, 220);
}

function setActiveScreen(screenId, navId = null, animate = false) {
  const screens = [...document.querySelectorAll('.screen')].filter(s => s.id !== 'intro-screen');
  const target = document.getElementById(screenId);
  if (!target) return;

  const targetName = screenId.replace(/-screen$/, '');
  const fromScreen = activeScreenName;
  if (fromScreen !== targetName) saveScreenScrollPosition(fromScreen);
  scheduleHeavyScreenReset(fromScreen, targetName);

  document.querySelectorAll('.nbtn').forEach(b => b.classList.remove('active'));
  if (navId) {
    const nav = document.getElementById(navId);
    if (nav) nav.classList.add('active');
  }

  const current = screens.find(s => s.classList.contains('active') && s.id !== screenId);
  screens.forEach(s => {
    if (s.id !== screenId) {
      s.classList.remove('fade-in', 'fade-out', 'active');
    }
  });

  lastScreenName = fromScreen;
  activeScreenName = targetName;
  persistActiveScreen(targetName);

  const shouldAnimate = animate && window.innerWidth < 600 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!shouldAnimate) {
    target.classList.remove('fade-out', 'fade-in');
    target.classList.add('active');
    flushPendingScreenResets(targetName);
    flushBackgroundScreenResets(targetName);
    restoreScreenScrollPosition(targetName);
    return;
  }

  document.body.classList.add('screen-transitioning');

  if (current) {
    current.classList.remove('fade-in');
    current.classList.add('fade-out');
  }

  setTimeout(() => {
    if (current) current.classList.remove('active', 'fade-out');
    target.classList.add('active', 'fade-in');
    flushPendingScreenResets(targetName);
    flushBackgroundScreenResets(targetName);
    restoreScreenScrollPosition(targetName);
    setTimeout(() => {
      target.classList.remove('fade-in');
      document.body.classList.remove('screen-transitioning');
    }, 180);
  }, current ? 90 : 0);
}

function getDefaultMonthlyNewsPayload() {
  return {
    month: '2026-08',
    title: 'Novedades de Agosto',
    subtitle: 'Noticias y eventos de anime que estamos siguiendo este mes en NeoAnimeZ.',
    items: [
      {
        title: 'Novedades de anime en seguimiento',
        summary: 'Estamos preparando la selección mensual de noticias, eventos y estrenos destacados.',
        date: '2026-08-01',
        source: 'NeoAnimeZ',
        url: '',
        tags: ['Anime', 'Noticias']
      }
    ]
  };
}

function formatMonthlyNewsDate(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function renderMonthlyNews(payload = monthlyNewsPayload || getDefaultMonthlyNewsPayload()) {
  const items = Array.isArray(payload?.items) ? payload.items.slice(0, 6) : [];
  const targets = [
    {
      kicker: document.getElementById('neoTodayKicker'),
      title: document.getElementById('neoTodayTitle'),
      sub: document.getElementById('neoTodaySub'),
      list: document.getElementById('neoTodayNewsList')
    },
    {
      title: document.getElementById('communityNewsTitle'),
      sub: document.getElementById('communityNewsSub'),
      list: document.getElementById('communityNewsList')
    }
  ].filter(target => target.list);
  if (!targets.length) return;

  const emptyHtml = `
      <li>
        <div class="neo-news-meta">NeoAnimeZ</div>
        <div class="neo-news-title">Sin novedades seleccionadas todavía</div>
        <div class="neo-news-summary">Actualizaremos este aviso con noticias y eventos del mes.</div>
      </li>
    `;

  const newsHtml = items.map(item => {
    const itemTitle = escapeHtml(item.title || 'Novedad anime');
    const summary = escapeHtml(item.summary || '');
    const source = escapeHtml(item.source || 'Fuente');
    const date = escapeHtml(formatMonthlyNewsDate(item.date));
    const tags = Array.isArray(item.tags) ? item.tags.slice(0, 4) : [];
    const tagHtml = tags.length
      ? `<div class="neo-news-tags">${tags.map(tag => `<span class="neo-news-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
      : '';
    const sourceUrl = String(item.url || '').trim();
    const sourceHtml = sourceUrl
      ? `<a class="neo-news-source" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Leer fuente</a>`
      : '';
    return `
      <li>
        <div class="neo-news-meta">${source}${date ? ` · ${date}` : ''}</div>
        <div class="neo-news-title">${itemTitle}</div>
        ${summary ? `<div class="neo-news-summary">${summary}</div>` : ''}
        ${tagHtml}
        ${sourceHtml}
      </li>
    `;
  }).join('');

  targets.forEach(target => {
    if (target.kicker) target.kicker.textContent = 'Novedades anime';
    if (target.title) target.title.textContent = payload?.title || 'Novedades del mes';
    if (target.sub) target.sub.textContent = payload?.subtitle || 'Noticias y eventos de anime que estamos siguiendo este mes en NeoAnimeZ.';
    target.list.innerHTML = items.length ? newsHtml : emptyHtml;
  });
}

async function loadMonthlyNews({ force = false } = {}) {
  if (monthlyNewsLoaded && !force) {
    renderMonthlyNews();
    return true;
  }
  try {
    monthlyNewsPayload = await fetchCatalogJson(NEWS_URL, { preferCache: !force, timeout: 7000 });
    monthlyNewsLoaded = true;
    renderMonthlyNews();
    return true;
  } catch (error) {
    monthlyNewsPayload = getDefaultMonthlyNewsPayload();
    monthlyNewsLoaded = true;
    renderMonthlyNews();
    console.warn('No se pudo cargar anime-news.json:', error);
    return false;
  }
}

function openNeoToday() {
  const overlay = document.getElementById('neoTodayOverlay');
  if (!overlay) return;
  renderMonthlyNews();
  loadMonthlyNews();
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeNeoToday() {
  const overlay = document.getElementById('neoTodayOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
}

function scrollToMoodPanel() {
  const panel = document.getElementById('moodRecommendationPanel');
  panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function goNeoTodayAction(action) {
  closeNeoToday();
  if (action === 'mood') {
    showScreen('search');
    window.setTimeout(scrollToMoodPanel, 160);
    return;
  }
  if (action === 'community') {
    showScreen('ranking');
    return;
  }
  if (action === 'arcade') {
    showScreen('ranking');
    window.setTimeout(openNeoArcadeGame, 180);
    return;
  }
  if (['filter', 'search', 'user', 'info'].includes(action)) {
    showScreen(action);
  }
}

function startApp() {
  markIntroSeenInCurrentMobileSession();
  dismissIntroIfNeeded(true);
  setActiveScreen('user-screen', 'nav-user', true);
  scheduleResumeRefresh(120);
  schedulePendingWriteSync(500);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function goHome() {
  setResetCursor(false);
  openIntro(false);
}

function showScreen(name) {
  if (activeScreenName === name && hasStarted) {
    if (name === 'ranking') loadRanking();
    return;
  }
  dismissIntroIfNeeded(true);
  if (name !== 'ranking') stopNeoArcadeLoop();
  setActiveScreen(name + '-screen', 'nav-' + name, true);
  if (name === 'ranking') loadRanking();
  if (name === 'ranking' && !document.getElementById('communityArcadeView')?.classList.contains('hidden')) initNeoArcadeGame();
  if (name === 'user') loadAnimeSchedule();
}

function addGenreSelect(value = '') {
  const stack = document.getElementById('genreFilters');
  if (!stack) return;

  const firstSelect = stack.querySelector('.genre-select');
  const row = document.createElement('div');
  row.className = 'genre-row';

  const select = firstSelect.cloneNode(true);
  select.value = value;

  const actions = document.createElement('div');
  actions.className = 'genre-row-actions';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'genre-remove-btn';
  removeBtn.textContent = '×';
  removeBtn.setAttribute('aria-label', 'Quitar género');
  removeBtn.addEventListener('click', () => {
    row.remove();
    ensureGenreRemoveButtons();
  });

  actions.appendChild(removeBtn);
  row.appendChild(actions);
  row.appendChild(select);
  stack.appendChild(row);
  ensureGenreRemoveButtons();
  updateAdultContentUI();
}

function ensureGenreRemoveButtons() {
  const rows = [...document.querySelectorAll('#genreFilters .genre-row')];
  rows.forEach((row, index) => {
    let actions = row.querySelector('.genre-row-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'genre-row-actions';
      row.prepend(actions);
    }

    let btn = actions.querySelector('.genre-remove-btn');

    if (index === 0) {
      actions.innerHTML = '';
    } else if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'genre-remove-btn';
      btn.textContent = '×';
      btn.setAttribute('aria-label', 'Quitar género');
      btn.addEventListener('click', () => {
        row.remove();
        ensureGenreRemoveButtons();
      });
      actions.appendChild(btn);
    }
  });
}

function getSelectedGenres() {
  return [...document.querySelectorAll('.genre-select')]
    .map(select => select.value)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function addThemeSelect(value = '') {
  const stack = document.getElementById('themeFilters');
  if (!stack) return;

  const firstSelect = stack.querySelector('.theme-select');
  const row = document.createElement('div');
  row.className = 'theme-row';

  const select = firstSelect.cloneNode(true);
  select.value = value;

  const actions = document.createElement('div');
  actions.className = 'theme-row-actions';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'theme-remove-btn';
  removeBtn.textContent = '×';
  removeBtn.setAttribute('aria-label', 'Quitar tema');
  removeBtn.addEventListener('click', () => {
    row.remove();
    ensureThemeRemoveButtons();
  });

  actions.appendChild(removeBtn);
  row.appendChild(actions);
  row.appendChild(select);
  stack.appendChild(row);
  ensureThemeRemoveButtons();
}

function ensureThemeRemoveButtons() {
  const rows = [...document.querySelectorAll('#themeFilters .theme-row')];
  rows.forEach((row, index) => {
    let actions = row.querySelector('.theme-row-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'theme-row-actions';
      row.prepend(actions);
    }

    let btn = actions.querySelector('.theme-remove-btn');

    if (index === 0) {
      actions.innerHTML = '';
    } else if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-remove-btn';
      btn.textContent = '×';
      btn.setAttribute('aria-label', 'Quitar tema');
      btn.addEventListener('click', () => {
        row.remove();
        ensureThemeRemoveButtons();
      });
      actions.appendChild(btn);
    }
  });
}

function getSelectedThemes() {
  return [...document.querySelectorAll('.theme-select')]
    .map(select => select.value)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function getAnimeSortValue(anime) {
  const score = Number(anime.score);
  return Number.isFinite(score) ? score : -1;
}

function getVotesSortValue(anime) {
  const votes = Number(anime.scored_by);
  return Number.isFinite(votes) ? votes : -1;
}

function sortAnimeResults(list) {
  return [...list].sort((a, b) => {
    const scoreDiff = getAnimeSortValue(b) - getAnimeSortValue(a);
    if (scoreDiff !== 0) return scoreDiff;

    const votesDiff = getVotesSortValue(b) - getVotesSortValue(a);
    if (votesDiff !== 0) return votesDiff;

    const yearDiff = (Number(b.year) || -1) - (Number(a.year) || -1);
    if (yearDiff !== 0) return yearDiff;

    return String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base' });
  });
}

function updateResultsSummary(count) {
  const summary = document.getElementById('resultsSummary');
  if (!summary) return;
  if (!count) {
    summary.textContent = '';
    summary.classList.remove('show');
    return;
  }
  summary.textContent = `Títulos encontrados · ${count}`;
  summary.classList.add('show');
}

function renderLoadMoreButton(container, visibleCount, totalCount, handler) {
  container.querySelector('.load-more-wrap')?.remove();
  if (visibleCount >= totalCount) return;

  const wrap = document.createElement('div');
  wrap.className = 'load-more-wrap';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'load-more-btn';
  button.textContent = `Mostrar más · ${visibleCount}/${totalCount}`;
  button.addEventListener('click', handler);
  wrap.appendChild(button);
  container.appendChild(wrap);
}

function renderCatalogBatch({ reset = false } = {}) {
  const container = document.getElementById('filterResults');
  if (!container) return;
  if (reset) {
    catalogVisibleCount = 0;
    container.innerHTML = '';
  }

  container.querySelector('.load-more-wrap')?.remove();
  const start = catalogVisibleCount;
  const next = catalogResultsCache.slice(start, start + RESULTS_PAGE_SIZE);
  next.forEach((anime, index) => {
    container.appendChild(renderAnimeCard(anime, start + index, 'catalog', index));
  });
  catalogVisibleCount += next.length;
  renderLoadMoreButton(container, catalogVisibleCount, catalogResultsCache.length, () => renderCatalogBatch());
}

function renderSearchBatch({ reset = false } = {}) {
  const container = document.getElementById('titleSearchResults');
  if (!container) return;
  if (reset) {
    searchVisibleCount = 0;
    container.innerHTML = '';
  }

  container.querySelector('.load-more-wrap')?.remove();
  const start = searchVisibleCount;
  const next = searchResultsCache.slice(start, start + RESULTS_PAGE_SIZE);
  next.forEach((anime, index) => {
    container.appendChild(renderAnimeCard(anime, start + index, 'search', index));
  });
  searchVisibleCount += next.length;
  renderLoadMoreButton(container, searchVisibleCount, searchResultsCache.length, () => renderSearchBatch());
}

async function applyFilters() {
  const container = document.getElementById('filterResults');
  if (!DB.length) {
    updateResultsSummary(0);
    container.innerHTML = '<div class="no-res">La base de datos todavía no está lista.<br><small>Recarga la página si el problema continúa.</small></div>';
    return;
  }

  const genres = getSelectedGenres();
  const themes = getSelectedThemes();
  const type = document.getElementById('f-type').value;
  const demo = document.getElementById('f-demo').value;
  const year = document.getElementById('f-year').value;

  let results = DB.filter(a => {
    if (!isAnimeVisible(a)) return false;
    const animeYear = Number(a.year) || 0;
    const animeGenres = a.genres || [];
    const animeThemes = a.themes || [];

    if (genres.length && !genres.every(genre => animeGenres.includes(genre))) return false;
    if (themes.length && !themes.every(theme => animeThemes.includes(theme))) return false;
    if (type && a.type !== type) return false;
    if (demo && a.demographic !== demo) return false;

    if (year === '2020s' && !(animeYear >= 2020 && animeYear <= 2029)) return false;
    if (year === '2010s' && !(animeYear >= 2010 && animeYear <= 2019)) return false;
    if (year === '2000s' && !(animeYear >= 2000 && animeYear <= 2009)) return false;
    if (year === '1990s' && !(animeYear >= 1990 && animeYear <= 1999)) return false;
    if (year === 'classic' && !(animeYear > 0 && animeYear < 1990)) return false;

    return true;
  });

  results = sortAnimeResults(results);

  container.innerHTML = '';

  if (!results.length) {
    updateResultsSummary(0);
    container.innerHTML = '<div class="no-res">😶‍🌫️ Sin resultados con esos filtros.<br><small>Prueba con menos restricciones.</small></div>';
    return;
  }

  updateResultsSummary(results.length);
  catalogResultsCache = results;
  renderCatalogBatch({ reset: true });
}


function updateSimpleSummary(id, count, label = 'Resultados') {
  const summary = document.getElementById(id);
  if (!summary) return;
  if (!count) {
    summary.textContent = '';
    summary.classList.remove('show');
    return;
  }
  summary.textContent = `${label} · ${count}`;
  summary.classList.add('show');
}

function renderAnimeCard(anime, idx, mode = 'catalog', loadIndex = idx) {
  const imgId = `${mode}-${idx}-${String(anime.title || 'anime').replace(/\W/g, '-')}`;
  const meta = [
    anime.year || '—',
    getAnimeEpisodeLabel(anime),
    anime.demographic || '—'
  ].join(' · ');

  const chips = [
    ...(anime.genres || []).slice(0, 2),
    ...(anime.themes || []).slice(0, 2),
    anime.demographic
  ].filter(Boolean).slice(0, 5);

  const displayTitle = mode === 'search' && anime._searchDisplayTitle
    ? anime._searchDisplayTitle
    : getAnimeDisplayTitle(anime);
  const scoreValue = Number.isFinite(Number(anime.score)) ? Number(anime.score).toFixed(2) : '—';
  const votesValue = Number.isFinite(Number(anime.scored_by)) ? Number(anime.scored_by).toLocaleString('es-ES') : '—';
  const showTop = mode === 'catalog' && idx < 5;
  const rankClass = showTop ? ` top-rank top-${idx + 1}` : '';
  const badge = showTop ? `<div class="rank-badge"><strong>TOP ${idx + 1}</strong></div>` : '';
  const scoreLine = mode === 'catalog'
    ? `<div class="score-line"><strong>${scoreValue}</strong> · ${votesValue} votos</div>`
    : '';
  const animeId = Number(anime.mal_id);
  const userStatus = userAnimeMap.get(animeId) || '';
  const hasUserStatus = !!STATUS_LABELS[userStatus];
  const statusMark = hasUserStatus ? buildStatusBadge(userStatus, 'fcard-status-mark') : '';

  const div = document.createElement('div');
  div.className = `fcard card-clickable${rankClass}${hasUserStatus ? ` has-user-status status-${userStatus}` : ''}`;
  div.dataset.animeId = String(animeId || '');
  div.innerHTML = `
    <img class="fcard-img" id="${imgId}" src="${BLANK}" alt="${displayTitle}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
    <div style="min-width:0;flex:1">
      ${badge}
      <div class="fcard-title-row">
        <div class="fcard-title">${displayTitle}</div>
        ${statusMark}
      </div>
      <div class="fcard-meta">${meta}</div>
      ${scoreLine}
      <div class="fcard-desc">${escapeHtml(getAnimeDescription(anime, { preview: true }))}</div>
      <div class="tags" style="margin-top:5px">${chips.map(g => '<span class="tag">' + g + '</span>').join('')}</div>
    </div>`;
  div.addEventListener('click', () => {
    const imgNow = div.querySelector('.fcard-img')?.src || BLANK;
    openAnimeModal(anime, imgNow);
  });

  loadAnimeImageElement(div.querySelector('.fcard-img'), anime, Math.min(loadIndex, 12) * 55);

  return div;
}

function scoreAnimeMatch(anime, query) {
  const normalizedQuery = normalizeLoose(query);
  if (!normalizedQuery) return -1;

  const aliases = getSearchAliases(anime);
  if (!aliases.length) return -1;

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  let best = -1;

  aliases.forEach(alias => {
    const text = alias.clean;
    if (!text) return;

    let score = -1;

    if (text === normalizedQuery) score = 1200;
    else if (text.startsWith(normalizedQuery)) score = 920;
    else if (text.includes(` ${normalizedQuery}`)) score = 840;
    else if (queryTokens.every(token => text.includes(token))) score = 650;
    else if (text.includes(normalizedQuery)) score = 520;
    else {
      const tokenHits = queryTokens.filter(token => text.includes(token)).length;
      if (tokenHits) score = 260 + tokenHits * 70;
    }

    if (score < 0) return;

    const compactText = text.replace(/\s+/g, '');
    const compactQuery = normalizedQuery.replace(/\s+/g, '');
    if (compactText.startsWith(compactQuery)) score += 80;
    if (compactText.includes(compactQuery)) score += 30;

    const lengthPenalty = Math.max(0, text.length - normalizedQuery.length);
    score -= Math.min(140, lengthPenalty * 2);

    if (normalizeLoose(anime.title) === text) score += 55;
    if (normalizeLoose(anime.franchise) === text) score += 25;

    best = Math.max(best, score);
  });

  return best;
}

function sortTitleSearchResults(results) {
  return [...results].sort((a, b) => {
    if (b._searchScore !== a._searchScore) return b._searchScore - a._searchScore;

    const votesDiff = getVotesSortValue(b) - getVotesSortValue(a);
    if (votesDiff !== 0) return votesDiff;

    const scoreDiff = getAnimeSortValue(b) - getAnimeSortValue(a);
    if (scoreDiff !== 0) return scoreDiff;

    return String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base' });
  });
}

function toggleSearchClearButton() {
  const input = document.getElementById('titleSearchInput');
  const clear = document.getElementById('titleSearchClear');
  if (!input || !clear) return;
  clear.classList.toggle('show', !!input.value.trim());
}

function isLikelyFollowUpSeason(anime = {}) {
  const text = [
    anime.title,
    anime.title_english,
    anime.title_es,
    ...(anime.title_synonyms || []),
    ...(anime.search_titles || []),
    ...(anime.search_titles_es || [])
  ].filter(Boolean).join(' ');

  return [
    /\b(?:season|temporada)\s*(?:2|3|4|5|6|7|8|9|10|ii|iii|iv|v|vi|vii|viii|ix|x)\b/i,
    /\b(?:segunda|tercera|cuarta|quinta|sexta)\s+temporada\b/i,
    /\b(?:2nd|3rd|4th|5th|second|third|fourth|fifth)\s+(?:season|stage|cour)\b/i,
    /\b(?:part|cour)\s*(?:2|3|4|ii|iii|iv)\b/i,
    /\b(?:chapter|capitulo|capítulo|episode|episodio)\s*(?:2|3|4|5|6|7|8|9|10|ii|iii|iv|v|vi|vii|viii|ix|x)\b/i,
    /\b(?:movie|film|pelicula|película)\s*(?:2|3|4|ii|iii|iv)\b/i,
    /\b(?:final|last)\s+season\b/i,
    /\b\d+(?:nd|rd|th)\s+season\b/i
  ].some(regex => regex.test(text));
}

function getRandomRecommendationPool() {
  const allowedTypes = new Set(['tv', 'movie', 'ona', 'ova']);
  return DB.filter(anime => {
    const type = String(anime?.type || '').toLowerCase();
    if (!allowedTypes.has(type)) return false;
    if (!isAnimeVisible(anime)) return false;
    if (isLikelyFollowUpSeason(anime)) return false;
    return Number(anime?.mal_id) > 0;
  });
}

function pickRandomAnime(list) {
  if (!list.length) return null;
  const index = Math.floor(Math.random() * list.length);
  return list[index];
}

const MOOD_RECOMMENDATIONS = {
  short: {
    reason: 'es fácil de empezar y no exige comprometerte con una serie larguísima',
    match: anime => anime.type === 'Movie' || (getAnimeTotalEpisodes(anime) && getAnimeTotalEpisodes(anime) <= 13)
  },
  intense: {
    reason: 'encaja con acción, tensión o historias con mucha energía',
    genres: ['Action', 'Suspense', 'Horror'],
    themes: ['Survival', 'Gore', 'Psychological', 'Super Power', 'Combat Sports']
  },
  adventure: {
    reason: 'tiene espíritu de viaje, fantasía o mundo por descubrir',
    genres: ['Adventure', 'Fantasy', 'Action'],
    themes: ['Isekai', 'Mythology', 'Super Power']
  },
  comfort: {
    reason: 'va mejor para ver algo más amable, ligero o de ritmo cómodo',
    genres: ['Slice of Life', 'Comedy', 'Gourmet'],
    themes: ['Iyashikei', 'CGDCT', 'School', 'Music']
  },
  mystery: {
    reason: 'tira hacia misterio, investigación o tensión psicológica',
    genres: ['Mystery', 'Suspense', 'Supernatural'],
    themes: ['Detective', 'Psychological', 'Time Travel']
  },
  romance: {
    reason: 'prioriza romance, drama emocional o relaciones entre personajes',
    genres: ['Romance', 'Drama', 'Girls Love', 'Boys Love'],
    themes: ['Love Polygon', 'School', 'Workplace']
  }
};

function animeHasAny(values = [], targets = []) {
  if (!targets.length) return false;
  return values.some(value => targets.includes(value));
}

function scoreMoodAnime(anime, mood) {
  let score = 0;
  if (mood.match?.(anime)) score += 6;
  if (animeHasAny(anime.genres || [], mood.genres || [])) score += 4;
  if (animeHasAny(anime.themes || [], mood.themes || [])) score += 3;
  if (Number.isFinite(Number(anime.score))) score += Math.max(0, Number(anime.score) - 6.8) * 0.8;
  if (Number.isFinite(Number(anime.scored_by))) score += Math.min(1.4, Math.log10(Math.max(1, Number(anime.scored_by))) / 8);
  if (userAnimeMap.has(Number(anime.mal_id))) score -= 2.5;
  return score;
}

function getMoodRecommendationPool(key) {
  const mood = MOOD_RECOMMENDATIONS[key];
  if (!mood) return [];
  const scored = getRandomRecommendationPool()
    .map(anime => ({ anime, score: scoreMoodAnime(anime, mood) }))
    .filter(item => item.score > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return getVotesSortValue(b.anime) - getVotesSortValue(a.anime);
  });
  return scored.slice(0, 36).map(item => item.anime);
}

function openMoodRecommendation(key) {
  if (!DB.length) {
    showRecommendationUnavailable('La base de datos todavía no está lista.<br><small>Recarga la página si el problema continúa.</small>');
    return;
  }
  const mood = MOOD_RECOMMENDATIONS[key];
  const anime = pickRandomAnime(getMoodRecommendationPool(key));
  if (!anime || !mood) {
    showRecommendationUnavailable('No encontré una recomendación clara para ese mood. Prueba con otro estado.');
    return;
  }
  openAnimeModal(anime, anime.image || BLANK, {
    recommendationReason: `Te lo recomiendo porque ${mood.reason}.`
  });
}

function rollRecommendationButton(button, anime, recommendationReason = '') {
  if (!anime) return;
  button?.classList.add('is-rolling');
  if (button) button.disabled = true;

  setTimeout(() => {
    button?.classList.remove('is-rolling');
    if (button) button.disabled = false;
    openAnimeModal(anime, anime.image || BLANK, { recommendationReason });
  }, 620);
}

function showRecommendationUnavailable(message = 'No hay recomendaciones suficientes todavía.') {
  updateSimpleSummary('searchResultsSummary', 0);
  const container = document.getElementById('titleSearchResults');
  if (container) container.innerHTML = `<div class="no-res">${message}</div>`;
}

function openRandomRecommendation() {
  const button = document.getElementById('randomAnimeButton');
  if (!DB.length) {
    showRecommendationUnavailable('La base de datos todavía no está lista.<br><small>Recarga la página si el problema continúa.</small>');
    return;
  }

  const anime = pickRandomAnime(getRandomRecommendationPool());
  rollRecommendationButton(button, anime, 'Sorpresa total del catálogo NeoAnimeZ: una primera temporada o película para descubrir sin darle demasiadas vueltas.');
}

function addWeightedMapValue(map, values = [], weight = 1) {
  values.filter(Boolean).forEach(value => {
    map.set(value, (map.get(value) || 0) + weight);
  });
}

function getTasteProfile() {
  const genreWeights = new Map();
  const themeWeights = new Map();
  const demographicWeights = new Map();
  let signalCount = 0;

  userAnimeMap.forEach((status, animeId) => {
    const anime = getAnimeById(animeId);
    if (!anime || !isAnimeVisible(anime)) return;
    const rating = Number(userRatingMap.get(Number(animeId)));
    const statusWeight = {
      completed: 3,
      watching: 2.4,
      pending: 1.15,
      dropped: -2.8
    }[status] || 0;
    const ratingWeight = Number.isFinite(rating) ? (rating - 6) * 0.85 : 0;
    const weight = statusWeight + ratingWeight;
    if (!weight) return;

    signalCount += Math.max(0, weight);
    addWeightedMapValue(genreWeights, anime.genres || [], weight);
    addWeightedMapValue(themeWeights, anime.themes || [], weight * 0.9);
    addWeightedMapValue(demographicWeights, anime.demographic ? [anime.demographic] : [], weight * 0.7);
  });

  userRatingMap.forEach((rating, animeId) => {
    if (userAnimeMap.has(Number(animeId))) return;
    const anime = getAnimeById(animeId);
    const numericRating = Number(rating);
    if (!anime || !isAnimeVisible(anime) || !Number.isFinite(numericRating) || numericRating < 7) return;
    const weight = (numericRating - 6) * 0.65;
    signalCount += weight;
    addWeightedMapValue(genreWeights, anime.genres || [], weight);
    addWeightedMapValue(themeWeights, anime.themes || [], weight * 0.9);
    addWeightedMapValue(demographicWeights, anime.demographic ? [anime.demographic] : [], weight * 0.7);
  });

  return { genreWeights, themeWeights, demographicWeights, signalCount };
}

function getTasteRecommendationPool() {
  if (!currentUser) return [];
  const base = getRandomRecommendationPool().filter(anime => !userAnimeMap.has(Number(anime.mal_id)));
  const profile = getTasteProfile();
  if (profile.signalCount <= 0) return [];

  const scored = base.map(anime => {
    let score = 0;
    (anime.genres || []).forEach(genre => score += profile.genreWeights.get(genre) || 0);
    (anime.themes || []).forEach(theme => score += profile.themeWeights.get(theme) || 0);
    if (anime.demographic) score += profile.demographicWeights.get(anime.demographic) || 0;
    if (Number.isFinite(Number(anime.score))) score += Math.max(0, Number(anime.score) - 6.8) * 0.55;
    if (Number.isFinite(Number(anime.scored_by))) score += Math.min(1.4, Math.log10(Math.max(1, Number(anime.scored_by))) / 8);
    if (anime.popular) score += 0.3;
    return { anime, score };
  }).filter(item => item.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 30).map(item => item.anime);
}

function openTasteRecommendation() {
  const button = document.getElementById('tasteAnimeButton');
  if (!currentUser) return;
  if (!DB.length) {
    showRecommendationUnavailable('La base de datos todavía no está lista.<br><small>Recarga la página si el problema continúa.</small>');
    return;
  }

  const anime = pickRandomAnime(getTasteRecommendationPool());
  if (!anime) {
    showRecommendationUnavailable('Añade algunos animes a tu lista o pon puntuaciones para activar recomendaciones según tus gustos.');
    return;
  }

  rollRecommendationButton(button, anime, 'Te lo recomiendo porque comparte géneros, temas o señales con animes que tienes en tu lista y tus puntuaciones.');
}

function scrollToTitleSearchResults() {
  const container = document.getElementById('titleSearchResults');
  const summary = document.getElementById('searchResultsSummary');
  if (!container) return;
  const target = summary?.classList.contains('show')
    ? summary
    : (container.querySelector('.fcard, .no-res, .pre-search-note') || container);
  window.requestAnimationFrame(() => {
    scrollElementBelowStickyHeader(target, { extra: 16 });
  });
}

function performTitleSearch({ scrollToResults = false } = {}) {
  const input = document.getElementById('titleSearchInput');
  const container = document.getElementById('titleSearchResults');
  if (!input || !container) return;

  const rawQuery = input.value || '';
  const query = normalizeLoose(rawQuery);
  toggleSearchClearButton();
  updateAccountModeUI();
  container.innerHTML = '';

  if (!DB.length) {
    updateSimpleSummary('searchResultsSummary', 0);
    container.innerHTML = '<div class="no-res">La base de datos todavía no está lista.<br><small>Recarga la página si el problema continúa.</small></div>';
    if (scrollToResults) scrollToTitleSearchResults();
    return;
  }

  if (query.length < 2) {
    updateSimpleSummary('searchResultsSummary', 0);
    container.innerHTML = '<div class="pre-search-note">Escribe al menos <strong>2 letras</strong> para buscar coincidencias por título, alias o nombre alternativo.</div>';
    if (scrollToResults) scrollToTitleSearchResults();
    return;
  }

  const results = sortTitleSearchResults(
    DB.filter(isAnimeVisible)
      .map(anime => ({
      ...anime,
      _searchScore: scoreAnimeMatch(anime, query),
      _searchDisplayTitle: getSearchDisplayTitle(anime, query)
    }))
      .filter(anime => anime._searchScore >= 320)
  );

  if (!results.length) {
    updateSimpleSummary('searchResultsSummary', 0);
    container.innerHTML = '<div class="no-res">No encontré coincidencias suficientes.<br><small>Prueba con otra palabra, un alias o un título más corto.</small></div>';
    if (scrollToResults) scrollToTitleSearchResults();
    return;
  }

  updateSimpleSummary('searchResultsSummary', results.length, 'Títulos encontrados');
  searchResultsCache = results;
  renderSearchBatch({ reset: true });
  if (scrollToResults) scrollToTitleSearchResults();
}

function scheduleTitleSearch(delay = 300) {
  window.clearTimeout(titleSearchDebounce);
  titleSearchDebounce = window.setTimeout(() => {
    performTitleSearch();
  }, delay);
}

let rankingLoaded = false;

function initRankingAccordions() {
  const toggles = document.querySelectorAll('.ranking-toggle');
  toggles.forEach(btn => {
    if (!btn.dataset.target) return;
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
      const group = btn.closest('.ranking-group');
      if (!group) return;
      group.classList.toggle('open');
    });
  });
}

function buildRankingCard({ anime, rank, imageId, scoreText = '', scoreSubText = '', showScore = false, rightBadgeHtml = '' }) {
  const animeId = Number(anime.mal_id) || '';
  const displayTitle = getAnimeDisplayTitle(anime);
  const div = document.createElement('div');
  div.className = 'rcard card-clickable';
  div.dataset.animeId = String(animeId);
  div.innerHTML = `
    <div class="rnum">${String(rank).padStart(2, '0')}</div>
    <img class="rimg" id="${imageId}" src="${BLANK}" alt="${displayTitle}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
    <div class="rinfo">
      <div class="rmeta-top">
        <div class="rtitle">${displayTitle}</div>
        ${rightBadgeHtml || (showScore ? `<div class="rscore-badge"><strong>${scoreText}</strong>${scoreSubText ? `<span>${scoreSubText}</span>` : ''}</div>` : '')}
      </div>
      <div class="rgenres">${[...(anime.genres || []), ...(anime.themes || [])].slice(0, 3).join(' · ')}</div>
      <div class="rdesc">${escapeHtml(getAnimeDescription(anime, { preview: true }))}</div>
    </div>`;
  return div;
}

function updateCommunityRankingModeButtons() {
  document.querySelectorAll('[data-community-ranking-mode]').forEach(button => {
    const active = button.dataset.communityRankingMode === communityRankingMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function setCommunityRankingMode(mode) {
  communityRankingMode = ['selection', 'best', 'popular'].includes(mode) ? mode : 'selection';
  updateCommunityRankingModeButtons();
  renderCommunityRanking();
}

function getCommunityRankingItems(mode = communityRankingMode) {
  const base = [...communityRatingMap.entries()]
    .map(([animeId, rating]) => ({
      anime: getAnimeById(animeId),
      rating
    }))
    .filter(item => item.anime && isAnimeVisible(item.anime) && item.rating?.count);

  const sorters = {
    best: (a, b) => {
      const weightedDiff = b.rating.weighted - a.rating.weighted;
      if (weightedDiff !== 0) return weightedDiff;
      const countDiff = b.rating.count - a.rating.count;
      if (countDiff !== 0) return countDiff;
      return b.rating.average - a.rating.average;
    },
    popular: (a, b) => {
      const countDiff = b.rating.count - a.rating.count;
      if (countDiff !== 0) return countDiff;
      const weightedDiff = b.rating.weighted - a.rating.weighted;
      if (weightedDiff !== 0) return weightedDiff;
      return b.rating.average - a.rating.average;
    }
  };

  return base
    .sort((a, b) => {
      const diff = (sorters[mode] || sorters.best)(a, b);
      if (diff !== 0) return diff;
      return String(getAnimeDisplayTitle(a.anime)).localeCompare(String(getAnimeDisplayTitle(b.anime)), 'es', { sensitivity: 'base' });
    })
    .slice(0, 10);
}

function getCommunityRankingEmptyMessage() {
  if (communityRankingMode === 'popular') return 'Todavía no hay suficientes votos para ordenar por participación.';
  return 'Todavía no hay puntuaciones de la comunidad. Cuando los usuarios empiecen a votar, aparecerán aquí.';
}

function renderNeoSelection(container) {
  container.innerHTML = '';
  let visibleRank = 0;
  RANKING_DATA.forEach((rankingItem, index) => {
    const fromCatalog = findAnimeByTitle(rankingItem.title)
      || DB.find(anime => Number(anime.mal_id) === Number(rankingItem.mal_id))
      || {};
    const anime = {
      ...fromCatalog,
      title: fromCatalog.title || rankingItem.title,
      mal_id: fromCatalog.mal_id || rankingItem.mal_id
    };
    if (!isAnimeVisible(anime)) return;
    visibleRank += 1;
    const imageId = `ri-${index}`;
    const card = buildRankingCard({ anime, rank: visibleRank, imageId });
    card.addEventListener('click', () => {
      const image = card.querySelector('.rimg')?.src || BLANK;
      openAnimeModal(anime, image);
    });
    container.appendChild(card);
    loadAnimeImageById(imageId, anime, index * 60);
  });
}

function renderCommunityRanking(emptyMessage = '') {
  const communityContainer = document.getElementById('rankingCommunityList');
  if (!communityContainer) return;

  communityContainer.innerHTML = '';
  updateCommunityRankingModeButtons();
  if (communityRankingMode === 'selection') {
    renderNeoSelection(communityContainer);
    return;
  }
  if (emptyMessage) {
    communityContainer.innerHTML = `<div class="ranking-empty">${emptyMessage}</div>`;
    return;
  }

  const communityTop = getCommunityRankingItems();

  if (!communityTop.length) {
    communityContainer.innerHTML = `<div class="ranking-empty">${getCommunityRankingEmptyMessage()}</div>`;
    return;
  }

  communityTop.forEach((item, index) => {
    const imgId = 'rc-' + index;
    const votesLabel = item.rating.count === 1 ? '1 voto' : `${item.rating.count} votos`;
    const scoreText = communityRankingMode === 'popular'
      ? String(item.rating.count)
      : item.rating.average.toFixed(1);
    const scoreSubText = communityRankingMode === 'popular'
      ? (item.rating.count === 1 ? 'voto' : 'votos')
      : votesLabel;
    const div = buildRankingCard({
      anime: item.anime,
      rank: index + 1,
      imageId: imgId,
      scoreText,
      scoreSubText,
      showScore: true
    });

    div.addEventListener('click', () => {
      const imgNow = div.querySelector('.rimg')?.src || BLANK;
      openAnimeModal(item.anime, imgNow);
    });

    communityContainer.appendChild(div);

    loadAnimeImageById(imgId, item.anime, index * 60);
  });
}

function formatCompactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  try {
    return new Intl.NumberFormat('es-ES', {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(number);
  } catch {
    if (number >= 1000000) return `${Math.round(number / 100000) / 10}M`;
    if (number >= 1000) return `${Math.round(number / 100) / 10}K`;
    return String(Math.round(number));
  }
}

function formatUpcomingDate(anime = {}) {
  const raw = String(anime.aired_from || '').trim();
  if (!raw) return 'Fecha desconocida';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'Fecha desconocida';
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate && isoDate[3] === '01') {
    return new Intl.DateTimeFormat('es-ES', {
      month: 'long',
      year: 'numeric'
    }).format(new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, 1)));
  }
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function forceUpcomingImageLoad(img, anime, delay = 0) {
  if (!img || !anime || !img.isConnected) return;
  if (img.dataset.imageLoaded === '1') return;

  loadAnimeImageElement(img, anime, delay);
  window.setTimeout(() => {
    if (!img.isConnected || img.dataset.imageLoaded === '1') return;
    enqueueAnimeImageLoad(img, anime, 0);
  }, delay + 90);
}

function loadUpcomingSectionImages(section) {
  if (!section?.open) return;
  section.querySelectorAll('img[data-upcoming-image="true"]').forEach((img, index) => {
    const anime = upcomingAnimeMap.get(Number(img.dataset.animeId));
    if (!anime) return;
    forceUpcomingImageLoad(img, anime, Math.min(index, 10) * 45);
  });
}

function buildUpcomingCard(anime, sectionId) {
  const animeId = Number(anime.mal_id) || '';
  const displayTitle = getAnimeDisplayTitle(anime);
  const div = document.createElement('div');
  div.className = 'rcard upcoming-card card-clickable';
  div.dataset.animeId = String(animeId);
  div.innerHTML = `
    <img class="rimg" src="${EMPTY_IMAGE}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-upcoming-image="true" data-anime-id="${animeId}">
    <div class="rinfo upcoming-info">
      <div class="upcoming-title"></div>
      <div class="upcoming-date"></div>
      <div class="upcoming-type"></div>
    </div>
  `;

  const img = div.querySelector('.rimg');
  const title = div.querySelector('.upcoming-title');
  const date = div.querySelector('.upcoming-date');
  const type = div.querySelector('.upcoming-type');
  if (img) img.alt = displayTitle;
  if (title) title.textContent = displayTitle;
  if (date) date.textContent = formatUpcomingDate(anime);
  if (type) {
    const sectionSeasonLabels = {
      winter: 'Invierno',
      spring: 'Primavera',
      summer: 'Verano',
      fall: 'Otoño'
    };
    const sectionSeason = String(sectionId || '').split('_')[0];
    const parts = [anime.type, sectionSeasonLabels[sectionSeason] || anime.upcoming_season_label].filter(Boolean);
    type.textContent = parts.join(' · ');
  }
  return div;
}

async function loadUpcomingRanking() {
  const container = document.getElementById('rankingUpcomingList');
  const updatedAt = document.getElementById('rankingUpcomingUpdated');
  if (!container) return;

  if (!upcomingPayload) {
    container.innerHTML = '<div class="ranking-empty">Cargando más esperados...</div>';
    try {
      const payload = await fetchCatalogJson(UPCOMING_URL, { preferCache: true, timeout: 12000 });
      const items = Array.isArray(payload?.items) ? payload.items.map(item => normalizeAnimeRecord(item)) : [];
      upcomingPayload = {
        ...payload,
        items
      };
      upcomingAnimeMap = new Map(items.map(item => [Number(item.mal_id), item]));
    } catch (error) {
      console.warn('No se pudo cargar anime-upcoming.json:', error);
      if (updatedAt) updatedAt.classList.add('hidden');
      container.innerHTML = '<div class="ranking-empty">No se pudo cargar Más esperados. Comprueba que anime-upcoming.json está subido junto al HTML.</div>';
      return;
    }
  }

  renderDataUpdatedLabel(
    'rankingUpcomingUpdated',
    upcomingPayload?.meta?.curated_at || upcomingPayload?.meta?.generated_at
  );

  const sectionOrder = upcomingPayload.section_order || ['most_anticipated', 'winter', 'spring', 'summer', 'fall', 'unknown'];
  const labels = upcomingPayload.section_labels || {};
  const sections = upcomingPayload.sections || {};
  container.innerHTML = '';

  sectionOrder.forEach(sectionId => {
    const ids = sections[sectionId] || [];
    const items = ids
      .map(id => upcomingAnimeMap.get(Number(id)))
      .filter(anime => anime && isAnimeVisible(anime));
    if (!items.length) return;

    const details = document.createElement('details');
    details.className = 'upcoming-season';
    details.dataset.section = sectionId;

    const label = labels[sectionId] || sectionId;
    details.innerHTML = `
      <summary>
        <span>${label}</span>
      </summary>
      <div class="rlist"></div>
    `;

    const list = details.querySelector('.rlist');
    items.forEach(anime => {
      const card = buildUpcomingCard(anime, sectionId);

      card.addEventListener('click', () => {
        const imgNow = card.querySelector('.rimg')?.src || BLANK;
        openAnimeModal(anime, imgNow);
      });

      list.appendChild(card);
    });

    details.addEventListener('toggle', () => loadUpcomingSectionImages(details));
    container.appendChild(details);
  });

  if (!container.children.length) {
    container.innerHTML = '<div class="ranking-empty">Todavía no hay estrenos seleccionados.</div>';
  }
}

async function loadRanking() {
  initRankingAccordions();
  if (rankingLoaded) {
    await fetchCommunityRatings({ silent: true });
    if (!upcomingPayload) await loadUpcomingRanking();
    return;
  }
  rankingLoaded = true;

  const communityContainer = document.getElementById('rankingCommunityList');
  const upcomingContainer = document.getElementById('rankingUpcomingList');
  if (!communityContainer || !upcomingContainer) return;
  renderCommunityRanking();
  upcomingContainer.innerHTML = '<div class="ranking-empty">Cargando más esperados...</div>';
  hydrateCachedCommunityRatings();

  await Promise.all([
    fetchCommunityRatings({ silent: true }),
    loadUpcomingRanking()
  ]);
}

function renderAnimeModalContent(anime, { loadingDetails = false } = {}) {
  const img = document.getElementById('animeModalImg');
  const title = document.getElementById('animeModalTitle');
  const meta = document.getElementById('animeModalMeta');
  const desc = document.getElementById('animeModalDesc');
  const tags = document.getElementById('animeModalTags');
  const recommendationNote = document.getElementById('animeRecommendationNote');
  if (!anime || !img || !title || !meta || !desc || !tags) return;

  const displayTitle = getAnimeDisplayTitle(anime);
  title.textContent = displayTitle;
  img.alt = displayTitle;

  const metaParts = [];
  if (anime.year) metaParts.push(String(anime.year));
  metaParts.push(getAnimeEpisodeLabel(anime, { long: true }));
  if (anime.length) {
    const durationMap = { corto: 'corta', medio: 'media', largo: 'larga' };
    metaParts.push(`Duración ${durationMap[anime.length] || anime.length}`);
  }
  if (anime.demographic) metaParts.push(anime.demographic);
  if (anime.tone) metaParts.push(`Tono ${anime.tone}`);
  if (typeof anime.ongoing === 'boolean') {
    metaParts.push(isUpcomingAnime(anime) ? 'Próximo estreno' : (anime.ongoing ? 'En emisión' : 'Finalizado'));
    const premiereDate = formatUpcomingDate(anime);
    if (premiereDate !== 'Fecha desconocida') metaParts.push(`Fecha de estreno: ${premiereDate}`);
  }
  const databaseScore = Number(anime.score);
  const databaseVotes = Number(anime.scored_by);
  if (anime.score != null && Number.isFinite(databaseScore) && databaseScore > 0) {
    metaParts.push(`Nota ${databaseScore.toFixed(2)}`);
  }
  if (anime.scored_by != null && Number.isFinite(databaseVotes) && databaseVotes > 0) {
    metaParts.push(`${databaseVotes.toLocaleString('es-ES')} votos`);
  }

  meta.textContent = metaParts.join(' · ');
  const allTags = [...(anime.genres || []), ...(anime.themes || [])];
  tags.innerHTML = allTags.map(t => `<span class="tag">${t}</span>`).join('');
  if (recommendationNote) {
    recommendationNote.textContent = currentRecommendationReason || '';
    recommendationNote.classList.toggle('hidden', !currentRecommendationReason);
  }

  if (loadingDetails) {
    desc.textContent = getAnimeDescription(anime, { loading: true });
    desc.classList.add('loading');
  } else {
    desc.textContent = getAnimeDescription(anime);
    desc.classList.remove('loading');
  }
}

function clearAnimeRelationsUI() {
  const section = document.getElementById('animeRelationsSection');
  const list = document.getElementById('animeRelationsList');
  const timeline = document.getElementById('animeTimelineAction');
  section?.classList.add('hidden');
  list?.replaceChildren();
  list?.removeAttribute('data-count');
  list?.style.removeProperty('--relation-count');
  timeline?.replaceChildren();
  timeline?.classList.add('hidden');
}

const ANIME_TIMELINE_MAIN_LINE_INCLUDE_IDS = new Set();
const ANIME_TIMELINE_MAIN_LINE_EXCLUDE_IDS = new Set();
const ANIME_TIMELINE_IGNORED_FORMATS = new Set(['MANGA', 'NOVEL', 'ONE_SHOT', 'MUSIC', 'PV', 'CM']);

function normalizeAnimeTimelineFormat(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function isAnimeTimelineIgnoredNode(node = {}) {
  if (ANIME_TIMELINE_IGNORED_FORMATS.has(normalizeAnimeTimelineFormat(node.format || node.type))) return true;
  const catalogAnime = getAnimeById(node.mal_id);
  return !!catalogAnime && !isAnimeVisible(catalogAnime);
}

function getAnimeTimelineBranchKind(node = {}) {
  return normalizeAnimeTimelineFormat(node.format || node.type) === 'MOVIE' ? 'movie' : 'extra';
}

function isAnimeTimelineMainSeriesFormat(value, episodes = 0, title = '') {
  const format = normalizeAnimeTimelineFormat(value);
  if (['TV', 'TV_SHORT', 'ANIME'].includes(format)) return true;
  if (format !== 'ONA') return false;
  const episodeCount = Number(episodes) || 0;
  return episodeCount >= 4 || /\b(season|temporada|part|cour)\b/i.test(String(title || ''));
}

function isAnimeTimelineMainSeriesNode(node = {}) {
  const animeId = Number(node.mal_id);
  if (ANIME_TIMELINE_MAIN_LINE_INCLUDE_IDS.has(animeId)) return true;
  if (ANIME_TIMELINE_MAIN_LINE_EXCLUDE_IDS.has(animeId) || node.role === 'secondary') return false;
  return isAnimeTimelineMainSeriesFormat(
    node.format || node.type,
    node.episodes,
    node.title_english || node.title
  );
}

function isAnimeMainSeriesEntry(anime = {}) {
  const animeId = Number(anime.mal_id);
  if (ANIME_TIMELINE_MAIN_LINE_INCLUDE_IDS.has(animeId)) return true;
  if (ANIME_TIMELINE_MAIN_LINE_EXCLUDE_IDS.has(animeId)) return false;
  return isAnimeTimelineMainSeriesFormat(
    anime.type || anime.format,
    anime.episodes,
    anime.title_english || anime.title
  );
}

function getAnimeTimelineReleaseKey(anime = {}) {
  const raw = String(anime.release_date || anime.aired_from || anime.year || '').trim();
  const match = raw.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!match) return '9999-99-99';
  return `${match[1]}-${match[2] || '99'}-${match[3] || '99'}`;
}

function compareAnimeTimelineNodes(a = {}, b = {}, levelById = null) {
  const releaseOrder = getAnimeTimelineReleaseKey(a).localeCompare(getAnimeTimelineReleaseKey(b));
  if (releaseOrder) return releaseOrder;
  if (levelById) {
    const levelA = Number(levelById[String(a.mal_id)] ?? 0);
    const levelB = Number(levelById[String(b.mal_id)] ?? 0);
    if (levelA !== levelB) return levelA - levelB;
  }
  return Number(a.mal_id) - Number(b.mal_id);
}

function getAnimeTimelineMainSeriesNodes(timeline, nodesMap) {
  const levelById = timeline?.levels || {};
  return (timeline?.nodes || [])
    .map(nodeId => nodesMap.get(Number(nodeId)))
    .filter(node => node && !isAnimeTimelineIgnoredNode(node) && isAnimeTimelineMainSeriesNode(node))
    .sort((a, b) => compareAnimeTimelineNodes(a, b, levelById));
}

function getAnimeRelationMeta(anime = {}) {
  const parts = [];
  if (anime.year) parts.push(String(anime.year));
  if (anime.type || anime.format) parts.push(formatAnimeTimelineType(anime.type || anime.format));
  const episodes = Number(anime.episodes);
  if (Number.isFinite(episodes) && episodes > 0) parts.push(`${episodes} ep`);
  return parts.join(' · ');
}

function getAnimeRouteFormatKind(anime = {}) {
  const format = String(anime.type || anime.format || '').trim().toUpperCase();
  if (format === 'MOVIE') return 'movie';
  if (format === 'TV') return 'series';
  return 'extra';
}

function getAnimeRouteFormatLabel(anime = {}) {
  return formatAnimeTimelineType(anime.type || anime.format || 'Anime');
}

function getAnimeRelationCandidates(ids = []) {
  return [...new Set(Array.isArray(ids) ? ids.map(Number) : [])]
    .map(targetId => getAnimeById(targetId))
    .filter(anime => anime && isAnimeVisible(anime))
    .sort((a, b) => compareAnimeTimelineNodes(a, b));
}

function getSharedAnimeRouteAnchor(kind, candidates = []) {
  if (candidates.length < 2) return 0;
  const relationKey = kind === 'sequel' ? 'sequels' : 'prequels';
  const sets = candidates.map(candidate => new Set(
    animeRelationsMap.get(Number(candidate.mal_id))?.[relationKey] || []
  ));
  if (sets.some(set => !set.size)) return 0;
  return [...sets[0]].find(targetId => sets.slice(1).every(set => set.has(targetId))) || 0;
}

function buildAnimeRelationCard(anime, kind) {
  const isPrequel = kind === 'prequel';
  const displayTitle = getAnimeDisplayTitle(anime);
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `anime-relation-card relation-${kind} relation-format-${getAnimeRouteFormatKind(anime)}`;
  card.dataset.animeRelationId = String(anime.mal_id);
  card.setAttribute('aria-label', `Abrir entrega ${isPrequel ? 'anterior' : 'siguiente'}: ${displayTitle}`);

  const image = document.createElement('img');
  image.className = 'anime-relation-img';
  image.src = BLANK;
  image.alt = '';

  const copy = document.createElement('span');
  copy.className = 'anime-relation-copy';

  const label = document.createElement('span');
  label.className = 'anime-relation-label';
  label.textContent = isPrequel ? '← Antes' : 'Después →';

  const title = document.createElement('span');
  title.className = 'anime-relation-title';
  title.textContent = displayTitle;

  const meta = document.createElement('span');
  meta.className = 'anime-relation-meta';
  meta.textContent = getAnimeRelationMeta(anime);

  const open = document.createElement('span');
  open.className = 'anime-relation-open';
  open.setAttribute('aria-hidden', 'true');
  open.textContent = '›';

  copy.append(label, title);
  if (meta.textContent) copy.appendChild(meta);
  card.append(image, copy, open);
  card.addEventListener('click', () => openAnimeModal(anime, anime.image || BLANK));
  return card;
}

function buildAnimeRelationRouteCard(sourceAnime, kind, candidates) {
  const isPrequel = kind === 'prequel';
  const count = candidates.length;
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `anime-relation-card relation-${kind} relation-route`;
  card.setAttribute('aria-label', `${isPrequel ? 'Antes' : 'Después'}: elegir entre ${count} rutas`);

  const preview = document.createElement('span');
  preview.className = 'anime-relation-route-preview';
  candidates.slice(0, 2).forEach(candidate => {
    const image = document.createElement('img');
    image.src = BLANK;
    image.alt = '';
    image.dataset.animeRoutePreviewId = String(candidate.mal_id);
    preview.appendChild(image);
  });

  const copy = document.createElement('span');
  copy.className = 'anime-relation-copy';
  const label = document.createElement('span');
  label.className = 'anime-relation-label';
  label.textContent = isPrequel ? '← Antes' : 'Después →';
  const title = document.createElement('span');
  title.className = 'anime-relation-title';
  title.textContent = `${count} rutas disponibles`;
  const meta = document.createElement('span');
  meta.className = 'anime-relation-route-count';
  meta.textContent = 'Elige cómo continuar';
  copy.append(label, title, meta);

  const open = document.createElement('span');
  open.className = 'anime-relation-open';
  open.setAttribute('aria-hidden', 'true');
  open.textContent = '›';
  card.append(preview, copy, open);
  card.addEventListener('click', () => openAnimeRouteChooser(sourceAnime, kind, candidates));
  return card;
}

function buildAnimeRouteOption(anime) {
  const formatKind = getAnimeRouteFormatKind(anime);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `anime-route-option route-format-${formatKind}`;
  button.setAttribute('aria-label', `Elegir ${getAnimeDisplayTitle(anime)}, ${getAnimeRouteFormatLabel(anime)}`);

  const image = document.createElement('img');
  image.className = 'anime-route-option-img';
  image.src = BLANK;
  image.alt = '';

  const copy = document.createElement('span');
  copy.className = 'anime-route-option-copy';
  const format = document.createElement('span');
  format.className = 'anime-route-format';
  format.textContent = getAnimeRouteFormatLabel(anime);
  const title = document.createElement('span');
  title.className = 'anime-route-option-title';
  title.textContent = getAnimeDisplayTitle(anime);
  const meta = document.createElement('span');
  meta.className = 'anime-route-option-meta';
  const metaParts = [];
  if (anime.year) metaParts.push(String(anime.year));
  const episodes = Number(anime.episodes);
  if (Number.isFinite(episodes) && episodes > 0) metaParts.push(`${episodes} ep`);
  meta.textContent = metaParts.join(' · ') || 'Fecha sin confirmar';
  copy.append(format, title, meta);

  const open = document.createElement('span');
  open.className = 'anime-route-option-open';
  open.setAttribute('aria-hidden', 'true');
  open.textContent = '›';
  button.append(image, copy, open);
  button.addEventListener('click', () => {
    closeAnimeRouteChooser();
    openAnimeModal(anime, anime.image || BLANK);
  });
  loadAnimeImageElement(image, anime, 0);
  return button;
}

function openAnimeRouteChooser(sourceAnime, kind, candidates = []) {
  const modal = document.getElementById('animeRouteModal');
  const kicker = document.getElementById('animeRouteKicker');
  const subtitle = document.getElementById('animeRouteSubtitle');
  const options = document.getElementById('animeRouteOptions');
  if (!modal || !options || candidates.length < 2) return;

  const sharedAnchorId = getSharedAnimeRouteAnchor(kind, candidates);
  const equivalent = !!sharedAnchorId;
  activeAnimeRouteChoice = {
    sourceId: Number(sourceAnime?.mal_id) || 0,
    kind,
    candidateIds: candidates.map(candidate => Number(candidate.mal_id)),
    equivalent
  };
  if (kicker) kicker.textContent = kind === 'prequel' ? 'Antes · rutas disponibles' : 'Después · rutas disponibles';
  if (subtitle) {
    subtitle.textContent = equivalent
      ? 'Estas opciones cubren un tramo equivalente de la historia. Elige el formato que prefieras.'
      : (kind === 'prequel'
        ? 'Esta ficha se puede alcanzar desde más de una entrega. Elige la ruta anterior que quieras consultar.'
        : 'La historia ofrece más de una continuación directa. Elige la ruta que quieras seguir.');
  }
  options.replaceChildren(...candidates.map(buildAnimeRouteOption));
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const sheet = modal.querySelector('.anime-route-sheet');
  if (sheet) sheet.scrollTop = 0;
  requestAnimationFrame(() => options.querySelector('button')?.focus({ preventScroll: true }));
}

function closeAnimeRouteChooser() {
  const modal = document.getElementById('animeRouteModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  activeAnimeRouteChoice = null;
  document.body.style.overflow = document.querySelector('.modal-backdrop.open, .timeline-backdrop.open') ? 'hidden' : '';
}

function getAnimeRelationCards(anime, relations) {
  return [
    ['prequel', getAnimeRelationCandidates(relations?.prequels)],
    ['sequel', getAnimeRelationCandidates(relations?.sequels)]
  ].filter(([, candidates]) => candidates.length)
    .map(([kind, candidates]) => candidates.length === 1
      ? { kind, anime: candidates[0] }
      : { kind, candidates });
}

function renderAnimeTimelineAction(anime) {
  const container = document.getElementById('animeTimelineAction');
  if (!container) return false;
  container.replaceChildren();
  container.classList.add('hidden');
  const navigation = animeTimelineNavigationMap.get(Number(anime?.mal_id));
  if (!animeTimelineIndexLoaded || !navigation) return false;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'anime-timeline-tree-btn';
  button.setAttribute('aria-label', `Abrir mapa de la saga de ${getAnimeDisplayTitle(anime)}`);

  const icon = document.createElement('span');
  icon.className = 'anime-timeline-tree-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"></circle><circle cx="18" cy="6" r="3"></circle><circle cx="12" cy="18" r="3"></circle><path d="M6 9v3a6 6 0 0 0 6 6"></path><path d="M18 9v3a6 6 0 0 1-6 6"></path></svg>';

  const copy = document.createElement('span');
  copy.className = 'anime-timeline-tree-copy';
  const title = document.createElement('span');
  title.className = 'anime-timeline-tree-title';
  title.textContent = 'Mapa de la saga';
  const subtitle = document.createElement('span');
  subtitle.className = 'anime-timeline-tree-sub';
  subtitle.textContent = 'Temporadas, fechas, películas, OVAs y rutas relacionadas';
  copy.append(title, subtitle);

  const open = document.createElement('span');
  open.className = 'anime-timeline-tree-open';
  open.setAttribute('aria-hidden', 'true');
  open.textContent = '›';

  button.append(icon, copy, open);
  button.addEventListener('click', () => openAnimeTimeline(anime));
  container.appendChild(button);
  container.classList.remove('hidden');
  return true;
}

function renderAnimeRelations(anime = currentModalAnime) {
  const section = document.getElementById('animeRelationsSection');
  const list = document.getElementById('animeRelationsList');
  if (!section || !list || !anime) {
    return false;
  }

  list.replaceChildren();
  const hasTimeline = renderAnimeTimelineAction(anime);
  if (!animeRelationsLoaded) {
    list.classList.add('hidden');
    section.classList.toggle('hidden', !hasTimeline);
    return hasTimeline;
  }
  const relations = animeRelationsMap.get(Number(anime.mal_id));
  if (!relations && !hasTimeline) {
    section.classList.add('hidden');
    return false;
  }

  const cards = getAnimeRelationCards(anime, relations).map(item => {
    if (item.candidates) {
      return {
        card: buildAnimeRelationRouteCard(anime, item.kind, item.candidates),
        targets: item.candidates
      };
    }
    return {
      card: buildAnimeRelationCard(item.anime, item.kind),
      targets: [item.anime]
    };
  });

  if (!cards.length && !hasTimeline) {
    section.classList.add('hidden');
    return false;
  }

  list.dataset.count = String(cards.length);
  list.style.setProperty('--relation-count', String(Math.max(1, cards.length)));
  cards.forEach(({ card }) => list.appendChild(card));
  list.classList.toggle('hidden', !cards.length);
  section.classList.remove('hidden');
  cards.forEach(({ card, targets }, index) => {
    const images = card.querySelectorAll('.anime-relation-img, [data-anime-route-preview-id]');
    images.forEach((image, imageIndex) => {
      const target = targets[imageIndex];
      if (target) loadAnimeImageElement(image, target, index * 40 + imageIndex * 25);
    });
  });
  return true;
}

async function renderAnimeRelationsForModal(anime) {
  clearAnimeRelationsUI();
  const requestedId = Number(anime?.mal_id);
  if (!requestedId) return;
  renderAnimeRelations(anime);

  const requests = [];
  if (!animeRelationsLoaded) {
    requests.push(loadAnimeRelations().catch(error => {
      console.warn('No se pudo cargar la continuidad del anime:', error);
    }));
  }
  if (!animeTimelineIndexLoaded) {
    requests.push(loadAnimeTimelineIndex().catch(error => {
      console.warn('No se pudo cargar el índice de mapas de sagas:', error);
    }));
  }
  if (requests.length) await Promise.allSettled(requests);
  if (Number(currentModalAnime?.mal_id) === requestedId) renderAnimeRelations(currentModalAnime);

}

function getAnimeTimelineNodeTitle(node = {}) {
  const localAnime = node.local ? getAnimeById(node.mal_id) : null;
  return getAnimeDisplayTitle(localAnime || node);
}

function formatAnimeTimelineDate(value, fallbackYear = null) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!match) return fallbackYear ? String(fallbackYear) : 'Fecha sin confirmar';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!month) return String(year);
  const date = new Date(Date.UTC(year, month - 1, day || 1));
  return new Intl.DateTimeFormat('es-ES', day
    ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
    : { month: 'long', year: 'numeric', timeZone: 'UTC' }
  ).format(date);
}

function formatAnimeTimelineType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  const labels = {
    TV: 'Serie TV',
    MOVIE: 'Película',
    OVA: 'OVA',
    ONA: 'ONA',
    SPECIAL: 'Especial',
    TV_SPECIAL: 'Especial TV',
    MUSIC: 'Vídeo musical',
    PV: 'Promocional'
  };
  return labels[normalized] || String(value || 'Anime').replaceAll('_', ' ');
}

function getAnimeTimelineYearKey(node = {}) {
  const raw = String(node.release_date || node.aired_from || node.year || '').trim();
  return raw.match(/^(\d{4})/)?.[1] || 'unknown';
}

function renderAnimeTimelineLoading(message = 'Preparando el mapa de la saga…', isError = false) {
  const loading = document.getElementById('animeTimelineLoading');
  const canvas = document.getElementById('animeTimelineCanvas');
  const progress = document.getElementById('animeTimelineScrollProgress');
  if (!loading || !canvas) return;
  if (progress) progress.style.width = '0%';
  canvas.classList.add('hidden');
  loading.classList.remove('hidden');
  loading.replaceChildren();
  if (!isError) {
    const ring = document.createElement('span');
    ring.className = 'timeline-loading-ring';
    ring.setAttribute('aria-hidden', 'true');
    loading.appendChild(ring);
  }
  const copy = document.createElement('span');
  copy.textContent = message;
  loading.appendChild(copy);
}

function isAnimeTimelineMobileLayout() {
  return window.matchMedia?.('(max-width: 520px)').matches ?? window.innerWidth <= 520;
}

function updateAnimeTimelineScrollProgress() {
  const viewport = document.getElementById('animeTimelineViewport');
  const progress = document.getElementById('animeTimelineScrollProgress');
  const canvas = document.getElementById('animeTimelineCanvas');
  if (!viewport || !progress) return;
  const horizontalMobile = canvas?.dataset.timelineLayout === 'horizontal-mobile';
  const scrollable = horizontalMobile
    ? Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    : Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const offset = horizontalMobile ? viewport.scrollLeft : viewport.scrollTop;
  const ratio = scrollable > 0 ? Math.min(1, Math.max(0, offset / scrollable)) : 1;
  progress.style.width = `${ratio * 100}%`;
}

async function openAnimeTimeline(anime = currentModalAnime) {
  const modal = document.getElementById('animeTimelineModal');
  const title = document.getElementById('animeTimelineTitle');
  const summary = document.getElementById('animeTimelineSummary');
  const requestedId = Number(anime?.mal_id);
  if (!modal || !requestedId) return;

  activeAnimeTimelineCurrentId = requestedId;
  activeAnimeTimeline = null;
  activeAnimeTimelineNodes = new Map();
  activeAnimeTimelineDisplayEdges = [];
  activeAnimeTimelineNarrativeIds = new Set();
  animeTimelineMode = 'continuity';
  if (title) title.textContent = `Mapa de ${getAnimeDisplayTitle(anime)}`;
  if (summary) summary.textContent = 'Orden visual, fechas, películas y rutas relacionadas.';
  const mainModeButton = document.getElementById('animeTimelineModeMain');
  const allModeButton = document.getElementById('animeTimelineModeAll');
  mainModeButton?.classList.toggle('active', animeTimelineMode === 'continuity');
  allModeButton?.classList.toggle('active', animeTimelineMode === 'all');
  mainModeButton?.setAttribute('aria-pressed', String(animeTimelineMode === 'continuity'));
  allModeButton?.setAttribute('aria-pressed', String(animeTimelineMode === 'all'));
  const viewport = document.getElementById('animeTimelineViewport');
  viewport?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
  updateAnimeTimelineScrollProgress();
  renderAnimeTimelineLoading();
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  try {
    if (!animeTimelineIndexLoaded) await loadAnimeTimelineIndex();
    if (!animeRelationsLoaded) {
      await loadAnimeRelations().catch(error => {
        console.warn('No se pudo cargar el orden narrativo; se usará el mapa disponible:', error);
      });
    }
    const navigation = animeTimelineNavigationMap.get(requestedId);
    if (!navigation) throw new Error('Esta ficha aún no dispone de un mapa de saga.');
    const payload = await loadAnimeTimelineBlock(navigation.file);
    if (activeAnimeTimelineCurrentId !== requestedId || !modal.classList.contains('open')) return;
    const timeline = payload.timelines?.[String(navigation.timelineId)];
    if (!timeline) throw new Error('No se encontró el mapa temporal de esta saga.');

    const nodes = new Map();
    (timeline.nodes || []).forEach(nodeId => {
      const node = payload.nodes?.[String(nodeId)];
      if (node) nodes.set(Number(nodeId), node);
    });
    activeAnimeTimeline = timeline;
    activeAnimeTimelineNodes = nodes;

    const visibleNodes = [...nodes.values()].filter(node => !isAnimeTimelineIgnoredNode(node));
    const continuityCount = getAnimeTimelineMainSeriesNodes(timeline, nodes).length;
    const movieCount = visibleNodes.filter(node => !isAnimeTimelineMainSeriesNode(node) && getAnimeTimelineBranchKind(node) === 'movie').length;
    const extraCount = Math.max(0, visibleNodes.length - continuityCount - movieCount);
    const externalCount = visibleNodes.filter(node => !node.local).length;
    const summaryParts = [`${visibleNodes.length} entregas`, `${continuityCount} series o temporadas`];
    if (movieCount) summaryParts.push(`${movieCount} películas`);
    if (extraCount) summaryParts.push(`${extraCount} OVA o especiales`);
    if (externalCount) summaryParts.push(`${externalCount} aún fuera del catálogo`);
    if (summary) summary.textContent = summaryParts.join(' · ');
    renderAnimeTimelineGraph({ centerCurrent: true });
  } catch (error) {
    console.warn('No se pudo abrir el mapa de la saga:', error);
    if (activeAnimeTimelineCurrentId === requestedId) {
      renderAnimeTimelineLoading(error?.message || 'No se pudo cargar el mapa de la saga.', true);
    }
  }
}

function closeAnimeTimeline() {
  const modal = document.getElementById('animeTimelineModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (animeTimelineDrawFrame) cancelAnimationFrame(animeTimelineDrawFrame);
  if (animeTimelineResizeTimer) window.clearTimeout(animeTimelineResizeTimer);
  animeTimelineDrawFrame = 0;
  animeTimelineResizeTimer = 0;
  activeAnimeTimeline = null;
  activeAnimeTimelineNodes = new Map();
  activeAnimeTimelineCurrentId = 0;
  activeAnimeTimelineDisplayEdges = [];
  activeAnimeTimelineNarrativeIds = new Set();
  document.body.style.overflow = document.querySelector('.modal-backdrop.open') ? 'hidden' : '';
}

function setAnimeTimelineMode(mode) {
  if (!['continuity', 'all'].includes(mode) || !activeAnimeTimeline) return;
  animeTimelineMode = mode;
  const mainModeButton = document.getElementById('animeTimelineModeMain');
  const allModeButton = document.getElementById('animeTimelineModeAll');
  mainModeButton?.classList.toggle('active', mode === 'continuity');
  allModeButton?.classList.toggle('active', mode === 'all');
  mainModeButton?.setAttribute('aria-pressed', String(mode === 'continuity'));
  allModeButton?.setAttribute('aria-pressed', String(mode === 'all'));
  renderAnimeTimelineGraph({ centerCurrent: true });
}

function buildAnimeTimelineNode(node, index) {
  const nodeId = Number(node?.mal_id);
  const localAnime = node.local ? getAnimeById(nodeId) : null;
  const isLocal = !!localAnime;
  const isCurrent = nodeId === activeAnimeTimelineCurrentId;
  const isSecondary = !isAnimeTimelineMainSeriesNode(node);
  const branchKind = isSecondary ? getAnimeTimelineBranchKind(node) : '';
  const card = document.createElement(isLocal ? 'button' : 'div');
  if (isLocal) card.type = 'button';
  card.className = `timeline-node${isSecondary ? ` secondary ${branchKind}-format` : ''}${isCurrent ? ' current' : ''}${isLocal ? '' : ' external'}`;
  card.dataset.timelineNodeId = String(nodeId);
  if (isCurrent) card.setAttribute('aria-current', 'true');

  const displayTitle = getAnimeTimelineNodeTitle(node);
  if (isLocal) {
    card.setAttribute('aria-label', isCurrent ? `${displayTitle}, ficha actual` : `Abrir ficha de ${displayTitle}`);
    card.addEventListener('click', () => {
      closeAnimeTimeline();
      openAnimeModal(localAnime, localAnime.image || BLANK);
    });
  }

  const image = document.createElement('img');
  image.className = 'timeline-node-img';
  image.src = BLANK;
  image.alt = '';

  const copy = document.createElement('span');
  copy.className = 'timeline-node-copy';
  const title = document.createElement('span');
  title.className = 'timeline-node-title';
  title.textContent = displayTitle;
  const date = document.createElement('span');
  date.className = 'timeline-node-date';
  date.textContent = formatAnimeTimelineDate(node.release_date, node.year);
  const meta = document.createElement('span');
  meta.className = 'timeline-node-meta';
  const metaParts = [formatAnimeTimelineType(node.format)];
  const episodes = Number(node.episodes);
  if (Number.isFinite(episodes) && episodes > 0) metaParts.push(`${episodes} ep`);
  meta.textContent = metaParts.join(' · ');
  const badge = document.createElement('span');
  badge.className = 'timeline-node-badge';
  const isNarrativeRoute = animeTimelineMode === 'continuity' && activeAnimeTimelineNarrativeIds.has(nodeId);
  badge.textContent = isCurrent
    ? 'Estás aquí'
    : (!isLocal ? 'Fuera del catálogo' : (isSecondary ? (isNarrativeRoute ? 'Ruta narrativa' : 'Rama relacionada') : ''));

  copy.append(title, date, meta);
  if (badge.textContent) copy.appendChild(badge);
  card.append(image, copy);
  loadAnimeImageElement(image, localAnime || node, Math.min(index * 18, 420));
  return card;
}

function assignAnimeTimelineBranchLanes(branches, cardWidth) {
  const laneEnds = { top: [], bottom: [] };
  const clearance = cardWidth + 14;
  branches.sort((a, b) => a.left - b.left || compareAnimeTimelineNodes(a.node, b.node));
  branches.forEach(branch => {
    const side = branch.kind === 'movie' ? 'top' : 'bottom';
    const availableLane = laneEnds[side].findIndex(lastLeft => branch.left - lastLeft >= clearance);
    const lane = availableLane >= 0 ? availableLane : laneEnds[side].length;
    branch.side = side;
    branch.lane = lane;
    laneEnds[side][lane] = branch.left;
  });
  return {
    top: laneEnds.top.length,
    bottom: laneEnds.bottom.length
  };
}

function getAnimeTimelineNarrativeEdges(timeline, nodesMap) {
  const visibleIds = new Set((timeline?.nodes || [])
    .map(Number)
    .filter(nodeId => nodesMap.has(nodeId) && !isAnimeTimelineIgnoredNode(nodesMap.get(nodeId))));
  const edgeKeys = new Set();
  const edges = [];
  const appendEdge = (from, to) => {
    const fromId = Number(from);
    const toId = Number(to);
    if (!visibleIds.has(fromId) || !visibleIds.has(toId) || fromId === toId) return;
    const key = `${fromId}:${toId}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from: fromId, to: toId, kind: 'continuity' });
  };

  if (animeRelationsLoaded) {
    visibleIds.forEach(fromId => {
      (animeRelationsMap.get(fromId)?.sequels || []).forEach(toId => appendEdge(fromId, toId));
    });
  }
  if (!edges.length) {
    (timeline?.edges || [])
      .filter(edge => edge?.kind === 'continuity')
      .forEach(edge => appendEdge(edge.from, edge.to));
  }
  return edges;
}

function buildAnimeTimelineNarrativeLevels(nodes, edges) {
  const ids = new Set(nodes.map(node => Number(node.mal_id)));
  const byId = new Map(nodes.map(node => [Number(node.mal_id), node]));
  const incoming = new Map([...ids].map(nodeId => [nodeId, new Set()]));
  const outgoing = new Map([...ids].map(nodeId => [nodeId, new Set()]));
  edges.forEach(edge => {
    const fromId = Number(edge.from);
    const toId = Number(edge.to);
    if (!ids.has(fromId) || !ids.has(toId)) return;
    outgoing.get(fromId).add(toId);
    incoming.get(toId).add(fromId);
  });

  const indegree = new Map([...ids].map(nodeId => [nodeId, incoming.get(nodeId).size]));
  const levels = new Map([...ids].map(nodeId => [nodeId, 0]));
  const ready = [...ids]
    .filter(nodeId => indegree.get(nodeId) === 0)
    .sort((a, b) => compareAnimeTimelineNodes(byId.get(a), byId.get(b)));
  const processed = new Set();

  while (ready.length) {
    const nodeId = ready.shift();
    if (processed.has(nodeId)) continue;
    processed.add(nodeId);
    [...outgoing.get(nodeId)]
      .sort((a, b) => compareAnimeTimelineNodes(byId.get(a), byId.get(b)))
      .forEach(targetId => {
        levels.set(targetId, Math.max(levels.get(targetId) || 0, (levels.get(nodeId) || 0) + 1));
        indegree.set(targetId, indegree.get(targetId) - 1);
        if (indegree.get(targetId) === 0) {
          ready.push(targetId);
          ready.sort((a, b) => compareAnimeTimelineNodes(byId.get(a), byId.get(b)));
        }
      });
  }

  const cyclicIds = [...ids]
    .filter(nodeId => !processed.has(nodeId))
    .sort((a, b) => compareAnimeTimelineNodes(byId.get(a), byId.get(b)));
  let fallbackLevel = Math.max(0, ...levels.values());
  cyclicIds.forEach(nodeId => {
    const knownParentLevels = [...incoming.get(nodeId)]
      .filter(parentId => processed.has(parentId))
      .map(parentId => levels.get(parentId) || 0);
    fallbackLevel = knownParentLevels.length ? Math.max(...knownParentLevels) + 1 : fallbackLevel + 1;
    levels.set(nodeId, fallbackLevel);
    processed.add(nodeId);
  });

  const groups = new Map();
  nodes.forEach(node => {
    const level = levels.get(Number(node.mal_id)) || 0;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(node);
  });
  groups.forEach(group => group.sort((a, b) => compareAnimeTimelineNodes(a, b)));
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function renderAnimeWatchOrderGraph({ centerCurrent = false } = {}) {
  const viewport = document.getElementById('animeTimelineViewport');
  const loading = document.getElementById('animeTimelineLoading');
  const canvas = document.getElementById('animeTimelineCanvas');
  const grid = document.getElementById('animeTimelineGrid');
  const svg = document.getElementById('animeTimelineConnections');
  if (!viewport || !loading || !canvas || !grid || !svg || !activeAnimeTimeline) return;

  const allNodes = (activeAnimeTimeline.nodes || [])
    .map(nodeId => activeAnimeTimelineNodes.get(Number(nodeId)))
    .filter(node => node && !isAnimeTimelineIgnoredNode(node));
  const allEdges = getAnimeTimelineNarrativeEdges(activeAnimeTimeline, activeAnimeTimelineNodes);
  const narrativeIds = new Set();
  allEdges.forEach(edge => {
    narrativeIds.add(Number(edge.from));
    narrativeIds.add(Number(edge.to));
  });
  if (activeAnimeTimelineNodes.has(activeAnimeTimelineCurrentId)) narrativeIds.add(activeAnimeTimelineCurrentId);
  const visibleNodes = allNodes.filter(node => narrativeIds.has(Number(node.mal_id)));
  if (!visibleNodes.length) {
    renderAnimeTimelineLoading('No hay un orden narrativo confirmado para esta saga.', true);
    return;
  }

  const visibleIds = new Set(visibleNodes.map(node => Number(node.mal_id)));
  const visibleEdges = allEdges.filter(edge => visibleIds.has(Number(edge.from)) && visibleIds.has(Number(edge.to)));
  const levelGroups = buildAnimeTimelineNarrativeLevels(visibleNodes, visibleEdges);
  activeAnimeTimelineNarrativeIds = visibleIds;
  activeAnimeTimelineDisplayEdges = visibleEdges;
  loading.classList.add('hidden');
  canvas.classList.remove('hidden');
  grid.replaceChildren();
  svg.replaceChildren();

  const mobileLayout = isAnimeTimelineMobileLayout();
  canvas.dataset.timelineLayout = mobileLayout ? 'horizontal-mobile' : 'narrative-desktop';
  const cardWidth = mobileLayout ? 176 : 196;
  const cardHeight = 82;
  const columnGap = mobileLayout ? 38 : 54;
  const rowGap = mobileLayout ? 14 : 18;
  const padX = mobileLayout ? 28 : 42;
  const padY = mobileLayout ? 38 : 46;
  const columnStep = cardWidth + columnGap;
  const maxRows = Math.max(1, ...levelGroups.map(([, group]) => group.length));
  const innerHeight = maxRows * cardHeight + Math.max(0, maxRows - 1) * rowGap;
  const contentWidth = padX * 2 + levelGroups.length * cardWidth + Math.max(0, levelGroups.length - 1) * columnGap;
  const graphHeight = padY * 2 + innerHeight;
  const canvasWidth = Math.max(viewport.clientWidth, contentWidth);
  const canvasHeight = Math.max(viewport.clientHeight, graphHeight);
  const horizontalOffset = Math.max(0, (canvasWidth - contentWidth) / 2);
  const verticalOffset = Math.max(0, (canvasHeight - graphHeight) / 2);
  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
  grid.style.width = `${canvasWidth}px`;
  grid.style.height = `${canvasHeight}px`;

  let renderedIndex = 0;
  levelGroups.forEach(([, group], columnIndex) => {
    const left = horizontalOffset + padX + columnIndex * columnStep;
    const groupHeight = group.length * cardHeight + Math.max(0, group.length - 1) * rowGap;
    const groupTop = verticalOffset + padY + (innerHeight - groupHeight) / 2;
    const marker = document.createElement('span');
    marker.className = 'timeline-step-marker';
    marker.textContent = `Paso ${columnIndex + 1}`;
    marker.style.left = `${left + cardWidth / 2}px`;
    marker.style.top = `${Math.max(8, groupTop - 25)}px`;
    grid.appendChild(marker);

    group.forEach((node, rowIndex) => {
      const card = buildAnimeTimelineNode(node, renderedIndex++);
      card.style.position = 'absolute';
      card.style.left = `${left}px`;
      card.style.top = `${groupTop + rowIndex * (cardHeight + rowGap)}px`;
      card.style.width = `${cardWidth}px`;
      card.dataset.timelinePrimary = String(getAnimeRouteFormatKind(node) === 'series');
      grid.appendChild(card);
    });
  });

  if (animeTimelineDrawFrame) cancelAnimationFrame(animeTimelineDrawFrame);
  animeTimelineDrawFrame = requestAnimationFrame(() => {
    drawAnimeTimelineConnections();
    if (centerCurrent) centerAnimeTimelineCurrent();
    else updateAnimeTimelineScrollProgress();
  });
}

function renderAnimeTimelineGraph(options = {}) {
  if (animeTimelineMode === 'continuity') {
    renderAnimeWatchOrderGraph(options);
    return;
  }
  renderAnimeTimelineReleaseGraph(options);
}

function renderAnimeTimelineReleaseGraph({ centerCurrent = false } = {}) {
  const viewport = document.getElementById('animeTimelineViewport');
  const loading = document.getElementById('animeTimelineLoading');
  const canvas = document.getElementById('animeTimelineCanvas');
  const grid = document.getElementById('animeTimelineGrid');
  const svg = document.getElementById('animeTimelineConnections');
  if (!viewport || !loading || !canvas || !grid || !svg || !activeAnimeTimeline) return;

  const allNodes = (activeAnimeTimeline.nodes || [])
    .map(nodeId => activeAnimeTimelineNodes.get(Number(nodeId)))
    .filter(node => node && !isAnimeTimelineIgnoredNode(node));
  const mainNodes = getAnimeTimelineMainSeriesNodes(activeAnimeTimeline, activeAnimeTimelineNodes);
  const mainIds = new Set(mainNodes.map(node => Number(node.mal_id)));
  const currentNode = activeAnimeTimelineNodes.get(activeAnimeTimelineCurrentId);
  const visibleBranches = animeTimelineMode === 'all'
    ? allNodes.filter(node => !mainIds.has(Number(node.mal_id)))
    : (currentNode && !mainIds.has(Number(currentNode.mal_id)) ? [currentNode] : []);
  const spineNodes = mainNodes.length ? mainNodes : [currentNode || visibleBranches[0]].filter(Boolean);
  const visibleNodes = [...spineNodes, ...visibleBranches.filter(node => !spineNodes.includes(node))];
  if (!visibleNodes.length) {
    renderAnimeTimelineLoading('No hay entregas visibles en esta ruta.', true);
    return;
  }

  loading.classList.add('hidden');
  canvas.classList.remove('hidden');
  grid.replaceChildren();
  svg.replaceChildren();
  activeAnimeTimelineDisplayEdges = [];

  const mobileLayout = isAnimeTimelineMobileLayout();
  canvas.dataset.timelineLayout = mobileLayout ? 'horizontal-mobile' : 'desktop';
  const cardWidth = mobileLayout ? 176 : 196;
  const mainHeight = 82;
  const branchHeight = 76;
  const columnGap = mobileLayout ? 26 : 34;
  const rowStep = mobileLayout ? 94 : 100;
  const padX = mobileLayout ? 28 : 38;
  const padY = mobileLayout ? 26 : 34;
  const branchGap = mobileLayout ? 38 : 42;
  const columnStep = cardWidth + columnGap;

  const yearKeys = [...new Set(visibleNodes.map(getAnimeTimelineYearKey))]
    .sort((a, b) => {
      if (a === 'unknown') return 1;
      if (b === 'unknown') return -1;
      return Number(a) - Number(b);
    });
  const mainNodesByYear = new Map();
  spineNodes.forEach(node => {
    const yearKey = getAnimeTimelineYearKey(node);
    if (!mainNodesByYear.has(yearKey)) mainNodesByYear.set(yearKey, []);
    mainNodesByYear.get(yearKey).push(node);
  });
  mainNodesByYear.forEach(nodes => nodes.sort((a, b) => compareAnimeTimelineNodes(a, b, activeAnimeTimeline.levels || {})));

  const yearLayouts = new Map();
  const mainSlotById = new Map();
  let slotCursor = 0;
  yearKeys.forEach(yearKey => {
    const yearlyMainNodes = mainNodesByYear.get(yearKey) || [];
    const slotCount = Math.max(1, yearlyMainNodes.length);
    const startSlot = slotCursor;
    yearlyMainNodes.forEach((node, index) => {
      mainSlotById.set(Number(node.mal_id), startSlot + index);
    });
    yearLayouts.set(yearKey, {
      yearKey,
      startSlot,
      centerSlot: startSlot + (slotCount - 1) / 2,
      slotCount
    });
    slotCursor += slotCount;
  });

  const totalSlots = Math.max(1, slotCursor);
  const contentWidth = padX * 2 + totalSlots * cardWidth + Math.max(0, totalSlots - 1) * columnGap;
  const canvasWidth = Math.max(viewport.clientWidth, contentWidth);
  const horizontalOffset = Math.max(0, (canvasWidth - contentWidth) / 2);
  const getSlotLeft = slot => horizontalOffset + padX + slot * columnStep;
  const mainLeftById = new Map();
  spineNodes.forEach(node => {
    const slot = mainSlotById.get(Number(node.mal_id)) ?? yearLayouts.get(getAnimeTimelineYearKey(node))?.centerSlot ?? 0;
    mainLeftById.set(Number(node.mal_id), getSlotLeft(slot));
  });

  const branchLayouts = visibleBranches
    .filter(node => !spineNodes.includes(node))
    .map(node => {
      const yearLayout = yearLayouts.get(getAnimeTimelineYearKey(node)) || yearLayouts.get('unknown');
      return {
        node,
        kind: getAnimeTimelineBranchKind(node),
        left: getSlotLeft(yearLayout?.centerSlot ?? totalSlots - 1)
      };
    });
  const laneCount = assignAnimeTimelineBranchLanes(branchLayouts, cardWidth);
  const topHeight = laneCount.top
    ? branchGap + branchHeight + (laneCount.top - 1) * rowStep
    : 0;
  const bottomHeight = laneCount.bottom
    ? branchGap + branchHeight + (laneCount.bottom - 1) * rowStep
    : 0;
  const graphHeight = padY * 2 + topHeight + mainHeight + bottomHeight;
  const canvasHeight = Math.max(viewport.clientHeight, graphHeight);
  const verticalOffset = Math.max(0, (canvasHeight - graphHeight) / 2);
  const mainTop = verticalOffset + padY + topHeight;
  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
  grid.style.width = `${canvasWidth}px`;
  grid.style.height = `${canvasHeight}px`;

  const axisY = mainTop + mainHeight / 2;
  const yearTicks = [...yearLayouts.values()].map(layout => ({
    x: getSlotLeft(layout.centerSlot) + cardWidth / 2,
    label: layout.yearKey === 'unknown' ? 'Sin fecha' : layout.yearKey
  }));
  activeAnimeTimelineDisplayEdges.push({
    kind: 'axis',
    x1: yearTicks[0]?.x ?? padX,
    x2: yearTicks[yearTicks.length - 1]?.x ?? canvasWidth - padX,
    y: axisY,
    ticks: yearTicks.map(tick => tick.x)
  });

  yearTicks.forEach(tick => {
    const marker = document.createElement('span');
    marker.className = 'timeline-year-marker';
    marker.textContent = tick.label;
    marker.style.left = `${tick.x}px`;
    marker.style.top = `${mainTop + mainHeight + 8}px`;
    grid.appendChild(marker);
  });

  let renderedIndex = 0;
  const appendNode = (node, left, top) => {
    const card = buildAnimeTimelineNode(node, renderedIndex++);
    card.style.position = 'absolute';
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.width = `${cardWidth}px`;
    card.dataset.timelinePrimary = String(mainIds.has(Number(node.mal_id)));
    grid.appendChild(card);
  };

  spineNodes.forEach(node => {
    appendNode(node, mainLeftById.get(Number(node.mal_id)), mainTop);
  });
  for (let index = 0; index < mainNodes.length - 1; index += 1) {
    activeAnimeTimelineDisplayEdges.push({
      from: Number(mainNodes[index].mal_id),
      to: Number(mainNodes[index + 1].mal_id),
      kind: 'continuity'
    });
  }

  branchLayouts.forEach(branch => {
    const top = branch.side === 'top'
      ? mainTop - branchGap - branchHeight - branch.lane * rowStep
      : mainTop + mainHeight + branchGap + branch.lane * rowStep;
    appendNode(branch.node, branch.left, top);
    activeAnimeTimelineDisplayEdges.push({
      to: Number(branch.node.mal_id),
      kind: 'branch',
      branchType: branch.kind,
      side: branch.side,
      anchorX: branch.left + cardWidth / 2,
      anchorY: axisY
    });
  });

  if (animeTimelineDrawFrame) cancelAnimationFrame(animeTimelineDrawFrame);
  animeTimelineDrawFrame = requestAnimationFrame(() => {
    drawAnimeTimelineConnections();
    if (centerCurrent) centerAnimeTimelineCurrent();
    else updateAnimeTimelineScrollProgress();
  });
}

function createAnimeTimelineMarker(svg, id, color) {
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', id);
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('refX', '6');
  marker.setAttribute('refY', '3.5');
  marker.setAttribute('orient', 'auto');
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M0 0 L7 3.5 L0 7 Z');
  arrow.setAttribute('fill', color);
  marker.appendChild(arrow);
  svg.appendChild(marker);
}

function drawAnimeTimelineConnections() {
  const canvas = document.getElementById('animeTimelineCanvas');
  const grid = document.getElementById('animeTimelineGrid');
  const svg = document.getElementById('animeTimelineConnections');
  if (!canvas || !grid || !svg || !activeAnimeTimeline || canvas.classList.contains('hidden')) return;
  svg.replaceChildren();
  svg.setAttribute('width', String(canvas.offsetWidth));
  svg.setAttribute('height', String(canvas.offsetHeight));
  svg.setAttribute('viewBox', `0 0 ${canvas.offsetWidth} ${canvas.offsetHeight}`);

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  createAnimeTimelineMarker(defs, 'timeline-arrow-main', '#35ddff');
  svg.appendChild(defs);

  const visibleIds = new Set(
    [...grid.querySelectorAll('[data-timeline-node-id]')].map(card => Number(card.dataset.timelineNodeId))
  );
  (activeAnimeTimelineDisplayEdges || []).forEach(edge => {
    if (edge.kind === 'axis') {
      const x1 = Number(edge.x1) || 0;
      const x2 = Number(edge.x2) || x1;
      const y = Number(edge.y) || 0;
      const axis = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      axis.setAttribute('class', 'timeline-axis');
      axis.setAttribute('d', `M ${Math.min(x1, x2)} ${y} L ${Math.max(x1, x2)} ${y}`);
      svg.appendChild(axis);
      (edge.ticks || []).forEach(tickX => {
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tick.setAttribute('class', 'timeline-axis-tick');
        tick.setAttribute('x1', String(tickX));
        tick.setAttribute('x2', String(tickX));
        tick.setAttribute('y1', String(y - 5));
        tick.setAttribute('y2', String(y + 5));
        svg.appendChild(tick);
      });
      return;
    }

    const toId = Number(edge.to);
    if (!visibleIds.has(toId)) return;
    const to = grid.querySelector(`[data-timeline-node-id="${toId}"]`);
    if (!to) return;

    const secondary = edge.kind === 'branch';
    if (secondary) {
      const x1 = Number(edge.anchorX) || to.offsetLeft + to.offsetWidth / 2;
      const y1 = Number(edge.anchorY) || 0;
      const x2 = to.offsetLeft + to.offsetWidth / 2;
      const y2 = edge.side === 'top' ? to.offsetTop + to.offsetHeight : to.offsetTop;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', `timeline-edge secondary ${edge.branchType === 'movie' ? 'movie' : 'extra'}`);
      path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
      svg.appendChild(path);
      return;
    }

    const fromId = Number(edge.from);
    if (!visibleIds.has(fromId)) return;
    const from = grid.querySelector(`[data-timeline-node-id="${fromId}"]`);
    if (!from) return;

    const fromCenterX = from.offsetLeft + from.offsetWidth / 2;
    const toCenterX = to.offsetLeft + to.offsetWidth / 2;
    let x1;
    let y1;
    let x2;
    let y2;
    let pathData;
    if (Math.abs(fromCenterX - toCenterX) < 20) {
      const forward = to.offsetTop >= from.offsetTop;
      x1 = fromCenterX;
      y1 = forward ? from.offsetTop + from.offsetHeight : from.offsetTop;
      x2 = toCenterX;
      y2 = forward ? to.offsetTop : to.offsetTop + to.offsetHeight;
      const middleY = (y1 + y2) / 2;
      pathData = `M ${x1} ${y1} C ${x1 + 34} ${middleY}, ${x2 + 34} ${middleY}, ${x2} ${y2}`;
    } else {
      const forward = toCenterX >= fromCenterX;
      x1 = forward ? from.offsetLeft + from.offsetWidth : from.offsetLeft;
      y1 = from.offsetTop + from.offsetHeight / 2;
      x2 = forward ? to.offsetLeft : to.offsetLeft + to.offsetWidth;
      y2 = to.offsetTop + to.offsetHeight / 2;
      const middleX = (x1 + x2) / 2;
      pathData = `M ${x1} ${y1} C ${middleX} ${y1}, ${middleX} ${y2}, ${x2} ${y2}`;
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'timeline-edge');
    path.setAttribute('d', pathData);
    path.setAttribute('marker-end', 'url(#timeline-arrow-main)');
    svg.appendChild(path);
  });
}

function centerAnimeTimelineCurrent({ behavior = 'auto' } = {}) {
  const viewport = document.getElementById('animeTimelineViewport');
  const current = document.querySelector(`#animeTimelineGrid [data-timeline-node-id="${activeAnimeTimelineCurrentId}"]`)
    || document.querySelector('#animeTimelineGrid [data-timeline-node-id]');
  if (!viewport || !current) return;
  viewport.scrollTo({
    left: Math.max(0, current.offsetLeft - (viewport.clientWidth - current.offsetWidth) / 2),
    top: Math.max(0, current.offsetTop - (viewport.clientHeight - current.offsetHeight) / 2),
    behavior
  });
  requestAnimationFrame(updateAnimeTimelineScrollProgress);
}

function resetAnimeModalScroll(modal) {
  const sheet = modal?.querySelector?.('.modal-sheet');
  if (!sheet) return;
  sheet.scrollTop = 0;
  requestAnimationFrame(() => {
    sheet.scrollTop = 0;
  });
}

function openAnimeModal(anime, imgSrc = BLANK, options = {}) {
  const modal = document.getElementById('animeModal');
  const img = document.getElementById('animeModalImg');
  const statusBox = document.querySelector('.modal-status-box');

  if (!modal || !anime || !isAnimeVisible(anime)) return;

  currentModalAnime = anime;
  currentRecommendationReason = options.recommendationReason || '';
  if (img) img.src = BLANK;
  loadAnimeImageElement(img, anime, 0);

  const needsDetails = splitCatalogEnabled && !!getCatalogDetailFile(anime) && !anime._details_loaded;
  renderAnimeModalContent(anime, { loadingDetails: needsDetails });
  renderAnimeRelationsForModal(anime);
  statusBox?.classList.toggle('hidden', !currentUser);

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  resetAnimeModalScroll(modal);
  updateModalStatusUI();
  updateModalRatingUI();
  updateModalProgressUI();

  if (needsDetails) {
    loadAnimeDetails(anime).then(fullAnime => {
      if (!fullAnime || Number(currentModalAnime?.mal_id) !== Number(anime.mal_id)) return;
      if (!isAnimeVisible(fullAnime)) {
        closeAnimeModal();
        return;
      }
      currentModalAnime = fullAnime;
      renderAnimeModalContent(fullAnime);
      renderAnimeRelations(fullAnime);
      updateModalStatusUI();
      updateModalRatingUI();
      updateModalProgressUI();
    });
  }
}

function closeAnimeModal() {
  const modal = document.getElementById('animeModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  resetAnimeModalScroll(modal);
  document.body.style.overflow = '';
  currentModalAnime = null;
  currentRecommendationReason = '';
  clearAnimeRelationsUI();
}

document.addEventListener('click', (e) => {
  const modal = document.getElementById('animeModal');
  if (e.target === modal) closeAnimeModal();
  const routeModal = document.getElementById('animeRouteModal');
  if (e.target === routeModal) closeAnimeRouteChooser();
  const timelineModal = document.getElementById('animeTimelineModal');
  if (e.target === timelineModal) closeAnimeTimeline();
  const scheduleModal = document.getElementById('scheduleDayModal');
  if (e.target === scheduleModal) closeScheduleDayModal();
  const todayOverlay = document.getElementById('neoTodayOverlay');
  if (e.target === todayOverlay) closeNeoToday();
  const languageWidget = document.getElementById('titleLanguageWidget');
  const languagePanel = document.getElementById('titleLanguagePanel');
  if (languageWidget && languagePanel && !languagePanel.classList.contains('hidden') && !languageWidget.contains(e.target)) {
    toggleTitleLanguagePanel(false);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const routeModal = document.getElementById('animeRouteModal');
    if (routeModal?.classList.contains('open')) {
      closeAnimeRouteChooser();
      return;
    }
    const timelineModal = document.getElementById('animeTimelineModal');
    if (timelineModal?.classList.contains('open')) {
      closeAnimeTimeline();
      return;
    }
    closeNeoToday();
    closeScheduleDayModal();
    closeAnimeModal();
    toggleTitleLanguagePanel(false);
  }
});

window.addEventListener('resize', () => {
  if (!activeAnimeTimeline) return;
  if (animeTimelineResizeTimer) window.clearTimeout(animeTimelineResizeTimer);
  animeTimelineResizeTimer = window.setTimeout(() => {
    animeTimelineResizeTimer = 0;
    if (activeAnimeTimeline) renderAnimeTimelineGraph({ centerCurrent: true });
  }, 120);
}, { passive: true });

window.addEventListener('pagehide', () => {
  lastAppHiddenAt = Date.now();
  saveScreenScrollPosition(activeScreenName);
  persistActiveScreen(activeScreenName);
  stopNeoArcadeLoop();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    lastAppHiddenAt = Date.now();
    saveScreenScrollPosition(activeScreenName);
    persistActiveScreen(activeScreenName);
    stopNeoArcadeLoop();
  } else {
    scheduleResumeRefresh(250);
    schedulePendingWriteSync(900);
    const arcadeOpen = !document.getElementById('communityArcadeView')?.classList.contains('hidden');
    if (arcadeOpen) startNeoArcadeLoop();
  }
});

window.addEventListener('pageshow', (event) => {
  persistActiveScreen(activeScreenName);
  scheduleResumeRefresh(event.persisted ? 120 : 350);
});

window.addEventListener('focus', () => {
  scheduleResumeRefresh(250);
  schedulePendingWriteSync(900);
});
window.addEventListener('online', () => {
  scheduleResumeRefresh(120);
  schedulePendingWriteSync(300);
});


document.addEventListener('DOMContentLoaded', async () => {
  initCookieBanner();
  updateAdultContentUI();
  document.getElementById('adultContentToggle')?.addEventListener('change', event => {
    setAdultContentEnabled(event.currentTarget.checked);
  });
  renderIntroFlashMessage();
  document.getElementById('animeTimelineViewport')?.addEventListener('scroll', updateAnimeTimelineScrollProgress, { passive: true });
  loadAnimeSchedule().catch(error => {
    console.warn('No se pudo precargar el calendario:', error);
  });
  await loadDB();
  updateAdultContentUI();
  window.setTimeout(() => {
    loadAnimeRelations().catch(error => {
      console.warn('No se pudo precargar anime-relations.json:', error);
    });
    loadAnimeTimelineIndex().catch(error => {
      console.warn('No se pudo precargar anime-timeline-index.json:', error);
    });
  }, 700);
  const publicProfileSlug = readPublicProfileSlugFromUrl();
  const savedAppState = readAppState();
  const passwordJustUpdated = (() => {
    try {
      const currentUrl = new URL(window.location.href);
      return currentUrl.searchParams.get('password_updated') === '1';
    } catch {
      return false;
    }
  })();

  if (publicProfileSlug) {
    openPublicProfileRoute(publicProfileSlug);
  } else if (shouldRestoreSavedAppScreen(savedAppState, passwordJustUpdated)) {
    dismissIntroIfNeeded(false);
    setActiveScreen(savedAppState.activeScreen + '-screen', 'nav-' + savedAppState.activeScreen, false);
    if (savedAppState.activeScreen === 'ranking') loadRanking();
  } else {
    openIntro(true);
    persistActiveScreen('intro');
  }
  ensureGenreRemoveButtons();
  ensureThemeRemoveButtons();
  updateResultsSummary(0);
  updateSimpleSummary('searchResultsSummary', 0);

  const filterContainer = document.getElementById('filterResults');
  if (filterContainer && !filterContainer.innerHTML.trim()) {
    filterContainer.innerHTML = '<div class="pre-search-note">Selecciona tus filtros y pulsa <strong>Buscar anime</strong> para descubrir resultados.</div>';
  }

  const searchInput = document.getElementById('titleSearchInput');
  const searchClear = document.getElementById('titleSearchClear');
  const searchButton = document.getElementById('titleSearchButton');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      toggleSearchClearButton();
      scheduleTitleSearch();
    });
    searchInput.addEventListener('search', performTitleSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.clearTimeout(titleSearchDebounce);
        performTitleSearch({ scrollToResults: true });
      }
    });
  }
  if (searchButton) {
    searchButton.addEventListener('click', () => performTitleSearch({ scrollToResults: true }));
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      window.clearTimeout(titleSearchDebounce);
      searchInput.value = '';
      performTitleSearch();
      searchInput.focus();
    });
  }
  toggleSearchClearButton();
  updateAccountModeUI();

  const progressEpisodeInput = document.getElementById('modalProgressEpisode');
  if (progressEpisodeInput) {
    progressEpisodeInput.addEventListener('input', () => clampModalProgressInput());
    progressEpisodeInput.addEventListener('change', () => clampModalProgressInput({ forceMinimum: true }));
  }

  document.querySelectorAll('[data-community-admin-tab]').forEach(btn => {
    btn.addEventListener('click', () => setCommunityAdminTab(btn.dataset.communityAdminTab));
  });

  document.getElementById('communityPostBody')?.addEventListener('input', updateCommunityCounts);
  document.getElementById('communityReplyBody')?.addEventListener('input', updateCommunityCounts);
  document.getElementById('communityComposer')?.addEventListener('submit', createCommunityThread);
  document.getElementById('communityReplyComposer')?.addEventListener('submit', createCommunityReply);
  updateCommunityComposerUI();

  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  document.getElementById('signupForm')?.addEventListener('submit', handleSignup);
  document.getElementById('changePasswordForm')?.addEventListener('submit', handleChangePassword);

  supabaseClient.auth.onAuthStateChange((event, session) => {
    setCurrentUser(session?.user || null);
    if (event === 'PASSWORD_RECOVERY' || isRecoveryUrl()) {
      isPasswordRecoveryFlow = true;
    }
    if (currentUser) {
      hydrateCachedUserAnimeData(currentUser.id);
      document.getElementById('loginForm')?.reset();
      document.getElementById('signupForm')?.reset();
    } else if (!isPasswordRecoveryFlow) {
      resetAuthForms();
      switchAuthTab('login');
    }
    renderUserScreen();
    window.setTimeout(() => {
      const authRefreshTasks = [
        fetchCommunityRole({ silent: true }),
        loadMyPublicProfile({ silent: true }),
        refreshUserAnimeData({ silent: true }),
        processPendingWrites({ silent: true })
      ];
      if (communityBoardLoaded) authRefreshTasks.push(loadCommunityThreads({ silent: true }));
      if (activeCommunityThread) authRefreshTasks.push(loadCommunityReplies(activeCommunityThread.id, { silent: true }));
      Promise.allSettled(authRefreshTasks).then(() => {
        if (isPasswordRecoveryFlow && currentUser) {
          showScreen('user');
          toggleUserSettingsPanel(true);
          updateAccountModeUI();
          setAuthFeedback('Has entrado en modo recuperación. Restablece tu contraseña desde ajustes.', 'success');
        }
      });
    }, 0);
  });

  await syncAuthState();
  if (currentUser) loadMyPublicProfile({ silent: true });
  cleanupAuthRedirectUrl();
  if (passwordJustUpdated) {
    try {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.delete('password_updated');
      window.history.replaceState({}, document.title, currentUrl.pathname + currentUrl.search + currentUrl.hash);
    } catch {}
  }
});
