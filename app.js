import {
  STORAGE_KEY,
  CATEGORIES,
  QUEST_DISCIPLINES,
  CLASSES,
  DEFAULT_REWARDS,
  DIFFICULTIES,
  REWARD_TIERS,
  calculateHp,
  calculateMp,
  computeQuestReward,
  countQuestBonuses,
  createDemoState,
  exportState,
  formatDate,
  formatDistanceKm,
  formatHours,
  formatMinutes,
  getCyclingSummary,
  getFastingSummary,
  getLevel,
  getQuestById,
  getQuestNameMap,
  getQuestSummary,
  importState,
  loadState,
  normalizeState,
  parseDateKey,
  prerequisitesComplete,
  saveState,
  toDateKey,
  uid,
  weekRange,
  xpForLevel,
  xpIntoCurrentLevel
} from "./state.js";
import { mergeStravaRides, syncStravaRides } from "./strava.js";

const appRoot = document.querySelector("#app");
const modalRoot = document.querySelector("#modal-root");
const THEME_STORAGE_KEY = "dc-theme";

function getStoredTheme() {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}

let state = loadState();
let ui = {
  tab: "dashboard",
  disciplineTab: "cycling",
  modal: null,
  syncingStrava: false,
  toasts: [],
  theme: getStoredTheme()
};

const REWARD_WEIGHTS = [
  { tier: "common", weight: 50 },
  { tier: "uncommon", weight: 30 },
  { tier: "rare", weight: 15 },
  { tier: "epic", weight: 4 },
  { tier: "legendary", weight: 1 }
];

const QUEST_DISCIPLINE_ORDER = ["cycling", "running", "fasting", "reading", "general"];

function getQuestDisciplineKey(value) {
  return QUEST_DISCIPLINES[value] ? value : "general";
}

function getQuestDisciplineMeta(value) {
  return QUEST_DISCIPLINES[getQuestDisciplineKey(value)];
}

function compareQuestDisciplineKeys(left, right) {
  const leftIndex = QUEST_DISCIPLINE_ORDER.indexOf(getQuestDisciplineKey(left));
  const rightIndex = QUEST_DISCIPLINE_ORDER.indexOf(getQuestDisciplineKey(right));
  const normalizedLeft = leftIndex === -1 ? QUEST_DISCIPLINE_ORDER.length : leftIndex;
  const normalizedRight = rightIndex === -1 ? QUEST_DISCIPLINE_ORDER.length : rightIndex;

  return normalizedLeft - normalizedRight || getQuestDisciplineMeta(left).label.localeCompare(getQuestDisciplineMeta(right).label);
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", ui.theme);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeAttr(value) {
  return escapeHtml(String(value ?? ""));
}

function pushToast(type, message) {
  const toast = { id: uid("toast"), type, message };
  ui.toasts = [...ui.toasts, toast];
  render();
  window.setTimeout(() => {
    ui.toasts = ui.toasts.filter((item) => item.id !== toast.id);
    render();
  }, 3400);
}

function persist(options = {}) {
  state = saveState(state);
  if (!options.skipRender) render();
}

function setModal(modal) {
  ui.modal = modal;
  render();
}

function closeModal() {
  ui.modal = null;
  render();
}

function ensureRewards() {
  if (!state.rewards?.length) state.rewards = DEFAULT_REWARDS.map((reward) => ({ ...reward }));
}

function getRewardPool() {
  ensureRewards();
  return state.rewards;
}

