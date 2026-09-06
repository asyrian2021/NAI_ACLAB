const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let state = null;
let currentTab = "generate";
let categoryIndex = 0;
let baseIndex = 0;
let charIndex = 0;
let charSlotIndex = 0;
let historyIndex = 0;
let saveTimer = null;
let worldcupRound = [];
let worldcupNextRound = [];
let worldcupPair = [];
let worldcupRoundSize = 0;
let worldcupRoundNumber = 0;
let worldcupMatchNumber = 0;
let worldcupRunnerUp = null;
let selectedHistoryIds = new Set();
let liveItems = [];
let battingLiveItems = [];
let compareHistoryValue = "0";
let compareSelectionTouched = false;
let modalItem = null;
let modalItems = [];
let modalIndex = -1;
let modalZoom = 1;
let modalPanX = 0;
let modalPanY = 0;
let modalDragging = false;
let modalDragStart = { x: 0, y: 0, panX: 0, panY: 0 };
let presetPickerKind = null;
let activeJobs = { generate: null, batting: null };
let quotaData = null;
let quotaRefreshInFlight = false;
let quotaPollingStarted = false;
const pendingJobId = "__pending__";

const pageCopy = {
  generate: ["이미지 생성", "프리셋과 작가 조합을 골라 이미지를 만듭니다."],
  batting: ["타율 테스트", "같은 작가 가중치로 여러 장면을 만들어 일관성을 확인합니다."],
  artists: ["작가 태그", "랜덤으로 조합할 작가와 가중치 범위를 설정합니다."],
  learning: ["취향 학습", "이미지 평점이 작가 선택과 가중치에 어떻게 반영되는지 확인합니다."],
  presets: ["프롬프트 프리셋", "자주 쓰는 장면과 캐릭터 프롬프트를 저장합니다."],
  settings: ["API 설정", "NovelAI 연결과 이미지 생성 세부값을 설정합니다."],
  compare: ["가중치 비교", "한 히스토리의 이미지와 작가 가중치를 나란히 비교합니다."],
  history: ["생성 기록", "완성된 이미지를 다시 보고 마음에 드는 가중치를 불러옵니다."],
};

const apiFields = [
  ["token", "API 토큰", "password"],
  ["endpoint", "API 주소", "text"],
  ["model", "이미지 모델", "text"],
  ["steps", "스텝", "number"],
  ["scale", "프롬프트 영향도 (Scale)", "number"],
  ["guidance_rescale", "가이던스 보정", "number"],
  ["sampler", "샘플러", "select"],
  ["noise_schedule", "노이즈 스케줄", "select"],
  ["seed", "시드 (-1은 매번 랜덤)", "number"],
];

const apiSelectOptions = {
  sampler: [
    ["k_euler_ancestral", "Euler Ancestral"],
    ["k_euler", "Euler"],
    ["k_dpmpp_2m", "DPM++ 2M"],
    ["k_dpmpp_2s_ancestral", "DPM++ 2S Ancestral"],
    ["k_dpmpp_sde", "DPM++ SDE"],
    ["k_dpm_2", "DPM2"],
    ["k_dpm_fast", "DPM Fast"],
    ["ddim_v3", "DDIM"],
  ],
  noise_schedule: [
    ["karras", "Karras"],
    ["native", "Native"],
    ["exponential", "Exponential"],
    ["polyexponential", "Polyexponential"],
  ],
};

const apiFieldHelp = {
  endpoint: "기본 NovelAI 주소입니다. 별도 서버를 쓰는 경우가 아니면 바꾸지 마세요.",
  model: "NovelAI에서 사용할 이미지 모델입니다.",
  steps: "높을수록 처리 시간이 늘어납니다. 기본값 28을 권장합니다.",
  scale: "프롬프트를 따르는 강도입니다. 기본값 5를 권장합니다.",
  guidance_rescale: "과도한 대비를 보정합니다. 특별한 이유가 없다면 기본값을 유지하세요.",
  sampler: "이미지를 계산하는 방식입니다.",
  noise_schedule: "노이즈 감소 순서를 정합니다.",
  seed: "-1이면 이미지마다 새로운 랜덤 시드를 사용합니다.",
};

const imageSizeOptions = {
  portrait: { label: "Normal Portrait", width: 832, height: 1216 },
  landscape: { label: "Landscape", width: 1216, height: 832 },
  square: { label: "Square", width: 1024, height: 1024 },
};
const defaultNovelAiEndpoint = "https://image.novelai.net/ai/generate-image";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseArtistTags(textOrLines) {
  const text = Array.isArray(textOrLines) ? textOrLines.join("\n") : String(textOrLines || "");
  const seen = new Set();
  const tags = [];
  for (const chunk of text.split(/[,\n\r]+/)) {
    let item = chunk.trim();
    if (!item) continue;
    item = item.replace(/^[+-]?\d+(?:\.\d+)?\s*::\s*/, "");
    const lower = item.toLowerCase();
    const start = lower.indexOf("artist:");
    if (start < 0) continue;
    let tag = item.slice(start).replace(/\s*::\s*$/, "").trim();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function renderRecognizedTags() {
  const tags = parseArtistTags($("#catTags")?.value || "");
  const root = $("#recognizedTags");
  if (!root) return;
  $("#recognizedCount").textContent = `${tags.length}개`;
  root.innerHTML = "";
  if (!tags.length) {
    root.innerHTML = `<span>아직 인식된 artist 태그가 없습니다.</span>`;
    return;
  }
  for (const tag of tags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    root.appendChild(chip);
  }
}

function setSaveState(text, tone = "success") {
  const root = $("#saveState");
  root.textContent = text;
  root.dataset.tone = tone;
}

function formatQuotaDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "";
  // Older responses used milliseconds while the current API uses seconds.
  const normalized = value > 100000 ? value / 1000 : value;
  const minutes = Math.max(1, Math.ceil(normalized / 60));
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}시간 ${remainder}분` : `${hours}시간`;
}

function renderQuota() {
  const root = $("#quotaWidgetContent");
  if (!root) return;
  root.innerHTML = "";
  root.classList.remove("exhausted");
  if (!quotaData?.available) {
    root.textContent = quotaData?.reason || "API 토큰을 입력하면 할당량을 확인합니다.";
    return;
  }
  const tierNames = ["Paper", "Tablet", "Scroll", "Opus"];
  const percent = Number(quotaData.v5_percent);
  const hasV5Quota = Number.isFinite(percent);
  const isExhausted = Boolean(quotaData.v5_is_negative) || (hasV5Quota && percent <= 0);
  const displayedPercent = hasV5Quota ? Math.max(0, percent) : null;
  const barPercent = displayedPercent === null ? 0 : Math.min(100, displayedPercent);

  const summary = document.createElement("div");
  summary.className = "quota-summary";
  const title = document.createElement("span");
  title.textContent = hasV5Quota ? "V5 사용 한도" : "이미지 Anlas";
  const value = document.createElement("strong");
  value.textContent = hasV5Quota
    ? (isExhausted ? "소진" : `${displayedPercent.toFixed(displayedPercent % 1 ? 1 : 0)}%`)
    : `${Number(quotaData.total_anlas || 0).toLocaleString()}`;
  summary.append(title, value);
  root.appendChild(summary);

  if (hasV5Quota) {
    const bar = document.createElement("div");
    bar.className = "quota-bar";
    const fill = document.createElement("span");
    fill.style.width = `${barPercent}%`;
    bar.appendChild(fill);
    root.appendChild(bar);
  }

  const details = document.createElement("div");
  details.className = "quota-detail";
  const tier = tierNames[Number(quotaData.tier)] || "NovelAI";
  const anlas = `Anlas ${Number(quotaData.total_anlas || 0).toLocaleString()}`;
  const recovery = formatQuotaDuration(quotaData.v5_next_percent_seconds);
  details.textContent = hasV5Quota
    ? `${tier} · ${anlas}${recovery ? ` · 다음 +1% ${recovery}` : ""}`
    : `${tier} · ${anlas}`;
  root.appendChild(details);
  const updated = document.createElement("div");
  updated.className = "quota-updated";
  updated.textContent = "방금 갱신됨";
  root.appendChild(updated);
  root.classList.toggle("exhausted", isExhausted);
}

async function refreshQuota({ silent = false } = {}) {
  if (quotaRefreshInFlight) return;
  quotaRefreshInFlight = true;
  const button = $("#quotaRefreshButton");
  if (button) button.disabled = true;
  try {
    const data = await request("/api/quota");
    quotaData = data.quota || null;
    renderQuota();
    if (!silent && quotaData?.available) showToast("NAI 할당량을 갱신했습니다.", "success");
  } catch (error) {
    quotaData = { available: false, reason: "할당량 정보를 불러오지 못했습니다." };
    renderQuota();
    if (!silent) showToast(`할당량을 갱신하지 못했습니다: ${error.message}`, "error");
  } finally {
    quotaRefreshInFlight = false;
    if (button) button.disabled = false;
  }
}

function startQuotaPolling() {
  if (quotaPollingStarted) return;
  quotaPollingStarted = true;
  setInterval(() => refreshQuota({ silent: true }), 60_000);
}

function showToast(message, tone = "info") {
  const region = $("#toastRegion");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 180);
  }, 3200);
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-NAI-ACLAB-Token": window.__NAI_ACLAB_TOKEN__ || "",
    ...(options.headers || {}),
  };
  const response = await fetch(path, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    try {
      const parsed = JSON.parse(raw);
      message = parsed.error || parsed.message || parsed.detail || raw;
    } catch {
      // Keep the plain response when it is not JSON.
    }
    throw new Error(message || `요청 실패 (${response.status})`);
  }
  return response.json();
}

function scheduleSave() {
  setSaveState("저장 중...", "working");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 450);
}

async function saveNow() {
  if (!state) return;
  const tokenInput = $("#api_token");
  const hadPendingToken = Boolean(tokenInput?.value.trim());
  syncEditorsToState();
  try {
    const data = await request("/api/state", {
      method: "POST",
      body: JSON.stringify({ state }),
    });
    state = data.state;
    if (hadPendingToken && tokenInput) {
      tokenInput.value = "";
      tokenInput.placeholder = "저장된 토큰을 사용합니다. 새 토큰을 입력하면 교체됩니다.";
      renderSettings();
      renderGenerate();
    }
    setSaveState(hadPendingToken ? "API 토큰 변경 저장됨" : "자동 저장됨", "success");
    if (hadPendingToken) {
      showToast("새 API 토큰으로 교체했습니다.", "success");
      await refreshQuota({ silent: true });
    }
  } catch (error) {
    setSaveState("저장 실패", "error");
    showToast(`저장하지 못했습니다: ${error.message}`, "error");
    console.error(error);
  }
}

function syncEditorsToState() {
  if (!state) return;
  state.generation.preset_set = $("#presetSetSelect")?.value || "";
  state.generation.base_preset = $("#baseSelect").value;
  state.generation.character_preset = $("#charSelect").value;
  state.generation.count = Math.max(1, Number($("#countInput").value || 1));
  state.generation.image_size = $("#imageSizeSelect").value || "portrait";
  state.generation.fixed_artists = state.generation.fixed_artists || [];
  syncBattingScenesToState();

  const category = state.categories[categoryIndex];
  if (category) {
    category.name = $("#catName").value.trim() || "이름 없는 카테고리";
    category.learning_role = $("#catLearningRole")?.value === "stability" ? "stability" : "style";
    category.min_weight = Number($("#catMin").value || 0);
    category.max_weight = Number($("#catMax").value || 0);
    category.granule = Number($("#catGranule").value || 0.1);
    category.picks = $("#catPicks").value.trim() ? Math.max(1, Number($("#catPicks").value)) : 0;
    category.tags = $("#catTags").value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  }

  const base = state.base_presets[baseIndex];
  if (base) {
    const oldName = base.name;
    base.name = $("#baseName").value.trim() || "이름 없는 베이스";
    renameRecentPreset("base", oldName, base.name);
    renameBattingScenePreset("base", oldName, base.name);
    renamePresetSetReferences("base", oldName, base.name);
    updatePresetNameSurfaces("base", oldName, base.name);
    base.prompt = $("#basePrompt").value.trim();
    base.quality_prompt = $("#qualityPrompt").value.trim();
  }
  state.quality_override_prompt = $("#qualityOverridePrompt").value.trim();

  const character = state.character_presets[charIndex];
  if (character) {
    const oldName = character.name;
    character.name = $("#charName").value.trim() || "이름 없는 캐릭터";
    renameRecentPreset("character", oldName, character.name);
    renameBattingScenePreset("character", oldName, character.name);
    renamePresetSetReferences("character", oldName, character.name);
    updatePresetNameSurfaces("character", oldName, character.name);
    character.prompts = [0, 1, 2].map((i) => $(`#charPrompt${i}`).value.trim());
    character.negatives = [0, 1, 2].map((i) => $(`#charNegative${i}`).value.trim());
  }

  ensureAutoPresetSets();

  state.negative_prompt = $("#negativePrompt").value.trim();

  for (const [key, , type] of apiFields) {
    const input = $(`#api_${key}`);
    if (!input) continue;
    state.api[key] = type === "number" ? Number(input.value || 0) : input.value;
  }
  state.api.mock_mode = $("#mockMode").checked;
}

