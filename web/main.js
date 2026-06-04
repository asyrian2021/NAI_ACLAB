const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let state = null;
let currentTab = "generate";
let categoryIndex = 0;
let baseIndex = 0;
let charIndex = 0;
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
let compareHistoryValue = "__all__";
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

const pageCopy = {
  generate: ["생성", "프리셋, 작가 조합, 생성 상태를 한 화면에서 조정합니다."],
  batting: ["타율 테스트", "고정 작가가중치로 여러 씬의 프리셋 조합을 비교 생성합니다."],
  artists: ["작가 태그", "카테고리별 작가 풀과 랜덤 가중치 범위를 관리합니다."],
  presets: ["프리셋", "베이스, 퀄리티, 캐릭터 프롬프트를 저장하고 조합합니다."],
  settings: ["API 설정", "NovelAI 요청 파라미터와 Undesired Content를 관리합니다."],
  compare: ["가중치 비교", "생성 이미지별 작가태그 가중치를 나란히 확인합니다."],
  history: ["히스토리", "생성 결과를 훑어보고 이상형 월드컵으로 선호 조합을 고릅니다."],
};

const apiFields = [
  ["token", "API 토큰", "password"],
  ["endpoint", "Endpoint", "text"],
  ["model", "Model", "text"],
  ["steps", "Steps", "number"],
  ["scale", "Scale", "number"],
  ["guidance_rescale", "Guidance Rescale", "number"],
  ["sampler", "Sampler", "text"],
  ["noise_schedule", "Noise Schedule", "text"],
  ["seed", "Seed (-1=random)", "number"],
];

const imageSizeOptions = {
  portrait: { label: "Normal Portrait", width: 832, height: 1216 },
  landscape: { label: "Landscape", width: 1216, height: 832 },
  square: { label: "Square", width: 1024, height: 1024 },
};

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

function setSaveState(text) {
  $("#saveState").textContent = text;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function scheduleSave() {
  setSaveState("저장 대기 중...");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 450);
}

async function saveNow() {
  if (!state) return;
  syncEditorsToState();
  try {
    const data = await request("/api/state", {
      method: "POST",
      body: JSON.stringify({ state }),
    });
    state = data.state;
    setSaveState("자동 저장됨");
  } catch (error) {
    setSaveState("저장 실패");
    console.error(error);
  }
}