function rollReward(quest) {
  const chance = DIFFICULTIES[quest.difficulty]?.rewardChance ?? 0.7;
  if (Math.random() > chance) return null;

  const availableRewards = getRewardPool();
  if (!availableRewards.length) return null;

  const weightedTiers = [];
  for (const entry of REWARD_WEIGHTS) {
    for (let count = 0; count < entry.weight; count += 1) weightedTiers.push(entry.tier);
  }

  const pickedTier = weightedTiers[Math.floor(Math.random() * weightedTiers.length)];
  const tierRewards = availableRewards.filter((reward) => reward.tier === pickedTier);
  const pool = tierRewards.length ? tierRewards : availableRewards;
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function createCharacter(data) {
  state.character = {
    name: data.name,
    title: data.title,
    class: data.classId,
    xp: 0,
    gold: 0,
    hp: null,
    stats: {
      vitality: 10,
      wisdom: 10,
      fortune: 10,
      charisma: 10
    }
  };
  state.character.hp = calculateHp(state.character);
  persist();
  pushToast("success", "The chronicle is open. Your campaign has begun.");
}

function questSort(left, right) {
  const weight = {
    in_progress: 0,
    available: 1,
    failed: 2,
    abandoned: 3,
    completed: 4
  };
  return (
    (weight[left.state] ?? 5) - (weight[right.state] ?? 5) ||
    new Date(left.dueDate || left.createdAt).getTime() - new Date(right.dueDate || right.createdAt).getTime()
  );
}

function addQuest(formData) {
  const bonusObjectives = ["bonusOne", "bonusTwo", "bonusThree"]
    .map((name) => String(formData.get(name) || "").trim())
    .filter(Boolean)
    .map((title) => ({ id: uid("bonus"), title, done: false }));
  const discipline = getQuestDisciplineKey(String(formData.get("discipline") || "general"));

  state.quests.push({
    id: uid("quest"),
    title: String(formData.get("title") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    category: String(formData.get("category") || "health"),
    discipline,
    difficulty: String(formData.get("difficulty") || "easy"),
    state: "available",
    dueDate: String(formData.get("dueDate") || "").trim() || null,
    recurrence: String(formData.get("recurrence") || "none"),
    chainId: String(formData.get("chainId") || "").trim(),
    prerequisiteIds: formData.getAll("prerequisiteIds").filter(Boolean),
    bonusObjectives,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    failedAt: null,
    notes: String(formData.get("notes") || "").trim()
  });

  state.quests.sort(questSort);
  persist();
  closeModal();
  pushToast("success", "Quest contract added to the journal.");
}

function updateQuestBonus(questId, bonusId, done) {
  const quest = getQuestById(state, questId);
  if (!quest) return;
  const bonus = quest.bonusObjectives.find((item) => item.id === bonusId);
  if (!bonus) return;
  bonus.done = done;
  persist();
}

function setQuestState(questId, nextState) {
  const quest = getQuestById(state, questId);
  if (!quest) return;
  if (!prerequisitesComplete(state, quest) && nextState !== "abandoned") {
    pushToast("error", "This quest is still locked by an earlier chain step.");
    return;
  }

  if (nextState === "in_progress") {
    quest.state = "in_progress";
    quest.startedAt = quest.startedAt || new Date().toISOString();
    persist();
    pushToast("info", `Quest started: ${quest.title}`);
    return;
  }

  if (nextState === "failed" || nextState === "abandoned") {
    quest.state = nextState;
    quest.failedAt = new Date().toISOString();
    if (state.character) {
      const penalty = nextState === "failed" ? 14 : 8;
      state.character.hp = Math.max(1, (state.character.hp ?? calculateHp(state.character)) - penalty);
    }
    persist();
    pushToast("error", `${quest.title} marked as ${nextState.replace("_", " ")}.`);
    return;
  }

  if (nextState !== "completed") return;

  quest.state = "completed";
  quest.completedAt = new Date().toISOString();
  const { xp, gold } = computeQuestReward(state, quest);
  const reward = rollReward(quest);
  const today = toDateKey(new Date());

  if (state.character) {
    const previousLevel = getLevel(state.character.xp);
    state.character.xp += xp;
    state.character.gold += gold;
    state.character.hp = Math.min(calculateHp(state.character), (state.character.hp ?? calculateHp(state.character)) + 4);
    const nextLevel = getLevel(state.character.xp);
    if (nextLevel > previousLevel) {
      const delta = nextLevel - previousLevel;
      state.character.stats.vitality += delta;
      state.character.stats.wisdom += delta;
      state.character.stats.fortune += delta;
      state.character.stats.charisma += delta;
      pushToast("success", `Level up. You reached level ${nextLevel}.`);
    }
  }

  state.stats.totalQuests += 1;
  state.stats.questsByCategory[quest.category] = (state.stats.questsByCategory[quest.category] || 0) + 1;
  state.stats.questsByDay[today] = (state.stats.questsByDay[today] || 0) + 1;

  if (state.stats.questLastCompletedDate === today) {
    state.stats.questDayStreakCurrent = Math.max(1, state.stats.questDayStreakCurrent);
  } else {
    const previous = state.stats.questLastCompletedDate ? parseDateKey(state.stats.questLastCompletedDate) : null;
    const diff = previous ? Math.round((parseDateKey(today).getTime() - previous.getTime()) / 86400000) : 0;
    state.stats.questDayStreakCurrent = diff === 1 ? state.stats.questDayStreakCurrent + 1 : 1;
  }

  state.stats.questLastCompletedDate = today;
  state.stats.questDayStreakLongest = Math.max(state.stats.questDayStreakLongest, state.stats.questDayStreakCurrent);

  if (reward) {
    state.rewardHistory.unshift({
      id: uid("history"),
      name: reward.name,
      tier: reward.tier,
      questTitle: quest.title,
      unlockedAt: new Date().toISOString()
    });
    pushToast("success", `Reward unlocked: ${reward.name}`);
  } else {
    pushToast("info", `${quest.title} completed for ${xp} XP and ${gold} gold.`);
  }

  if (quest.recurrence && quest.recurrence !== "none") {
    const nextDue = quest.dueDate ? new Date(quest.dueDate) : new Date();
    if (quest.recurrence === "daily") nextDue.setDate(nextDue.getDate() + 1);
    if (quest.recurrence === "weekly") nextDue.setDate(nextDue.getDate() + 7);
    if (quest.recurrence === "monthly") nextDue.setMonth(nextDue.getMonth() + 1);
    state.quests.push({
      ...quest,
      id: uid("quest"),
      state: "available",
      startedAt: null,
      completedAt: null,
      failedAt: null,
      dueDate: toDateKey(nextDue),
      bonusObjectives: quest.bonusObjectives.map((objective) => ({ ...objective, done: false })),
      createdAt: new Date().toISOString()
    });
  }

  state.quests.sort(questSort);
  persist();
}

function addManualRide(formData) {
  state.training.cycling.rides.unshift({
    id: uid("ride"),
    source: "manual",
    stravaId: "",
    name: String(formData.get("name") || "").trim() || "Manual ride",
    startAt: String(formData.get("startAt")),
    distanceKm: Number(formData.get("distanceKm") || 0),
    movingTimeMin: Number(formData.get("movingTimeMin") || 0),
    elevationM: Number(formData.get("elevationM") || 0),
    note: String(formData.get("note") || "").trim()
  });
  persist();
  closeModal();
  pushToast("success", "Ride added to the cycling ledger.");
}

function addFastLog(formData) {
  const startAt = String(formData.get("startAt"));
  const endAt = String(formData.get("endAt"));
  const hours = Math.max(0, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 36e5);
  state.training.fasting.logs.unshift({
    id: uid("fast"),
    startAt,
    endAt,
    hours,
    note: String(formData.get("note") || "").trim()
  });
  persist();
  closeModal();
  pushToast("success", "Fast logged in the ledger.");
}

function addReward(formData) {
  state.rewards.push({
    id: uid("reward"),
    name: String(formData.get("name") || "").trim(),
    tier: String(formData.get("tier") || "common"),
    cooldownDays: Number(formData.get("cooldownDays") || 0)
  });
  persist();
  closeModal();
  pushToast("success", "Reward added to the treasury.");
}

function updateRideNote(formData) {
  const rideId = String(formData.get("rideId"));
  const ride = state.training.cycling.rides.find((entry) => entry.id === rideId);
  if (!ride) return;
  ride.note = String(formData.get("note") || "").trim();
  persist();
  closeModal();
  pushToast("success", "Ride note updated.");
}

function updateFastingSettings(formData) {
  state.training.fasting.targetHours = Number(formData.get("targetHours") || 16);
  state.training.fasting.weeklyTargetDays = Number(formData.get("weeklyTargetDays") || 5);
  persist();
  pushToast("success", "Fasting targets updated.");
}

function updateCyclingSettings(formData) {
  state.training.cycling.weeklyRideTarget = Number(formData.get("weeklyRideTarget") || 3);
  state.training.cycling.weeklyDistanceTargetKm = Number(formData.get("weeklyDistanceTargetKm") || 90);
  state.training.cycling.qualifyingRideKm = Number(formData.get("qualifyingRideKm") || 20);
  state.training.cycling.qualifyingRideMinutes = Number(formData.get("qualifyingRideMinutes") || 45);
  persist();
  pushToast("success", "Cycling targets updated.");
}

function updateStravaSettings(formData) {
  state.training.cycling.strava.accessToken = String(formData.get("accessToken") || "").trim();
  state.training.cycling.strava.autoSyncEnabled = formData.get("autoSyncEnabled") === "on";
  persist();
  pushToast("success", "Strava sync settings saved.");
}

function updateQuestSettings(formData) {
  state.goals.weeklyQuestTarget = Math.max(1, Math.min(14, Math.round(Number(formData.get("weeklyQuestTarget")) || 4)));
  persist();
  pushToast("success", "Quest targets updated.");
}

function updateRunningSettings(formData) {
  state.training.running.weeklyRunTarget = Number(formData.get("weeklyRunTarget") || 4);
  state.training.running.weeklyDistanceTargetKm = Number(formData.get("weeklyDistanceTargetKm") || 40);
  state.training.running.qualifyingRunKm = Number(formData.get("qualifyingRunKm") || 3);
  state.training.running.qualifyingRunMinutes = Number(formData.get("qualifyingRunMinutes") || 20);
  persist();
  pushToast("success", "Running targets updated.");
}

function updateReadingSettings(formData) {
  state.training.reading.dailyPageTarget = Number(formData.get("dailyPageTarget") || 30);
  state.training.reading.yearlyBookTarget = Number(formData.get("yearlyBookTarget") || 12);
  state.training.reading.clubMeetingDay = String(formData.get("clubMeetingDay") || "").trim();
  persist();
  pushToast("success", "Reading targets updated.");
}

function removeReward(rewardId) {
  state.rewards = state.rewards.filter((reward) => reward.id !== rewardId);
  persist();
  pushToast("info", "Reward removed.");
}

function downloadBackup() {
  const blob = new Blob([exportState(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `discipline-chronicle-${toDateKey(new Date())}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function openImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = normalizeState(importState(String(reader.result)));
      persist();
      pushToast("success", "Chronicle imported successfully.");
    } catch (error) {
      console.error(error);
      pushToast("error", "That backup could not be imported.");
    }
  };
  reader.readAsText(file);
}

function loadDemoState() {
  state = createDemoState();
  persist();
  pushToast("success", "Demo chronicle restored.");
}

async function syncStrava(manual = true) {
  const accessToken = state.training.cycling.strava.accessToken.trim();
  if (!accessToken) {
    if (manual) pushToast("error", "Add a Strava access token in Settings before syncing.");
    return;
  }

  ui.syncingStrava = true;
  state.training.cycling.strava.lastSyncStatus = "syncing";
  render();

  try {
    const latestImportedRide = state.training.cycling.rides.find((ride) => ride.source === "strava");
    const afterEpochSeconds = latestImportedRide
      ? Math.floor(new Date(latestImportedRide.startAt).getTime() / 1000) - 86400
      : Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 90;

    const result = await syncStravaRides({ accessToken, afterEpochSeconds });
    state.training.cycling.rides = mergeStravaRides(state.training.cycling.rides, result.rides);
    state.training.cycling.strava.athleteName = result.athleteName;
    state.training.cycling.strava.lastSyncAt = new Date().toISOString();
    state.training.cycling.strava.lastSyncStatus = "success";
    state.training.cycling.strava.lastError = "";
    persist({ skipRender: true });
    if (manual) pushToast("success", `Strava synced. ${result.rides.length} ride${result.rides.length === 1 ? "" : "s"} imported.`);
  } catch (error) {
    console.error(error);
    state.training.cycling.strava.lastSyncStatus = "error";
    state.training.cycling.strava.lastError = error.message;
    persist({ skipRender: true });
    if (manual) {
      pushToast("error", "Strava sync failed. A production version should move token exchange to a backend.");
    }
  } finally {
    ui.syncingStrava = false;
    render();
  }
}

async function maybeAutoSync() {
  const strava = state.training.cycling.strava;
  if (!strava.accessToken || !strava.autoSyncEnabled) return;
  const lastSyncAge = strava.lastSyncAt ? Date.now() - new Date(strava.lastSyncAt).getTime() : Infinity;
  if (lastSyncAge > 4 * 60 * 60 * 1000) await syncStrava(false);
}

function questGroups() {
  const quests = [...state.quests].sort(questSort);
  return {
    locked: quests.filter((quest) => quest.state === "available" && !prerequisitesComplete(state, quest)),
    available: quests.filter((quest) => quest.state === "available" && prerequisitesComplete(state, quest)),
    inProgress: quests.filter((quest) => quest.state === "in_progress"),
    closed: quests.filter((quest) => ["completed", "failed", "abandoned"].includes(quest.state))
  };
}

function buildChainGroups() {
  const terminalStates = new Set(["completed", "failed", "abandoned"]);
  const groups = new Map();
  for (const quest of state.quests) {
    if (!quest.chainId) continue;
    const bucket = groups.get(quest.chainId) || [];
    bucket.push(quest);
    groups.set(quest.chainId, bucket);
  }

  return [...groups.entries()]
    .map(([chainId, quests]) => {
      const sortedQuests = quests.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
      const activeQuests = sortedQuests.filter((quest) => !terminalStates.has(quest.state));
      const disciplineSource = activeQuests.length ? activeQuests : sortedQuests;
      const disciplineCounts = new Map();

      for (const quest of disciplineSource) {
        const discipline = getQuestDisciplineKey(quest.discipline);
        disciplineCounts.set(discipline, (disciplineCounts.get(discipline) || 0) + 1);
      }

      const disciplineKeys = [...disciplineCounts.entries()]
        .sort((left, right) => right[1] - left[1] || compareQuestDisciplineKeys(left[0], right[0]))
        .map(([discipline]) => discipline);

      return {
        chainId,
        quests: sortedQuests,
        activeQuests,
        isActive: activeQuests.length > 0,
        primaryDiscipline: disciplineKeys[0] || "general",
        disciplineKeys
      };
    })
    .sort((left, right) =>
      Number(right.isActive) - Number(left.isActive) ||
      compareQuestDisciplineKeys(left.primaryDiscipline, right.primaryDiscipline) ||
      left.chainId.localeCompare(right.chainId)
    );
}

function groupActiveChainsByDiscipline(chains) {
  const grouped = new Map();

  for (const chain of chains.filter((entry) => entry.isActive)) {
    const bucket = grouped.get(chain.primaryDiscipline) || [];
    bucket.push(chain);
    grouped.set(chain.primaryDiscipline, bucket);
  }

  return [...grouped.entries()]
    .sort((left, right) => compareQuestDisciplineKeys(left[0], right[0]))
    .map(([discipline, disciplineChains]) => ({
      discipline,
      chains: disciplineChains.sort((left, right) => left.chainId.localeCompare(right.chainId))
    }));
}

function renderDisciplineChainSections(chains, emptyMessage, limitPerDiscipline = Infinity) {
  const disciplines = groupActiveChainsByDiscipline(chains);
  if (!disciplines.length) return `<div class="empty-state">${emptyMessage}</div>`;

  return disciplines.map(({ discipline, chains: disciplineChains }) => {
    const disciplineMeta = getQuestDisciplineMeta(discipline);
    const visibleChains = disciplineChains.slice(0, limitPerDiscipline);
    const hiddenCount = Math.max(0, disciplineChains.length - visibleChains.length);

    return `
      <section class="chain-group">
        <div class="detail-list chain-group-head">
          <span class="meta-chip ${disciplineMeta.colorClass}">${escapeHtml(disciplineMeta.label)}</span>
          <span class="small-meta">${disciplineChains.length} active chain${disciplineChains.length === 1 ? "" : "s"}</span>
        </div>
        <div class="chain-panel-list">
          ${visibleChains.map(renderChainCard).join("")}
        </div>
        ${hiddenCount ? `<div class="small-copy chain-group-overflow">+${hiddenCount} more in ${escapeHtml(disciplineMeta.label.toLowerCase())}</div>` : ""}
      </section>
    `;
  }).join("");
}

function isOverdue(quest) {
  if (!quest.dueDate) return false;
  if (quest.state === "completed" || quest.state === "failed" || quest.state === "abandoned") return false;
  return new Date(quest.dueDate).getTime() < new Date().setHours(0, 0, 0, 0);
}

// Arc sweeps left-to-right along the BOTTOM of the circle (opens upward, like a speedometer).
// cx,cy = centre. The arc starts at the left endpoint (cx-r, cy) and sweeps
// clockwise through the top to the right endpoint (cx+r, cy).
// sweep-flag=1 → clockwise in SVG coordinates (Y-axis points down).
function arcGaugePath(cx, cy, r, progress) {
  const clamp = Math.max(0, Math.min(100, progress));
  const angle = 180 * (clamp / 100); // degrees swept, 0→180
  // Start: left point of the diameter
  const x1 = cx - r, y1 = cy;
  // End: rotated clockwise from the left by `angle` degrees
  const rad = (angle * Math.PI) / 180;
  const x2 = (cx - r * Math.cos(rad)).toFixed(2);
  const y2 = (cy - r * Math.sin(rad)).toFixed(2); // negative because up = negative Y in SVG
  const la = angle > 180 ? 1 : 0;
  // sweep-flag=1 = clockwise
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${la} 1 ${x2} ${y2}`;
}

function getAccentVar(accentClass) {
  return {
    "accent-cyan": "var(--accent-cyan)",
    "accent-orange": "var(--accent-orange)",
    "accent-violet": "var(--accent-purple)",
    "accent-yellow": "var(--accent-yellow)"
  }[accentClass] || "var(--accent-cyan)";
}

function buildArcTicks({
  cx,
  cy,
  r,
  strokeWidth,
  totalSegments,
  filledSegments,
  outerInset,
  innerInset,
  filledColor = "var(--bg)",
  emptyColor = "var(--surface-3)",
  tickWidth = 1.2
}) {
  let ticks = "";
  for (let i = 1; i < totalSegments; i += 1) {
    const pct = (i / totalSegments) * 100;
    const ang = (pct / 100) * Math.PI;
    const ox = (cx - (r + strokeWidth / 2 + outerInset) * Math.cos(ang)).toFixed(2);
    const oy = (cy - (r + strokeWidth / 2 + outerInset) * Math.sin(ang)).toFixed(2);
    const ix = (cx - (r - strokeWidth / 2 - innerInset) * Math.cos(ang)).toFixed(2);
    const iy = (cy - (r - strokeWidth / 2 - innerInset) * Math.sin(ang)).toFixed(2);
    const tickColor = i <= filledSegments ? filledColor : emptyColor;
    ticks += `<line x1="${ox}" y1="${oy}" x2="${ix}" y2="${iy}" stroke="${tickColor}" stroke-width="${tickWidth}" stroke-linecap="round"/>`;
  }
  return ticks;
}

function renderSummaryCard({ label, value, note, ringValue, ringUnit = "", progress = 0, accentClass = "accent-cyan" }) {
  const clamped = Math.max(0, Math.min(progress, 100));
  const cx = 40, cy = 36, r = 28, tw = 5;
  const accentVar = getAccentVar(accentClass);
  const totalSegs = 5;
  const filledCount = Math.max(0, Math.min(totalSegs, Math.round((clamped / 100) * totalSegs)));
  const ticks = buildArcTicks({
    cx,
    cy,
    r,
    strokeWidth: tw,
    totalSegments: totalSegs,
    filledSegments: filledCount,
    outerInset: 2,
    innerInset: 2,
    filledColor: "var(--bg)",
    emptyColor: "var(--surface-3)",
    tickWidth: 1
  });

  return `
    <article class="summary-card arc-summary-card ${accentClass}" style="--arc-accent:${accentVar}">
      <div class="arc-mini-wrap">
        <svg viewBox="0 0 80 42" aria-hidden="true" class="arc-mini-svg">
          <path d="${arcGaugePath(cx, cy, r, 100)}" fill="none" stroke="var(--border)" stroke-width="${tw}" stroke-linecap="round"/>
          ${clamped > 0 ? `<path d="${arcGaugePath(cx, cy, r, clamped)}" fill="none" stroke="${accentVar}" stroke-width="${tw}" stroke-linecap="round" class="arc-fill"/>` : ""}
          ${ticks}
          <circle cx="${cx - r}" cy="${cy}" r="1.8" fill="var(--border-2)"/>
          <circle cx="${cx + r}" cy="${cy}" r="1.8" fill="var(--border-2)"/>
          <text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="${accentVar}" font-family="var(--font-mono)" font-size="13" font-weight="600" letter-spacing="-0.03em">${escapeHtml(String(ringValue))}</text>
          ${ringUnit ? `<text x="${cx}" y="${cy + 2}" text-anchor="middle" fill="var(--text-3)" font-family="var(--font-mono)" font-size="5.5" letter-spacing="0.12em">${escapeHtml(ringUnit.toUpperCase())}</text>` : ""}
        </svg>
      </div>
      <div class="stat-text">
        <div class="summary-label">${escapeHtml(label)}</div>
        <div class="summary-value">${escapeHtml(value)}</div>
        <div class="summary-note">${escapeHtml(note)}</div>
      </div>
    </article>
  `;
}

function renderThemeIcon(theme) {
  if (theme === "dark") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"></circle>
        <path d="M12 2.5v2.5"></path>
        <path d="M12 19v2.5"></path>
        <path d="m4.93 4.93 1.77 1.77"></path>
        <path d="m17.3 17.3 1.77 1.77"></path>
        <path d="M2.5 12H5"></path>
        <path d="M19 12h2.5"></path>
        <path d="m4.93 19.07 1.77-1.77"></path>
        <path d="m17.3 6.7 1.77-1.77"></path>
      </svg>`;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.5 14.5A6.5 6.5 0 0 1 10 6a7.5 7.5 0 1 0 7.5 8.5Z" fill="currentColor" stroke="none"></path>
      <path d="M16.5 4.5v2"></path>
      <path d="M15.5 5.5h2"></path>
    </svg>`;
}

function renderTopbar() {
  const characterName = state.character?.name || "New Hunter";
  const characterRole = state.character
    ? state.character.title || CLASSES[state.character.class].name
    : "Open the Chronicle";
  const level = state.character ? getLevel(state.character.xp) : 1;

  return `
    <header class="topbar">
      <div class="topbar-left">
        <div class="logo-mark">DC</div>
        <div class="topbar-title">
          <span class="topbar-eyebrow">Hunter Protocol</span>
          <span class="topbar-name">Cadence</span>
        </div>
      </div>
      <div class="topbar-right">
        ${!state.character ? `
        <button class="theme-toggle" type="button" data-action="toggle-theme" title="Toggle theme">
          ${renderThemeIcon(ui.theme)}
        </button>
        ` : ""}
        ${state.character ? `
        <div class="profile-chip profile-chip-compact">
          <div class="avatar">${escapeHtml(characterName.slice(0, 2).toUpperCase())}</div>
          <div class="profile-info">
            <span class="profile-sub">Level ${level} | ${escapeHtml(characterRole)}</span>
            <div class="topbar-xp-bar">
              <div class="topbar-xp-fill" style="width:${state.character ? Math.min(100, Math.round((xpIntoCurrentLevel(state.character.xp) / Math.max(xpForLevel(getLevel(state.character.xp)), 1)) * 100)) : 0}%"></div>
            </div>
          </div>
        </div>
        ` : ""}
      </div>
    </header>
  `;
}

function renderMetricsStrip() {
  const cyclingSummary = getCyclingSummary(state);
  const fastingSummary = getFastingSummary(state);
  const questSummary = getQuestSummary(state);
  const resetInfo = getWeeklyResetState();
  const level = getLevel(state.character.xp);
  const xpIn = xpIntoCurrentLevel(state.character.xp);
  const xpNeeded = xpForLevel(level);
  const xpPct = Math.round((xpIn / Math.max(xpNeeded, 1)) * 100);
  const ridePct = Math.min(
    100,
    Math.round(
      (cyclingSummary.currentWeek.distanceKm / Math.max(state.training.cycling.weeklyDistanceTargetKm, 1)) * 100
    )
  );
  const fastPct = Math.min(
    100,
    Math.round(
      (fastingSummary.currentWeek.completedDays / Math.max(fastingSummary.currentWeek.targetDays, 1)) * 100
    )
  );
  const totalQuests = Math.max(questSummary.total || 1, 1);
  const activeQuests = questSummary.inProgress + questSummary.available;
  const questPct = Math.min(100, Math.round((activeQuests / totalQuests) * 100));
  const levelPct = Math.min(100, xpPct);

  const disciplines = state.disciplines || {};
  const weekStartMs = (() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return d.getTime(); })();
  const weekRuns = (state.training.running.runs || []).filter(r => new Date(r.startAt).getTime() >= weekStartMs);
  const weekRunKm = weekRuns.reduce((s, r) => s + r.distanceKm, 0);
  const runTarget = Math.max(state.training.running.weeklyDistanceTargetKm || 40, 1);
  const runPct = Math.min(100, Math.round((weekRunKm / runTarget) * 100));
  const currentBook = (state.training.reading.books || []).find(b => !b.finishedAt);
  const readPct = currentBook ? Math.min(100, Math.round((currentBook.currentPage / Math.max(currentBook.totalPages, 1)) * 100)) : 0;

  return `
    <section class="metrics-strip">
      <div class="mchip mchip-level">
        <div class="mchip-inner">
          <span class="mchip-key">LVL</span><span class="mchip-sep">/</span><span class="mchip-val mchip-red">${level}</span>
          <span class="mchip-note">${escapeHtml(CLASSES[state.character.class].name)}</span>
        </div>
        <div class="mchip-bar-track"><div class="mchip-bar mchip-bar-red" style="width:${levelPct}%"></div></div>
      </div>
      <div class="mchip mchip-xp">
        <div class="mchip-inner">
          <span class="mchip-key">XP</span><span class="mchip-sep">/</span><span class="mchip-val mchip-cyan">${xpIn} / ${xpNeeded}</span>
          <span class="mchip-note">${xpPct}% to next</span>
        </div>
        <div class="mchip-bar-track"><div class="mchip-bar mchip-bar-cyan" style="width:${xpPct}%"></div></div>
      </div>
      ${disciplines.cycling !== false ? `
      <div class="mchip mchip-ride">
        <div class="mchip-inner">
          <span class="mchip-key">RIDE</span><span class="mchip-sep">/</span><span class="mchip-val mchip-amber">${cyclingSummary.currentWeek.distanceKm.toFixed(1)} km</span>
          <span class="mchip-note">${cyclingSummary.currentWeek.targetMet ? "target met" : `${cyclingSummary.currentWeek.distanceRemainingKm.toFixed(1)} km left`}</span>
        </div>
        <div class="mchip-bar-track"><div class="mchip-bar mchip-bar-amber" style="width:${ridePct}%"></div></div>
      </div>` : ""}
      ${disciplines.running ? `
      <div class="mchip mchip-run">
        <div class="mchip-inner">
          <span class="mchip-key">RUN</span><span class="mchip-sep">/</span><span class="mchip-val mchip-amber">${weekRunKm.toFixed(1)} km</span>
          <span class="mchip-note">${runPct >= 100 ? "target met" : `${(runTarget - weekRunKm).toFixed(1)} km left`}</span>
        </div>
        <div class="mchip-bar-track"><div class="mchip-bar mchip-bar-run" style="width:${runPct}%"></div></div>
      </div>` : ""}
      ${disciplines.fasting !== false ? `
      <div class="mchip mchip-fast">
        <div class="mchip-inner">
          <span class="mchip-key">FAST</span><span class="mchip-sep">/</span><span class="mchip-val mchip-violet">${fastingSummary.currentWeek.completedDays}/${fastingSummary.currentWeek.targetDays} days</span>
          <span class="mchip-note">${fastingSummary.currentWeek.targetMet ? "target met" : `${fastingSummary.currentWeek.targetDays - fastingSummary.currentWeek.completedDays} remaining`}</span>
        </div>
        <div class="mchip-bar-track"><div class="mchip-bar mchip-bar-violet" style="width:${fastPct}%"></div></div>
      </div>` : ""}
      ${disciplines.reading ? `
      <div class="mchip mchip-read">
        <div class="mchip-inner">
          <span class="mchip-key">READ</span><span class="mchip-sep">/</span><span class="mchip-val mchip-red">${currentBook ? `p.${currentBook.currentPage}` : "no book"}</span>
          <span class="mchip-note">${currentBook ? `${readPct}% through` : "add a book"}</span>
        </div>
        <div class="mchip-bar-track"><div class="mchip-bar mchip-bar-red" style="width:${readPct}%"></div></div>
      </div>` : ""}
      <div class="mchip mchip-quests">
        <div class="mchip-inner">
          <span class="mchip-key">GOALS</span><span class="mchip-sep">/</span><span class="mchip-val mchip-green">${activeQuests} active</span>
          <span class="mchip-note">${questSummary.overdue ? `${questSummary.overdue} overdue` : "board clear"}</span>
        </div>
        <div class="mchip-bar-track"><div class="mchip-bar mchip-bar-green" style="width:${questPct}%"></div></div>
      </div>
      <div class="mchip mchip-reset">
        <div class="mchip-inner">
          <span class="mchip-key">RESET</span><span class="mchip-sep">/</span><span class="mchip-val mchip-cyan">${resetInfo.countdown}</span>
          <span class="mchip-note">${resetInfo.detail}</span>
        </div>
        <div class="mchip-bar-track"><div class="mchip-bar mchip-bar-cyan" style="width:100%"></div></div>
      </div>
    </section>
  `;
}

function renderTopStats() {
  const questSummary = getQuestSummary(state);
  const cyclingSummary = getCyclingSummary(state);
  const fastingSummary = getFastingSummary(state);
  const level = state.character ? getLevel(state.character.xp) : 1;
  const activeQuests = questSummary.available + questSummary.inProgress;
  const rideTarget = Math.max(state.training.cycling.weeklyRideTarget, 1);
  const fastTarget = Math.max(fastingSummary.currentWeek.targetDays, 1);
  const questGoal = getWeeklyQuestGoalData();
  const rideProgress = Math.round((cyclingSummary.currentWeek.rideCount / rideTarget) * 100);
  const fastProgress = Math.round((fastingSummary.currentWeek.completedDays / fastTarget) * 100);
  const questProgress = Math.round((activeQuests / Math.max(questSummary.total || activeQuests || 1, 1)) * 100);
  const levelProgress = Math.round((xpIntoCurrentLevel(state.character?.xp || 0) / Math.max(xpForLevel(level), 1)) * 100);

  return `
    <article class="page panel system-status-card">
      <div class="panel-header">
        <span class="panel-title">System Status</span>
      </div>
      <div class="panel-body system-status-body">
        <section class="stats-grid">
          ${renderSummaryCard({
            label: "Level",
            value: CLASSES[state.character.class].name,
            note: `${state.character.name} the ${CLASSES[state.character.class].name}`,
            ringValue: String(level),
            ringUnit: "lvl",
            progress: levelProgress,
            accentClass: "accent-cyan"
          })}
          ${renderSummaryCard({
            label: "Active Quests",
            value: `${activeQuests} active`,
            note: `${questSummary.locked} locked in chains`,
            ringValue: String(activeQuests),
            ringUnit: "open",
            progress: questProgress,
            accentClass: "accent-orange"
          })}
          ${renderSummaryCard({
            label: "Ride Streak",
            value: `${cyclingSummary.dayStreak.current} days`,
            note: `${cyclingSummary.weekStreak.current} winning week chain`,
            ringValue: `${cyclingSummary.dayStreak.current}d`,
            progress: rideProgress,
            accentClass: "accent-yellow"
          })}
          ${renderSummaryCard({
            label: "Fast Streak",
            value: `${fastingSummary.streak.current} days`,
            note: `${fastingSummary.currentWeek.completedDays}/${fastingSummary.currentWeek.targetDays} this week`,
            ringValue: `${fastingSummary.streak.current}d`,
            progress: fastProgress,
            accentClass: "accent-violet"
          })}
        </section>
        <section class="system-goals-section">
          <div class="system-goals-head">
            <div>
              <div class="panel-title">Goal Progress</div>
              <div class="small-copy">Each block maps to one target unit for the week.</div>
            </div>
          </div>
          <div class="goal-progress-grid system-goals-grid">
            ${renderGoalProgressCard({
              label: "Cycling",
              value: `${cyclingSummary.currentWeek.rideCount}/${rideTarget} rides`,
              note: `${formatDistanceKm(cyclingSummary.currentWeek.distanceKm)} this week`,
              progress: rideProgress,
              segments: rideTarget,
              filledSegments: cyclingSummary.currentWeek.rideCount,
              accentClass: "accent-cyan"
            })}
            ${renderGoalProgressCard({
              label: "Fasting",
              value: `${fastingSummary.currentWeek.completedDays}/${fastTarget} days`,
              note: `${state.training.fasting.targetHours} hr target window`,
              progress: fastProgress,
              segments: fastTarget,
              filledSegments: fastingSummary.currentWeek.completedDays,
              accentClass: "accent-orange"
            })}
            ${renderGoalProgressCard({
              label: "Quests",
              value: `${questGoal.completed}/${questGoal.target} sealed`,
              note: `${activeQuests} active on board`,
              progress: questGoal.progress,
              segments: questGoal.target,
              filledSegments: questGoal.completed,
              accentClass: "accent-violet"
            })}
          </div>
        </section>
      </div>
    </article>
  `;
}

function renderChainCard(chain) {
  const completed = chain.quests.filter((quest) => quest.state === "completed").length;
  const current = (chain.activeQuests || chain.quests).find((quest) => prerequisitesComplete(state, quest));
  const chainPct = Math.round((completed / Math.max(chain.quests.length, 1)) * 100);
  const disciplineChips = (chain.disciplineKeys?.length ? chain.disciplineKeys : [chain.primaryDiscipline || "general"]).map((disciplineKey) => {
    const discipline = getQuestDisciplineMeta(disciplineKey);
    return `<span class="meta-chip ${discipline.colorClass}">${escapeHtml(discipline.label)}</span>`;
  }).join("");
  const stepSegments = chain.quests.map((quest) => {
    if (quest.state === "completed") return `<div class="chain-step-seg chain-seg-done" title="${escapeHtml(quest.title)}"></div>`;
    if (quest.state === "in_progress") return `<div class="chain-step-seg chain-seg-active" title="${escapeHtml(quest.title)}"></div>`;
    if (quest.state === "failed" || quest.state === "abandoned") return `<div class="chain-step-seg chain-seg-failed" title="${escapeHtml(quest.title)}"></div>`;
    return `<div class="chain-step-seg chain-seg-todo" title="${escapeHtml(quest.title)}"></div>`;
  }).join("");
  return `
    <article class="chain-card" style="margin-top:10px">
      <div class="quest-head">
        <div>
          <div class="quest-meta">${disciplineChips}</div>
          <h4>${escapeHtml(chain.chainId)}</h4>
          <p class="chain-copy">${completed}/${chain.quests.length} steps complete${current ? ` | Next: ${escapeHtml(current.title)}` : " | All steps closed"}</p>
        </div>
        <span class="meta-chip">${chainPct}%</span>
      </div>
      <div class="chain-step-bar">${stepSegments}</div>
      <div class="inline-list" style="margin-top:6px;">
        ${chain.quests.map((quest) => `<span class="state-pill ${quest.state}">${escapeHtml(quest.title)}</span>`).join("")}
      </div>
    </article>
  `;
}

function buildActivityFeed() {
  const questEvents = state.quests
    .filter((quest) => quest.completedAt || quest.failedAt)
    .map((quest) => ({
      id: `quest-${quest.id}`,
      date: quest.completedAt || quest.failedAt || quest.createdAt,
      label: quest.state === "completed" ? "Quest sealed" : "Quest closed",
      title: quest.title,
      meta: quest.state === "completed" ? "Completion recorded" : quest.state.replace("_", " ")
    }));

  const rideEvents = state.training.cycling.rides.map((ride) => ({
    id: `ride-${ride.id}`,
    date: ride.startAt,
    label: "Ride logged",
    title: ride.name,
    meta: `${formatDistanceKm(ride.distanceKm)} • ${Math.round(ride.movingTimeMin)} min`
  }));

  const fastEvents = state.training.fasting.logs.map((log) => ({
    id: `fast-${log.id}`,
    date: log.endAt || log.startAt,
    label: "Fast logged",
    title: `${Number(log.hours).toFixed(log.hours % 1 ? 1 : 0)} hr fast`,
    meta: log.note || "Manual fasting entry"
  }));

  const rewardEvents = state.rewardHistory.map((item) => ({
    id: `reward-${item.id}`,
    date: item.unlockedAt,
    label: "Reward unlocked",
    title: item.name,
    meta: item.questTitle
  }));

  return [...questEvents, ...rideEvents, ...fastEvents, ...rewardEvents]
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, 6);
}

function renderActivityPanel() {
  const events = buildActivityFeed();

  return `
    <article class="page">
      <div class="page-title-row">
        <div>
          <p class="page-kicker">Recent Activity</p>
          <h2 class="page-title">Live Feed</h2>
          <p class="page-copy">A quick ledger of what moved recently so the week never feels abstract.</p>
        </div>
      </div>
      <div class="activity-list">
        ${
          events.length
            ? events.map((event) => `
              <article class="activity-item">
                <div>
                  <div class="activity-label">${escapeHtml(event.label)}</div>
                  <div class="activity-title">${escapeHtml(event.title)}</div>
                  <div class="activity-meta">${escapeHtml(event.meta)}</div>
                </div>
                <time class="activity-time">${escapeHtml(formatDate(event.date, { day: "numeric", month: "short" }))}</time>
              </article>`).join("")
            : `<div class="empty-state">No recent activity yet. The first completed action will show up here.</div>`
        }
      </div>
    </article>
  `;
}

function getWeeklyResetState(now = new Date()) {
  const { start, end } = weekRange(now);
  const resetAt = new Date(end);
  resetAt.setDate(resetAt.getDate() + 1);
  resetAt.setHours(0, 0, 0, 0);

  const totalMinutes = Math.max(0, Math.floor((resetAt.getTime() - now.getTime()) / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  return {
    start,
    end,
    resetAt,
    countdown: days ? `${days}d ${hours}h ${minutes}m` : hours ? `${hours}h ${minutes}m` : `${minutes}m`,
    detail: `Resets ${formatDate(resetAt, { weekday: "short", day: "numeric", month: "short" })} at 00:00`
  };
}

function renderFocusPanel(chains, cyclingSummary, fastingSummary) {
  const nextQuest = [...state.quests]
    .filter((quest) => !["completed", "failed", "abandoned"].includes(quest.state))
    .sort((left, right) => new Date(left.dueDate || left.createdAt).getTime() - new Date(right.dueDate || right.createdAt).getTime())[0];
  const activeChains = chains.filter((chain) => chain.isActive);
  const currentChain = activeChains.find((chain) => chain.activeQuests.some((quest) => prerequisitesComplete(state, quest))) || activeChains[0];
  const currentStep = currentChain?.activeQuests.find((quest) => prerequisitesComplete(state, quest));
  const rideRemaining = Math.max(0, state.training.cycling.weeklyRideTarget - cyclingSummary.currentWeek.rideCount);
  const fastRemaining = Math.max(0, state.training.fasting.weeklyTargetDays - fastingSummary.currentWeek.completedDays);

  const items = [
    {
      label: "Next deadline",
      value: nextQuest ? nextQuest.title : "No active deadlines",
      meta: nextQuest?.dueDate ? `Due ${formatDate(nextQuest.dueDate, { day: "numeric", month: "short" })}` : "Clear board"
    },
    {
      label: "Next chain step",
      value: currentStep ? currentStep.title : "No active chain step",
      meta: currentChain ? currentChain.chainId : "Start a campaign"
    },
    {
      label: "Ride target",
      value: rideRemaining ? `${rideRemaining} rides left` : "Ride target met",
      meta: `${cyclingSummary.currentWeek.distanceKm.toFixed(1)} km this week`
    },
    {
      label: "Fasting target",
      value: fastRemaining ? `${fastRemaining} days left` : "Fasting target met",
      meta: `${state.training.fasting.targetHours} hr target window`
    }
  ];

  return `
    <article class="page">
      <div class="page-title-row">
        <div>
          <p class="page-kicker">Focus</p>
          <h2 class="page-title">Active Goals</h2>
          <p class="page-copy">The next few moves worth protecting before the week gets noisy.</p>
        </div>
      </div>
      <div class="focus-list">
        ${items.map((item) => `
          <article class="focus-item">
            <div class="focus-label">${escapeHtml(item.label)}</div>
            <div class="focus-value">${escapeHtml(item.value)}</div>
            <div class="focus-meta">${escapeHtml(item.meta)}</div>
          </article>`).join("")}
      </div>
    </article>
  `;
}

function renderChainPanel(chains) {
  const activeChainCount = chains.filter((chain) => chain.isActive).length;

  return `
    <article class="page">
      <div class="page-title-row">
        <div>
          <p class="page-kicker">Goal Series</p>
          <h2 class="page-title">Active Chains</h2>
          <p class="page-copy">Multi-step plans stay visible here, grouped by discipline so the bigger picture is easier to scan.</p>
        </div>
      </div>
      <div class="section-stack chain-panel-list">
        ${renderDisciplineChainSections(chains, "Add a chain name to quests when you want multi-step campaigns.", 2)}
        ${activeChainCount > 4 ? `<div class="small-copy">Showing up to 2 chains per discipline.</div>` : ""}
      </div>
    </article>
  `;
}


function renderOverview() {
  const cyclingSummary = getCyclingSummary(state);
  const fastingSummary = getFastingSummary(state);
  const questSummary = getQuestSummary(state);
  const chains = buildChainGroups();
  const activeChainCount = chains.filter((chain) => chain.isActive).length;
  const level = getLevel(state.character.xp);
  const xpIntoLevel = xpIntoCurrentLevel(state.character.xp);
  const xpNeeded = xpForLevel(level);
  const xpPercent = Math.min(100, Math.round((xpIntoLevel / xpNeeded) * 100));

  return `
    ${renderTopStats()}
    <section class="page-spread overview-primary">
      <div class="overview-stack">
      <article class="page panel">
        <div class="panel-header">
          <span class="panel-title">Combat Record</span>
          <span class="panel-badge">Level ${level}</span>
        </div>
        <div class="panel-body">
          <div>
            <div class="char-name">${escapeHtml(state.character.name)}</div>
            <div class="char-class">${escapeHtml(state.character.title || "No title chosen yet")} · ${escapeHtml(CLASSES[state.character.class].bonus)}</div>
          </div>
          <div class="xp-row">
            <span class="xp-label">Experience · ${xpPercent}% to Level ${level + 1}</span>
            <span class="xp-val">${xpIntoLevel} <span>/ ${xpNeeded}</span></span>
            <div class="progress-shell"><div class="progress-fill" style="width:${xpPercent}%"></div></div>
          </div>
          <div class="metric-grid">
            <div class="card">
              <div class="summary-label">Health</div>
              <div class="summary-value">${calculateHp(state.character)}</div>
              <div class="small-copy">HP pool</div>
            </div>
            <div class="card">
              <div class="summary-label">Focus</div>
              <div class="summary-value">${calculateMp(state.character)}</div>
              <div class="small-copy">MP pool</div>
            </div>
            <div class="card">
              <div class="summary-label">Gold</div>
              <div class="summary-value">${state.character.gold}</div>
              <div class="small-copy">Treasury</div>
            </div>
            <div class="card">
              <div class="summary-label">Goal Streak</div>
              <div class="summary-value">${state.stats.questDayStreakCurrent}</div>
              <div class="small-copy" style="display:flex;flex-direction:column;gap:3px;">
                <span>Best ${state.stats.questDayStreakLongest} days</span>
                <div class="progress-shell" style="margin-top:2px;"><div class="progress-fill" style="width:${Math.min(100, Math.round((state.stats.questDayStreakCurrent / Math.max(state.stats.questDayStreakLongest || 1, 1)) * 100))}%;background:var(--green);"></div></div>
              </div>
            </div>
          </div>
        </div>
      </article>
      ${renderFocusPanel(chains, cyclingSummary, fastingSummary)}
      </div>
      <article class="page panel">
        <div class="panel-header">
          <span class="panel-title">Active Chains</span>
          <span class="panel-badge">${activeChainCount} chain${activeChainCount === 1 ? "" : "s"}</span>
        </div>
        <div class="panel-body">
          ${renderDisciplineChainSections(chains, "No active chains yet. Give related goals the same chain name to group them.", 2)}
        </div>
      </article>
    </section>
  `;
}

function renderQuestCard(quest) {
  const unlocked = prerequisitesComplete(state, quest);
  const questNames = getQuestNameMap(state);
  const completedBonuses = countQuestBonuses(quest);
  const reward = computeQuestReward(state, quest);
  const disciplineMeta = quest.discipline && quest.discipline !== "general" ? getQuestDisciplineMeta(quest.discipline) : null;

  return `
    <article class="quest-card">
      <div class="quest-head">
        <div>
          <div class="quest-meta">
            ${disciplineMeta ? `<span class="meta-chip ${disciplineMeta.colorClass}">${escapeHtml(disciplineMeta.label)}</span>` : ""}
            <span class="meta-chip ${CATEGORIES[quest.category].colorClass}">${escapeHtml(CATEGORIES[quest.category].label)}</span>
            <span class="meta-chip">${escapeHtml(DIFFICULTIES[quest.difficulty].label)}</span>
            ${quest.chainId ? `<span class="meta-chip">Chain ${escapeHtml(quest.chainId)}</span>` : ""}
          </div>
          <h3 class="quest-title">${escapeHtml(quest.title)}</h3>
          <p class="quest-desc">${escapeHtml(quest.description || quest.notes || "No flavour text recorded.")}</p>
        </div>
        <div>
          ${isOverdue(quest) ? `<div class="wax-badge overdue">Overdue</div>` : ""}
          <div class="state-pill ${unlocked ? quest.state : "locked"}" style="margin-top:${isOverdue(quest) ? "10px" : "0"}">${unlocked ? quest.state.replace("_", " ") : "locked"}</div>
        </div>
      </div>
      <div class="detail-list">
        <span class="small-meta">Reward ${reward.xp} XP · ${reward.gold} gold</span>
        ${quest.dueDate ? `<span class="small-meta">Due ${escapeHtml(formatDate(quest.dueDate))}</span>` : ""}
        ${quest.recurrence && quest.recurrence !== "none" ? `<span class="small-meta">Recurs ${escapeHtml(quest.recurrence)}</span>` : ""}
      </div>
      ${
        quest.prerequisiteIds.length
          ? `<div class="note-strip" style="margin-top:12px">Prerequisites: ${quest.prerequisiteIds
              .map((prerequisiteId) => escapeHtml(questNames.get(prerequisiteId) || "Unknown quest"))
              .join(", ")}</div>`
          : ""
      }
      ${
        quest.bonusObjectives.length
          ? `<div class="bonus-list">
              ${quest.bonusObjectives
                .map(
                  (bonus) => `
                    <div class="bonus-row">
                      <input
                        type="checkbox"
                        data-bonus-toggle="true"
                        data-quest-id="${safeAttr(quest.id)}"
                        data-bonus-id="${safeAttr(bonus.id)}"
                        ${bonus.done ? "checked" : ""}
                        ${["completed", "failed", "abandoned"].includes(quest.state) ? "disabled" : ""}
                      >
                      <label>${escapeHtml(bonus.title)}</label>
                    </div>`
                )
                .join("")}
              <div class="small-copy">${completedBonuses} bonus objective${completedBonuses === 1 ? "" : "s"} currently secured.</div>
            </div>`
          : ""
      }
      <div class="quest-actions">
        ${quest.state === "available" && unlocked ? `<button class="primary-button" data-action="start-quest" data-id="${safeAttr(quest.id)}">Start quest</button>` : ""}
        ${quest.state === "in_progress" ? `<button class="primary-button" data-action="complete-quest" data-id="${safeAttr(quest.id)}">Seal completion</button>` : ""}
        ${quest.state === "in_progress" ? `<button class="danger-button" data-action="fail-quest" data-id="${safeAttr(quest.id)}">Mark failed</button>` : ""}
        ${quest.state === "available" || quest.state === "in_progress" ? `<button class="ghost-button" data-action="abandon-quest" data-id="${safeAttr(quest.id)}">Abandon</button>` : ""}
      </div>
    </article>
  `;
}

function renderQuests() {
  const groups = questGroups();
  const chainGroups = buildChainGroups();

  return `
    <section class="page-spread">
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Quest Board</p>
            <h2 class="page-title">Contracts and Chains</h2>
            <p class="page-copy">Available quests stay unlocked only when their chain prerequisites are fulfilled.</p>
          </div>
          <button class="primary-button" data-action="open-modal" data-modal="quest">New quest</button>
        </div>
        <div class="section-stack">
          <div>
            <div class="section-label">In Progress</div>
            ${groups.inProgress.length ? groups.inProgress.map(renderQuestCard).join("") : `<div class="empty-state">No quests are currently underway.</div>`}
          </div>
          <div>
            <div class="section-label">Available</div>
            ${groups.available.length ? groups.available.map(renderQuestCard).join("") : `<div class="empty-state">No unlocked quests waiting right now.</div>`}
          </div>
          <div>
            <div class="section-label">Locked</div>
            ${groups.locked.length ? groups.locked.map(renderQuestCard).join("") : `<div class="empty-state">No chain steps are locked.</div>`}
          </div>
        </div>
      </article>
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Quest Ledger</p>
            <h2 class="page-title">Chains and History</h2>
            <p class="page-copy">Chain context, bonus objective progress, and the full record of closed contracts.</p>
          </div>
        </div>
        <div class="section-stack">
          <div class="card">
            <div class="section-label">Active Chains by Discipline</div>
            ${renderDisciplineChainSections(chainGroups, "Create a quest chain by giving related quests the same chain name.")}
          </div>
          <div class="card">
            <div class="section-label">History</div>
            <div class="log-list">
              ${
                groups.closed.length
                  ? groups.closed
                      .sort((left, right) => {
                        const leftDate = new Date(left.completedAt || left.failedAt || left.createdAt).getTime();
                        const rightDate = new Date(right.completedAt || right.failedAt || right.createdAt).getTime();
                        return rightDate - leftDate;
                      })
                      .map((quest) => `
                        <article class="log-card">
                          <div class="log-head">
                            <div>
                              <h4>${escapeHtml(quest.title)}</h4>
                              <p class="log-copy">${escapeHtml(DIFFICULTIES[quest.difficulty].label)} · ${escapeHtml(CATEGORIES[quest.category].label)}</p>
                            </div>
                            <span class="state-pill ${quest.state}">${escapeHtml(quest.state.replace("_", " "))}</span>
                          </div>
                          <div class="small-copy">${escapeHtml(formatDate(quest.completedAt || quest.failedAt || quest.createdAt, { day: "numeric", month: "short", year: "numeric" }))}</div>
                        </article>`)
                      .join("")
                  : `<div class="empty-state">Completed, failed, and abandoned quests will settle here.</div>`
              }
            </div>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderCyclingPanel(summary) {
  const strava = state.training.cycling.strava;
  const dayStreakProgress = Math.min(100, Math.round((summary.dayStreak.current / Math.max(summary.dayStreak.longest || 1, 1)) * 100));
  const weekStreakProgress = Math.min(100, Math.round((summary.weekStreak.current / Math.max(summary.weekStreak.longest || 1, 1)) * 100));
  const weeklyRideProgress = Math.min(100, Math.round((summary.currentWeek.rideCount / Math.max(state.training.cycling.weeklyRideTarget, 1)) * 100));
  const weeklyDistanceProgress = Math.min(100, Math.round((summary.currentWeek.distanceKm / Math.max(state.training.cycling.weeklyDistanceTargetKm, 1)) * 100));

  return `
    <article class="page">
      <div class="page-title-row">
        <div>
          <p class="page-kicker">Cycling Campaign</p>
          <h2 class="page-title">Ride Ledger</h2>
          <p class="page-copy">This section is centered around real rides, not vague intention. Strava can feed the ledger; notes keep the story honest.</p>
        </div>
        <div class="quest-actions">
          <button class="secondary-button" data-action="sync-strava" ${ui.syncingStrava ? "disabled" : ""}>${ui.syncingStrava ? "Syncing..." : "Sync Strava"}</button>
          <button class="primary-button" data-action="open-modal" data-modal="ride">Log manual ride</button>
        </div>
      </div>
      <div class="section-stack">
        <div class="metric-grid ring-metric-grid">
          ${renderSummaryCard({
            label: "Ride Day Streak",
            value: `${summary.dayStreak.current} days`,
            note: `Longest ${summary.dayStreak.longest} days`,
            ringValue: `${summary.dayStreak.current}d`,
            progress: dayStreakProgress,
            accentClass: "accent-cyan"
          })}
          ${renderSummaryCard({
            label: "Winning Week Streak",
            value: `${summary.weekStreak.current} weeks`,
            note: `Longest ${summary.weekStreak.longest} weeks`,
            ringValue: `${summary.weekStreak.current}w`,
            progress: weekStreakProgress,
            accentClass: "accent-violet"
          })}
          ${renderSummaryCard({
            label: "Weekly Ride Count",
            value: `${summary.currentWeek.rideCount}/${state.training.cycling.weeklyRideTarget}`,
            note: `${summary.currentWeek.ridesRemaining} rides remaining`,
            ringValue: `${summary.currentWeek.rideCount}`,
            ringUnit: "rides",
            progress: weeklyRideProgress,
            accentClass: "accent-orange"
          })}
          ${renderSummaryCard({
            label: "Weekly Distance",
            value: `${summary.currentWeek.distanceKm.toFixed(1)} km`,
            note: `${summary.currentWeek.distanceRemainingKm.toFixed(1)} km to target`,
            ringValue: `${Math.round(summary.currentWeek.distanceKm)}`,
            ringUnit: "km",
            progress: weeklyDistanceProgress,
            accentClass: "accent-yellow"
          })}
        </div>
        <div class="training-card">
          <div class="training-head">
            <div>
              <div class="section-label">Strava Status</div>
              <h4>${escapeHtml(strava.athleteName || "No athlete profile synced yet")}</h4>
            </div>
            <span class="state-pill ${strava.lastSyncStatus === "error" ? "failed" : strava.lastSyncStatus === "success" ? "completed" : "available"}">${escapeHtml(strava.lastSyncStatus)}</span>
          </div>
          <p class="training-copy">Last sync: ${escapeHtml(strava.lastSyncAt ? formatDate(strava.lastSyncAt, { day: "numeric", month: "short", year: "numeric" }) : "never")}${strava.lastError ? ` — ${escapeHtml(strava.lastError)}` : ""}</p>
        </div>
        <div class="card">
          <div class="section-label">Recent Rides</div>
          <div class="ride-list">
            ${
              summary.rides.length
                ? summary.rides
                    .slice(0, 10)
                    .map((ride) => `
                      <article class="training-card">
                        <div class="training-head">
                          <div>
                            <h4>${escapeHtml(ride.name)}</h4>
                            <p class="training-copy">${escapeHtml(formatDate(ride.startAt, { weekday: "short", day: "numeric", month: "short" }))} · ${formatDistanceKm(ride.distanceKm)} · ${formatMinutes(ride.movingTimeMin)}</p>
                          </div>
                          <span class="meta-chip">${escapeHtml(ride.source)}</span>
                        </div>
                        <div class="small-copy">${escapeHtml(ride.note || "No note recorded yet.")}</div>
                        <div class="training-actions">
                          <button class="ghost-button" data-action="open-modal" data-modal="ride-note" data-id="${safeAttr(ride.id)}">Add note</button>
                        </div>
                      </article>`)
                    .join("")
                : `<div class="empty-state">No rides logged yet. Sync Strava or add a manual ride to start the cycling streak engine.</div>`
            }
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderFastingPanel(summary) {
  const lastFastHours = summary.lastFast ? summary.lastFast.hours : 0;
  const streakProgress = Math.min(100, Math.round((summary.streak.current / Math.max(summary.streak.longest || 1, 1)) * 100));
  const targetWindowProgress = Math.min(100, Math.round((lastFastHours / Math.max(state.training.fasting.targetHours, 1)) * 100));
  const weeklyFastProgress = Math.min(100, Math.round((summary.currentWeek.completedDays / Math.max(summary.currentWeek.targetDays, 1)) * 100));
  const lastFastProgress = Math.min(100, Math.round((lastFastHours / 24) * 100));

  return `
    <article class="page">
      <div class="page-title-row">
        <div>
          <p class="page-kicker">Fasting Discipline</p>
          <h2 class="page-title">Fasting Ledger</h2>
          <p class="page-copy">For now the fasting side is manual by design. The important thing is the streak logic, weekly targets, and the notes that explain the day.</p>
        </div>
        <button class="primary-button" data-action="open-modal" data-modal="fast">Log fast</button>
      </div>
      <div class="section-stack">
        <div class="metric-grid ring-metric-grid fasting-tiles">
          ${renderSummaryCard({
            label: "Current Streak",
            value: `${summary.streak.current} days`,
            note: `Longest ${summary.streak.longest} days`,
            ringValue: `${summary.streak.current}d`,
            progress: streakProgress,
            accentClass: "accent-violet"
          })}
          ${renderSummaryCard({
            label: "Target Window",
            value: `${state.training.fasting.targetHours} hr threshold`,
            note: summary.lastFast ? `Last fast reached ${Math.round(targetWindowProgress)}% of target` : "Qualifying window for streak credit",
            ringValue: `${state.training.fasting.targetHours}`,
            ringUnit: "hrs",
            progress: targetWindowProgress,
            accentClass: "accent-orange"
          })}
          ${renderSummaryCard({
            label: "Weekly Fast Days",
            value: `${summary.currentWeek.completedDays}/${summary.currentWeek.targetDays}`,
            note: summary.currentWeek.targetMet ? "Weekly target met" : "Still building the week",
            ringValue: `${summary.currentWeek.completedDays}`,
            ringUnit: "days",
            progress: weeklyFastProgress,
            accentClass: "accent-cyan"
          })}
          ${renderSummaryCard({
            label: "Last Fast",
            value: `${lastFastHours.toFixed(1)} hr`,
            note: summary.lastFast ? formatDate(summary.lastFast.endAt, { day: "numeric", month: "short" }) : "No log yet",
            ringValue: summary.lastFast ? `${Math.round(lastFastHours)}` : "0",
            ringUnit: "hrs",
            progress: lastFastProgress,
            accentClass: "accent-yellow"
          })}
        </div>
        <div class="card fasting-table-card">
          <div class="section-label">Fasting Ledger</div>
          ${
            summary.logs.length
              ? `<div class="table-wrap">
                  <table class="data-table fasting-table">
                    <thead>
                      <tr>
                        <th>Window</th>
                        <th>Hours</th>
                        <th>Status</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${summary.logs
                        .slice(0, 10)
                        .map((log) => `
                          <tr>
                            <td>${escapeHtml(formatDate(log.startAt, { day: "numeric", month: "short" }))} to ${escapeHtml(formatDate(log.endAt, { day: "numeric", month: "short" }))}</td>
                            <td>${escapeHtml(formatHours(log.hours))}</td>
                            <td>${log.hours >= state.training.fasting.targetHours ? "Qualified" : "Below target"}</td>
                            <td>${escapeHtml(log.note || "No note recorded yet.")}</td>
                          </tr>`)
                        .join("")}
                    </tbody>
                  </table>
                </div>`
              : `<div class="empty-state">No fasts logged yet. Record the first one and let the streak begin.</div>`
          }
        </div>
      </div>
    </article>
  `;
}

function renderRewards() {
  return `
    <section class="page-spread">
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Reward Treasury</p>
            <h2 class="page-title">Your Spoils</h2>
            <p class="page-copy">Rewards earned through completed quests. Add what actually motivates you.</p>
          </div>
          <button class="primary-button" data-action="open-modal" data-modal="reward">Add reward</button>
        </div>
        <div class="reward-list">
          ${
            state.rewards.length
              ? state.rewards.map((reward) => `
                <article class="reward-card">
                  <div class="reward-head">
                    <div>
                      <h4>${escapeHtml(reward.name)}</h4>
                      <p class="reward-copy">${escapeHtml(reward.tier)} tier · ${reward.cooldownDays} day cooldown</p>
                    </div>
                    <div class="reward-actions">
                      <span class="reward-pill meta-chip">${escapeHtml(reward.tier)}</span>
                      <button class="ghost-button" data-action="remove-reward" data-id="${safeAttr(reward.id)}">Remove</button>
                    </div>
                  </div>
                </article>`)
              .join("")
              : `<div class="empty-state">No rewards registered yet.</div>`
          }
        </div>
      </article>
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Reward History</p>
            <h2 class="page-title">Unlocked Moments</h2>
            <p class="page-copy">Rewards unlocked through completed quests.</p>
          </div>
        </div>
        <div class="log-list">
          ${
            state.rewardHistory.length
              ? state.rewardHistory.slice(0, 12).map((item) => `
                <article class="log-card">
                  <div class="log-head">
                    <div>
                      <h4>${escapeHtml(item.name)}</h4>
                      <p class="log-copy">${escapeHtml(item.questTitle)}</p>
                    </div>
                    <span class="reward-pill meta-chip">${escapeHtml(item.tier)}</span>
                  </div>
                  <div class="small-copy">${escapeHtml(formatDate(item.unlockedAt, { day: "numeric", month: "short", year: "numeric" }))}</div>
                </article>`)
              .join("")
              : `<div class="empty-state">Rewards you unlock from quests will be written here.</div>`
          }
        </div>
      </article>
    </section>
  `;
}

function renderSettings() {
  const strava = state.training.cycling.strava;
  const disc = state.disciplines || {};
  return `
    <section class="page-spread">
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Connections, Disciplines and Targets</p>
            <h2 class="page-title">Operational Settings</h2>
            <p class="page-copy">These settings shape the streak logic, weekly thresholds, and how cycling data enters the journal.</p>
          </div>
        </div>
        <div class="settings-grid">
          <form class="settings-card form-shell" data-form="strava-settings">
            <div class="section-label">Strava Sync</div>
            <div class="small-copy">Paste a Strava access token to pull rides automatically into the cycling ledger.</div>
            <div>
              <label class="form-label" for="accessToken">Access token</label>
              <input class="text-input token-field" id="accessToken" name="accessToken" type="password" value="${safeAttr(strava.accessToken)}" autocomplete="off">
            </div>
            <label class="check-row">
              <input type="checkbox" name="autoSyncEnabled" ${strava.autoSyncEnabled ? "checked" : ""}>
              <span>Auto-sync on load when the last sync is stale.</span>
            </label>
            <div class="settings-actions">
              <button class="primary-button" type="submit">Save</button>
              <button class="secondary-button" type="button" data-action="sync-strava" ${ui.syncingStrava ? "disabled" : ""}>${ui.syncingStrava ? "Syncing..." : "Sync now"}</button>
            </div>
          </form>
          <form class="settings-card form-shell" data-form="cycling-settings">
            <div class="section-label">Cycling thresholds</div>
            <div class="field-grid two">
              <div>
                <label class="form-label" for="weeklyRideTarget">Weekly ride target</label>
                <input class="text-input" id="weeklyRideTarget" name="weeklyRideTarget" type="number" min="1" max="14" value="${state.training.cycling.weeklyRideTarget}">
              </div>
              <div>
                <label class="form-label" for="weeklyDistanceTargetKm">Weekly distance target (km)</label>
                <input class="text-input" id="weeklyDistanceTargetKm" name="weeklyDistanceTargetKm" type="number" min="1" max="1000" value="${state.training.cycling.weeklyDistanceTargetKm}">
              </div>
              <div>
                <label class="form-label" for="qualifyingRideKm">Qualifying ride distance (km)</label>
                <input class="text-input" id="qualifyingRideKm" name="qualifyingRideKm" type="number" min="1" max="300" value="${state.training.cycling.qualifyingRideKm}">
              </div>
              <div>
                <label class="form-label" for="qualifyingRideMinutes">Qualifying ride duration (min)</label>
                <input class="text-input" id="qualifyingRideMinutes" name="qualifyingRideMinutes" type="number" min="1" max="1440" value="${state.training.cycling.qualifyingRideMinutes}">
              </div>
            </div>
            <div class="settings-actions">
              <button class="primary-button" type="submit">Save cycling targets</button>
            </div>
          </form>
          <form class="settings-card form-shell" data-form="fasting-settings">
            <div class="section-label">Fasting thresholds</div>
            <div class="field-grid two">
              <div>
                <label class="form-label" for="targetHours">Target hours</label>
                <input class="text-input" id="targetHours" name="targetHours" type="number" min="8" max="36" step="0.5" value="${state.training.fasting.targetHours}">
              </div>
              <div>
                <label class="form-label" for="weeklyTargetDays">Weekly target days</label>
                <input class="text-input" id="weeklyTargetDays" name="weeklyTargetDays" type="number" min="1" max="7" value="${state.training.fasting.weeklyTargetDays}">
              </div>
            </div>
            <div class="settings-actions">
              <button class="primary-button" type="submit">Save fasting targets</button>
            </div>
          </form>
          <form class="settings-card form-shell" data-form="quest-settings">
            <div class="section-label">Quest thresholds</div>
            <div class="small-copy">This sets how many completed quests divide the weekly quest progress bar.</div>
            <div class="field-grid">
              <div>
                <label class="form-label" for="weeklyQuestTarget">Weekly quest target</label>
                <input class="text-input" id="weeklyQuestTarget" name="weeklyQuestTarget" type="number" min="1" max="14" value="${state.goals.weeklyQuestTarget}">
              </div>
            </div>
            <div class="settings-actions">
              <button class="primary-button" type="submit">Save quest targets</button>
            </div>
          </form>
          <div class="settings-card form-shell">
            <div class="section-label">Disciplines</div>
            <div class="small-copy">Enable or disable tracking modules. Disabled disciplines hide from nav and metrics strip.</div>
            <div class="field-grid" style="gap:6px;margin-top:4px;">
              ${[["cycling","Cycling","Strava sync · ride streak · weekly km"],["running","Running","Strava sync · run streak · weekly km"],["fasting","Fasting","Manual logs · streak · weekly targets"],["reading","Reading","Book tracker · reading streak · club dates"]].map(([key, label, desc]) => {
                const isEnabled = key === "cycling" || key === "fasting" ? disc[key] !== false : Boolean(disc[key]);
                return `<label class="check-row" style="align-items:center;">
                  <input type="checkbox" data-discipline-toggle="${escapeHtml(key)}" ${isEnabled ? "checked" : ""}>
                  <span><strong>${escapeHtml(label)}</strong> — ${escapeHtml(desc)}</span>
                </label>`;
              }).join("")}
            </div>
          </div>
          ${disc.running ? `
          <form class="settings-card form-shell" data-form="running-settings">
            <div class="section-label">Running thresholds</div>
            <div class="field-grid two">
              <div>
                <label class="form-label" for="weeklyRunTarget">Weekly run target</label>
                <input class="text-input" id="weeklyRunTarget" name="weeklyRunTarget" type="number" min="1" max="14" value="${state.training.running.weeklyRunTarget}">
              </div>
              <div>
                <label class="form-label" for="weeklyRunDistanceTarget">Weekly distance target (km)</label>
                <input class="text-input" id="weeklyRunDistanceTarget" name="weeklyDistanceTargetKm" type="number" min="1" max="500" value="${state.training.running.weeklyDistanceTargetKm}">
              </div>
              <div>
                <label class="form-label" for="qualifyingRunKm">Qualifying run distance (km)</label>
                <input class="text-input" id="qualifyingRunKm" name="qualifyingRunKm" type="number" min="0.5" max="100" step="0.5" value="${state.training.running.qualifyingRunKm}">
              </div>
              <div>
                <label class="form-label" for="qualifyingRunMinutes">Qualifying run duration (min)</label>
                <input class="text-input" id="qualifyingRunMinutes" name="qualifyingRunMinutes" type="number" min="1" max="600" value="${state.training.running.qualifyingRunMinutes}">
              </div>
            </div>
            <div class="settings-actions">
              <button class="primary-button" type="submit">Save running targets</button>
            </div>
          </form>` : ""}
          ${disc.reading ? `
          <form class="settings-card form-shell" data-form="reading-settings">
            <div class="section-label">Reading targets</div>
            <div class="field-grid two">
              <div>
                <label class="form-label" for="dailyPageTarget">Daily page target</label>
                <input class="text-input" id="dailyPageTarget" name="dailyPageTarget" type="number" min="1" max="500" value="${state.training.reading.dailyPageTarget}">
              </div>
              <div>
                <label class="form-label" for="yearlyBookTarget">Yearly book target</label>
                <input class="text-input" id="yearlyBookTarget" name="yearlyBookTarget" type="number" min="1" max="200" value="${state.training.reading.yearlyBookTarget}">
              </div>
              <div>
                <label class="form-label" for="clubMeetingDay">Club meeting day</label>
                <input class="text-input" id="clubMeetingDay" name="clubMeetingDay" placeholder="e.g. Friday" value="${safeAttr(state.training.reading.clubMeetingDay || "")}">
              </div>
            </div>
            <div class="settings-actions">
              <button class="primary-button" type="submit">Save reading targets</button>
            </div>
          </form>` : ""}
          <div class="settings-card form-shell">
            <div class="section-label">Backup</div>
            <div class="small-copy">Export the full chronicle as JSON or import a previous backup.</div>
            <div class="settings-actions">
              <button class="primary-button" type="button" data-action="export-state">Export backup</button>
              <button class="ghost-button" type="button" data-action="load-demo-state">Load demo</button>
              <label class="secondary-button" style="display:inline-flex;align-items:center;justify-content:center">
                Import backup
                <input type="file" data-action="import-state" accept="application/json" style="display:none">
              </label>
            </div>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderSidebarIcon(kind) {
  const icons = {
    dashboard: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="6" height="6"></rect>
        <rect x="14" y="4" width="6" height="6"></rect>
        <rect x="4" y="14" width="6" height="6"></rect>
        <rect x="14" y="14" width="6" height="6"></rect>
      </svg>`,
    goals: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 4h8a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"></path>
        <path d="M9.5 8.5h5"></path>
        <path d="m9.5 13 1.5 1.5 3.5-3.5"></path>
        <path d="M9.5 17.5h5"></path>
      </svg>`,
    disciplines: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6.5" cy="17.5" r="3.5"></circle>
        <circle cx="17.5" cy="17.5" r="3.5"></circle>
        <path d="M10 17.5 13 10h4"></path>
        <path d="m14 10 3.5 7.5"></path>
        <path d="M8.25 10H11"></path>
        <path d="M13 10 10 17.5"></path>
      </svg>`,
    journal: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h16v16H4z"></path>
        <path d="M8 8h8"></path>
        <path d="M8 12h8"></path>
        <path d="M8 16h5"></path>
      </svg>`,
    settings: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 6h14"></path>
        <circle cx="9" cy="6" r="2"></circle>
        <path d="M5 12h14"></path>
        <circle cx="15" cy="12" r="2"></circle>
        <path d="M5 18h14"></path>
        <circle cx="11" cy="18" r="2"></circle>
      </svg>`
  };

  return icons[kind] || "";
}

function renderTabs() {
  const tabs = [
    ["dashboard", "Dashboard", "Weekly snapshot", "dashboard"],
    ["goals", "Goals", "Tasks and series", "goals"],
    ["disciplines", "Disciplines", "Cycling, running, fasting, reading", "disciplines"],
    ["journal", "Journal", "Full activity history", "journal"],
    ["settings", "Settings", "Thresholds, sync, and modules", "settings"]
  ];

  return `
    <nav class="sidebar" aria-label="Primary">
      <div class="sidebar-brand">
        <div class="sidebar-brand-mark">DC</div>
        <div class="sidebar-brand-copy">
          <span class="sidebar-eyebrow">Cadence</span>
          <span class="sidebar-title">Discipline Chronicle</span>
        </div>
      </div>
      <div class="sidebar-section-label">Navigate</div>
      <div class="sidebar-nav">
      ${tabs.map(([key, label, description, icon]) => `
        <button
          class="nav-btn ${ui.tab === key ? "active" : ""}"
          type="button"
          data-tab="${key}"
          title="${escapeHtml(label)}"
          aria-label="${escapeHtml(label)}"
        >
          <span class="nav-btn-icon">${renderSidebarIcon(icon)}</span>
          <span class="nav-btn-copy">
            <span class="nav-btn-label">${escapeHtml(label)}</span>
            <span class="nav-btn-desc">${escapeHtml(description)}</span>
          </span>
        </button>`).join("")}
      </div>
    </nav>
  `;
}

function renderShellHeader() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";

  function getContextualTagline() {
    if (ui.tab === "disciplines") {
      const dt = ui.disciplineTab;
      if (dt === "cycling") {
        const s = getCyclingSummary(state);
        if (s.currentWeek.targetMet) return `Ride target met this week. ${s.dayStreak.current > 1 ? `${s.dayStreak.current}-day streak running.` : ""}`;
        return `${s.currentWeek.ridesRemaining} ride${s.currentWeek.ridesRemaining === 1 ? "" : "s"} left to hit the weekly target. ${s.currentWeek.distanceRemainingKm.toFixed(1)} km to go.`;
      }
      if (dt === "running") {
        const runs = state.training.running.runs || [];
        const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekRuns = runs.filter(r => new Date(r.startAt) >= weekStart);
        const remaining = Math.max(0, state.training.running.weeklyRunTarget - weekRuns.length);
        return remaining ? `${remaining} run${remaining === 1 ? "" : "s"} left this week.` : "Run target met this week.";
      }
      if (dt === "fasting") {
        const s = getFastingSummary(state);
        if (s.currentWeek.targetMet) return `Fasting target met this week. ${s.streak.current > 1 ? `${s.streak.current}-day streak active.` : ""}`;
        return `${s.currentWeek.targetDays - s.currentWeek.completedDays} fast${s.currentWeek.targetDays - s.currentWeek.completedDays === 1 ? "" : "s"} remaining this week.`;
      }
      if (dt === "reading") {
        const currentBook = (state.training.reading.books || []).find(b => !b.finishedAt);
        return currentBook ? `Reading ${escapeHtml(currentBook.title)} · p.${currentBook.currentPage} of ${currentBook.totalPages}` : "No book in progress. Add one to start tracking.";
      }
    }
    if (ui.tab === "goals") {
      const s = getQuestSummary(state);
      if (s.overdue) return `${s.overdue} overdue goal${s.overdue === 1 ? "" : "s"} need attention. ${s.inProgress} in progress.`;
      return `${s.inProgress} goal${s.inProgress === 1 ? "" : "s"} in progress. ${s.available} available to start.`;
    }
    if (ui.tab === "journal") return "Your full activity log — every ride, fast, read, and goal in one place.";
    if (ui.tab === "settings") return "Adjust thresholds, disciplines, and sync rules.";
    // dashboard
    const questSummary = getQuestSummary(state);
    if (questSummary.overdue) return `${questSummary.overdue} overdue goal${questSummary.overdue === 1 ? "" : "s"} on the board. Deal with those first.`;
    const riding = getCyclingSummary(state);
    if (!riding.currentWeek.targetMet) return `${riding.currentWeek.ridesRemaining} ride${riding.currentWeek.ridesRemaining === 1 ? "" : "s"} left this week. ${riding.currentWeek.distanceKm.toFixed(1)} km logged so far.`;
    return `Weekly targets on track. ${questSummary.inProgress} goal${questSummary.inProgress === 1 ? "" : "s"} in progress.`;
  }

  return `
    <section class="header-band">
      <div>
        <p class="greeting">${greeting}</p>
        <h1 class="welcome">Welcome back, <span>${escapeHtml(state.character.name)}</span></h1>
        <p class="tagline">${escapeHtml(getContextualTagline())}</p>
      </div>
      <div class="header-actions">
        <button class="theme-toggle" type="button" data-action="toggle-theme" title="Toggle theme">
          ${renderThemeIcon(ui.theme)}
        </button>
        <button class="btn btn-primary" type="button" data-action="open-modal" data-modal="${ui.tab === "disciplines" && ui.disciplineTab === "cycling" ? "ride" : ui.tab === "disciplines" && ui.disciplineTab === "running" ? "run" : ui.tab === "disciplines" && ui.disciplineTab === "fasting" ? "fast" : ui.tab === "disciplines" && ui.disciplineTab === "reading" ? "book" : "quest"}">
          ${ui.tab === "disciplines" && ui.disciplineTab === "cycling" ? "Log ride" : ui.tab === "disciplines" && ui.disciplineTab === "running" ? "Log run" : ui.tab === "disciplines" && ui.disciplineTab === "fasting" ? "Log fast" : ui.tab === "disciplines" && ui.disciplineTab === "reading" ? "Add book" : "New goal"}
        </button>
      </div>
    </section>
  `;
}

function renderGoalStatusCard({ label, value, note, ringValue, ringUnit = "", progress = 0, accentClass = "accent-cyan" }) {
  return renderSummaryCard({ label, value, note, ringValue, ringUnit, progress, accentClass })
    .replace("summary-card arc-summary-card", "summary-card arc-summary-card goal-status-card");
}

function getWeeklyQuestGoalData() {
  const { start, end } = weekRange(new Date());
  const startTime = start.getTime();
  const endTime = end.getTime();
  const completed = Object.entries(state.stats?.questsByDay || {}).reduce((sum, [dateKey, count]) => {
    const time = parseDateKey(dateKey).getTime();
    if (time < startTime || time > endTime) return sum;
    return sum + Number(count || 0);
  }, 0);
  const target = Math.max(1, Number(state.goals?.weeklyQuestTarget || 4));

  return {
    completed,
    target,
    progress: Math.min(100, Math.round((completed / target) * 100))
  };
}

function renderGoalProgressCard({ label, value, note, progress = 0, segments = 1, filledSegments = 0, accentClass = "accent-cyan" }) {
  const clamped = Math.max(0, Math.min(progress, 100));
  const totalSegs = Math.max(1, Math.round(Number(segments) || 1));
  const filledCount = Math.max(0, Math.min(totalSegs, Math.round(Number(filledSegments) || 0)));
  const accentVar = getAccentVar(accentClass);

  const vcx = 60, vcy = 56, vr = 40, vtw = 7;
  const vticks = buildArcTicks({
    cx: vcx,
    cy: vcy,
    r: vr,
    strokeWidth: vtw,
    totalSegments: totalSegs,
    filledSegments: filledCount,
    outerInset: 2,
    innerInset: 2,
    filledColor: "var(--bg)",
    emptyColor: "var(--surface-3)",
    tickWidth: 1.2
  });

  return `
    <article class="arc-goal-card ${accentClass}" style="--arc-accent:${accentVar}">
      <div class="arc-gauge-wrap">
        <svg viewBox="0 0 120 62" class="arc-gauge-svg" aria-hidden="true">
          <path d="${arcGaugePath(vcx, vcy, vr, 100)}" fill="none" stroke="var(--border)" stroke-width="${vtw}" stroke-linecap="round"/>
          ${clamped > 0 ? `<path d="${arcGaugePath(vcx, vcy, vr, clamped)}" fill="none" stroke="${accentVar}" stroke-width="${vtw}" stroke-linecap="round" class="arc-fill"/>` : ""}
          ${vticks}
          <circle cx="${vcx - vr}" cy="${vcy}" r="2.5" fill="var(--border-2)"/>
          <circle cx="${vcx + vr}" cy="${vcy}" r="2.5" fill="var(--border-2)"/>
          <text x="${vcx}" y="${vcy - 14}" text-anchor="middle" fill="${accentVar}" font-family="var(--font-mono)" font-size="14" font-weight="600" letter-spacing="-0.03em">${clamped}%</text>
          <text x="${vcx}" y="${vcy - 3}" text-anchor="middle" fill="var(--text-3)" font-family="var(--font-mono)" font-size="5.5" letter-spacing="0.12em">${escapeHtml(label.toUpperCase())}</text>
        </svg>
      </div>
      <div class="arc-goal-meta">
        <div class="arc-goal-value">${escapeHtml(value)}</div>
        <div class="arc-goal-note">${escapeHtml(note)}</div>
      </div>
    </article>
  `;
}

function getDueSoonQuests() {
  return [...state.quests]
    .filter((quest) => quest.dueDate && !["completed", "failed", "abandoned"].includes(quest.state))
    .sort((left, right) => new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime())
    .slice(0, 4);
}

function renderScheduledPanel() {
  const dueSoon = getDueSoonQuests();

  return `
    <article class="page panel scheduled-panel">
      <div class="panel-header">
        <span class="panel-title">Scheduled</span>
      </div>
      <div class="panel-body rail-schedule-list">
        ${
          dueSoon.length
            ? dueSoon.map((quest) => `
              <article class="chain-card scheduled-chain-card">
                <div class="quest-head">
                  <div class="scheduled-chain-copy">
                    <h4 class="sched-text">${escapeHtml(quest.title)}</h4>
                    <p class="chain-copy">Due ${escapeHtml(formatDate(quest.dueDate, { day: "numeric", month: "short", year: "numeric" }))}</p>
                    <div class="sched-status">${escapeHtml(quest.state.replace("_", " "))}</div>
                  </div>
                  <div class="sched-date scheduled-chain-date">
                    <div class="sched-day">${escapeHtml(new Date(quest.dueDate).toLocaleDateString("en-US", { day: "numeric" }))}</div>
                    <div class="sched-month">${escapeHtml(new Date(quest.dueDate).toLocaleDateString("en-US", { month: "short" }))}</div>
                  </div>
                </div>
              </article>`).join("")
            : `<div class="empty-state">No upcoming due dates.</div>`
        }
      </div>
    </article>
  `;
}

function renderOnboarding() {
  return `
    <section class="page-spread single">
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Open the Chronicle</p>
            <h2 class="page-title">Create Your Character</h2>
            <p class="page-copy">This journal tracks real work. Set your name, choose the class bonus you want, and begin the campaign.</p>
          </div>
        </div>
        <form class="form-shell" data-form="onboarding" style="max-width:760px">
          <div class="field-grid two">
            <div>
              <label class="form-label" for="characterName">Name</label>
              <input class="text-input" id="characterName" name="name" required placeholder="Your name">
            </div>
            <div>
              <label class="form-label" for="characterTitle">Title</label>
              <input class="text-input" id="characterTitle" name="title" placeholder="Optional title">
            </div>
          </div>
          <div>
            <label class="form-label" for="characterClass">Class</label>
            <select class="select-input" id="characterClass" name="classId">
              ${Object.entries(CLASSES).map(([key, value]) => `<option value="${key}">${escapeHtml(value.name)} · ${escapeHtml(value.bonus)}</option>`).join("")}
            </select>
          </div>
          <div class="settings-actions">
            <button class="primary-button" type="submit">Open the Chronicle</button>
          </div>
        </form>
      </article>
    </section>
  `;
}


// ── RUNNING PANEL ──────────────────────────────────────────────────
function getRunSummary() {
  const running = state.training.running;
  const runs = [...(running.runs || [])].sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
  const weekStart = new Date(); weekStart.setHours(0,0,0,0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay()+6)%7));
  const weekRuns = runs.filter(r => new Date(r.startAt) >= weekStart);
  const weekKm = weekRuns.reduce((s, r) => s + r.distanceKm, 0);
  const weekMins = weekRuns.reduce((s, r) => s + r.movingTimeMin, 0);
  const avgPace = weekRuns.length ? weekRuns.reduce((s, r) => s + (r.avgPaceMinPerKm || 0), 0) / weekRuns.length : 0;
  const runDays = [...new Set(runs.map(r => toDateKey(r.startAt)))].sort();
  let streak = 0;
  for (let i = runDays.length - 1; i >= 0; i--) {
    const expected = toDateKey(new Date(Date.now() - (runDays.length - 1 - i) * 86400000));
    if (runDays[i] === toDateKey(new Date(Date.now() - streak * 86400000))) streak++;
    else break;
  }
  return { runs, weekRuns, weekKm, weekMins, avgPace, streak,
    runsRemaining: Math.max(0, running.weeklyRunTarget - weekRuns.length),
    kmRemaining: Math.max(0, running.weeklyDistanceTargetKm - weekKm),
    targetMet: weekRuns.length >= running.weeklyRunTarget || weekKm >= running.weeklyDistanceTargetKm
  };
}

function formatPace(minPerKm) {
  if (!minPerKm) return "—";
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${String(secs).padStart(2, "0")} /km`;
}

function renderRunningPanel() {
  const summary = getRunSummary();
  const running = state.training.running;
  const streakProgress = Math.min(100, Math.round((summary.streak / Math.max(summary.streak || 1, 7)) * 100));
  const weeklyRunProgress = Math.min(100, Math.round((summary.weekRuns.length / Math.max(running.weeklyRunTarget, 1)) * 100));
  const weeklyDistProgress = Math.min(100, Math.round((summary.weekKm / Math.max(running.weeklyDistanceTargetKm, 1)) * 100));
  const paceProgress = summary.avgPace ? Math.min(100, Math.round(((8 - Math.min(summary.avgPace, 8)) / 8) * 100)) : 0;

  return `
    <article class="page">
      <div class="page-title-row">
        <div>
          <p class="page-kicker">Running Discipline</p>
          <h2 class="page-title">Run Ledger</h2>
          <p class="page-copy">Every qualifying run feeds the streak and the weekly distance target.</p>
        </div>
        <button class="primary-button" data-action="open-modal" data-modal="run">Log run</button>
      </div>
      <div class="section-stack">
        <div class="metric-grid ring-metric-grid">
          ${renderSummaryCard({ label: "Run Streak", value: `${summary.streak} days`, note: `${summary.weekRuns.length} runs this week`, ringValue: `${summary.streak}d`, progress: streakProgress, accentClass: "accent-orange" })}
          ${renderSummaryCard({ label: "Weekly Runs", value: `${summary.weekRuns.length}/${running.weeklyRunTarget}`, note: `${summary.runsRemaining} runs remaining`, ringValue: `${summary.weekRuns.length}`, ringUnit: "runs", progress: weeklyRunProgress, accentClass: "accent-cyan" })}
          ${renderSummaryCard({ label: "Weekly Distance", value: `${summary.weekKm.toFixed(1)} km`, note: `${summary.kmRemaining.toFixed(1)} km to target`, ringValue: `${Math.round(summary.weekKm)}`, ringUnit: "km", progress: weeklyDistProgress, accentClass: "accent-yellow" })}
          ${renderSummaryCard({ label: "Avg Pace", value: formatPace(summary.avgPace), note: "This week's average", ringValue: summary.avgPace ? summary.avgPace.toFixed(1) : "—", ringUnit: "min", progress: paceProgress, accentClass: "accent-violet" })}
        </div>
        <div class="card">
          <div class="section-label">Recent Runs</div>
          <div class="ride-list">
            ${summary.runs.length
              ? summary.runs.slice(0, 10).map(run => `
                <article class="training-card">
                  <div class="training-head">
                    <div>
                      <h4>${escapeHtml(run.name)}</h4>
                      <p class="training-copy">${escapeHtml(formatDate(run.startAt, { weekday: "short", day: "numeric", month: "short" }))} · ${formatDistanceKm(run.distanceKm)} · ${formatMinutes(run.movingTimeMin)}${run.avgPaceMinPerKm ? ` · ${formatPace(run.avgPaceMinPerKm)}` : ""}</p>
                    </div>
                    <span class="meta-chip">${escapeHtml(run.source)}</span>
                  </div>
                  <div class="small-copy">${escapeHtml(run.note || "No note recorded yet.")}</div>
                </article>`).join("")
              : `<div class="empty-state">No runs logged yet. Log your first run to start the streak engine.</div>`
            }
          </div>
        </div>
      </div>
    </article>
  `;
}

// ── READING PANEL ──────────────────────────────────────────────────
function renderReadingPanel() {
  const reading = state.training.reading;
  const books = reading.books || [];
  const sessions = reading.sessions || [];
  const currentBook = books.find(b => !b.finishedAt);
  const finishedBooks = books.filter(b => b.finishedAt);
  const todaySessions = sessions.filter(s => toDateKey(s.date) === toDateKey(new Date()));
  const todayPages = todaySessions.reduce((sum, s) => sum + (s.pages || 0), 0);
  const readPct = currentBook ? Math.min(100, Math.round((currentBook.currentPage / Math.max(currentBook.totalPages, 1)) * 100)) : 0;
  const yearProgress = Math.min(100, Math.round((finishedBooks.length / Math.max(reading.yearlyBookTarget, 1)) * 100));
  const pageProgress = Math.min(100, Math.round((todayPages / Math.max(reading.dailyPageTarget, 1)) * 100));

  const readStreak = (() => {
    const days = [...new Set(sessions.map(s => toDateKey(s.date)))].sort();
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i] === toDateKey(new Date(Date.now() - streak * 86400000))) streak++;
      else break;
    }
    return streak;
  })();

  return `
    <article class="page">
      <div class="page-title-row">
        <div>
          <p class="page-kicker">Reading Discipline</p>
          <h2 class="page-title">Reading Ledger</h2>
          <p class="page-copy">Track current reads, log sessions, and keep the book club honest.${reading.clubMeetingDay ? ` Club meets ${escapeHtml(reading.clubMeetingDay)}.` : ""}</p>
        </div>
        <button class="primary-button" data-action="open-modal" data-modal="book">Add book</button>
      </div>
      <div class="section-stack">
        <div class="metric-grid ring-metric-grid">
          ${renderSummaryCard({ label: "Reading Streak", value: `${readStreak} days`, note: "Consecutive days with a session", ringValue: `${readStreak}d`, progress: Math.min(100, readStreak * 7), accentClass: "accent-cyan" })}
          ${renderSummaryCard({ label: "Books This Year", value: `${finishedBooks.length} / ${reading.yearlyBookTarget}`, note: `${reading.yearlyBookTarget - finishedBooks.length} remaining this year`, ringValue: `${finishedBooks.length}`, ringUnit: "done", progress: yearProgress, accentClass: "accent-violet" })}
          ${renderSummaryCard({ label: "Pages Today", value: `${todayPages} pages`, note: `Target ${reading.dailyPageTarget} pages/day`, ringValue: `${todayPages}`, ringUnit: "pg", progress: pageProgress, accentClass: "accent-orange" })}
          ${renderSummaryCard({ label: "Current Progress", value: currentBook ? `${readPct}% through` : "No book active", note: currentBook ? escapeHtml(currentBook.title) : "Add a book to begin", ringValue: currentBook ? `${readPct}%` : "0%", progress: readPct, accentClass: "accent-yellow" })}
        </div>
        ${currentBook ? `
        <div class="card">
          <div class="section-label">Currently Reading</div>
          <article class="book-card">
            <div class="book-spine" style="background:${escapeHtml(currentBook.color || "#1e293b")}">${escapeHtml(currentBook.initials || "?")}</div>
            <div class="book-info">
              <div class="book-title">${escapeHtml(currentBook.title)}</div>
              <div class="book-author">${escapeHtml(currentBook.author)}${currentBook.clubPick ? " · Club pick" : ""}</div>
              <div class="book-progress-bar"><div class="book-progress-fill" style="width:${readPct}%"></div></div>
              <div class="book-progress-label">p.${currentBook.currentPage} of ${currentBook.totalPages} · ${readPct}% complete</div>
            </div>
            <button class="ghost-button" data-action="open-modal" data-modal="reading-session">Log session</button>
          </article>
        </div>` : `<div class="empty-state">No book in progress. Add a book to start tracking your reading.</div>`}
        ${finishedBooks.length ? `
        <div class="card">
          <div class="section-label">Completed Reads</div>
          <div class="section-stack">
            ${finishedBooks.map(book => `
              <article class="book-card">
                <div class="book-spine" style="background:${escapeHtml(book.color || "#1e293b")}">${escapeHtml(book.initials || "?")}</div>
                <div class="book-info">
                  <div class="book-title">${escapeHtml(book.title)}</div>
                  <div class="book-author">${escapeHtml(book.author)} · Finished ${escapeHtml(formatDate(book.finishedAt, { day: "numeric", month: "short", year: "numeric" }))}</div>
                  ${book.note ? `<div class="small-copy" style="margin-top:4px">${escapeHtml(book.note)}</div>` : ""}
                </div>
                <span class="wax-badge">done</span>
              </article>`).join("")}
          </div>
        </div>` : ""}
      </div>
    </article>
  `;
}

// ── DISCIPLINES TAB ────────────────────────────────────────────────
function renderDisciplines() {
  const disciplines = state.disciplines || {};
  const enabledTabs = [];
  if (disciplines.cycling !== false) enabledTabs.push(["cycling", "Cycling"]);
  if (disciplines.running) enabledTabs.push(["running", "Running"]);
  if (disciplines.fasting !== false) enabledTabs.push(["fasting", "Fasting"]);
  if (disciplines.reading) enabledTabs.push(["reading", "Reading"]);

  if (!enabledTabs.length) {
    return `<div class="empty-state">No disciplines enabled. Enable them in Settings.</div>`;
  }

  if (!enabledTabs.find(([k]) => k === ui.disciplineTab)) {
    ui.disciplineTab = enabledTabs[0][0];
  }

  const currentIndex = enabledTabs.findIndex(([k]) => k === ui.disciplineTab);

  const subNav = `
    <div class="discipline-subnav" id="discipline-subnav">
      ${enabledTabs.map(([key, label], i) => `
        <button class="discipline-tab ${ui.disciplineTab === key ? "active" : ""}" data-discipline-tab="${escapeHtml(key)}">
          ${escapeHtml(label)}
          ${enabledTabs.length > 1 ? `<span class="disc-tab-hint">${i + 1}/${enabledTabs.length}</span>` : ""}
        </button>
      `).join("")}
      ${enabledTabs.length > 1 ? `
        <div class="disc-scroll-hint">
          ${currentIndex > 0 ? `<span class="disc-arrow disc-arrow-up" data-discipline-tab="${escapeHtml(enabledTabs[currentIndex - 1][0])}" title="Scroll up · ${escapeHtml(enabledTabs[currentIndex - 1][1])}">&#8593; ${escapeHtml(enabledTabs[currentIndex - 1][1])}</span>` : ""}
          ${currentIndex < enabledTabs.length - 1 ? `<span class="disc-arrow disc-arrow-down" data-discipline-tab="${escapeHtml(enabledTabs[currentIndex + 1][0])}" title="Scroll down · ${escapeHtml(enabledTabs[currentIndex + 1][1])}">&#8595; ${escapeHtml(enabledTabs[currentIndex + 1][1])}</span>` : ""}
        </div>
      ` : ""}
    </div>
  `;

  let panel = "";
  if (ui.disciplineTab === "cycling") panel = renderCyclingPanel(getCyclingSummary(state));
  else if (ui.disciplineTab === "running") panel = renderRunningPanel();
  else if (ui.disciplineTab === "fasting") panel = renderFastingPanel(getFastingSummary(state));
  else if (ui.disciplineTab === "reading") panel = renderReadingPanel();

  return `
    <div id="disciplines-scroll-container" data-enabled-tabs="${escapeHtml(enabledTabs.map(([k]) => k).join(","))}" data-current-tab="${escapeHtml(ui.disciplineTab)}">
      <article class="page" style="margin-bottom:10px;">
        ${subNav}
      </article>
      <div id="discipline-panel-content">
        ${panel}
      </div>
    </div>
  `;
}

// ── JOURNAL TAB ────────────────────────────────────────────────────
function buildJournalFeed() {
  const entries = [];

  for (const ride of state.training.cycling.rides) {
    entries.push({ date: ride.startAt, type: "ride", title: ride.name,
      body: `${formatDistanceKm(ride.distanceKm)} · ${formatMinutes(ride.movingTimeMin)}${ride.note ? ` — ${ride.note}` : ""}` });
  }

  for (const run of (state.training.running.runs || [])) {
    entries.push({ date: run.startAt, type: "run", title: run.name,
      body: `${formatDistanceKm(run.distanceKm)} · ${formatMinutes(run.movingTimeMin)}${run.avgPaceMinPerKm ? ` · ${formatPace(run.avgPaceMinPerKm)}` : ""}${run.note ? ` — ${run.note}` : ""}` });
  }

  for (const log of state.training.fasting.logs) {
    entries.push({ date: log.endAt || log.startAt, type: "fast", title: `${Number(log.hours).toFixed(1)} hr fast`,
      body: log.note || (log.hours >= state.training.fasting.targetHours ? "Above target." : "Below target window.") });
  }

  for (const session of (state.training.reading.sessions || [])) {
    const book = (state.training.reading.books || []).find(b => b.id === session.bookId);
    entries.push({ date: session.date, type: "read", title: `Reading session — ${session.pages} pages`,
      body: session.note || (book ? `From ${escapeHtml(book.title)}` : "Reading session logged.") });
  }

  for (const quest of state.quests.filter(q => q.completedAt || q.failedAt)) {
    entries.push({ date: quest.completedAt || quest.failedAt, type: "goal",
      title: quest.state === "completed" ? `Goal sealed — ${quest.title}` : `Goal closed — ${quest.title}`,
      body: quest.state === "completed" ? `${CATEGORIES[quest.category]?.label || quest.category} · ${DIFFICULTIES[quest.difficulty]?.label || quest.difficulty}` : `Marked ${quest.state.replace("_", " ")}` });
  }

  for (const item of state.rewardHistory) {
    entries.push({ date: item.unlockedAt, type: "reward", title: `Reward unlocked — ${item.name}`,
      body: `${item.tier} tier · from ${item.questTitle}` });
  }

  return entries.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function renderJournal() {
  const entries = buildJournalFeed();
  const typeLabel = { ride: "ride", run: "run", fast: "fast", read: "reading", goal: "goal", reward: "reward" };

  return `
    <section class="page-spread single">
      ${renderActivityPanel()}
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Activity Journal</p>
            <h2 class="page-title">Full Chronicle</h2>
            <p class="page-copy">Every ride, run, fast, reading session, goal, and reward in one chronological feed.</p>
          </div>
        </div>
        <div class="journal-list" style="padding:12px">
          ${entries.length
            ? entries.map(e => `
              <article class="journal-entry entry-${e.type}">
                <div class="journal-entry-date">${escapeHtml(formatDate(e.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}</div>
                <div class="journal-entry-title">${escapeHtml(e.title)}</div>
                <div class="journal-entry-body">${escapeHtml(e.body)}</div>
                <span class="journal-entry-tag tag-${e.type}">${escapeHtml(typeLabel[e.type] || e.type)}</span>
              </article>`).join("")
            : `<div class="empty-state">Nothing logged yet. Complete a goal, log a ride, or record a fast to start the journal.</div>`
          }
        </div>
      </article>
    </section>
  `;
}


function renderCurrentTab() {
  if (!state.character) return renderOnboarding();
  if (ui.tab === "goals") return renderQuests();
  if (ui.tab === "disciplines") return renderDisciplines();
  if (ui.tab === "journal") return renderJournal();
  if (ui.tab === "settings") return renderSettings();
  return renderOverview();
}

function renderQuestModal() {
  const prerequisiteOptions = state.quests
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div>
            <p class="page-kicker">Quest Contract</p>
            <h3 class="modal-title">Add a New Quest</h3>
          </div>
          <button class="modal-close" type="button" data-action="close-modal">&times;</button>
        </div>
        <form class="form-shell" data-form="quest">
          <div class="field-grid two">
            <div>
              <label class="form-label" for="questTitle">Quest title</label>
              <input class="text-input" id="questTitle" name="title" required>
            </div>
            <div>
              <label class="form-label" for="questChainId">Chain name</label>
              <input class="text-input" id="questChainId" name="chainId" placeholder="Optional multi-step campaign">
            </div>
          </div>
          <div>
            <label class="form-label" for="questDescription">Description or note</label>
            <textarea class="text-area" id="questDescription" name="description" placeholder="Why this matters, or what done looks like."></textarea>
          </div>
          <div class="field-grid two">
            <div>
              <label class="form-label" for="questCategory">Category</label>
              <select class="select-input" id="questCategory" name="category">
                ${Object.entries(CATEGORIES).map(([key, value]) => `<option value="${key}">${escapeHtml(value.label)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label class="form-label" for="questDiscipline">Discipline</label>
              <select class="select-input" id="questDiscipline" name="discipline">
                ${Object.entries(QUEST_DISCIPLINES).map(([key, value]) => `<option value="${key}">${escapeHtml(value.label)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label class="form-label" for="questDifficulty">Difficulty</label>
              <select class="select-input" id="questDifficulty" name="difficulty">
                ${Object.entries(DIFFICULTIES).map(([key, value]) => `<option value="${key}">${escapeHtml(value.label)} · ${value.xp} XP</option>`).join("")}
              </select>
            </div>
            <div>
              <label class="form-label" for="questDueDate">Due date</label>
              <input class="text-input" id="questDueDate" name="dueDate" type="date">
            </div>
            <div>
              <label class="form-label" for="questRecurrence">Recurrence</label>
              <select class="select-input" id="questRecurrence" name="recurrence">
                <option value="none">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
          <div>
            <label class="form-label">Prerequisites</label>
            <div class="checkbox-panel">
              ${
                prerequisiteOptions.length
                  ? prerequisiteOptions.map((quest) => `
                    <label class="check-row">
                      <input type="checkbox" name="prerequisiteIds" value="${safeAttr(quest.id)}">
                      <span>${escapeHtml(quest.title)}</span>
                    </label>`).join("")
                  : `<div class="small-copy">No prerequisite quests available yet.</div>`
              }
            </div>
          </div>
          <div>
            <label class="form-label">Bonus objectives</label>
            <div class="field-grid">
              <input class="text-input" name="bonusOne" placeholder="Optional bonus objective one">
              <input class="text-input" name="bonusTwo" placeholder="Optional bonus objective two">
              <input class="text-input" name="bonusThree" placeholder="Optional bonus objective three">
            </div>
          </div>
          <div class="settings-actions">
            <button class="primary-button" type="submit">Add quest</button>
            <button class="ghost-button" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderRideModal(ride) {
  const isNote = Boolean(ride);
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div>
            <p class="page-kicker">${isNote ? "Ride Notes" : "Manual Ride Entry"}</p>
            <h3 class="modal-title">${isNote ? escapeHtml(ride.name) : "Log a Ride"}</h3>
          </div>
          <button class="modal-close" type="button" data-action="close-modal">&times;</button>
        </div>
        ${
          isNote
            ? `<form class="form-shell" data-form="ride-note">
                <input type="hidden" name="rideId" value="${safeAttr(ride.id)}">
                <div>
                  <label class="form-label" for="rideNoteText">Ride note</label>
                  <textarea class="text-area" id="rideNoteText" name="note" placeholder="How the ride felt, what the weather was like, what you learned.">${escapeHtml(ride.note || "")}</textarea>
                </div>
                <div class="settings-actions">
                  <button class="primary-button" type="submit">Save note</button>
                  <button class="ghost-button" type="button" data-action="close-modal">Cancel</button>
                </div>
              </form>`
            : `<form class="form-shell" data-form="ride">
                <div class="field-grid two">
                  <div>
                    <label class="form-label" for="rideName">Ride name</label>
                    <input class="text-input" id="rideName" name="name" placeholder="Morning tempo" required>
                  </div>
                  <div>
                    <label class="form-label" for="rideStartAt">Start time</label>
                    <input class="text-input" id="rideStartAt" name="startAt" type="datetime-local" required>
                  </div>
                  <div>
                    <label class="form-label" for="rideDistanceKm">Distance (km)</label>
                    <input class="text-input" id="rideDistanceKm" name="distanceKm" type="number" min="0" step="0.1" required>
                  </div>
                  <div>
                    <label class="form-label" for="rideMovingTimeMin">Moving time (min)</label>
                    <input class="text-input" id="rideMovingTimeMin" name="movingTimeMin" type="number" min="0" step="1" required>
                  </div>
                  <div>
                    <label class="form-label" for="rideElevationM">Elevation gain (m)</label>
                    <input class="text-input" id="rideElevationM" name="elevationM" type="number" min="0" step="1">
                  </div>
                </div>
                <div>
                  <label class="form-label" for="rideNote">Ride note</label>
                  <textarea class="text-area" id="rideNote" name="note" placeholder="Conditions, pacing, what helped, what to repeat."></textarea>
                </div>
                <div class="settings-actions">
                  <button class="primary-button" type="submit">Record ride</button>
                  <button class="ghost-button" type="button" data-action="close-modal">Cancel</button>
                </div>
              </form>`
        }
      </div>
    </div>
  `;
}

function renderFastModal() {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div>
            <p class="page-kicker">Manual Fast Entry</p>
            <h3 class="modal-title">Log a Fast</h3>
          </div>
          <button class="modal-close" type="button" data-action="close-modal">&times;</button>
        </div>
        <form class="form-shell" data-form="fast">
          <div class="field-grid two">
            <div>
              <label class="form-label" for="fastStartAt">Fast start</label>
              <input class="text-input" id="fastStartAt" name="startAt" type="datetime-local" required>
            </div>
            <div>
              <label class="form-label" for="fastEndAt">Fast end</label>
              <input class="text-input" id="fastEndAt" name="endAt" type="datetime-local" required>
            </div>
          </div>
          <div>
            <label class="form-label" for="fastNote">Fast note</label>
            <textarea class="text-area" id="fastNote" name="note" placeholder="Hunger, energy, what made the window easier or harder."></textarea>
          </div>
          <div class="settings-actions">
            <button class="primary-button" type="submit">Record fast</button>
            <button class="ghost-button" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderRewardModal() {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div>
            <p class="page-kicker">Reward Treasury</p>
            <h3 class="modal-title">Add Reward</h3>
          </div>
          <button class="modal-close" type="button" data-action="close-modal">&times;</button>
        </div>
        <form class="form-shell" data-form="reward">
          <div class="field-grid two">
            <div>
              <label class="form-label" for="rewardName">Reward name</label>
              <input class="text-input" id="rewardName" name="name" required>
            </div>
            <div>
              <label class="form-label" for="rewardTier">Tier</label>
              <select class="select-input" id="rewardTier" name="tier">
                ${REWARD_TIERS.map((tier) => `<option value="${tier}">${escapeHtml(tier)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label class="form-label" for="rewardCooldownDays">Cooldown days</label>
              <input class="text-input" id="rewardCooldownDays" name="cooldownDays" type="number" min="0" value="0">
            </div>
          </div>
          <div class="settings-actions">
            <button class="primary-button" type="submit">Add reward</button>
            <button class="ghost-button" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderRunModal() {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div>
            <p class="page-kicker">Manual Run Entry</p>
            <h3 class="modal-title">Log a Run</h3>
          </div>
          <button class="modal-close" type="button" data-action="close-modal">&times;</button>
        </div>
        <form class="form-shell" data-form="run">
          <div class="field-grid two">
            <div>
              <label class="form-label" for="runName">Run name</label>
              <input class="text-input" id="runName" name="name" placeholder="Morning tempo" required>
            </div>
            <div>
              <label class="form-label" for="runStartAt">Start time</label>
              <input class="text-input" id="runStartAt" name="startAt" type="datetime-local" required>
            </div>
            <div>
              <label class="form-label" for="runDistanceKm">Distance (km)</label>
              <input class="text-input" id="runDistanceKm" name="distanceKm" type="number" min="0" step="0.1" required>
            </div>
            <div>
              <label class="form-label" for="runMovingTimeMin">Moving time (min)</label>
              <input class="text-input" id="runMovingTimeMin" name="movingTimeMin" type="number" min="0" step="1" required>
            </div>
            <div>
              <label class="form-label" for="runElevationM">Elevation gain (m)</label>
              <input class="text-input" id="runElevationM" name="elevationM" type="number" min="0" step="1">
            </div>
            <div>
              <label class="form-label" for="runAvgPace">Avg pace (min/km)</label>
              <input class="text-input" id="runAvgPace" name="avgPaceMinPerKm" type="number" min="0" step="0.1">
            </div>
          </div>
          <div>
            <label class="form-label" for="runNote">Run note</label>
            <textarea class="text-area" id="runNote" name="note" placeholder="Conditions, pacing, what helped."></textarea>
          </div>
          <div class="settings-actions">
            <button class="primary-button" type="submit">Record run</button>
            <button class="ghost-button" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderBookModal() {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div>
            <p class="page-kicker">Reading Ledger</p>
            <h3 class="modal-title">Add a Book</h3>
          </div>
          <button class="modal-close" type="button" data-action="close-modal">&times;</button>
        </div>
        <form class="form-shell" data-form="book">
          <div class="field-grid two">
            <div>
              <label class="form-label" for="bookTitle">Title</label>
              <input class="text-input" id="bookTitle" name="title" required>
            </div>
            <div>
              <label class="form-label" for="bookAuthor">Author</label>
              <input class="text-input" id="bookAuthor" name="author">
            </div>
            <div>
              <label class="form-label" for="bookTotalPages">Total pages</label>
              <input class="text-input" id="bookTotalPages" name="totalPages" type="number" min="1" required>
            </div>
            <div>
              <label class="form-label" for="bookCurrentPage">Current page</label>
              <input class="text-input" id="bookCurrentPage" name="currentPage" type="number" min="0" value="0">
            </div>
          </div>
          <label class="check-row">
            <input type="checkbox" name="clubPick">
            <span>This is a book club pick</span>
          </label>
          <div>
            <label class="form-label" for="bookNote">Note</label>
            <textarea class="text-area" id="bookNote" name="note" placeholder="Why you picked it, what you hope to get from it."></textarea>
          </div>
          <div class="settings-actions">
            <button class="primary-button" type="submit">Add book</button>
            <button class="ghost-button" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderReadingSessionModal() {
  const currentBook = (state.training.reading.books || []).find(b => !b.finishedAt);
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div>
            <p class="page-kicker">Reading Session</p>
            <h3 class="modal-title">Log a Reading Session</h3>
          </div>
          <button class="modal-close" type="button" data-action="close-modal">&times;</button>
        </div>
        <form class="form-shell" data-form="reading-session">
          <input type="hidden" name="bookId" value="${currentBook ? safeAttr(currentBook.id) : ""}">
          <div class="field-grid two">
            <div>
              <label class="form-label" for="sessionPages">Pages read</label>
              <input class="text-input" id="sessionPages" name="pages" type="number" min="1" required>
            </div>
            <div>
              <label class="form-label" for="sessionEndPage">Now on page</label>
              <input class="text-input" id="sessionEndPage" name="endPage" type="number" min="0" value="${currentBook ? currentBook.currentPage : 0}">
            </div>
          </div>
          <div>
            <label class="form-label" for="sessionNote">Session note</label>
            <textarea class="text-area" id="sessionNote" name="note" placeholder="What stood out, questions raised, favourite line."></textarea>
          </div>
          <div class="settings-actions">
            <button class="primary-button" type="submit">Log session</button>
            <button class="ghost-button" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderModal() {
  if (!ui.modal) return "";
  if (ui.modal.type === "quest") return renderQuestModal();
  if (ui.modal.type === "ride") return renderRideModal();
  if (ui.modal.type === "ride-note") {
    const ride = state.training.cycling.rides.find((entry) => entry.id === ui.modal.id);
    return ride ? renderRideModal(ride) : "";
  }
  if (ui.modal.type === "fast") return renderFastModal();
  if (ui.modal.type === "reward") return renderRewardModal();
  if (ui.modal.type === "run") return renderRunModal();
  if (ui.modal.type === "book") return renderBookModal();
  if (ui.modal.type === "reading-session") return renderReadingSessionModal();
  return "";
}

function renderToasts() {
  if (!ui.toasts.length) return "";
  return `<div class="toast-stack">${ui.toasts.map((toast) => `<div class="toast ${toast.type}">${escapeHtml(toast.message)}</div>`).join("")}</div>`;
}

function render() {
  applyTheme();
  appRoot.innerHTML = state.character
    ? `
      <section class="app-shell shell">
        ${renderTopbar()}
        ${renderTabs()}
        <main class="main">
          <section class="main-shell">
            ${renderShellHeader()}
            ${renderMetricsStrip()}
            <div class="dashboard-content">
              ${renderCurrentTab()}
            </div>
          </section>
        </main>
      </section>
      ${renderToasts()}
    `
    : `
      <section class="app-shell shell onboarding-shell">
        ${renderTopbar()}
        <main class="main main-full">
          <section class="journal-frame dashboard-onboarding">
            <div class="journal-content">
              ${renderCurrentTab()}
            </div>
          </section>
        </main>
      </section>
      ${renderToasts()}
    `;
  modalRoot.innerHTML = renderModal();
  setupDisciplineScroll();
}

function setupDisciplineScroll() {
  const container = document.getElementById("disciplines-scroll-container");
  if (!container) return;

  // Remove any previously attached listener by replacing the node
  const main = document.querySelector(".main");
  if (!main) return;

  // Debounce guard
  if (main._disciplineScrollHandler) {
    main.removeEventListener("wheel", main._disciplineScrollHandler);
  }

  main._disciplineScrollHandler = (e) => {
    const container = document.getElementById("disciplines-scroll-container");
    if (!container) return;

    // Only trigger when scrolled near top of disciplines panel
    const rect = container.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const panelTop = rect.top - mainRect.top + main.scrollTop;

    // Must be viewing the disciplines tab
    if (ui.tab !== "disciplines") return;

    const enabledTabs = container.dataset.enabledTabs.split(",").filter(Boolean);
    const currentTab = container.dataset.currentTab;
    const currentIndex = enabledTabs.indexOf(currentTab);

    // Only switch if we're at scroll boundaries
    const atTop = main.scrollTop <= 10;
    const atBottom = main.scrollTop + main.clientHeight >= main.scrollHeight - 10;

    if (e.deltaY > 30 && currentIndex < enabledTabs.length - 1) {
      // Scrolling down — go to next discipline
      e.preventDefault();
      ui.disciplineTab = enabledTabs[currentIndex + 1];
      main.scrollTop = 0;
      render();
    } else if (e.deltaY < -30 && currentIndex > 0 && atTop) {
      // Scrolling up at top — go to previous discipline
      e.preventDefault();
      ui.disciplineTab = enabledTabs[currentIndex - 1];
      render();
    }
  };

  // Use passive:false so we can preventDefault
  main.addEventListener("wheel", main._disciplineScrollHandler, { passive: false });
}

async function handleClick(event) {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    ui.tab = tab.dataset.tab;
    render();
    return;
  }

  const discTab = event.target.closest("[data-discipline-tab]");
  if (discTab) {
    ui.disciplineTab = discTab.dataset.disciplineTab;
    render();
    return;
  }

  const actionNode = event.target.closest("[data-action]");
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  const id = actionNode.dataset.id;

  if (action === "open-modal") return setModal({ type: actionNode.dataset.modal, id });
  if (action === "close-modal") return closeModal();
  if (action === "start-quest") return setQuestState(id, "in_progress");
  if (action === "complete-quest") return setQuestState(id, "completed");
  if (action === "fail-quest") return setQuestState(id, "failed");
  if (action === "abandon-quest") return setQuestState(id, "abandoned");
  if (action === "remove-reward") return removeReward(id);
  if (action === "export-state") return downloadBackup();
  if (action === "load-demo-state") return loadDemoState();
  if (action === "sync-strava") return syncStrava(true);
  if (action === "toggle-discipline") {
    const disc = actionNode.dataset.discipline;
    if (!state.disciplines) state.disciplines = {};
    state.disciplines[disc] = !state.disciplines[disc];
    persist();
    return;
  }
  if (action === "toggle-theme") {
    ui.theme = ui.theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(THEME_STORAGE_KEY, ui.theme);
    render();
  }
}

function handleSubmit(event) {
  const form = event.target;
  const kind = form.dataset.form;
  if (!kind) return;
  event.preventDefault();
  const formData = new FormData(form);

  if (kind === "onboarding") {
    const name = String(formData.get("name") || "").trim();
    if (!name) return pushToast("error", "Your character needs a name.");
    return createCharacter({
      name,
      title: String(formData.get("title") || "").trim(),
      classId: String(formData.get("classId") || "adventurer")
    });
  }

  if (kind === "quest") {
    const title = String(formData.get("title") || "").trim();
    if (!title) return pushToast("error", "Quest title is required.");
    return addQuest(formData);
  }

  if (kind === "ride") return addManualRide(formData);
  if (kind === "ride-note") return updateRideNote(formData);

  if (kind === "fast") {
    const startAt = String(formData.get("startAt") || "");
    const endAt = String(formData.get("endAt") || "");
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      return pushToast("error", "Fast end must be after fast start.");
    }
    return addFastLog(formData);
  }

  if (kind === "reward") {
    const name = String(formData.get("name") || "").trim();
    if (!name) return pushToast("error", "Reward name is required.");
    return addReward(formData);
  }

  if (kind === "cycling-settings") return updateCyclingSettings(formData);
  if (kind === "fasting-settings") return updateFastingSettings(formData);
  if (kind === "quest-settings") return updateQuestSettings(formData);
  if (kind === "strava-settings") return updateStravaSettings(formData);
  if (kind === "running-settings") return updateRunningSettings(formData);
  if (kind === "reading-settings") return updateReadingSettings(formData);

  if (kind === "run") {
    state.training.running.runs.unshift({
      id: uid("run"), source: "manual", stravaId: "",
      name: String(formData.get("name") || "").trim() || "Manual run",
      startAt: String(formData.get("startAt")),
      distanceKm: Number(formData.get("distanceKm") || 0),
      movingTimeMin: Number(formData.get("movingTimeMin") || 0),
      elevationM: Number(formData.get("elevationM") || 0),
      avgPaceMinPerKm: Number(formData.get("avgPaceMinPerKm") || 0),
      note: String(formData.get("note") || "").trim()
    });
    persist(); closeModal(); pushToast("success", "Run added to the ledger.");
    return;
  }

  if (kind === "book") {
    const title = String(formData.get("title") || "").trim();
    if (!title) return pushToast("error", "Book title is required.");
    const colors = ["#7f1d1d","#1e3a5f","#3b0764","#064e3b","#1c1917","#1e1b4b","#422006","#450a0a"];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const words = title.split(" ");
    const initials = words.length >= 2 ? words[0][0] + words[1][0] : title.slice(0,2);
    if (!state.training.reading.books) state.training.reading.books = [];
    state.training.reading.books.unshift({
      id: uid("book"), title,
      author: String(formData.get("author") || "").trim(),
      totalPages: Number(formData.get("totalPages") || 1),
      currentPage: Number(formData.get("currentPage") || 0),
      startedAt: new Date().toISOString(), finishedAt: null,
      clubPick: formData.get("clubPick") === "on",
      color, initials: initials.toUpperCase(),
      note: String(formData.get("note") || "").trim()
    });
    persist(); closeModal(); pushToast("success", "Book added to the reading ledger.");
    return;
  }

  if (kind === "reading-session") {
    const pages = Number(formData.get("pages") || 0);
    if (!pages) return pushToast("error", "Enter the number of pages read.");
    const bookId = String(formData.get("bookId") || "");
    const endPage = Number(formData.get("endPage") || 0);
    if (!state.training.reading.sessions) state.training.reading.sessions = [];
    state.training.reading.sessions.unshift({
      id: uid("session"), bookId,
      date: new Date().toISOString(), pages,
      note: String(formData.get("note") || "").trim()
    });
    if (bookId) {
      const book = (state.training.reading.books || []).find(b => b.id === bookId);
      if (book && endPage > 0) {
        book.currentPage = Math.min(endPage, book.totalPages);
        if (book.currentPage >= book.totalPages) book.finishedAt = new Date().toISOString();
      }
    }
    persist(); closeModal(); pushToast("success", "Reading session logged.");
    return;
  }
}

function handleChange(event) {
  const importInput = event.target.closest('input[data-action="import-state"]');
  if (importInput) {
    openImport(importInput.files?.[0]);
    importInput.value = "";
    return;
  }

  const bonusToggle = event.target.closest("[data-bonus-toggle]");
  if (bonusToggle) {
    updateQuestBonus(bonusToggle.dataset.questId, bonusToggle.dataset.bonusId, bonusToggle.checked);
    return;
  }

  const discToggle = event.target.closest("[data-discipline-toggle]");
  if (discToggle) {
    const disc = discToggle.dataset.disciplineToggle;
    if (!state.disciplines) state.disciplines = {};
    state.disciplines[disc] = discToggle.checked;
    persist();
  }
}

document.addEventListener("click", (event) => {
  handleClick(event).catch((error) => {
    console.error(error);
    pushToast("error", "That action failed.");
  });
});
document.addEventListener("submit", handleSubmit);
document.addEventListener("change", handleChange);

render();
maybeAutoSync();