function syncBattingScenesToState() {
  const root = $("#battingSceneList");
  if (!state || !root) return;
  const rows = $$(".batting-scene-row");
  if (!rows.length && !root.dataset.rendered) {
    state.batting_scenes = state.batting_scenes || [];
    return;
  }
  state.batting_scenes = rows.map((row, index) => ({
    name: row.querySelector(".batting-scene-name")?.value.trim() || `Scene ${index + 1}`,
    preset_set: row.querySelector(".batting-scene-set")?.value || "",
    base_preset: row.querySelector(".batting-scene-base")?.value || "",
    character_preset: row.querySelector(".batting-scene-character")?.value || "",
    image_size: normalizeImageSizeKey(row.querySelector(".batting-scene-size")?.value || state.generation?.image_size || "portrait"),
    count: Math.max(1, Number(row.querySelector(".batting-scene-count")?.value || 2)),
  }));
}

function fillSelect(select, items, selectedName) {
  select.innerHTML = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = item.name;
    select.appendChild(option);
  }
  if (items.some((item) => item.name === selectedName)) select.value = selectedName;
  else if (items[0]) select.value = items[0].name;
}

function fillImageSizeSelect() {
  const select = $("#imageSizeSelect");
  if (!select) return;
  select.innerHTML = "";
  for (const [key, option] of Object.entries(imageSizeOptions)) {
    const item = document.createElement("option");
    item.value = key;
    item.textContent = `${option.label}: ${option.width} x ${option.height}`;
    select.appendChild(item);
  }
  const saved = state.generation.image_size;
  select.value = imageSizeOptions[saved] ? saved : "portrait";
}

function matchingPresetSetName(baseName, characterName) {
  return (state.preset_sets || []).find(
    (item) => item.base_preset === baseName && item.character_preset === characterName
  )?.name || "";
}

function uniquePresetSetName(baseName) {
  return uniqueName(state.preset_sets || [], baseName);
}

function ensureAutoPresetSets() {
  state.preset_sets = state.preset_sets || [];
  const baseNames = new Set((state.base_presets || []).map((item) => item.name).filter(Boolean));
  const characterNames = new Set((state.character_presets || []).map((item) => item.name).filter(Boolean));
  const manualSets = state.preset_sets.filter(
    (item) => !item.auto && baseNames.has(item.base_preset) && characterNames.has(item.character_preset)
  );
  const usedNames = new Set(manualSets.map((item) => item.name));
  const autoSets = [];
  [...baseNames].filter((name) => characterNames.has(name)).sort().forEach((commonName) => {
    if (manualSets.some((item) => item.base_preset === commonName && item.character_preset === commonName)) return;
    let setName = commonName;
    if (usedNames.has(setName)) {
      const autoBase = `${commonName} (자동)`;
      setName = autoBase;
      let suffix = 2;
      while (usedNames.has(setName)) {
        setName = `${autoBase} ${suffix}`;
        suffix += 1;
      }
    }
    usedNames.add(setName);
    autoSets.push({ name: setName, base_preset: commonName, character_preset: commonName, auto: true });
  });
  state.preset_sets = [...manualSets, ...autoSets];
  const validNames = new Set(state.preset_sets.map((item) => item.name));
  if (!validNames.has(state.generation.preset_set)) {
    state.generation.preset_set = matchingPresetSetName(
      state.generation.base_preset,
      state.generation.character_preset
    );
  }
  (state.batting_scenes || []).forEach((scene) => {
    if (!validNames.has(scene.preset_set)) {
      scene.preset_set = matchingPresetSetName(scene.base_preset, scene.character_preset);
    }
  });
}

function fillPresetSetSelect(select, selectedName, directLabel = "직접 조합") {
  if (!select) return;
  select.innerHTML = "";
  const direct = document.createElement("option");
  direct.value = "";
  direct.textContent = directLabel;
  select.appendChild(direct);
  for (const item of state.preset_sets || []) {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = item.name;
    select.appendChild(option);
  }
  select.value = (state.preset_sets || []).some((item) => item.name === selectedName) ? selectedName : "";
}

function presetSetOptionsHtml(selectedName, directLabel = "직접 조합") {
  const options = [`<option value="">${escapeHtml(directLabel)}</option>`];
  for (const item of state.preset_sets || []) {
    options.push(`<option value="${escapeHtml(item.name)}" ${item.name === selectedName ? "selected" : ""}>${escapeHtml(item.name)}</option>`);
  }
  return options.join("");
}

function applyGenerationPresetSet(setName) {
  const presetSet = (state.preset_sets || []).find((item) => item.name === setName);
  state.generation.preset_set = presetSet?.name || "";
  if (!presetSet) return;
  state.generation.base_preset = presetSet.base_preset;
  state.generation.character_preset = presetSet.character_preset;
  rememberPreset("base", presetSet.base_preset);
  rememberPreset("character", presetSet.character_preset);
}

function updateGenerationPresetSetFromPair() {
  state.generation.preset_set = matchingPresetSetName(
    state.generation.base_preset,
    state.generation.character_preset
  );
  fillPresetSetSelect($("#presetSetSelect"), state.generation.preset_set);
}

function normalizeImageSizeKey(value, fallback = "portrait") {
  if (imageSizeOptions[value]) return value;
  return imageSizeOptions[fallback] ? fallback : "portrait";
}