function syncEditorsToState() {
  if (!state) return;
  state.generation.base_preset = $("#baseSelect").value;
  state.generation.character_preset = $("#charSelect").value;
  state.generation.count = Math.max(1, Number($("#countInput").value || 1));
  state.generation.image_size = $("#imageSizeSelect").value || "portrait";
  state.generation.fixed_artists = state.generation.fixed_artists || [];
  syncBattingScenesToState();

  const category = state.categories[categoryIndex];
  if (category) {
    category.name = $("#catName").value.trim() || "이름 없는 카테고리";
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
    updatePresetNameSurfaces("character", oldName, character.name);
    character.prompts = [0, 1, 2].map((i) => $(`#charPrompt${i}`).value.trim());
    character.negatives = [0, 1, 2].map((i) => $(`#charNegative${i}`).value.trim());
  }

  state.negative_prompt = $("#negativePrompt").value.trim();
  state.uc_prompt = $("#ucPrompt").value.trim();

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
    base_preset: row.querySelector(".batting-scene-base")?.value || "",
    character_preset: row.querySelector(".batting-scene-character")?.value || "",
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
  if (!isFixed) {
    list.innerHTML = `<p>고정된 작가태그가 없습니다.</p>`;
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
  if (!isFixed) {
    list.innerHTML = `<p>고정된 작가태그가 없습니다.</p>`;
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
  state.batting_scenes = state.batting_scenes || [];
  renderBattingFixedArtists();
  const root = $("#battingSceneList");
  if (!root) return;
  root.dataset.rendered = "true";
  root.innerHTML = "";
  if (!state.batting_scenes.length) {
    root.innerHTML = `<div class="empty-box">아직 등록된 씬이 없습니다. 씬을 추가해보세요.</div>`;
    return;
  }
  state.batting_scenes.forEach((scene, index) => {
    const row = document.createElement("article");
    row.className = "batting-scene-row";
    row.innerHTML = `
      <div class="batting-scene-number">${index + 1}</div>
      <label><span>씬 이름</span><input class="batting-scene-name" value="${escapeHtml(scene.name || `Scene ${index + 1}`)}" /></label>
      <label><span>베이스 + 퀄리티</span><select class="batting-scene-base">${selectOptionsHtml(state.base_presets, scene.base_preset)}</select></label>
      <label><span>캐릭터</span><select class="batting-scene-character">${selectOptionsHtml(state.character_presets, scene.character_preset)}</select></label>
      <label><span>생성 개수</span><input class="batting-scene-count" type="number" min="1" max="200" value="${Math.max(1, Number(scene.count || 2))}" /></label>
      <button class="icon-button batting-scene-delete" type="button" title="씬 삭제">×</button>
    `;
    row.querySelector(".batting-scene-delete").onclick = () => deleteBattingScene(index);
    row.querySelectorAll("input, select").forEach((node) => {
      node.oninput = () => {
        syncBattingScenesToState();
        scheduleSave();
      };
      node.onchange = () => {
        syncBattingScenesToState();
        scheduleSave();
      };
    });
    root.appendChild(row);
  });
}

function renderAll() {
  renderGenerate();
  renderBatting();
  renderArtists();
  renderPresets();
  renderSettings();
  renderHistory();
  renderCompare();
}

function renderGenerate() {
  state.generation.recent_base_presets = state.generation.recent_base_presets || [];
  state.generation.recent_character_presets = state.generation.recent_character_presets || [];
  state.generation.image_size = imageSizeOptions[state.generation.image_size] ? state.generation.image_size : "portrait";
  fillSelect($("#baseSelect"), state.base_presets, state.generation.base_preset);
  fillSelect($("#charSelect"), state.character_presets, state.generation.character_preset);
  fillImageSizeSelect();
  $("#countInput").value = state.generation.count || 1;
  state.generation.fixed_artists = state.generation.fixed_artists || [];
  renderFixedArtistMode();
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
  $("#catMin").value = category?.min_weight ?? "";
  $("#catMax").value = category?.max_weight ?? "";
  $("#catGranule").value = category?.granule ?? "";
  $("#catPicks").value = category?.picks > 0 ? category.picks : "";
  $("#catTags").value = (category?.tags || []).join("\n");
  renderRecognizedTags();
}

function renderPresets() {
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
  const editors = $("#characterEditors");
  editors.innerHTML = "";
  for (let i = 0; i < 3; i += 1) {
    const box = document.createElement("div");
    box.className = "character-box";
    box.innerHTML = `
      <h3>캐릭터 ${i + 1}</h3>
      <label class="text-label"><span>프롬프트</span><textarea id="charPrompt${i}" spellcheck="false"></textarea></label>
      <label class="text-label"><span>네거티브 프롬프트</span><textarea id="charNegative${i}" spellcheck="false"></textarea></label>
    `;
    editors.appendChild(box);
    $(`#charPrompt${i}`).value = character?.prompts?.[i] || "";
    $(`#charNegative${i}`).value = character?.negatives?.[i] || "";
  }
  bindAutosaveInputs(editors);
}

function renderSettings() {
  const form = $("#apiForm");
  form.innerHTML = "";
  for (const [key, label, type] of apiFields) {
    const wrap = document.createElement("label");
    wrap.innerHTML = `<span>${label}</span><input id="api_${key}" type="${type}" />`;
    form.appendChild(wrap);
    const input = $(`#api_${key}`);
    input.value = key === "token" ? "" : state.api[key] ?? "";
    if (key === "token") {
      input.placeholder = state.api.token_saved ? "저장된 토큰을 사용합니다" : "API 토큰을 입력하세요";
      input.autocomplete = "off";
    }
    if (type === "number") input.step = "any";
  }
  $("#mockMode").checked = !!state.api.mock_mode;
  $("#negativePrompt").value = state.negative_prompt || "";
  $("#ucPrompt").value = state.uc_prompt || "";
  bindAutosaveInputs(form);
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
    source_base_preset: item.source_base_preset || context.history?.base_preset || "",
    source_character_preset: item.source_character_preset || context.history?.character_preset || "",
    source_label: item.scene_name ? `${context.label || item.source_label || ""} · ${item.scene_name}` : context.label || item.source_label || "",
  };
}

function renderImageCard(item, context = {}) {
  const card = document.createElement("article");
  card.className = `image-card ${item.error ? "error" : ""}`;
  const enriched = enrichedImageItem(item, context);
  const modalList = context.modalItems || [enriched];
  card.innerHTML = `
    ${item.image_url ? `<img src="${item.image_url}" alt="generated image" />` : ""}
    <div>${item.error ? item.error : item.created_at || "생성 완료"}</div>
  `;
  const img = card.querySelector("img");
  if (img) img.onclick = () => openImageModal(enriched, modalList);
  const meta = card.querySelector("div");
  if (meta) {
    const label = meta.textContent;
    meta.className = "image-card-meta";
    meta.textContent = "";
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    meta.appendChild(labelNode);
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
  }
  return card;
}

function renderLiveGallery(items = liveItems, rootSelector = "#liveGallery") {
  if (rootSelector === "#liveGallery") liveItems = items || [];
  const root = $(rootSelector);
  if (!root) return;
  root.innerHTML = "";
  const galleryItems = items || [];
  if (!galleryItems.length) {
    root.innerHTML = `<p>아직 생성된 이미지가 없습니다.</p>`;
    return;
  }
  const modalItems = galleryItems.filter((item) => item.image_url);
  for (const item of galleryItems) {
    root.appendChild(renderImageCard(item, { modalItems }));
  }
}

function renderHistory() {
  const list = $("#historyList");
  list.innerHTML = "";
  state.history.forEach((history, index) => {
    const row = document.createElement("div");
    row.className = "history-list-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedHistoryIds.has(history.id);
    checkbox.onchange = () => {
      if (checkbox.checked) selectedHistoryIds.add(history.id);
      else selectedHistoryIds.delete(history.id);
    };
    const button = document.createElement("button");
    button.className = `list-item ${index === historyIndex ? "active" : ""}`;
    button.innerHTML = `<strong>${history.base_preset} + ${history.character_preset}</strong><br><span>${history.created_at} · ${(history.items || []).length}장</span>`;
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
    detail.innerHTML = `<p>아직 생성 히스토리가 없습니다.</p>`;
    return;
  }
  const modalItems = (history.items || [])
    .map((item, index) => enrichedImageItem(item, { history, label: `#${index + 1}` }))
    .filter((item) => item.image_url);
  (history.items || []).forEach((item, index) => {
    detail.appendChild(renderImageCard(item, { history, label: `#${index + 1}`, modalItems }));
  });
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
  compareHistoryValue = previous === "__all__" || state.history[Number(previous)] ? previous : "__all__";
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
  $("#modalPrompt").textContent = item.prompt || "";
  const artistList = $("#modalArtists");
  artistList.innerHTML = "";
  for (const row of artistWeightRows(item.artists || [])) artistList.appendChild(row);
  $("#modalGenerateButton").disabled = !canReuseArtists(item);
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
    tag: artist.tag || "",
    weight: Number(artist.weight ?? 1),
    prompt: artist.prompt || "",
  })).filter((artist) => artist.tag);
  if (item.source_base_preset) state.generation.base_preset = item.source_base_preset;
  if (item.source_character_preset) state.generation.character_preset = item.source_character_preset;
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
    base_preset: state.generation.base_preset || state.base_presets[0]?.name || "",
    character_preset: state.generation.character_preset || state.character_presets[0]?.name || "",
    count: 2,
  });
  renderBatting();
  scheduleSave();
}

function deleteBattingScene(index) {
  syncBattingScenesToState();
  state.batting_scenes.splice(index, 1);
  renderBatting();
  scheduleSave();
}

function battingStateForRequest() {
  syncBattingScenesToState();
  const requestState = generationStateForRequest();
  requestState.batting_scenes = state.batting_scenes || [];
  return requestState;
}

function setBattingRunning(running, cancelling = false) {
  const startButton = $("#startBattingButton");
  const addButton = $("#addBattingSceneButton");
  const stopButton = $("#stopBattingButton");
  if (startButton) startButton.disabled = running;
  if (addButton) addButton.disabled = running;
  if (stopButton) {
    stopButton.disabled = !running || cancelling;
    stopButton.textContent = cancelling ? "중지 중" : "생성 중지";
  }
}

async function startBattingTest() {
  syncEditorsToState();
  if (!currentFixedArtists().length) {
    window.alert("타율 테스트는 작가태그 가중치를 고정한 상태에서 실행하는 기능입니다. 먼저 히스토리나 가중치 비교에서 가중치를 불러와 주세요.");
    return;
  }
  syncBattingScenesToState();
  if (!state.batting_scenes?.length) {
    window.alert("테스트할 씬을 먼저 추가해 주세요.");
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

async function deleteSelectedHistory() {
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
  $("#ucPreview").textContent = data.uc || "";
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

async function startGeneration() {
  syncEditorsToState();
  setProgressActive(true);
  $("#jobLog").textContent = "생성 작업을 시작합니다...\n";
  if (currentFixedArtists().length) $("#jobLog").textContent = "고정 작가가중치로 생성 작업을 시작합니다...\n";
  liveItems = [];
  renderLiveGallery();
  const data = await request("/api/generate", {
    method: "POST",
    body: JSON.stringify({ state: generationStateForRequest() }),
  });
  pollJob(data.job_id, jobTargets("generate"));
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
  }
  if (!terminal) {
    setTimeout(() => pollJob(jobId, targets), 900);
  } else {
    setProgressActive(false, targets.progress);
    if (targets.kind === "batting") {
      activeJobs.batting = null;
      setBattingRunning(false);
    }
    await loadState();
    switchTab(targets.finalTab);
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
  state.categories.push({ name: uniqueName(state.categories, "새 카테고리"), tags: [], min_weight: 0.5, max_weight: 1.2, granule: 0.1, picks: 0 });
  categoryIndex = state.categories.length - 1;
  renderArtists();
  scheduleSave();
}

function deleteCategory() {
  if (!state.categories[categoryIndex]) return;
  state.categories.splice(categoryIndex, 1);
  categoryIndex = Math.max(0, categoryIndex - 1);
  renderArtists();
  scheduleSave();
}

function addBase() {
  syncEditorsToState();
  state.base_presets.push({ name: uniqueName(state.base_presets, "새 베이스"), prompt: "", quality_prompt: "" });
  baseIndex = state.base_presets.length - 1;
  rememberPreset("base", state.base_presets[baseIndex].name);
  renderPresets();
  renderGenerate();
  scheduleSave();
}

function deleteBase() {
  if (!state.base_presets[baseIndex]) return;
  state.base_presets.splice(baseIndex, 1);
  baseIndex = Math.max(0, baseIndex - 1);
  renderPresets();
  renderGenerate();
  scheduleSave();
}

function addChar() {
  syncEditorsToState();
  state.character_presets.push({ name: uniqueName(state.character_presets, "새 캐릭터"), prompts: ["", "", ""], negatives: ["", "", ""] });
  charIndex = state.character_presets.length - 1;
  rememberPreset("character", state.character_presets[charIndex].name);
  renderPresets();
  renderGenerate();
  scheduleSave();
}

function deleteChar() {
  if (!state.character_presets[charIndex]) return;
  state.character_presets.splice(charIndex, 1);
  charIndex = Math.max(0, charIndex - 1);
  renderPresets();
  renderGenerate();
  scheduleSave();
}

function bindAutosaveInputs(root = document) {
  root.querySelectorAll("input, textarea, select").forEach((node) => {
    if (node.id === "compareHistorySelect") return;
    if (node.id === "api_token") {
      node.oninput = null;
      node.onchange = () => {
        syncEditorsToState();
        scheduleSave();
      };
      return;
    }
    node.oninput = () => {
      syncEditorsToState();
      if (node.id === "catTags") renderRecognizedTags();
      scheduleSave();
    };
    node.onchange = () => {
      syncEditorsToState();
      if (node.id === "baseSelect") rememberPreset("base", state.generation.base_preset);
      if (node.id === "charSelect") rememberPreset("character", state.generation.character_preset);
      scheduleSave();
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
  $("#generateButton").hidden = tab !== "generate";
}

async function loadState() {
  const data = await request("/api/state");
  state = data.state;
  state.quality_override_prompt = state.quality_override_prompt || "";
  state.batting_scenes = state.batting_scenes || [];
  selectedHistoryIds = new Set(Array.from(selectedHistoryIds).filter((id) => state.history.some((item) => item.id === id)));
  categoryIndex = Math.min(categoryIndex, Math.max(0, state.categories.length - 1));
  baseIndex = Math.min(baseIndex, Math.max(0, state.base_presets.length - 1));
  charIndex = Math.min(charIndex, Math.max(0, state.character_presets.length - 1));
  historyIndex = Math.min(historyIndex, Math.max(0, state.history.length - 1));
  renderAll();
  bindAutosaveInputs(document);
  switchTab(currentTab);
  await previewPrompt();
}

function bindEvents() {
  bindModalImageInteractions();
  $$(".nav-item").forEach((button) => button.onclick = () => switchTab(button.dataset.tab));
  $("#refreshButton").onclick = loadState;
  $("#previewButton").onclick = previewPrompt;
  $("#generateButton").onclick = startGeneration;
  $("#generateButtonInline").onclick = startGeneration;
  $("#clearFixedArtistsButton").onclick = clearFixedArtists;
  $("#addBattingSceneButton").onclick = addBattingScene;
  $("#startBattingButton").onclick = startBattingTest;
  $("#stopBattingButton").onclick = stopBattingTest;
  $("#basePresetAllButton").onclick = () => openPresetPicker("base");
  $("#charPresetAllButton").onclick = () => openPresetPicker("character");
  $("#addCategoryButton").onclick = addCategory;
  $("#deleteCategoryButton").onclick = deleteCategory;
  $("#addBaseButton").onclick = addBase;
  $("#deleteBaseButton").onclick = deleteBase;
  $("#addCharButton").onclick = addChar;
  $("#deleteCharButton").onclick = deleteChar;
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
    renderCompare();
  };
}

bindEvents();
loadState().catch((error) => {
  console.error(error);
  setSaveState("초기화 실패");
});