function imageSizeOptionsHtml(selectedKey) {
  const selected = normalizeImageSizeKey(selectedKey);
  return Object.entries(imageSizeOptions)
    .map(([key, option]) => {
      const label = `${option.label}: ${option.width} x ${option.height}`;
      return `<option value="${key}" ${key === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function applyImageSizeToState(requestState) {
  const selected = imageSizeOptions[requestState.generation?.image_size] || imageSizeOptions.portrait;
  requestState.api = requestState.api || {};
  requestState.api.width = selected.width;
  requestState.api.height = selected.height;
}

function rememberPreset(kind, name) {
  if (!name || !state?.generation) return;
  const key = kind === "base" ? "recent_base_presets" : "recent_character_presets";
  const recent = (state.generation[key] || []).filter((item) => item && item !== name);
  state.generation[key] = [name, ...recent].slice(0, 5);
}

function renameRecentPreset(kind, oldName, newName) {
  if (!oldName || !newName || oldName === newName || !state?.generation) return;
  const key = kind === "base" ? "recent_base_presets" : "recent_character_presets";
  state.generation[key] = (state.generation[key] || []).map((item) => (item === oldName ? newName : item));
}

function renameBattingScenePreset(kind, oldName, newName) {
  if (!oldName || !newName || oldName === newName || !state) return;
  const key = kind === "base" ? "base_preset" : "character_preset";
  state.batting_scenes = (state.batting_scenes || []).map((scene) => ({
    ...scene,
    [key]: scene[key] === oldName ? newName : scene[key],
  }));
}

function renameSelectOptions(selector, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  $$(selector).forEach((select) => {
    const wasSelected = select.value === oldName;
    Array.from(select.options || []).forEach((option) => {
      if (option.value === oldName) {
        option.value = newName;
        option.textContent = newName;
      }
    });
    if (wasSelected) select.value = newName;
  });
}

function refreshPresetButtonLabels(kind) {
  const items = kind === "base" ? state.base_presets : state.character_presets;
  const roots = [kind === "base" ? $("#baseList") : $("#charList")];
  if (presetPickerKind === kind) roots.push($("#presetPickerList"));
  roots.filter(Boolean).forEach((root) => {
    root.querySelectorAll(".list-item").forEach((button) => {
      const index = Number(button.dataset.index);
      if (Number.isInteger(index) && items[index]) button.textContent = items[index].name;
    });
  });
}

function updatePresetNameSurfaces(kind, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  refreshPresetButtonLabels(kind);
  if (kind === "base") {
    renameSelectOptions("#baseSelect, .batting-scene-base", oldName, newName);
  } else {
    renameSelectOptions("#charSelect, .batting-scene-character", oldName, newName);
  }
}

function uniqueName(items, baseName) {
  const names = new Set((items || []).map((item) => item.name));
  if (!names.has(baseName)) return baseName;
  let index = 2;
  while (names.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

function recentPresetIndexes(items, selectedIndex, recentNames = []) {
  const indexes = [];
  const addIndex = (index) => {
    if (index >= 0 && index < items.length && !indexes.includes(index)) indexes.push(index);
  };
  addIndex(selectedIndex);
  for (const name of recentNames || []) addIndex(items.findIndex((item) => item.name === name));
  for (let index = 0; index < items.length && indexes.length < 5; index += 1) addIndex(index);
  return indexes.slice(0, 5);
}

function selectPreset(kind, index) {
  syncEditorsToState();
  if (kind === "base") {
    baseIndex = index;
    rememberPreset("base", state.base_presets[index]?.name);
  } else {
    charIndex = index;
    charSlotIndex = 0;
    rememberPreset("character", state.character_presets[index]?.name);
  }
  renderPresets();
  renderGenerate();
  scheduleSave();
}

function renderPresetButtons(root, items, selectedIndex, indexes, kind) {
  root.innerHTML = "";
  for (const index of indexes) {
    const preset = items[index];
    const button = document.createElement("button");
    button.className = `list-item ${index === selectedIndex ? "active" : ""}`;
    button.dataset.kind = kind;
    button.dataset.index = String(index);
    button.textContent = preset.name;
    button.onclick = () => selectPreset(kind, index);
    root.appendChild(button);
  }
}

function renamePresetSetReferences(kind, oldName, newName) {
  if (!oldName || !newName || oldName === newName || !state) return;
  const key = kind === "base" ? "base_preset" : "character_preset";
  if (state.generation?.[key] === oldName) state.generation[key] = newName;
  state.preset_sets = (state.preset_sets || []).map((item) => ({
    ...item,
    [key]: item[key] === oldName ? newName : item[key],
  }));
}

function hasConfiguredArtists() {
  return (state?.categories || []).some((category) => parseArtistTags(category.tags || []).length > 0);
}

function hasBasePreset() {
  return (state?.base_presets || []).some((preset) => String(preset.name || "").trim());
}

function hasCharacterPreset() {
  return (state?.character_presets || []).some((preset) => String(preset.name || "").trim());
}

function hasApiAccess() {
  return Boolean(state?.api?.mock_mode || state?.api?.token_saved || String($("#api_token")?.value || "").trim());
}

function generationCanStart() {
  return hasApiAccess() && hasConfiguredArtists() && hasBasePreset() && hasCharacterPreset();
}

function renderSetupGuide() {
  const root = $("#setupGuide");
  if (!root) return;
  const steps = [
    {
      done: hasApiAccess(),
      title: "NovelAI 연결",
      detail: state.api.mock_mode ? "API 없이 체험 모드 사용 중" : state.api.token_saved ? "API 토큰 저장됨" : "API 토큰이 필요합니다",
      tab: "settings",
      action: "API 설정",
    },
    {
      done: hasConfiguredArtists(),
      title: "작가 태그",
      detail: hasConfiguredArtists() ? "랜덤 조합에 사용할 태그 준비됨" : "작가 태그를 한 개 이상 입력하세요",
      tab: "artists",
      action: "태그 설정",
    },
    {
      done: hasBasePreset() && hasCharacterPreset(),
      title: "프롬프트 프리셋",
      detail: hasBasePreset() && hasCharacterPreset() ? "베이스와 캐릭터 프리셋 준비됨" : "베이스와 캐릭터 프리셋이 필요합니다",
      tab: "presets",
      action: "프리셋 설정",
    },
  ];
  const ready = steps.every((step) => step.done);
  root.classList.toggle("ready", ready);
  root.innerHTML = `
    <div class="setup-guide-copy">
      <strong>${ready ? "이미지를 만들 준비가 됐습니다" : "처음이라면 이 세 가지만 준비하세요"}</strong>
      <span>${ready ? "아래 생성 옵션을 확인하고 이미지 생성을 시작하세요." : "완료되지 않은 항목을 누르면 바로 설정 화면으로 이동합니다."}</span>
    </div>
    <div class="setup-steps"></div>
  `;
  const list = root.querySelector(".setup-steps");
  steps.forEach((step, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `setup-step ${step.done ? "done" : ""}`;
    button.innerHTML = `
      <span class="setup-step-number">${step.done ? "✓" : index + 1}</span>
      <span><strong>${step.title}</strong><small>${step.detail}</small></span>
      <em>${step.done ? "완료" : step.action}</em>
    `;
    button.onclick = () => switchTab(step.tab);
    list.appendChild(button);
  });
}

function battingCanStart() {
  return currentFixedArtists().length > 0 && Boolean(state?.batting_scenes?.length);
}

function renderBattingReadiness() {
  const root = $("#battingReadiness");
  const loadButton = $("#battingLoadWeightsButton");
  if (!root || !loadButton) return;
  const hasWeights = currentFixedArtists().length > 0;
  const hasScenes = Boolean(state.batting_scenes?.length);
  loadButton.hidden = hasWeights;
  root.className = `inline-notice ${hasWeights && hasScenes ? "success" : "warning"}`;
  if (!hasWeights) {
    root.textContent = state.history.length
      ? "먼저 생성 기록에서 마음에 드는 이미지의 ‘가중치 불러오기’를 눌러주세요."
      : "먼저 일반 이미지 생성을 완료한 뒤, 생성 기록에서 작가 가중치를 불러와 주세요.";
  } else if (!hasScenes) {
    root.textContent = "가중치는 준비됐습니다. 테스트할 씬을 한 개 이상 추가하세요.";
  } else {
    root.textContent = `준비 완료: 고정 가중치 ${currentFixedArtists().length}개를 ${state.batting_scenes.length}개 씬에 적용합니다.`;
  }
}

function currentFixedArtists() {
  return state?.generation?.fixed_artists || [];
}

function renderFixedArtistMode() {
  const label = $("#fixedArtistModeLabel");
  const summary = $("#fixedArtistSummary");
  const list = $("#fixedArtistList");
  const clearButton = $("#clearFixedArtistsButton");
  if (!label || !summary || !list || !clearButton) return;

  const artists = currentFixedArtists();
  const isFixed = artists.length > 0;
  clearButton.disabled = !isFixed;
  label.classList.toggle("fixed", isFixed);
  label.textContent = isFixed ? "작가태그 가중치 고정 모드" : "랜덤 가중치 모드";
  summary.textContent = isFixed
    ? `${artists.length}개의 작가태그 가중치를 고정해서 생성합니다.`
    : "작가 태그는 생성할 때마다 랜덤으로 선택됩니다.";
  list.innerHTML = "";
  list.hidden = !isFixed;
  if (!isFixed) {
    return;
  }
  for (const row of artistWeightRows(artists)) list.appendChild(row);
}

function renderBattingFixedArtists() {
  const label = $("#battingFixedArtistModeLabel");
  const summary = $("#battingFixedArtistSummary");
  const list = $("#battingFixedArtistList");
  if (!label || !summary || !list) return;
  const artists = currentFixedArtists();
  const isFixed = artists.length > 0;
  label.classList.toggle("fixed", isFixed);
  label.textContent = isFixed ? "고정 가중치 모드" : "랜덤 가중치 모드";
  summary.textContent = isFixed
    ? `${artists.length}개의 작가태그 가중치를 모든 씬에 고정해서 테스트합니다.`
    : "히스토리나 가중치 비교에서 마음에 드는 이미지의 가중치를 먼저 불러오세요.";
  list.innerHTML = "";
  list.hidden = !isFixed;
  if (!isFixed) {
    return;
  }
  for (const row of artistWeightRows(artists)) list.appendChild(row);
}

function selectOptionsHtml(items, selectedName) {
  return (items || [])
    .map((item) => `<option value="${escapeHtml(item.name)}" ${item.name === selectedName ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
    .join("");
}

function renderBatting() {
  ensureAutoPresetSets();
  state.batting_scenes = state.batting_scenes || [];
  renderBattingFixedArtists();
  renderBattingReadiness();
  const root = $("#battingSceneList");
  if (!root) return;
  root.dataset.rendered = "true";
  root.innerHTML = "";
  if (!state.batting_scenes.length) {
    const empty = document.createElement("div");
    empty.className = "empty-box empty-action";
    empty.innerHTML = `<strong>아직 테스트할 씬이 없습니다.</strong><span>씬은 베이스 + 캐릭터 + 이미지 해상도 한 묶음입니다.</span>`;
    const button = document.createElement("button");
    button.className = "ghost-button";
    button.type = "button";
    button.textContent = "첫 씬 추가";
    button.onclick = addBattingScene;
    empty.appendChild(button);
    root.appendChild(empty);
    updateJobActionButtons();
    return;
  }
  state.batting_scenes.forEach((scene, index) => {
    const row = document.createElement("article");
    row.className = "batting-scene-row";
    const sceneSize = normalizeImageSizeKey(scene.image_size || state.generation?.image_size || "portrait");
    const sceneSetName = (state.preset_sets || []).some((item) => item.name === scene.preset_set)
      ? scene.preset_set
      : matchingPresetSetName(scene.base_preset, scene.character_preset);
    scene.preset_set = sceneSetName;
    row.innerHTML = `
      <div class="batting-scene-number">${index + 1}</div>
      <label><span>씬 이름</span><input class="batting-scene-name" value="${escapeHtml(scene.name || `Scene ${index + 1}`)}" /></label>
      <label><span>프리셋 세트</span><select class="batting-scene-set">${presetSetOptionsHtml(sceneSetName)}</select></label>
      <label><span>베이스 + 퀄리티</span><select class="batting-scene-base">${selectOptionsHtml(state.base_presets, scene.base_preset)}</select></label>
      <label><span>캐릭터</span><select class="batting-scene-character">${selectOptionsHtml(state.character_presets, scene.character_preset)}</select></label>
      <label><span>이미지 해상도</span><select class="batting-scene-size">${imageSizeOptionsHtml(sceneSize)}</select></label>
      <label><span>생성 개수</span><input class="batting-scene-count" type="number" min="1" max="200" value="${Math.max(1, Number(scene.count || 2))}" /></label>
      <button class="icon-button batting-scene-delete" type="button" title="씬 삭제">×</button>
    `;
    row.querySelector(".batting-scene-delete").onclick = () => deleteBattingScene(index);
    const setSelect = row.querySelector(".batting-scene-set");
    const baseSelect = row.querySelector(".batting-scene-base");
    const characterSelect = row.querySelector(".batting-scene-character");
    row.querySelectorAll("input, select").forEach((node) => {
      node.oninput = () => {
        syncBattingScenesToState();
        scheduleSave();
      };
      node.onchange = () => {
        if (node === setSelect) {
          const presetSet = (state.preset_sets || []).find((item) => item.name === setSelect.value);
          if (presetSet) {
            baseSelect.value = presetSet.base_preset;
            characterSelect.value = presetSet.character_preset;
          }
        } else if (node === baseSelect || node === characterSelect) {
          setSelect.value = matchingPresetSetName(baseSelect.value, characterSelect.value);
        }
        syncBattingScenesToState();
        scheduleSave();
      };
    });
    root.appendChild(row);
  });
  updateJobActionButtons();
}

function renderAll() {
  renderGenerate();
  renderBatting();
  renderArtists();
  renderArtistLearning();
  renderPresets();
  renderSettings();
  renderHistory();
  renderCompare();
}

function renderGenerate() {
  ensureAutoPresetSets();
  state.generation.recent_base_presets = state.generation.recent_base_presets || [];
  state.generation.recent_character_presets = state.generation.recent_character_presets || [];
  state.generation.image_size = imageSizeOptions[state.generation.image_size] ? state.generation.image_size : "portrait";
  fillSelect($("#baseSelect"), state.base_presets, state.generation.base_preset);
  fillSelect($("#charSelect"), state.character_presets, state.generation.character_preset);
  fillPresetSetSelect($("#presetSetSelect"), state.generation.preset_set);
  fillImageSizeSelect();
  $("#countInput").value = state.generation.count || 1;
  state.generation.fixed_artists = state.generation.fixed_artists || [];
  const modeBadge = $("#generationModeBadge");
  modeBadge.classList.toggle("warning", !!state.api.mock_mode);
  modeBadge.classList.toggle("fixed", !state.api.mock_mode && !!state.api.token_saved);
  modeBadge.textContent = state.api.mock_mode ? "API 없이 체험 중" : state.api.token_saved ? "NovelAI 연결됨" : "API 연결 필요";
  renderFixedArtistMode();
  renderSetupGuide();
  updateJobActionButtons();
}

function renderArtists() {
  const list = $("#categoryList");
  list.innerHTML = "";
  state.categories.forEach((category, index) => {
    const button = document.createElement("button");
    button.className = `list-item ${index === categoryIndex ? "active" : ""}`;
    button.textContent = category.name;
    button.onclick = () => {
      syncEditorsToState();
      categoryIndex = index;
      renderArtists();
      scheduleSave();
    };
    list.appendChild(button);
  });
  const category = state.categories[categoryIndex];
  $("#catName").value = category?.name || "";
  $("#catLearningRole").value = category?.learning_role === "stability" ? "stability" : "style";
  $("#catMin").value = category?.min_weight ?? "";
  $("#catMax").value = category?.max_weight ?? "";
  $("#catGranule").value = category?.granule ?? "";
  $("#catPicks").value = category?.picks > 0 ? category.picks : "";
  $("#catTags").value = (category?.tags || []).join("\n");
  renderCategoryWeightPreview();
  $("#deleteCategoryButton").disabled = state.categories.length <= 1;
  $("#deleteCategoryButton").title = state.categories.length <= 1 ? "카테고리는 최소 한 개 필요합니다." : "현재 카테고리 삭제";
  renderRecognizedTags();
}

function renderCategoryWeightPreview() {
  const range = $("#categoryWeightPreview");
  const category = state?.categories?.[categoryIndex];
  if (!range || !category) return;
  const tagCount = parseArtistTags(category.tags || []).length;
  const useCount = category.picks > 0 ? Math.min(category.picks, tagCount) : tagCount;
  const roleLabel = category.learning_role === "stability" ? "신체 안정성" : "화풍 만족도";
  range.className = `inline-notice compact-notice ${tagCount ? "success" : "warning"}`;
  range.textContent = tagCount
    ? `생성할 때 이 카테고리에서 ${useCount}개 태그를 고르고, 각 가중치를 ${category.min_weight}~${category.max_weight} 범위에서 ${category.granule} 간격으로 정합니다. ${roleLabel} 평점으로 학습합니다.`
    : "인식된 artist 태그가 없습니다. 위 입력 예시처럼 태그를 추가하세요.";
}

function artistPreferenceStatus(signal) {
  if (signal >= 0.22) return { label: "강한 선호", className: "strong-positive", weight: "높은 가중치 우선" };
  if (signal >= 0.07) return { label: "선호", className: "positive", weight: "높은 가중치 쪽" };
  if (signal <= -0.22) return { label: "비선호", className: "strong-negative", weight: "낮은 가중치 우선" };
  if (signal <= -0.07) return { label: "덜 선호", className: "negative", weight: "낮은 가중치 쪽" };
  return { label: "중립", className: "neutral", weight: "범위 내 균등" };
}

function learningPhase(ratedImages) {
  if (!ratedImages) return { label: "학습 대기", detail: "이미지에 평점을 남겨주세요." };
  if (ratedImages < 5) return { label: "초기 학습", detail: "평가가 더 쌓이면 취향 차이가 선명해집니다." };
  if (ratedImages < 15) return { label: "학습 중", detail: "최근 평가가 생성 확률에 반영되고 있습니다." };
  return { label: "학습 안정화", detail: "충분한 평가를 바탕으로 취향을 반영합니다." };
}

function appendLearningStatus(root, label, value, detail, tone = "") {
  const card = document.createElement("article");
  card.className = `learning-status-card ${tone}`;
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = value;
  const detailNode = document.createElement("small");
  detailNode.textContent = detail;
  card.append(labelNode, valueNode, detailNode);
  root.appendChild(card);
}

function renderArtistLearning() {
  const summary = state?.artist_rating_summary || [];
  const stabilitySummary = state?.stability_rating_summary || [];
  const summaryNode = $("#artistLearningSummary");
  const statusRoot = $("#artistLearningStatus");
  const categoryList = $("#artistLearningCategoryList");
  const list = $("#artistLearningList");
  const stabilityList = $("#stabilityLearningList");
  const resetButton = $("#resetArtistRatingsButton");
  if (!summaryNode || !statusRoot || !categoryList || !list || !stabilityList || !resetButton) return;
  const ratedImages = (field) => (state.history || []).reduce(
    (total, history) => total + (history.type === "batting_test" ? 0 : (history.items || []).filter((item) => Number(item[field]) >= 1).length),
    0
  );
  const styleRatedImages = ratedImages("style_rating");
  const stabilityRatedImages = ratedImages("stability_rating");
  const totalRatedImages = Math.max(styleRatedImages, stabilityRatedImages);
  summaryNode.textContent = totalRatedImages
    ? `화풍 평가 ${styleRatedImages}장 · 신체 안정성 평가 ${stabilityRatedImages}장`
    : "아직 평가된 이미지가 없습니다.";
  resetButton.disabled = totalRatedImages === 0;
  statusRoot.innerHTML = "";
  const stylePhase = learningPhase(styleRatedImages);
  const stabilityPhase = learningPhase(stabilityRatedImages);
  const categoryStates = (state?.categories || []).map((category) => {
    const tagCount = parseArtistTags(category.tags || []).length;
    const selectedCount = category.picks > 0 ? Math.min(category.picks, tagCount) : tagCount;
    return { category, tagCount, selectedCount, active: tagCount > 0 && selectedCount < tagCount };
  });
  const favorite = summary[0];
  const bestStability = stabilitySummary[0];
  appendLearningStatus(statusRoot, "화풍 학습", stylePhase.label, `${styleRatedImages}장 평가 · ${summary.length}명 학습`, styleRatedImages ? "active" : "");
  appendLearningStatus(
    statusRoot,
    "화풍 1순위",
    favorite?.tag || "아직 없음",
    favorite ? `보정 평점 ${Number(favorite.smoothed_rating || 3).toFixed(2)} · 평가 ${favorite.count}회` : "선호 작가를 찾으려면 평점을 더 남겨주세요.",
    favorite ? "favorite" : ""
  );
  appendLearningStatus(
    statusRoot,
    "신체 안정성 학습",
    stabilityPhase.label,
    `${stabilityRatedImages}장 평가 · ${stabilitySummary.length}명 학습`,
    stabilityRatedImages ? "active" : ""
  );
  appendLearningStatus(
    statusRoot,
    "안정화 추천",
    bestStability ? `${bestStability.tag} · ${bestStability.best_weight}` : "아직 없음",
    bestStability ? `추천값 보정 평점 ${Number(bestStability.best_smoothed_rating || 3).toFixed(2)} · 총 ${bestStability.count}회` : "신체 안정성 평점을 남기면 작가별 추천 가중치를 계산합니다.",
    bestStability ? "favorite" : ""
  );
  categoryList.innerHTML = "";
  categoryStates.forEach(({ category, tagCount, selectedCount, active }) => {
    const row = document.createElement("article");
    row.className = `learning-category-row ${active ? "active" : ""}`;
    const text = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = category.name;
    const detail = document.createElement("span");
    const roleLabel = category.learning_role === "stability" ? "신체 안정화" : "메인 화풍";
    detail.textContent = tagCount ? `${roleLabel} · ${tagCount}개 중 ${selectedCount}개 사용` : `${roleLabel} · 등록된 태그 없음`;
    text.append(name, detail);
    const badge = document.createElement("span");
    badge.className = "learning-category-badge";
    badge.textContent = active ? "선택 보정" : tagCount ? "전체 포함" : "대기";
    row.append(text, badge);
    categoryList.appendChild(row);
  });
  list.innerHTML = "";
  if (!summary.length) {
    const empty = document.createElement("div");
    empty.className = "learning-empty";
    empty.textContent = "평가가 쌓이면 작가별 선호도와 생성 반영값이 여기에 표시됩니다.";
    empty.textContent = "화풍 만족도 평가가 쌓이면 메인 화풍 작가의 선호 순위가 표시됩니다.";
    list.appendChild(empty);
  } else summary.slice(0, 12).forEach((item, index) => {
    const signal = Number(item.preference_signal || 0);
    const preference = artistPreferenceStatus(signal);
    const row = document.createElement("article");
    row.className = `learning-row ${preference.className}`;
    row.style.setProperty("--preference-position", `${Math.max(0, Math.min(100, 50 + signal * 50))}%`);
    const head = document.createElement("div");
    head.className = "learning-row-head";
    const rank = document.createElement("span");
    rank.className = "learning-rank";
    rank.textContent = `${index + 1}`;
    const tag = document.createElement("strong");
    tag.className = "learning-tag";
    tag.textContent = item.tag;
    const status = document.createElement("span");
    status.className = "learning-preference-status";
    status.textContent = preference.label;
    head.append(rank, tag, status);
    const metrics = document.createElement("div");
    metrics.className = "learning-metrics";
    const values = [
      `보정 ★ ${Number(item.smoothed_rating || 3).toFixed(2)}`,
      `원평균 ${Number(item.average_rating || 3).toFixed(2)}`,
      `포함 ×${Number(item.selection_multiplier || 1).toFixed(2)}`,
      preference.weight,
      `평가 ${item.count}회`,
    ];
    values.forEach((value) => {
      const metric = document.createElement("span");
      metric.textContent = value;
      metrics.appendChild(metric);
    });
    const meter = document.createElement("div");
    meter.className = "learning-meter";
    meter.title = "왼쪽은 낮은 선호, 가운데는 중립, 오른쪽은 높은 선호입니다.";
    meter.innerHTML = "<span></span><i></i>";
    row.append(head, metrics, meter);
    list.appendChild(row);
  });
  stabilityList.innerHTML = "";
  if (!stabilitySummary.length) {
    const empty = document.createElement("div");
    empty.className = "learning-empty";
    empty.textContent = "신체 안정성 평가가 쌓이면 안정화 작가별 추천 가중치가 표시됩니다.";
    stabilityList.appendChild(empty);
  } else stabilitySummary.slice(0, 12).forEach((item, index) => {
    const signal = Math.max(-1, Math.min(1, (Number(item.best_smoothed_rating || 3) - 3) / 2));
    const preference = artistPreferenceStatus(signal);
    const row = document.createElement("article");
    row.className = `learning-row ${preference.className}`;
    row.style.setProperty("--preference-position", `${Math.max(0, Math.min(100, 50 + signal * 50))}%`);
    const head = document.createElement("div");
    head.className = "learning-row-head";
    const rank = document.createElement("span");
    rank.className = "learning-rank";
    rank.textContent = `${index + 1}`;
    const tag = document.createElement("strong");
    tag.className = "learning-tag";
    tag.textContent = item.tag;
    const status = document.createElement("span");
    status.className = "learning-preference-status";
    status.textContent = `추천 ${item.best_weight}`;
    head.append(rank, tag, status);
    const metrics = document.createElement("div");
    metrics.className = "learning-metrics";
    [
      `추천 보정 ★ ${Number(item.best_smoothed_rating || 3).toFixed(2)}`,
      `전체 평균 ${Number(item.average_rating || 3).toFixed(2)}`,
      `시험 가중치 ${item.tested_weight_count}개`,
      `총 평가 ${item.count}회`,
    ].forEach((value) => {
      const metric = document.createElement("span");
      metric.textContent = value;
      metrics.appendChild(metric);
    });
    const meter = document.createElement("div");
    meter.className = "learning-meter";
    meter.title = "추천 가중치의 보정된 신체 안정성 점수입니다.";
    meter.innerHTML = "<span></span><i></i>";
    row.append(head, metrics, meter);
    stabilityList.appendChild(row);
  });
}

async function resetArtistRatings() {
  if (!window.confirm("모든 이미지 평점을 지우고 작가 선호도 학습을 초기화할까요?")) return;
  const data = await request("/api/history/ratings/clear", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state = data.state;
  [modalItems, liveItems, battingLiveItems].forEach((items) => {
    items.forEach((item) => {
      delete item.rating;
      delete item.style_rating;
      delete item.stability_rating;
    });
  });
  renderHistory();
  renderCompare();
  renderArtistLearning();
  renderLiveGallery(liveItems, "#liveGallery");
  renderLiveGallery(battingLiveItems, "#battingLiveGallery");
  if (!$("#imageModal").hidden) closeImageModal();
  showToast("모든 평점과 작가 학습을 초기화했습니다.", "success");
}

function renderPresets() {
  ensureAutoPresetSets();
  state.generation.recent_base_presets = state.generation.recent_base_presets || [];
  state.generation.recent_character_presets = state.generation.recent_character_presets || [];
  const baseList = $("#baseList");
  renderPresetButtons(
    baseList,
    state.base_presets,
    baseIndex,
    recentPresetIndexes(state.base_presets, baseIndex, state.generation.recent_base_presets),
    "base"
  );
  const base = state.base_presets[baseIndex];
  $("#baseName").value = base?.name || "";
  $("#basePrompt").value = base?.prompt || "";
  $("#qualityPrompt").value = base?.quality_prompt || "";
  $("#qualityOverridePrompt").value = state.quality_override_prompt || "";

  const charList = $("#charList");
  renderPresetButtons(
    charList,
    state.character_presets,
    charIndex,
    recentPresetIndexes(state.character_presets, charIndex, state.generation.recent_character_presets),
    "character"
  );
  const character = state.character_presets[charIndex];
  $("#charName").value = character?.name || "";
  const tabs = $("#charSlotTabs");
  tabs.innerHTML = "";
  const editors = $("#characterEditors");
  editors.innerHTML = "";
  for (let i = 0; i < 3; i += 1) {
    const tab = document.createElement("button");
    const hasContent = Boolean(character?.prompts?.[i]?.trim() || character?.negatives?.[i]?.trim());
    tab.type = "button";
    tab.className = `segment-button ${i === charSlotIndex ? "active" : ""}`;
    tab.textContent = `캐릭터 ${i + 1}${hasContent ? " · 입력됨" : ""}`;
    tab.onclick = () => selectCharacterSlot(i);
    tabs.appendChild(tab);
    const box = document.createElement("div");
    box.className = "character-box";
    box.hidden = i !== charSlotIndex;
    box.innerHTML = `
      <p class="character-slot-help">한 명의 캐릭터 프롬프트를 입력하세요. 비워둔 캐릭터는 최종 프롬프트에서 제외되며, 네거티브도 공통 UC와 <code>|</code>로 나뉘어 해당 캐릭터 구획에 조립됩니다.</p>
      <label class="text-label"><span>프롬프트</span><textarea id="charPrompt${i}" spellcheck="false"></textarea></label>
      <label class="text-label"><span>네거티브 프롬프트</span><textarea id="charNegative${i}" spellcheck="false"></textarea></label>
    `;
    editors.appendChild(box);
    $(`#charPrompt${i}`).value = character?.prompts?.[i] || "";
    $(`#charNegative${i}`).value = character?.negatives?.[i] || "";
  }
  $("#deleteBaseButton").disabled = state.base_presets.length <= 1;
  $("#deleteCharButton").disabled = state.character_presets.length <= 1;
  bindAutosaveInputs(editors);
  renderPresetSetPanel();
}

function renderPresetSetPanel() {
  const root = $("#presetSetList");
  if (!root) return;
  ensureAutoPresetSets();
  root.innerHTML = "";
  if (!state.preset_sets.length) {
    root.innerHTML = `<div class="empty-box"><strong>아직 프리셋 세트가 없습니다.</strong><span>세트를 직접 추가하거나 두 프리셋의 이름을 같게 설정하세요.</span></div>`;
    return;
  }
  state.preset_sets.forEach((presetSet, index) => {
    const row = document.createElement("article");
    row.className = "preset-set-row";
    row.dataset.index = String(index);

    const nameLabel = document.createElement("label");
    const nameCaption = document.createElement("span");
    nameCaption.textContent = "세트 이름";
    const nameInput = document.createElement("input");
    nameInput.value = presetSet.name;
    nameInput.disabled = !!presetSet.auto;
    nameLabel.append(nameCaption, nameInput);

    const baseLabel = document.createElement("label");
    const baseCaption = document.createElement("span");
    baseCaption.textContent = "베이스 + 퀄리티";
    const baseSelect = document.createElement("select");
    fillSelect(baseSelect, state.base_presets, presetSet.base_preset);
    baseSelect.disabled = !!presetSet.auto;
    baseLabel.append(baseCaption, baseSelect);

    const characterLabel = document.createElement("label");
    const characterCaption = document.createElement("span");
    characterCaption.textContent = "캐릭터";
    const characterSelect = document.createElement("select");
    fillSelect(characterSelect, state.character_presets, presetSet.character_preset);
    characterSelect.disabled = !!presetSet.auto;
    characterLabel.append(characterCaption, characterSelect);

    const status = document.createElement("div");
    status.className = `mode-status ${presetSet.auto ? "fixed" : ""}`;
    status.textContent = presetSet.auto ? "이름 일치 자동" : "사용자 세트";

    const deleteButton = document.createElement("button");
    deleteButton.className = "icon-button";
    deleteButton.type = "button";
    deleteButton.title = presetSet.auto ? "동일 이름 프리셋에서 자동 생성된 세트입니다." : "세트 삭제";
    deleteButton.textContent = "×";
    deleteButton.disabled = !!presetSet.auto;

    if (!presetSet.auto) {
      nameInput.onchange = () => {
        const oldName = presetSet.name;
        const desired = nameInput.value.trim() || "이름 없는 세트";
        const duplicate = state.preset_sets.some((item, itemIndex) => itemIndex !== index && item.name === desired);
        presetSet.name = duplicate ? uniquePresetSetName(desired) : desired;
        if (state.generation.preset_set === oldName) state.generation.preset_set = presetSet.name;
        (state.batting_scenes || []).forEach((scene) => {
          if (scene.preset_set === oldName) scene.preset_set = presetSet.name;
        });
        renderPresetSetPanel();
        renderGenerate();
        renderBatting();
        scheduleSave();
      };
      const updateCombination = () => {
        presetSet.base_preset = baseSelect.value;
        presetSet.character_preset = characterSelect.value;
        if (state.generation.preset_set === presetSet.name) applyGenerationPresetSet(presetSet.name);
        (state.batting_scenes || []).forEach((scene) => {
          if (scene.preset_set === presetSet.name) {
            scene.base_preset = presetSet.base_preset;
            scene.character_preset = presetSet.character_preset;
          }
        });
        renderGenerate();
        renderBatting();
        scheduleSave();
      };
      baseSelect.onchange = updateCombination;
      characterSelect.onchange = updateCombination;
      deleteButton.onclick = () => deletePresetSet(index);
    }

    row.append(nameLabel, baseLabel, characterLabel, status, deleteButton);
    root.appendChild(row);
  });
}

function addPresetSet() {
  syncEditorsToState();
  const baseName = state.generation.base_preset || state.base_presets[0]?.name || "";
  const characterName = state.generation.character_preset || state.character_presets[0]?.name || "";
  state.preset_sets.push({
    name: uniquePresetSetName("새 프리셋 세트"),
    base_preset: baseName,
    character_preset: characterName,
    auto: false,
  });
  renderPresetSetPanel();
  renderGenerate();
  renderBatting();
  scheduleSave();
  showToast("프리셋 세트를 추가했습니다.", "success");
}

function deletePresetSet(index) {
  const presetSet = state.preset_sets[index];
  if (!presetSet || presetSet.auto) return;
  if (!window.confirm(`'${presetSet.name}' 프리셋 세트를 삭제할까요?`)) return;
  if (state.generation.preset_set === presetSet.name) state.generation.preset_set = "";
  (state.batting_scenes || []).forEach((scene) => {
    if (scene.preset_set === presetSet.name) scene.preset_set = "";
  });
  state.preset_sets.splice(index, 1);
  renderPresetSetPanel();
  renderGenerate();
  renderBatting();
  scheduleSave();
  showToast("프리셋 세트를 삭제했습니다.", "success");
}

function selectCharacterSlot(index) {
  if (index < 0 || index > 2 || index === charSlotIndex) return;
  syncEditorsToState();
  charSlotIndex = index;
  renderPresets();
}

function renderSettings() {
  const primaryForm = $("#apiPrimaryForm");
  const advancedForm = $("#apiAdvancedForm");
  primaryForm.innerHTML = "";
  advancedForm.innerHTML = "";
  for (const [key, label, type] of apiFields) {
    const wrap = document.createElement("label");
    if (type === "select") {
      wrap.innerHTML = `<span>${label}</span><select id="api_${key}"></select>`;
    } else {
      wrap.innerHTML = `<span>${label}</span><input id="api_${key}" type="${type}" />`;
    }
    const form = key === "token" ? primaryForm : advancedForm;
    form.appendChild(wrap);
    const input = $(`#api_${key}`);
    if (type === "select") {
      input.innerHTML = (apiSelectOptions[key] || [])
        .map(([value, optionLabel]) => `<option value="${escapeHtml(value)}">${escapeHtml(optionLabel)}</option>`)
        .join("");
      const saved = state.api[key] ?? "";
      if (Array.from(input.options).some((option) => option.value === saved)) {
        input.value = saved;
      } else if (saved) {
        const custom = document.createElement("option");
        custom.value = saved;
        custom.textContent = `${saved} (custom)`;
        input.appendChild(custom);
        input.value = saved;
      }
    } else {
      input.value = key === "token" ? "" : state.api[key] ?? "";
    }
    if (key === "token") {
      input.placeholder = state.api.token_saved
        ? "저장된 토큰을 사용합니다. 새 토큰을 입력하면 교체됩니다."
        : "API 토큰을 입력하세요";
      input.autocomplete = "off";
      const help = document.createElement("small");
      help.className = "field-help";
      help.textContent = state.api.token_saved
        ? "보안을 위해 저장된 토큰은 다시 표시하지 않습니다. 새 토큰을 입력하고 설정 저장을 누르면 기존 토큰을 교체합니다."
        : "토큰은 브라우저에 다시 노출하지 않고 로컬에만 저장합니다.";
      wrap.appendChild(help);
    } else if (apiFieldHelp[key]) {
      const help = document.createElement("small");
      help.className = "field-help";
      help.textContent = apiFieldHelp[key];
      wrap.appendChild(help);
    }
    if (type === "number") input.step = "any";
  }
  $("#mockMode").checked = !!state.api.mock_mode;
  const connection = $("#apiConnectionStatus");
  connection.classList.toggle("warning", !!state.api.mock_mode || !state.api.token_saved);
  connection.classList.toggle("fixed", !state.api.mock_mode && !!state.api.token_saved);
  connection.textContent = state.api.mock_mode
    ? "체험 모드"
    : state.api.token_saved
      ? "토큰 저장됨"
      : "토큰 필요";
  $("#negativePrompt").value = state.negative_prompt || "";
  bindAutosaveInputs(primaryForm);
  bindAutosaveInputs(advancedForm);
}

function canReuseArtists(item) {
  return Array.isArray(item?.artists) && item.artists.length > 0;
}

function renderArtistActionButton(item) {
  if (!canReuseArtists(item)) return "";
  return `<button class="mini-button artist-reuse-button" type="button">가중치 불러오기</button>`;
}

function enrichedImageItem(item, context = {}) {
  return {
    ...item,
    rating_disabled: Boolean(item.rating_disabled || context.history?.type === "batting_test"),
    history_id: item.history_id || context.history?.id || "",
    source_base_preset: item.source_base_preset || context.history?.base_preset || "",
    source_character_preset: item.source_character_preset || context.history?.character_preset || "",
    source_label: item.scene_name ? `${context.label || item.source_label || ""} · ${item.scene_name}` : context.label || item.source_label || "",
  };
}

function sameHistoryImage(left, right) {
  return Boolean(
    left?.history_id &&
    right?.history_id &&
    left.history_id === right.history_id &&
    left.path &&
    right.path &&
    left.path === right.path
  );
}

const ratingAxes = [
  { key: "style", field: "style_rating", shortLabel: "화풍", label: "화풍 만족도", help: "메인 화풍 작가의 선택 확률과 가중치 방향에 반영됩니다." },
  { key: "stability", field: "stability_rating", shortLabel: "신체", label: "신체 안정성", help: "인체·손발의 자연스러움과 메인 화풍 보존을 함께 평가합니다." },
];

function itemRating(item, axis) {
  if (axis.key === "style" && item[axis.field] == null && item.rating != null) return Number(item.rating || 0);
  return Number(item[axis.field] || 0);
}

function setLocalItemRating(item, ratingType, rating) {
  const axis = ratingAxes.find((entry) => entry.key === ratingType);
  if (!axis) return;
  if (rating) item[axis.field] = rating;
  else delete item[axis.field];
  if (ratingType === "style") delete item.rating;
}

function renderRatingAxis(item, axis, compact = false) {
  const row = document.createElement("div");
  row.className = `rating-axis-row ${compact ? "compact" : ""}`;
  const copy = document.createElement("div");
  copy.className = "rating-axis-copy";
  const label = document.createElement("span");
  label.textContent = compact ? axis.shortLabel : axis.label;
  copy.appendChild(label);
  if (!compact) {
    const help = document.createElement("small");
    help.textContent = axis.help;
    copy.appendChild(help);
  }
  row.appendChild(copy);
  const stars = document.createElement("div");
  stars.className = "rating-stars";
  const currentRating = itemRating(item, axis);
  for (let rating = 1; rating <= 5; rating += 1) {
    const button = document.createElement("button");
    button.className = `${compact ? "card-rating-button" : "rating-button"} ${rating <= currentRating ? "active" : ""}`;
    button.type = "button";
    button.textContent = "★";
    button.title = currentRating === rating ? `${axis.label} ${rating}점 지우기` : `${axis.label} ${rating}점`;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", rating === currentRating ? "true" : "false");
    button.onclick = async (event) => {
      event.stopPropagation();
      await rateImage(item, axis.key, currentRating === rating ? 0 : rating);
    };
    stars.appendChild(button);
  }
  row.appendChild(stars);
  return row;
}

function renderCardRating(item) {
  if (item.rating_disabled || !item.history_id || !item.path || item.error) return null;
  const root = document.createElement("div");
  root.className = "card-rating-control";
  root.setAttribute("aria-label", "이미지 평가");
  ratingAxes.forEach((axis) => root.appendChild(renderRatingAxis(item, axis, true)));
  return root;
}

function renderImageCard(item, context = {}) {
  const card = document.createElement("article");
  card.className = `image-card ${item.error ? "error" : ""}`;
  const enriched = enrichedImageItem(item, context);
  const modalList = context.modalItems || [enriched];
  if (item.image_url) {
    const img = document.createElement("img");
    img.src = item.image_url;
    img.alt = "generated image";
    img.onclick = () => openImageModal(enriched, modalList);
    card.appendChild(img);
  }
  const meta = document.createElement("div");
  meta.className = "image-card-meta";
  const labelNode = document.createElement("span");
  labelNode.textContent = item.error ? item.error : item.created_at || "생성 완료";
  meta.appendChild(labelNode);
  if (!context.inlineRating && !enriched.rating_disabled) {
    const ratingValues = ratingAxes
      .map((axis) => [axis.shortLabel, itemRating(enriched, axis)])
      .filter(([, rating]) => rating >= 1);
    if (ratingValues.length) {
      const rating = document.createElement("span");
      rating.className = "rating-badge";
      rating.textContent = ratingValues.map(([label, value]) => `${label} ★${value}`).join(" · ");
      meta.appendChild(rating);
    }
  }
  if (canReuseArtists(item)) {
    const button = document.createElement("button");
    button.className = "mini-button artist-reuse-button";
    button.type = "button";
    button.textContent = "가중치 불러오기";
    button.onclick = (event) => {
      event.stopPropagation();
      generateFromImage(enriched);
    };
    meta.appendChild(button);
  }
  if (context.inlineRating) {
    const ratingControl = renderCardRating(enriched);
    if (ratingControl) meta.appendChild(ratingControl);
  }
  card.appendChild(meta);
  return card;
}

function renderLiveGallery(items = liveItems, rootSelector = "#liveGallery") {
  if (rootSelector === "#liveGallery") liveItems = items || [];
  if (rootSelector === "#battingLiveGallery") battingLiveItems = items || [];
  const root = $(rootSelector);
  if (!root) return;
  root.innerHTML = "";
  const galleryItems = items || [];
  if (!galleryItems.length) {
    root.innerHTML = `<p>아직 생성된 이미지가 없습니다.</p>`;
    return;
  }
  const modalItems = galleryItems.filter((item) => item.image_url);
  const inlineRating = rootSelector === "#liveGallery";
  for (const item of galleryItems) {
    root.appendChild(renderImageCard(item, { modalItems, inlineRating }));
  }
}

function renderHistory() {
  const list = $("#historyList");
  list.innerHTML = "";
  if (!state.history.length) {
    list.innerHTML = `<div class="empty-box"><strong>아직 생성 기록이 없습니다.</strong><span>이미지를 생성하면 프리셋 조합별로 자동 저장됩니다.</span></div>`;
  }
  state.history.forEach((history, index) => {
    const row = document.createElement("div");
    row.className = "history-list-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "history-select-checkbox";
    checkbox.dataset.historyId = history.id;
    checkbox.checked = selectedHistoryIds.has(history.id);
    checkbox.onchange = () => {
      if (checkbox.checked) selectedHistoryIds.add(history.id);
      else selectedHistoryIds.delete(history.id);
      updateHistoryActions();
    };
    const button = document.createElement("button");
    button.className = `list-item ${index === historyIndex ? "active" : ""}`;
    const title = document.createElement("strong");
    title.textContent = `${history.base_preset || ""} + ${history.character_preset || ""}`;
    const br = document.createElement("br");
    const meta = document.createElement("span");
    meta.textContent = `${history.created_at || ""} · ${(history.items || []).length}장`;
    button.append(title, br, meta);
    button.onclick = () => {
      historyIndex = index;
      renderHistory();
    };
    row.appendChild(checkbox);
    row.appendChild(button);
    list.appendChild(row);
  });
  const history = state.history[historyIndex];
  const detail = $("#historyDetail");
  detail.innerHTML = "";
  if (!history) {
    detail.innerHTML = `<div class="empty-box empty-action"><strong>비교할 이미지가 없습니다.</strong><span>생성 메뉴에서 첫 이미지를 만들어 보세요.</span><button class="primary-button" type="button" id="historyGoGenerateButton">이미지 생성으로 이동</button></div>`;
    $("#historyGoGenerateButton").onclick = () => switchTab("generate");
    updateHistoryActions();
    return;
  }
  const actions = document.createElement("div");
  actions.className = "history-detail-actions";
  const info = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${history.base_preset || ""} + ${history.character_preset || ""}`;
  const meta = document.createElement("span");
  meta.textContent = `${history.created_at || ""} · ${(history.items || []).length}장`;
  info.append(title, meta);
  const openButton = document.createElement("button");
  openButton.className = "ghost-button";
  openButton.type = "button";
  openButton.textContent = "저장 폴더 열기";
  openButton.onclick = () => openHistoryFolder(history);
  actions.append(info, openButton);
  detail.appendChild(actions);
  const modalItems = (history.items || [])
    .map((item, index) => enrichedImageItem(item, { history, label: `#${index + 1}` }))
    .filter((item) => item.image_url);
  (history.items || []).forEach((item, index) => {
    detail.appendChild(renderImageCard(item, { history, label: `#${index + 1}`, modalItems }));
  });
  updateHistoryActions();
}

function updateHistoryActions() {
  const hasHistory = Boolean(state?.history?.length);
  const allSelected = hasHistory && state.history.every((item) => selectedHistoryIds.has(item.id));
  const selectAll = $("#selectAllHistoryButton");
  const deleteSelected = $("#deleteSelectedHistoryButton");
  const clear = $("#clearHistoryButton");
  if (selectAll) {
    selectAll.disabled = !hasHistory;
    selectAll.textContent = allSelected ? "선택 해제" : "전체 선택";
  }
  if (deleteSelected) {
    deleteSelected.disabled = selectedHistoryIds.size === 0;
    deleteSelected.textContent = selectedHistoryIds.size ? `선택 ${selectedHistoryIds.size}개 삭제` : "선택 삭제";
  }
  if (clear) clear.disabled = !hasHistory;
  const worldcup = $("#startWorldcupButton");
  if (worldcup) worldcup.disabled = !(state?.history?.[historyIndex]?.items || []).some((item) => item.image_url);
}

function syncSelectedHistoryIdsFromDom() {
  selectedHistoryIds = new Set(
    $$("#historyList .history-select-checkbox")
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.dataset.historyId)
      .filter(Boolean)
  );
}

function compareItems() {
  const histories = compareHistoryValue === "__all__"
    ? state.history
    : [state.history[Number(compareHistoryValue)]].filter(Boolean);
  return histories.flatMap((history) =>
    (history.items || []).map((item, index) => ({
      ...item,
      compare_label: `${history.created_at || ""} #${index + 1}${item.scene_name ? ` · ${item.scene_name}` : ""}`,
      compare_history: `${history.base_preset || ""} + ${history.character_preset || ""}`,
      history_id: history.id || "",
      rating_disabled: Boolean(item.rating_disabled || history.type === "batting_test"),
      source_base_preset: item.source_base_preset || history.base_preset || "",
      source_character_preset: item.source_character_preset || history.character_preset || "",
      source_label: `${history.created_at || ""} #${index + 1}${item.scene_name ? ` · ${item.scene_name}` : ""}`,
    }))
  ).filter((item) => item.image_url && Array.isArray(item.artists));
}

function renderCompare() {
  const select = $("#compareHistorySelect");
  if (!select) return;
  select.onchange = (event) => {
    compareHistoryValue = event.target.value;
    compareSelectionTouched = true;
    renderCompare();
  };
  const previous = compareHistoryValue;
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "__all__";
  allOption.textContent = `전체 히스토리 (${state.history.length})`;
  select.appendChild(allOption);
  state.history.forEach((history, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${history.created_at} · ${history.base_preset} + ${history.character_preset} · ${(history.items || []).length}장`;
    select.appendChild(option);
  });
  compareHistoryValue = !state.history.length
    ? "__all__"
    : !compareSelectionTouched
      ? "0"
      : previous === "__all__" || state.history[Number(previous)]
        ? previous
        : "0";
  select.value = compareHistoryValue;

  const items = compareItems();
  renderCompareStrip(items);
  renderCompareMatrix(items);
}

function renderCompareStrip(items) {
  const root = $("#compareStrip");
  root.innerHTML = "";
  if (!items.length) {
    root.innerHTML = `<p>비교할 이미지가 없습니다.</p>`;
    return;
  }
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "compare-card";
    const rows = document.createElement("div");
    rows.className = "artist-weight-list";
    for (const artist of item.artists || []) {
      const row = document.createElement("div");
      row.className = "artist-weight-row";
      const tag = document.createElement("span");
      tag.textContent = artist.tag || "";
      const weight = document.createElement("span");
      weight.className = "weight-pill";
      weight.textContent = artist.weight ?? "";
      row.append(tag, weight);
      rows.appendChild(row);
    }
    const body = document.createElement("div");
    body.className = "compare-card-body";
    const title = document.createElement("h3");
    title.textContent = item.compare_label;
    const subtitle = document.createElement("p");
    subtitle.textContent = item.compare_history;
    const actions = document.createElement("div");
    actions.className = "compare-card-actions";
    const reuse = document.createElement("button");
    reuse.className = "mini-button";
    reuse.type = "button";
    reuse.textContent = "가중치 불러오기";
    reuse.onclick = () => generateFromImage(item);
    actions.appendChild(reuse);
    body.append(title, subtitle, actions, rows);
    card.innerHTML = `<img src="${item.image_url}" alt="generated image" />`;
    card.querySelector("img").onclick = () => openImageModal(item, items);
    card.appendChild(body);
    root.appendChild(card);
  }
}

function renderCompareMatrix(items) {
  const root = $("#compareMatrix");
  root.innerHTML = "";
  if (!items.length) {
    root.innerHTML = `<p>비교할 이미지가 없습니다.</p>`;
    return;
  }
  const tags = [];
  const seen = new Set();
  for (const item of items) {
    for (const artist of item.artists || []) {
      if (!seen.has(artist.tag)) {
        seen.add(artist.tag);
        tags.push(artist.tag);
      }
    }
  }
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const first = document.createElement("th");
  first.textContent = "artist tag";
  headRow.appendChild(first);
  items.forEach((item, index) => {
    const th = document.createElement("th");
    th.textContent = `#${index + 1}`;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const tag of tags) {
    const row = document.createElement("tr");
    const tagCell = document.createElement("td");
    tagCell.textContent = tag;
    row.appendChild(tagCell);
    for (const item of items) {
      const cell = document.createElement("td");
      const artist = (item.artists || []).find((entry) => entry.tag === tag);
      cell.textContent = artist ? artist.weight : "-";
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  root.appendChild(table);
}

function artistWeightRows(artists = []) {
  return artists.map((artist) => {
    const row = document.createElement("div");
    row.className = "artist-weight-row";
    const tag = document.createElement("span");
    tag.textContent = artist.tag || "";
    const weight = document.createElement("span");
    weight.className = "weight-pill";
    weight.textContent = artist.weight ?? "";
    row.append(tag, weight);
    return row;
  });
}

function modalItemIndex(item, items) {
  return items.findIndex((entry) =>
    (entry.path && item.path && entry.path === item.path) ||
    (entry.image_url && item.image_url && entry.image_url === item.image_url)
  );
}

function openImageModal(item, items = null) {
  if (!item?.image_url) return;
  modalItems = (items || [item]).filter((entry) => entry?.image_url);
  modalIndex = modalItemIndex(item, modalItems);
  if (modalIndex < 0) {
    modalItems = [item];
    modalIndex = 0;
  }
  $("#imageModal").hidden = false;
  renderImageModalItem(modalItems[modalIndex]);
}

function renderImageModalItem(item) {
  modalItem = item;
  resetModalTransform();
  const image = $("#modalImage");
  image.onload = () => {
    resetModalTransform();
    fitModalImageToView();
  };
  image.src = item.image_url;
  image.alt = item.source_label || "selected image";
  if (image.complete) requestAnimationFrame(fitModalImageToView);
  const position = modalItems.length > 1 ? ` (${modalIndex + 1} / ${modalItems.length})` : "";
  $("#modalTitle").textContent = `${item.source_label || item.created_at || "이미지"}${position}`;
  $("#modalSubtitle").textContent = [item.source_base_preset, item.source_character_preset].filter(Boolean).join(" + ");
  const artistList = $("#modalArtists");
  artistList.innerHTML = "";
  for (const row of artistWeightRows(item.artists || [])) artistList.appendChild(row);
  $("#modalGenerateButton").disabled = !canReuseArtists(item);
  renderModalRating(item);
}

function renderModalRating(item) {
  const root = $("#modalRating");
  if (!root) return;
  root.innerHTML = "";
  if (item.rating_disabled) {
    const message = document.createElement("span");
    message.className = "field-help";
    message.textContent = "타율 테스트는 고정 조합 검증용이므로 작가 학습 평점에서 제외됩니다.";
    root.appendChild(message);
    return;
  }
  if (!item.history_id || !item.path) {
    const message = document.createElement("span");
    message.className = "field-help";
    message.textContent = "생성 작업이 히스토리에 저장된 뒤 평점을 매길 수 있습니다.";
    root.appendChild(message);
    return;
  }
  ratingAxes.forEach((axis) => root.appendChild(renderRatingAxis(item, axis)));
}

async function rateImage(item, ratingType, rating) {
  if (item.rating_disabled) return;
  const data = await request("/api/history/rate", {
    method: "POST",
    body: JSON.stringify({ history_id: item.history_id, path: item.path, rating_type: ratingType, rating }),
  });
  state = data.state;
  [modalItems, liveItems, battingLiveItems].forEach((items) => {
    items.forEach((entry) => {
      if (sameHistoryImage(entry, item)) setLocalItemRating(entry, ratingType, rating);
    });
  });
  setLocalItemRating(item, ratingType, rating);
  renderHistory();
  renderCompare();
  renderArtistLearning();
  renderLiveGallery(liveItems, "#liveGallery");
  renderLiveGallery(battingLiveItems, "#battingLiveGallery");
  if (!$("#imageModal").hidden && modalItem && sameHistoryImage(modalItem, item)) {
    setLocalItemRating(modalItem, ratingType, rating);
    renderModalRating(modalItem);
  }
  const axis = ratingAxes.find((entry) => entry.key === ratingType);
  showToast(rating ? `${axis?.label || "평점"}: ${rating}점으로 평가했습니다.` : `${axis?.label || "평점"}을 지웠습니다.`, "success");
}

function applyModalTransform() {
  const image = $("#modalImage");
  image.style.transform = `translate(${modalPanX}px, ${modalPanY}px) scale(${modalZoom})`;
  image.classList.toggle("zoomed", modalZoom > 1.01);
}

function fitModalImageToView() {
  const modal = $("#imageModal");
  const image = $("#modalImage");
  const view = $(".image-modal-view");
  if (modal.hidden || !image.naturalWidth || !image.naturalHeight) return;
  const rect = view.getBoundingClientRect();
  const maxWidth = Math.max(1, rect.width - 18);
  const maxHeight = Math.max(1, rect.height - 18);
  const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  image.style.width = `${Math.floor(image.naturalWidth * scale)}px`;
  image.style.height = `${Math.floor(image.naturalHeight * scale)}px`;
}

function resetModalTransform() {
  modalZoom = 1;
  modalPanX = 0;
  modalPanY = 0;
  modalDragging = false;
  applyModalTransform();
}

function zoomModalImage(delta, originEvent = null) {
  const previousZoom = modalZoom;
  const nextZoom = Math.min(6, Math.max(1, modalZoom * (delta > 0 ? 1.12 : 0.88)));
  if (Math.abs(nextZoom - previousZoom) < 0.001) return;
  if (originEvent && previousZoom > 0) {
    const image = $("#modalImage");
    const rect = image.getBoundingClientRect();
    const offsetX = originEvent.clientX - (rect.left + rect.width / 2);
    const offsetY = originEvent.clientY - (rect.top + rect.height / 2);
    const ratio = nextZoom / previousZoom;
    modalPanX = offsetX - (offsetX - modalPanX) * ratio;
    modalPanY = offsetY - (offsetY - modalPanY) * ratio;
  }
  modalZoom = nextZoom;
  if (modalZoom <= 1.01) {
    modalZoom = 1;
    modalPanX = 0;
    modalPanY = 0;
  }
  applyModalTransform();
}

function navigateImageModal(delta) {
  if ($("#imageModal").hidden || modalItems.length <= 1) return;
  modalIndex = (modalIndex + delta + modalItems.length) % modalItems.length;
  renderImageModalItem(modalItems[modalIndex]);
}

function bindModalImageInteractions() {
  const image = $("#modalImage");
  const view = $(".image-modal-view");
  view.onwheel = (event) => {
    if ($("#imageModal").hidden) return;
    event.preventDefault();
    zoomModalImage(event.deltaY < 0 ? 1 : -1, event);
  };
  image.onmousedown = (event) => {
    if (modalZoom <= 1.01) return;
    event.preventDefault();
    modalDragging = true;
    modalDragStart = {
      x: event.clientX,
      y: event.clientY,
      panX: modalPanX,
      panY: modalPanY,
    };
  };
  window.addEventListener("mousemove", (event) => {
    if (!modalDragging) return;
    modalPanX = modalDragStart.panX + (event.clientX - modalDragStart.x);
    modalPanY = modalDragStart.panY + (event.clientY - modalDragStart.y);
    applyModalTransform();
  });
  window.addEventListener("mouseup", () => {
    modalDragging = false;
  });
  window.addEventListener("resize", () => {
    if ($("#imageModal").hidden) return;
    resetModalTransform();
    fitModalImageToView();
  });
  view.onclick = (event) => event.stopPropagation();
}

function openPresetPicker(kind) {
  presetPickerKind = kind;
  const items = kind === "base" ? state.base_presets : state.character_presets;
  const selectedIndex = kind === "base" ? baseIndex : charIndex;
  $("#presetPickerTitle").textContent = kind === "base" ? "베이스 + 퀄리티 프리셋" : "캐릭터 프리셋";
  $("#presetPickerSubtitle").textContent = "전체 목록에서 사용할 프리셋을 선택하세요.";
  const list = $("#presetPickerList");
  list.innerHTML = "";
  items.forEach((preset, index) => {
    const button = document.createElement("button");
    button.className = `list-item ${index === selectedIndex ? "active" : ""}`;
    button.dataset.kind = kind;
    button.dataset.index = String(index);
    button.textContent = preset.name;
    button.onclick = () => {
      selectPreset(kind, index);
      closePresetPicker();
    };
    list.appendChild(button);
  });
  $("#presetPickerModal").hidden = false;
}

function closePresetPicker() {
  $("#presetPickerModal").hidden = true;
  presetPickerKind = null;
}

function closeImageModal() {
  const modal = $("#imageModal");
  modal.hidden = true;
  modalItem = null;
  modalItems = [];
  modalIndex = -1;
  resetModalTransform();
  $("#modalImage").removeAttribute("src");
}

function generateFromImage(item) {
  if (!canReuseArtists(item)) return;
  closeImageModal();
  state.generation.fixed_artists = item.artists.map((artist) => ({
    category: artist.category || "fixed",
    learning_role: artist.learning_role || (String(artist.category || "").includes("안정") ? "stability" : "style"),
    tag: artist.tag || "",
    weight: Number(artist.weight ?? 1),
    prompt: artist.prompt || "",
  })).filter((artist) => artist.tag);
  if (item.source_base_preset) state.generation.base_preset = item.source_base_preset;
  if (item.source_character_preset) state.generation.character_preset = item.source_character_preset;
  state.generation.preset_set = matchingPresetSetName(
    state.generation.base_preset,
    state.generation.character_preset
  );
  renderGenerate();
  renderBatting();
  switchTab("generate");
  previewPrompt();
  scheduleSave();
  setSaveState("작가태그 가중치 고정됨");
}

function clearFixedArtists() {
  if (!state?.generation) return;
  state.generation.fixed_artists = [];
  renderGenerate();
  renderBatting();
  previewPrompt();
  scheduleSave();
  setSaveState("랜덤 가중치 모드");
}

function addBattingScene() {
  syncEditorsToState();
  state.batting_scenes = state.batting_scenes || [];
  const nextIndex = state.batting_scenes.length + 1;
  state.batting_scenes.push({
    name: uniqueName(state.batting_scenes, `Scene ${nextIndex}`),
    preset_set: state.generation.preset_set || matchingPresetSetName(
      state.generation.base_preset,
      state.generation.character_preset
    ),
    base_preset: state.generation.base_preset || state.base_presets[0]?.name || "",
    character_preset: state.generation.character_preset || state.character_presets[0]?.name || "",
    image_size: normalizeImageSizeKey(state.generation.image_size || "portrait"),
    count: 2,
  });
  renderBatting();
  scheduleSave();
}

function deleteBattingScene(index) {
  syncBattingScenesToState();
  const scene = state.batting_scenes[index];
  if (!scene || !window.confirm(`'${scene.name || `Scene ${index + 1}`}' 씬을 삭제할까요?`)) return;
  state.batting_scenes.splice(index, 1);
  renderBatting();
  scheduleSave();
  showToast("씬을 삭제했습니다.", "success");
}

function battingStateForRequest() {
  syncBattingScenesToState();
  const requestState = generationStateForRequest();
  requestState.batting_scenes = state.batting_scenes || [];
  return requestState;
}

function setBattingRunning(running, cancelling = false) {
  activeJobs.batting = running ? activeJobs.batting || pendingJobId : null;
  updateJobActionButtons(cancelling ? "batting" : "");
}

async function startBattingTest() {
  syncEditorsToState();
  if (hasActiveJob()) return;
  if (!confirmCustomEndpointTokenUse()) return;
  if (!currentFixedArtists().length) {
    showToast("먼저 생성 기록에서 마음에 드는 이미지의 가중치를 불러와 주세요.", "warning");
    switchTab(state.history.length ? "history" : "generate");
    return;
  }
  syncBattingScenesToState();
  if (!state.batting_scenes?.length) {
    showToast("테스트할 씬을 먼저 추가해 주세요.", "warning");
    return;
  }
  $("#battingJobLog").textContent = "타율 테스트를 시작합니다...\n";
  $("#battingProgressText").textContent = "생성 중";
  $("#battingProgressCount").textContent = "0 / 0";
  $("#battingProgressBar").style.width = "0%";
  setProgressActive(true, "#battingProgress");
  renderLiveGallery([], "#battingLiveGallery");
  setBattingRunning(true);
  try {
    const data = await request("/api/batting/generate", {
      method: "POST",
      body: JSON.stringify({ state: battingStateForRequest() }),
    });
    activeJobs.batting = data.job_id;
    pollJob(data.job_id, jobTargets("batting"));
  } catch (error) {
    setBattingRunning(false);
    $("#battingProgressText").textContent = "실패";
    $("#battingJobLog").textContent += `시작 실패: ${error.message}\n`;
    showToast(`타율 테스트를 시작하지 못했습니다: ${error.message}`, "error");
  }
}

async function stopBattingTest() {
  if (!activeJobs.batting) return;
  $("#stopBattingButton").disabled = true;
  $("#battingProgressText").textContent = "중지 요청";
  await request("/api/job/cancel", {
    method: "POST",
    body: JSON.stringify({ job_id: activeJobs.batting }),
  });
}

function setGenerationRunning(running, cancelling = false) {
  activeJobs.generate = running ? activeJobs.generate || pendingJobId : null;
  updateJobActionButtons(cancelling ? "generate" : "");
}

function hasActiveJob() {
  return Boolean(activeJobs.generate || activeJobs.batting);
}

function isPendingJob(jobId) {
  return jobId === pendingJobId;
}

function updateJobActionButtons(cancellingKind = "") {
  const generateRunning = Boolean(activeJobs.generate);
  const battingRunning = Boolean(activeJobs.batting);
  const busy = generateRunning || battingRunning;
  const topButton = $("#generateButton");
  const inlineButton = $("#generateButtonInline");
  const previewButton = $("#previewButton");
  const stopGenerateButton = $("#stopGenerateButton");
  const startBattingButton = $("#startBattingButton");
  const addBattingButton = $("#addBattingSceneButton");
  const stopBattingButton = $("#stopBattingButton");
  if (topButton) topButton.disabled = busy;
  if (inlineButton) {
    inlineButton.disabled = busy || !generationCanStart();
    inlineButton.title = generationCanStart() ? "선택한 설정으로 이미지 생성" : "위 준비 상태에서 완료되지 않은 항목을 먼저 설정하세요.";
    if (!busy) inlineButton.textContent = `이미지 ${Math.max(1, Number($("#countInput")?.value || state?.generation?.count || 1))}장 생성`;
  }
  if (previewButton) previewButton.disabled = busy;
  if (startBattingButton) {
    startBattingButton.disabled = busy || !battingCanStart();
    startBattingButton.title = battingCanStart() ? "모든 씬을 순서대로 생성" : "고정 가중치와 씬을 먼저 준비하세요.";
  }
  if (addBattingButton) addBattingButton.disabled = busy;
  if (stopGenerateButton) {
    stopGenerateButton.disabled = !generateRunning || isPendingJob(activeJobs.generate) || cancellingKind === "generate";
    stopGenerateButton.textContent = cancellingKind === "generate" ? "중지 중" : "생성 중지";
  }
  if (stopBattingButton) {
    stopBattingButton.disabled = !battingRunning || isPendingJob(activeJobs.batting) || cancellingKind === "batting";
    stopBattingButton.textContent = cancellingKind === "batting" ? "중지 중" : "생성 중지";
  }
}

async function stopGeneration() {
  if (!activeJobs.generate) return;
  $("#stopGenerateButton").disabled = true;
  $("#progressText").textContent = "중지 요청";
  await request("/api/job/cancel", {
    method: "POST",
    body: JSON.stringify({ job_id: activeJobs.generate }),
  });
}

async function deleteSelectedHistory() {
  syncSelectedHistoryIdsFromDom();
  if (!selectedHistoryIds.size) {
    setSaveState("삭제할 히스토리를 선택하세요");
    return;
  }
  const deleteFiles = $("#deleteFilesToggle").checked;
  const ok = window.confirm(`${selectedHistoryIds.size}개 히스토리를 삭제할까요?${deleteFiles ? " 출력 파일도 함께 삭제됩니다." : ""}`);
  if (!ok) return;
  const data = await request("/api/history/delete", {
    method: "POST",
    body: JSON.stringify({ ids: Array.from(selectedHistoryIds), delete_files: deleteFiles }),
  });
  state = data.state;
  selectedHistoryIds.clear();
  historyIndex = Math.min(historyIndex, Math.max(0, state.history.length - 1));
  renderHistory();
  renderCompare();
  setSaveState("히스토리 삭제됨");
}

async function clearHistory() {
  if (!state.history.length) return;
  const deleteFiles = $("#deleteFilesToggle").checked;
  const ok = window.confirm(`전체 히스토리 ${state.history.length}개를 삭제할까요?${deleteFiles ? " 출력 파일도 함께 삭제됩니다." : ""}`);
  if (!ok) return;
  const data = await request("/api/history/clear", {
    method: "POST",
    body: JSON.stringify({ delete_files: deleteFiles }),
  });
  state = data.state;
  selectedHistoryIds.clear();
  historyIndex = 0;
  renderHistory();
  renderCompare();
  setSaveState("히스토리 전체 삭제됨");
}

async function openHistoryFolder(history) {
  if (!history?.id) return;
  try {
    await request("/api/history/open", {
      method: "POST",
      body: JSON.stringify({ id: history.id }),
    });
    setSaveState("저장 폴더를 열었습니다");
  } catch {
    setSaveState("저장 폴더를 찾을 수 없습니다");
  }
}

function selectAllHistory() {
  const allSelected = state.history.length > 0 && state.history.every((item) => selectedHistoryIds.has(item.id));
  selectedHistoryIds = allSelected ? new Set() : new Set(state.history.map((item) => item.id));
  renderHistory();
}

async function previewPrompt() {
  syncEditorsToState();
  const data = await request("/api/preview", {
    method: "POST",
    body: JSON.stringify({ state }),
  });
  $("#promptPreview").textContent = data.prompt || "";
  $("#negativePreview").textContent = data.negative || "";
  setSaveState("미리보기 갱신됨");
}

function setProgressActive(active, selector = ".progress") {
  $(selector)?.classList.toggle("active", !!active);
}

function generationStateForRequest() {
  const requestState = JSON.parse(JSON.stringify(state));
  requestState.generation = requestState.generation || {};
  requestState.generation.count = Math.max(1, Number($("#countInput").value || requestState.generation.count || 1));
  requestState.generation.fixed_artists = currentFixedArtists();
  applyImageSizeToState(requestState);
  return requestState;
}

function shouldConfirmCustomEndpoint() {
  const endpoint = String(state?.api?.endpoint || "").trim();
  if (!endpoint || endpoint === defaultNovelAiEndpoint) return false;
  return Boolean(state?.api?.token_saved || String($("#api_token")?.value || "").trim());
}

function confirmCustomEndpointTokenUse() {
  if (!shouldConfirmCustomEndpoint()) return true;
  return window.confirm(
    "기본 NovelAI endpoint가 아닌 주소가 설정되어 있습니다.\n\n" +
    "이미지 생성 시 API 토큰이 이 endpoint로 전송됩니다. 계속할까요?"
  );
}

async function startGeneration() {
  syncEditorsToState();
  if (hasActiveJob()) return;
  if (!generationCanStart()) {
    showToast("생성 준비가 끝나지 않았습니다. 준비 상태에서 필요한 항목을 확인해 주세요.", "warning");
    renderSetupGuide();
    return;
  }
  if (!confirmCustomEndpointTokenUse()) return;
  setProgressActive(true);
  setGenerationRunning(true);
  $("#jobLog").textContent = "생성 작업을 시작합니다...\n";
  if (currentFixedArtists().length) $("#jobLog").textContent = "고정 작가가중치로 생성 작업을 시작합니다...\n";
  liveItems = [];
  renderLiveGallery();
  try {
    const data = await request("/api/generate", {
      method: "POST",
      body: JSON.stringify({ state: generationStateForRequest() }),
    });
    activeJobs.generate = data.job_id;
    pollJob(data.job_id, jobTargets("generate"));
  } catch (error) {
    setGenerationRunning(false);
    $("#progressText").textContent = "실패";
    $("#jobLog").textContent += `시작 실패: ${error.message}\n`;
    showToast(`이미지 생성을 시작하지 못했습니다: ${error.message}`, "error");
  }
}

function jobTargets(kind) {
  if (kind === "batting") {
    return {
      kind,
      finalTab: "batting",
      gallery: "#battingLiveGallery",
      log: "#battingJobLog",
      progress: "#battingProgress",
      progressText: "#battingProgressText",
      progressCount: "#battingProgressCount",
      progressBar: "#battingProgressBar",
      stopButton: "#stopBattingButton",
    };
  }
  return {
    kind,
    finalTab: "generate",
    gallery: "#liveGallery",
    log: "#jobLog",
    progress: ".progress",
    progressText: "#progressText",
    progressCount: "#progressCount",
    progressBar: "#progressBar",
    stopButton: "#stopGenerateButton",
  };
}

async function pollJob(jobId, targets = jobTargets("generate")) {
  const data = await request(`/api/job?id=${encodeURIComponent(jobId)}`);
  const job = data.job;
  const total = job.total || 0;
  const progress = job.progress || 0;
  const terminal = ["done", "missing", "cancelled"].includes(job.status);
  const statusText = {
    done: "완료",
    missing: "작업 없음",
    cancelled: "중지됨",
    cancelling: "중지 중",
    queued: "대기 중",
    running: "생성 중",
  }[job.status] || "생성 중";
  $(targets.progressText).textContent = statusText;
  setProgressActive(!terminal && job.status !== "queued", targets.progress);
  $(targets.progressCount).textContent = `${progress} / ${total}`;
  $(targets.progressBar).style.width = total ? `${(progress / total) * 100}%` : "0%";
  $(targets.log).textContent = (job.log || []).join("\n");
  renderLiveGallery(job.items || [], targets.gallery);
  if (targets.kind === "batting") {
    activeJobs.batting = terminal ? null : jobId;
    setBattingRunning(!terminal, job.status === "cancelling");
  } else if (targets.kind === "generate") {
    activeJobs.generate = terminal ? null : jobId;
    setGenerationRunning(!terminal, job.status === "cancelling");
  }
  if (!terminal) {
    setTimeout(() => pollJob(jobId, targets), 900);
  } else {
    setProgressActive(false, targets.progress);
    if (targets.kind === "batting") {
      activeJobs.batting = null;
      setBattingRunning(false);
    } else if (targets.kind === "generate") {
      activeJobs.generate = null;
      setGenerationRunning(false);
    }
    await loadState();
    switchTab(targets.finalTab);
    showToast(job.status === "cancelled" ? "이미지 생성을 중지했습니다." : "이미지 생성이 완료됐습니다.", job.status === "cancelled" ? "warning" : "success");
  }
}

function legacyNextPairUnused() {
  return;
  const root = $("#worldcup");
  root.innerHTML = "";
  if (worldcupQueue.length === 0) return;
  if (worldcupQueue.length === 1) {
    const winner = worldcupQueue[0];
    root.innerHTML = `<article class="worldcup-card"><img src="${winner.image_url}" alt="winner" /><button class="primary-button">우승</button></article>`;
    return;
  }
  currentPair = [worldcupQueue.pop(), worldcupQueue.pop()];
  currentPair.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "worldcup-card";
    card.innerHTML = `<img src="${item.image_url}" alt="candidate" /><button class="primary-button">${index === 0 ? "왼쪽" : "오른쪽"} 선택</button>`;
    card.querySelector("img").onclick = () => openImageModal(item, worldcupPair);
    card.querySelector("button").onclick = () => {
      worldcupQueue.unshift(item);
      worldcupQueue.sort(() => Math.random() - 0.5);
      nextPair();
    };
    root.appendChild(card);
  });
}

function shuffleItems(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function updateWorldcupStatus(message = "") {
  const status = $("#worldcupStatus");
  if (!status) return;
  if (!worldcupRoundSize) {
    status.innerHTML = "";
    return;
  }
  const totalMatches = Math.max(1, Math.floor(worldcupRoundSize / 2));
  const currentMatch = Math.min(worldcupMatchNumber + 1, totalMatches);
  const roundLabel = worldcupRoundSize === 1 ? "결승 결과" : `${worldcupRoundSize}강`;
  status.innerHTML = `
    <strong>${roundLabel}</strong>
    <span>라운드 ${worldcupRoundNumber}</span>
    <span>매치 ${currentMatch} / ${totalMatches}</span>
    ${message ? `<em>${message}</em>` : ""}
  `;
}

function startWorldcup() {
  const history = state.history[historyIndex];
  const candidates = (history?.items || [])
    .map((item, index) => ({
      ...item,
      worldcup_no: index + 1,
      source_base_preset: history?.base_preset || "",
      source_character_preset: history?.character_preset || "",
      source_label: `#${index + 1}`,
    }))
    .filter((item) => item.image_url);
  worldcupRound = shuffleItems(candidates);
  worldcupNextRound = [];
  worldcupPair = [];
  worldcupRunnerUp = null;
  worldcupRoundSize = worldcupRound.length;
  worldcupRoundNumber = 1;
  worldcupMatchNumber = 0;
  nextPair();
}

function nextPair() {
  const root = $("#worldcup");
  root.innerHTML = "";
  if (!worldcupRoundSize) {
    updateWorldcupStatus();
    return;
  }
  if (worldcupRound.length === 0) {
    if (worldcupNextRound.length === 1) {
      showWorldcupWinner(worldcupNextRound[0]);
      return;
    }
    worldcupRound = shuffleItems(worldcupNextRound);
    worldcupNextRound = [];
    worldcupRoundSize = worldcupRound.length;
    worldcupRoundNumber += 1;
    worldcupMatchNumber = 0;
  }
  if (worldcupRound.length === 1) {
    worldcupNextRound.push(worldcupRound.pop());
    nextPair();
    return;
  }
  worldcupPair = [worldcupRound.pop(), worldcupRound.pop()];
  updateWorldcupStatus();
  worldcupPair.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "worldcup-card";
    card.innerHTML = `
      <div class="worldcup-card-header">
        <span class="worldcup-badge">#${item.worldcup_no}</span>
        <span>${index === 0 ? "왼쪽 후보" : "오른쪽 후보"}</span>
      </div>
      <img src="${item.image_url}" alt="candidate #${item.worldcup_no}" />
      <button class="primary-button">#${item.worldcup_no} 선택</button>
    `;
    card.querySelector("button").onclick = () => {
      if (worldcupRoundSize === 2) {
        worldcupRunnerUp = worldcupPair.find((candidate) => candidate !== item) || null;
      }
      worldcupNextRound.push(item);
      worldcupMatchNumber += 1;
      nextPair();
    };
    root.appendChild(card);
  });
}

function showWorldcupWinner(winner) {
  const root = $("#worldcup");
  worldcupRoundSize = 1;
  updateWorldcupStatus("탈락한 이미지는 다시 후보로 들어오지 않습니다.");
  const finalists = [
    { item: winner, label: "우승", className: "winner-card" },
    { item: worldcupRunnerUp, label: "준우승", className: "runner-up-card" },
  ].filter((entry) => entry.item);
  const finalistItems = finalists.map((entry) => entry.item);
  root.innerHTML = "";
  for (const entry of finalists) {
    const card = document.createElement("article");
    card.className = `worldcup-card ${entry.className}`;
    card.innerHTML = `
      <div class="worldcup-card-header">
        <span class="worldcup-badge">#${entry.item.worldcup_no}</span>
        <span>${entry.label}</span>
      </div>
      <img src="${entry.item.image_url}" alt="${entry.label} #${entry.item.worldcup_no}" />
      <button class="primary-button worldcup-load-button">가중치 불러오기</button>
    `;
    card.querySelector("img").onclick = () => openImageModal(entry.item, finalistItems);
    card.querySelector(".worldcup-load-button").onclick = () => generateFromImage(entry.item);
    root.appendChild(card);
  }
}

function addCategory() {
  syncEditorsToState();
  state.categories.push({ name: uniqueName(state.categories, "새 카테고리"), tags: [], min_weight: 0.5, max_weight: 1.2, granule: 0.1, picks: 0, learning_role: "style" });
  categoryIndex = state.categories.length - 1;
  renderArtists();
  scheduleSave();
  showToast("새 작가 카테고리를 추가했습니다.", "success");
}

function deleteCategory() {
  const category = state.categories[categoryIndex];
  if (!category) return;
  if (state.categories.length <= 1) {
    showToast("작가 카테고리는 최소 한 개 필요합니다.", "warning");
    return;
  }
  if (!window.confirm(`'${category.name}' 카테고리를 삭제할까요?`)) return;
  state.categories.splice(categoryIndex, 1);
  categoryIndex = Math.max(0, categoryIndex - 1);
  renderArtists();
  scheduleSave();
  showToast("작가 카테고리를 삭제했습니다.", "success");
}

function addBase() {
  syncEditorsToState();
  state.base_presets.push({ name: uniqueName(state.base_presets, "새 베이스"), prompt: "", quality_prompt: "" });
  baseIndex = state.base_presets.length - 1;
  rememberPreset("base", state.base_presets[baseIndex].name);
  renderPresets();
  renderGenerate();
  scheduleSave();
  showToast("새 베이스 프리셋을 추가했습니다.", "success");
}

function deleteBase() {
  const preset = state.base_presets[baseIndex];
  if (!preset) return;
  if (state.base_presets.length <= 1) {
    showToast("베이스 프리셋은 최소 한 개 필요합니다.", "warning");
    return;
  }
  if (!window.confirm(`'${preset.name}' 베이스 프리셋을 삭제할까요?`)) return;
  state.base_presets.splice(baseIndex, 1);
  baseIndex = Math.max(0, baseIndex - 1);
  renderPresets();
  renderGenerate();
  scheduleSave();
  showToast("베이스 프리셋을 삭제했습니다.", "success");
}

function addChar() {
  syncEditorsToState();
  state.character_presets.push({ name: uniqueName(state.character_presets, "새 캐릭터"), prompts: ["", "", ""], negatives: ["", "", ""] });
  charIndex = state.character_presets.length - 1;
  charSlotIndex = 0;
  rememberPreset("character", state.character_presets[charIndex].name);
  renderPresets();
  renderGenerate();
  scheduleSave();
  showToast("새 캐릭터 프리셋을 추가했습니다.", "success");
}

function deleteChar() {
  const preset = state.character_presets[charIndex];
  if (!preset) return;
  if (state.character_presets.length <= 1) {
    showToast("캐릭터 프리셋은 최소 한 개 필요합니다.", "warning");
    return;
  }
  if (!window.confirm(`'${preset.name}' 캐릭터 프리셋을 삭제할까요?`)) return;
  state.character_presets.splice(charIndex, 1);
  charIndex = Math.max(0, charIndex - 1);
  charSlotIndex = 0;
  renderPresets();
  renderGenerate();
  scheduleSave();
  showToast("캐릭터 프리셋을 삭제했습니다.", "success");
}

function bindAutosaveInputs(root = document) {
  root.querySelectorAll("input, textarea, select").forEach((node) => {
    if (node.id === "compareHistorySelect") return;
    if (node.id === "deleteFilesToggle" || node.closest("#historyList")) return;
    if (node.id === "api_token") {
      node.oninput = () => {
        setSaveState(node.value.trim() ? "새 API 토큰 입력됨" : "저장된 API 토큰 유지", node.value.trim() ? "working" : "success");
        renderSetupGuide();
        updateJobActionButtons();
      };
      node.onchange = () => {
        syncEditorsToState();
        scheduleSave();
      };
      return;
    }
    node.oninput = () => {
      syncEditorsToState();
      if (node.id === "catTags") renderRecognizedTags();
      if (["catTags", "catMin", "catMax", "catGranule", "catPicks", "catLearningRole"].includes(node.id)) renderCategoryWeightPreview();
      if (node.id === "countInput") updateJobActionButtons();
      if (["catTags", "baseName", "charName"].includes(node.id)) {
        renderSetupGuide();
        updateJobActionButtons();
      }
      if (["baseName", "charName"].includes(node.id)) {
        renderPresetSetPanel();
        fillPresetSetSelect($("#presetSetSelect"), state.generation.preset_set);
      }
      scheduleSave();
    };
    node.onchange = () => {
      syncEditorsToState();
      if (node.id === "catLearningRole") {
        renderCategoryWeightPreview();
        renderArtistLearning();
      }
      if (node.id === "presetSetSelect") {
        applyGenerationPresetSet(node.value);
        renderGenerate();
        scheduleSave();
        previewPrompt();
        return;
      }
      if (node.id === "baseSelect") rememberPreset("base", state.generation.base_preset);
      if (node.id === "charSelect") rememberPreset("character", state.generation.character_preset);
      if (node.id === "baseSelect" || node.id === "charSelect") updateGenerationPresetSetFromPair();
      scheduleSave();
      if (node.id === "mockMode") {
        renderSettings();
        renderGenerate();
        renderBatting();
        showToast(state.api.mock_mode ? "API 없이 체험 모드를 켰습니다." : "실제 NovelAI 생성 모드로 전환했습니다.", "info");
      }
      if (node.id === "baseSelect" || node.id === "charSelect" || node.id === "countInput" || node.id === "imageSizeSelect") previewPrompt();
    };
  });
}

function switchTab(tab) {
  if (state && tab === "batting") {
    syncEditorsToState();
    renderBatting();
  }
  currentTab = tab;
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $$(".tab-page").forEach((page) => page.classList.toggle("active", page.id === tab));
  $("#pageTitle").textContent = pageCopy[tab][0];
  $("#pageSubtitle").textContent = pageCopy[tab][1];
  updateJobActionButtons();
}

async function loadState() {
  const data = await request("/api/state");
  state = data.state;
  state.quality_override_prompt = state.quality_override_prompt || "";
  state.preset_sets = state.preset_sets || [];
  state.artist_rating_summary = state.artist_rating_summary || [];
  state.stability_rating_summary = state.stability_rating_summary || [];
  state.categories = (state.categories || []).map((category) => ({
    ...category,
    learning_role: category.learning_role === "stability" || (!category.learning_role && String(category.name || "").includes("안정")) ? "stability" : "style",
  }));
  state.batting_scenes = state.batting_scenes || [];
  state.generation = state.generation || {};
  state.generation.image_size = normalizeImageSizeKey(state.generation.image_size || "portrait");
  state.batting_scenes = state.batting_scenes.map((scene) => ({
    ...scene,
    preset_set: scene.preset_set || "",
    image_size: normalizeImageSizeKey(scene.image_size || state.generation.image_size),
  }));
  state.generation.preset_set = state.generation.preset_set || "";
  ensureAutoPresetSets();
  selectedHistoryIds = new Set(Array.from(selectedHistoryIds).filter((id) => state.history.some((item) => item.id === id)));
  categoryIndex = Math.min(categoryIndex, Math.max(0, state.categories.length - 1));
  baseIndex = Math.min(baseIndex, Math.max(0, state.base_presets.length - 1));
  charIndex = Math.min(charIndex, Math.max(0, state.character_presets.length - 1));
  historyIndex = Math.min(historyIndex, Math.max(0, state.history.length - 1));
  renderAll();
  bindAutosaveInputs(document);
  switchTab(currentTab);
  updateJobActionButtons();
  await previewPrompt();
  await refreshQuota({ silent: true });
  startQuotaPolling();
}

function bindEvents() {
  bindModalImageInteractions();
  $$(".nav-item").forEach((button) => button.onclick = () => switchTab(button.dataset.tab));
  $("#refreshButton").onclick = async () => {
    await loadState();
    showToast("저장된 내용을 다시 불러왔습니다.", "success");
  };
  $("#quotaRefreshButton").onclick = () => refreshQuota();
  $("#previewButton").onclick = previewPrompt;
  $("#generateButtonInline").onclick = startGeneration;
  $("#stopGenerateButton").onclick = stopGeneration;
  $("#clearFixedArtistsButton").onclick = clearFixedArtists;
  $("#addBattingSceneButton").onclick = addBattingScene;
  $("#startBattingButton").onclick = startBattingTest;
  $("#stopBattingButton").onclick = stopBattingTest;
  $("#battingLoadWeightsButton").onclick = () => {
    switchTab(state.history.length ? "history" : "generate");
    showToast(state.history.length ? "이미지 아래의 ‘가중치 불러오기’를 눌러주세요." : "먼저 이미지를 생성해 주세요.", "info");
  };
  $("#basePresetAllButton").onclick = () => openPresetPicker("base");
  $("#charPresetAllButton").onclick = () => openPresetPicker("character");
  $("#addCategoryButton").onclick = addCategory;
  $("#deleteCategoryButton").onclick = deleteCategory;
  $("#addBaseButton").onclick = addBase;
  $("#deleteBaseButton").onclick = deleteBase;
  $("#addCharButton").onclick = addChar;
  $("#deleteCharButton").onclick = deleteChar;
  $("#addPresetSetButton").onclick = addPresetSet;
  $("#resetArtistRatingsButton").onclick = resetArtistRatings;
  $("#saveSettingsButton").onclick = saveNow;
  $("#startWorldcupButton").onclick = startWorldcup;
  $("#selectAllHistoryButton").onclick = selectAllHistory;
  $("#deleteSelectedHistoryButton").onclick = deleteSelectedHistory;
  $("#clearHistoryButton").onclick = clearHistory;
  $("#modalCloseButton").onclick = closeImageModal;
  $("#imageModalBackdrop").onclick = closeImageModal;
  $("#presetPickerCloseButton").onclick = closePresetPicker;
  $("#presetPickerBackdrop").onclick = closePresetPicker;
  $("#modalGenerateButton").onclick = () => generateFromImage(modalItem);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#imageModal").hidden) closeImageModal();
    if (event.key === "Escape" && !$("#presetPickerModal").hidden) closePresetPicker();
    if (!$("#imageModal").hidden && event.key === "ArrowLeft") {
      event.preventDefault();
      navigateImageModal(-1);
    }
    if (!$("#imageModal").hidden && event.key === "ArrowRight") {
      event.preventDefault();
      navigateImageModal(1);
    }
  });
  $("#compareHistorySelect").onchange = (event) => {
    compareHistoryValue = event.target.value;
    compareSelectionTouched = true;
    renderCompare();
  };
}

bindEvents();
loadState().catch((error) => {
  console.error(error);
  setSaveState("초기화 실패");
});
