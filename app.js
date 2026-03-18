import {
  STORAGE_KEY,
  CATEGORIES,
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
  tab: "overview",
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

  state.quests.push({
    id: uid("quest"),
    title: String(formData.get("title") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    category: String(formData.get("category") || "health"),
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
  const groups = new Map();
  for (const quest of state.quests) {
    if (!quest.chainId) continue;
    const bucket = groups.get(quest.chainId) || [];
    bucket.push(quest);
    groups.set(quest.chainId, bucket);
  }

  return [...groups.entries()].map(([chainId, quests]) => ({
    chainId,
    quests: quests.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
  }));
}

function isOverdue(quest) {
  if (!quest.dueDate) return false;
  if (quest.state === "completed" || quest.state === "failed" || quest.state === "abandoned") return false;
  return new Date(quest.dueDate).getTime() < new Date().setHours(0, 0, 0, 0);
}

function renderSummaryCard({ label, value, note, ringValue, ringUnit = "", progress = 0, accentClass = "accent-cyan" }) {
  const circumference = 163.4;
  const clamped = Math.max(0, Math.min(progress, 100));
  const filled = ((clamped / 100) * circumference).toFixed(1);
  const remainder = Math.max(circumference - Number(filled), 0).toFixed(1);

  return `
    <article class="summary-card">
      <div class="stat-ring-wrap">
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="26" fill="none" class="ring-track" stroke-width="4"></circle>
          <circle
            cx="32"
            cy="32"
            r="26"
            fill="none"
            class="ring-progress ${accentClass}"
            stroke-width="4"
            stroke-dasharray="${filled} ${remainder}"
            stroke-linecap="round"
          ></circle>
        </svg>
        <div class="stat-ring-inner">
          <span class="stat-ring-val">${escapeHtml(ringValue)}</span>
          ${ringUnit ? `<span class="stat-ring-unit">${escapeHtml(ringUnit)}</span>` : ""}
        </div>
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
        <path d="M19.5 14.25A7.5 7.5 0 0 1 9.75 4.5a7.5 7.5 0 1 0 9.75 9.75Z"></path>
      </svg>`;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2.25v2.25"></path>
      <path d="M12 19.5v2.25"></path>
      <path d="m4.93 4.93 1.59 1.59"></path>
      <path d="m17.48 17.48 1.59 1.59"></path>
      <path d="M2.25 12H4.5"></path>
      <path d="M19.5 12h2.25"></path>
      <path d="m4.93 19.07 1.59-1.59"></path>
      <path d="m17.48 6.52 1.59-1.59"></path>
    </svg>`;
}

function renderTopbar() {
  const characterName = state.character?.name || "New Hunter";
  const characterRole = state.character
    ? state.character.title || CLASSES[state.character.class].name
    : "Open the Chronicle";

  return `
    <header class="topbar">
      <div class="topbar-left">
        <div class="logo-mark">DC</div>
        <div class="topbar-title">
          <span class="topbar-eyebrow">The System</span>
          <span class="topbar-name">Discipline Chronicle</span>
        </div>
      </div>
      <div class="topbar-right">
        <button class="theme-toggle" type="button" data-action="toggle-theme" title="Toggle theme">
          ${renderThemeIcon(ui.theme)}
        </button>
        <div class="profile-chip">
          <div class="avatar">${escapeHtml(characterName.slice(0, 2).toUpperCase())}</div>
          <div class="profile-info">
            <span class="profile-name">${escapeHtml(characterName)}</span>
            <span class="profile-sub">${escapeHtml(characterRole)}</span>
          </div>
        </div>
      </div>
    </header>
  `;
}

function renderMetricsStrip() {
  const cyclingSummary = getCyclingSummary(state);
  const fastingSummary = getFastingSummary(state);
  const questSummary = getQuestSummary(state);

  return `
    <section class="metrics-strip">
      <article class="metric-chip">
        <span class="metric-chip-label">Level</span>
        <span class="metric-chip-val">${getLevel(state.character.xp)}</span>
      </article>
      <article class="metric-chip">
        <span class="metric-chip-label">XP</span>
        <span class="metric-chip-val">${xpIntoCurrentLevel(state.character.xp)} / ${xpForLevel(getLevel(state.character.xp))}</span>
      </article>
      <article class="metric-chip">
        <span class="metric-chip-label">Weekly Ride KM</span>
        <span class="metric-chip-val">${cyclingSummary.currentWeek.distanceKm.toFixed(1)} km</span>
      </article>
      <article class="metric-chip">
        <span class="metric-chip-label">Fasting</span>
        <span class="metric-chip-val">${fastingSummary.currentWeek.completedDays}/${fastingSummary.currentWeek.targetDays} days</span>
      </article>
      <article class="metric-chip">
        <span class="metric-chip-label">Quest Load</span>
        <span class="metric-chip-val">${questSummary.inProgress + questSummary.available} active</span>
      </article>
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
            label: "Open Quests",
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
  const current = chain.quests.find((quest) => quest.state !== "completed" && prerequisitesComplete(state, quest));
  return `
    <article class="chain-card" style="margin-top:10px">
      <div class="quest-head">
        <div>
          <h4>${escapeHtml(chain.chainId)}</h4>
          <p class="chain-copy">${completed}/${chain.quests.length} steps sealed${current ? ` · Next: ${escapeHtml(current.title)}` : ""}</p>
        </div>
        <span class="meta-chip">${completed}/${chain.quests.length}</span>
      </div>
      <div class="inline-list">
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

function renderFocusPanel(chains, cyclingSummary, fastingSummary) {
  const nextQuest = [...state.quests]
    .filter((quest) => !["completed", "failed", "abandoned"].includes(quest.state))
    .sort((left, right) => new Date(left.dueDate || left.createdAt).getTime() - new Date(right.dueDate || right.createdAt).getTime())[0];
  const currentChain = chains.find((chain) => chain.quests.some((quest) => quest.state !== "completed"));
  const currentStep = currentChain?.quests.find((quest) => quest.state !== "completed" && prerequisitesComplete(state, quest));
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
          <p class="page-kicker">System Notes</p>
          <h2 class="page-title">Focus Queue</h2>
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
  return `
    <article class="page">
      <div class="page-title-row">
        <div>
          <p class="page-kicker">Quest Chains</p>
          <h2 class="page-title">Campaign Arcs</h2>
          <p class="page-copy">Multi-step threads stay visible here so the larger story does not disappear under daily tasks.</p>
        </div>
      </div>
      <div class="section-stack chain-panel-list">
        ${
          chains.length
            ? chains.slice(0, 4).map(renderChainCard).join("")
            : `<div class="empty-state">Add a chain name to quests when you want multi-step campaigns.</div>`
        }
      </div>
    </article>
  `;
}

function renderOverviewLegacy() {
  const cyclingSummary = getCyclingSummary(state);
  const fastingSummary = getFastingSummary(state);
  const questSummary = getQuestSummary(state);
  const chains = buildChainGroups();
  const level = getLevel(state.character.xp);
  const xpIntoLevel = xpIntoCurrentLevel(state.character.xp);
  const xpNeeded = xpForLevel(level);
  const xpPercent = Math.min(100, Math.round((xpIntoLevel / xpNeeded) * 100));

  return `
    ${renderTopStats()}
    <section class="page-spread" style="margin-top:18px">
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Character Ledger</p>
            <h2 class="page-title">${escapeHtml(state.character.name)}</h2>
            <p class="page-copy">${escapeHtml(state.character.title || "No title chosen yet")} · ${escapeHtml(CLASSES[state.character.class].bonus)}</p>
          </div>
          <div class="wax-badge">Level ${level}</div>
        </div>
        <div class="section-stack">
          <div class="summary-card">
            <div class="summary-label">Experience</div>
            <div class="summary-value">${xpIntoLevel} / ${xpNeeded}</div>
            <div class="progress-shell" style="margin-top:12px">
              <div class="progress-fill" style="width:${xpPercent}%"></div>
            </div>
          </div>
          <div class="metric-grid">
            <div class="card">
              <div class="summary-label">Health</div>
              <div class="summary-value">${calculateHp(state.character)}</div>
              <div class="small-copy">HP ledger</div>
            </div>
            <div class="card">
              <div class="summary-label">Focus</div>
              <div class="summary-value">${calculateMp(state.character)}</div>
              <div class="small-copy">MP ledger</div>
            </div>
            <div class="card">
              <div class="summary-label">Gold</div>
              <div class="summary-value">${state.character.gold}</div>
              <div class="small-copy">Treasury held</div>
            </div>
            <div class="card">
              <div class="summary-label">Quest Streak</div>
              <div class="summary-value">${state.stats.questDayStreakCurrent}</div>
              <div class="small-copy">Longest ${state.stats.questDayStreakLongest}</div>
            </div>
          </div>
          <div class="card">
            <div class="summary-label">Primary Stats</div>
            <div class="inline-list">
              <span class="meta-chip">Vitality ${state.character.stats.vitality}</span>
              <span class="meta-chip">Wisdom ${state.character.stats.wisdom}</span>
              <span class="meta-chip">Fortune ${state.character.stats.fortune}</span>
              <span class="meta-chip">Charisma ${state.character.stats.charisma}</span>
            </div>
          </div>
        </div>
      </article>
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Campaign Pressure</p>
            <h2 class="page-title">This Week</h2>
            <p class="page-copy">Your week revolves around repeatable wins: ride enough, fast enough, and keep the quest board moving.</p>
          </div>
        </div>
        <div class="section-stack">
          <div class="training-card">
            <div class="training-head">
              <div>
                <div class="section-label">Cycling</div>
                <h4>${cyclingSummary.currentWeek.rideCount}/${state.training.cycling.weeklyRideTarget} qualifying rides</h4>
              </div>
              <span class="state-pill ${cyclingSummary.currentWeek.targetMet ? "completed" : "available"}">${cyclingSummary.currentWeek.targetMet ? "Target met" : "In progress"}</span>
            </div>
            <p class="training-copy">${formatDistanceKm(cyclingSummary.currentWeek.distanceKm)} this week. ${cyclingSummary.currentWeek.ridesRemaining} ride${cyclingSummary.currentWeek.ridesRemaining === 1 ? "" : "s"} to hit the count target.</p>
          </div>
          <div class="training-card">
            <div class="training-head">
              <div>
                <div class="section-label">Fasting</div>
                <h4>${fastingSummary.currentWeek.completedDays}/${fastingSummary.currentWeek.targetDays} target fasts</h4>
              </div>
              <span class="state-pill ${fastingSummary.currentWeek.targetMet ? "completed" : "available"}">${fastingSummary.streak.current} day streak</span>
            </div>
            <p class="training-copy">Target hours: ${state.training.fasting.targetHours}. This week is about calm consistency, not perfection.</p>
          </div>
          <div class="training-card">
            <div class="training-head">
              <div>
                <div class="section-label">Quest Board</div>
                <h4>${questSummary.inProgress} in progress · ${questSummary.available} available</h4>
              </div>
              ${questSummary.overdue ? `<span class="wax-badge overdue">${questSummary.overdue} overdue</span>` : ""}
            </div>
            <p class="training-copy">${questSummary.closed} quests are already recorded in the chronicle. Keep the chain moving, not just the to-do list.</p>
          </div>
          <div class="card">
            <div class="section-label">Quest Chains</div>
            ${chains.length ? chains.map(renderChainCard).join("") : `<div class="empty-state">Add a chain name to quests when you want multi-step campaigns.</div>`}
          </div>
        </div>
      </article>
    </section>
    <section class="page-spread dashboard-support-row" style="margin-top:18px">
      ${renderActivityPanel()}
      ${renderFocusPanel(chains, cyclingSummary, fastingSummary)}
    </section>
  `;
}

function renderOverview() {
  const cyclingSummary = getCyclingSummary(state);
  const fastingSummary = getFastingSummary(state);
  const questSummary = getQuestSummary(state);
  const chains = buildChainGroups();
  const level = getLevel(state.character.xp);
  const xpIntoLevel = xpIntoCurrentLevel(state.character.xp);
  const xpNeeded = xpForLevel(level);
  const xpPercent = Math.min(100, Math.round((xpIntoLevel / xpNeeded) * 100));

  return `
    ${renderTopStats()}
    <section class="page-spread overview-primary">
      <article class="page panel">
        <div class="panel-header">
          <span class="panel-title">Character Ledger</span>
          <span class="panel-badge">Level ${level}</span>
        </div>
        <div class="panel-body">
          <div>
            <div class="char-name">${escapeHtml(state.character.name)}</div>
            <div class="char-class">${escapeHtml(state.character.title || "No title chosen yet")} - ${escapeHtml(CLASSES[state.character.class].bonus)}</div>
          </div>
          <div class="xp-row">
            <span class="xp-label">Experience</span>
            <span class="xp-val">${xpIntoLevel} <span>/ ${xpNeeded}</span></span>
            <div class="progress-shell"><div class="progress-fill" style="width:${xpPercent}%"></div></div>
          </div>
          <div class="metric-grid">
            <div class="card">
              <div class="summary-label">Health</div>
              <div class="summary-value">${calculateHp(state.character)}</div>
              <div class="small-copy">HP ledger</div>
            </div>
            <div class="card">
              <div class="summary-label">Focus</div>
              <div class="summary-value">${calculateMp(state.character)}</div>
              <div class="small-copy">MP ledger</div>
            </div>
            <div class="card">
              <div class="summary-label">Gold</div>
              <div class="summary-value">${state.character.gold}</div>
              <div class="small-copy">Treasury held</div>
            </div>
            <div class="card">
              <div class="summary-label">Quest Streak</div>
              <div class="summary-value">${state.stats.questDayStreakCurrent}</div>
              <div class="small-copy">Longest ${state.stats.questDayStreakLongest}</div>
            </div>
          </div>
        </div>
      </article>
      <article class="page panel">
        <div class="panel-header">
          <span class="panel-title">Campaign Pressure</span>
        </div>
        <div class="panel-body">
          <div>
            <div class="week-title">This Week</div>
            <div class="week-sub">Ride enough, fast enough, keep the quest board moving.</div>
          </div>
          <div class="campaign-item">
            <div class="campaign-item-header">
              <span class="campaign-item-label">Cycling</span>
              <span class="status-tag ${cyclingSummary.currentWeek.targetMet ? "status-met" : "status-streak"}">${cyclingSummary.currentWeek.targetMet ? "Target Met" : "In Progress"}</span>
            </div>
            <div class="campaign-item-body">
              <div class="campaign-stat">${cyclingSummary.currentWeek.rideCount}/${state.training.cycling.weeklyRideTarget} qualifying rides</div>
              <div class="campaign-desc">${formatDistanceKm(cyclingSummary.currentWeek.distanceKm)} this week. ${cyclingSummary.currentWeek.ridesRemaining} ride${cyclingSummary.currentWeek.ridesRemaining === 1 ? "" : "s"} to hit the count target.</div>
            </div>
          </div>
          <div class="campaign-item">
            <div class="campaign-item-header">
              <span class="campaign-item-label">Fasting</span>
              <span class="status-tag ${fastingSummary.currentWeek.targetMet ? "status-met" : "status-streak"}">${fastingSummary.currentWeek.targetMet ? "Target Met" : `${fastingSummary.streak.current} Day Streak`}</span>
            </div>
            <div class="campaign-item-body">
              <div class="campaign-stat">${fastingSummary.currentWeek.completedDays}/${fastingSummary.currentWeek.targetDays} target fasts</div>
              <div class="campaign-desc">Target hours: ${state.training.fasting.targetHours}. This week is about calm consistency, not perfection.</div>
            </div>
          </div>
          <div class="campaign-item">
            <div class="campaign-item-header">
              <span class="campaign-item-label">Quest Board</span>
              ${questSummary.overdue ? `<span class="status-tag status-streak">${questSummary.overdue} overdue</span>` : ""}
            </div>
            <div class="campaign-item-body">
              <div class="campaign-stat">${questSummary.inProgress} in progress - ${questSummary.available} available</div>
              <div class="campaign-desc">${questSummary.closed} quests recorded. Keep the chain moving, not just the to-do list.</div>
            </div>
          </div>
        </div>
      </article>
    </section>
    <section class="page-spread overview-secondary-row">
      ${renderScheduledPanel()}
      ${renderChainPanel(chains)}
    </section>
    <section class="page-spread dashboard-support-row">
      ${renderActivityPanel()}
      ${renderFocusPanel(chains, cyclingSummary, fastingSummary)}
    </section>
  `;
}

function renderQuestCard(quest) {
  const unlocked = prerequisitesComplete(state, quest);
  const questNames = getQuestNameMap(state);
  const completedBonuses = countQuestBonuses(quest);
  const reward = computeQuestReward(state, quest);

  return `
    <article class="quest-card">
      <div class="quest-head">
        <div>
          <div class="quest-meta">
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
            <h2 class="page-title">Chains, Failures, and History</h2>
            <p class="page-copy">This side of the journal keeps chain context, bonus objective progress, and the closed record.</p>
          </div>
        </div>
        <div class="section-stack">
          <div class="card">
            <div class="section-label">Quest Chains</div>
            ${chainGroups.length ? chainGroups.map(renderChainCard).join("") : `<div class="empty-state">Create a quest chain by giving related quests the same chain name.</div>`}
          </div>
          <div class="card">
            <div class="section-label">Closed Entries</div>
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
          <p class="training-copy">Stored in-browser for personal use under <strong>${escapeHtml(STORAGE_KEY)}</strong>. A production multi-user version should move token exchange to a backend.</p>
          <div class="small-copy">
            Last sync: ${escapeHtml(strava.lastSyncAt ? formatDate(strava.lastSyncAt, { day: "numeric", month: "short", year: "numeric" }) : "never")}
            ${strava.lastError ? `<br>${escapeHtml(strava.lastError)}` : ""}
          </div>
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

function renderTraining() {
  const cyclingSummary = getCyclingSummary(state);
  const fastingSummary = getFastingSummary(state);
  return `<section class="training-layout">${renderCyclingPanel(cyclingSummary)}${renderFastingPanel(fastingSummary)}</section>`;
}

function renderRewards() {
  return `
    <section class="page-spread">
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Reward Treasury</p>
            <h2 class="page-title">Claimable Indulgences</h2>
            <p class="page-copy">The rewards exist to reinforce consistency, not to become the whole game.</p>
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
            <p class="page-copy">A running record of rewards earned through completed quests.</p>
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
  return `
    <section class="page-spread">
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Connections and Targets</p>
            <h2 class="page-title">Operational Settings</h2>
            <p class="page-copy">These settings shape the streak logic, weekly thresholds, and how cycling data enters the journal.</p>
          </div>
        </div>
        <div class="settings-grid">
          <form class="settings-card form-shell" data-form="strava-settings">
            <div class="section-label">Strava Sync</div>
            <div class="small-copy">For personal use right now, paste a Strava access token here. Later we can replace this with a proper backend OAuth exchange.</div>
            <div>
              <label class="form-label" for="accessToken">Access token</label>
              <input class="text-input token-field" id="accessToken" name="accessToken" type="password" value="${safeAttr(strava.accessToken)}" autocomplete="off">
            </div>
            <label class="check-row">
              <input type="checkbox" name="autoSyncEnabled" ${strava.autoSyncEnabled ? "checked" : ""}>
              <span>Auto-sync on load when the last sync is stale.</span>
            </label>
            <div class="settings-actions">
              <button class="primary-button" type="submit">Save Strava settings</button>
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
            <div class="section-label">Backup</div>
            <div class="small-copy">Export the full chronicle as JSON or import a previous backup.</div>
            <div class="settings-actions">
              <button class="primary-button" type="button" data-action="export-state">Export backup</button>
              <button class="ghost-button" type="button" data-action="load-demo-state">Load demo chronicle</button>
              <label class="secondary-button" style="display:inline-flex;align-items:center;justify-content:center">
                Import backup
                <input type="file" data-action="import-state" accept="application/json" style="display:none">
              </label>
            </div>
          </div>
        </div>
      </article>
      <article class="page">
        <div class="page-title-row">
          <div>
            <p class="page-kicker">Implementation Notes</p>
            <h2 class="page-title">What This Build Covers</h2>
            <p class="page-copy">This version moves the app into a cleaner web-app structure, adds chain-driven quests, and turns vitality into a cycling and fasting campaign.</p>
          </div>
        </div>
        <div class="section-stack">
          <div class="note-strip">Quest chains, bonus objectives, and in-progress or failed states are all now first-class citizens in the board.</div>
          <div class="note-strip">Cycling is designed around real ride imports plus manual notes. Fasting stays manual for now, but the streak and weekly system is already in place.</div>
          <div class="note-strip">The web app entry point is <strong>index.html</strong>. The old single-file prototype remains in the workspace as a legacy reference.</div>
        </div>
      </article>
    </section>
  `;
}

function renderSidebarIcon(kind) {
  const icons = {
    overview: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 10.5 12 3l9 7.5"></path>
        <path d="M5.25 9.75V21h13.5V9.75"></path>
        <path d="M9.75 21v-5.25h4.5V21"></path>
      </svg>`,
    quests: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.5 4.5h9A1.5 1.5 0 0 1 18 6v12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18V6a1.5 1.5 0 0 1 1.5-1.5Z"></path>
        <path d="M9 8.25h6"></path>
        <path d="M9 12h6"></path>
        <path d="M9 15.75h3.75"></path>
      </svg>`,
    cycling: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6.75" cy="16.5" r="3"></circle>
        <circle cx="17.25" cy="16.5" r="3"></circle>
        <path d="m9.75 16.5 2.4-5.25h3.6"></path>
        <path d="m10.5 8.25 1.65 3h3.35"></path>
        <path d="M12.15 11.25 9 11.25"></path>
      </svg>`,
    fasting: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.25"></circle>
        <path d="M12 7.5v5.25l3 1.5"></path>
      </svg>`,
    rewards: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 7.5h12v3.75H6z"></path>
        <path d="M7.5 11.25v8.25h9v-8.25"></path>
        <path d="M12 7.5v12"></path>
        <path d="M12 7.5c-.9 0-3-.45-3-2.25 0-1.2.9-1.95 2.1-1.95 1.5 0 2.1 2.1 2.1 4.2Z"></path>
        <path d="M12 7.5c.9 0 3-.45 3-2.25 0-1.2-.9-1.95-2.1-1.95-1.5 0-2.1 2.1-2.1 4.2Z"></path>
      </svg>`,
    settings: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 8.25A3.75 3.75 0 1 0 12 15.75A3.75 3.75 0 1 0 12 8.25z"></path>
        <path d="M19.5 12a7.4 7.4 0 0 0-.09-1.13l2-1.56-1.9-3.29-2.42.82a7.8 7.8 0 0 0-1.95-1.13L14.7 3h-3.4l-.44 2.71a7.8 7.8 0 0 0-1.95 1.13l-2.42-.82-1.9 3.29 2 1.56A7.4 7.4 0 0 0 4.5 12c0 .38.03.76.09 1.13l-2 1.56 1.9 3.29 2.42-.82c.6.47 1.26.85 1.95 1.13L11.3 21h3.4l.44-2.71c.69-.28 1.35-.66 1.95-1.13l2.42.82 1.9-3.29-2-1.56c.06-.37.09-.75.09-1.13Z"></path>
      </svg>`
  };

  return icons[kind] || "";
}

function renderTabs() {
  const tabs = [
    ["overview", "Overview", "overview"],
    ["quests", "Quests", "quests"],
    ["cycling", "Cycling", "cycling"],
    ["fasting", "Fasting", "fasting"],
    ["rewards", "Rewards", "rewards"],
    ["settings", "Settings", "settings"]
  ];

  return `
    <nav class="sidebar">
      ${tabs.map(([key, label, icon], index) => `
        <button
          class="nav-btn ${ui.tab === key ? "active" : ""} ${index === tabs.length - 1 ? "nav-btn-bottom" : ""}"
          type="button"
          data-tab="${key}"
          title="${escapeHtml(label)}"
          aria-label="${escapeHtml(label)}"
        >
          ${renderSidebarIcon(icon)}
        </button>`).join("")}
    </nav>
  `;
}

function renderShellHeader() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";
  const shellCopy = {
    overview: "The System rewards consistency. Keep the board moving and your momentum alive.",
    quests: "Quest chains turn discipline into a campaign instead of a scattered grind.",
    cycling: "Cycling has its own command surface now. Keep the ride streak and distance targets honest.",
    fasting: "Fasting stands on its own. Watch the streak, target hours, and ledger quality.",
    rewards: "Rewards are trophies from the grind, not the reason for it.",
    settings: "Adjust thresholds and sync rules before the next run begins."
  };

  return `
    <section class="header-band">
      <div>
        <p class="greeting">${greeting}</p>
        <h1 class="welcome">Welcome back, <span>${escapeHtml(state.character.name)}</span></h1>
        <p class="tagline">${escapeHtml(shellCopy[ui.tab] || shellCopy.overview)}</p>
      </div>
      <div class="header-actions">
        <button class="btn" type="button" data-action="load-demo-state">Demo reset</button>
        <button class="btn btn-primary" type="button" data-action="open-modal" data-modal="${ui.tab === "cycling" ? "ride" : ui.tab === "fasting" ? "fast" : ui.tab === "rewards" ? "reward" : "quest"}">
          ${ui.tab === "cycling" ? "Log ride" : ui.tab === "fasting" ? "Log fast" : ui.tab === "rewards" ? "Add reward" : "New quest"}
        </button>
      </div>
    </section>
  `;
}

function renderGoalStatusCard({ label, value, note, ringValue, ringUnit = "", progress = 0, accentClass = "accent-cyan" }) {
  const circumference = 163.4;
  const clamped = Math.max(0, Math.min(progress, 100));
  const filled = ((clamped / 100) * circumference).toFixed(1);
  const remainder = Math.max(circumference - Number(filled), 0).toFixed(1);

  return `
    <article class="summary-card goal-status-card">
      <div class="stat-text">
        <div class="summary-label">${escapeHtml(label)}</div>
        <div class="summary-value">${escapeHtml(value)}</div>
        <div class="summary-note">${escapeHtml(note)}</div>
      </div>
      <div class="stat-ring-wrap">
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="26" fill="none" class="ring-track" stroke-width="4"></circle>
          <circle
            cx="32"
            cy="32"
            r="26"
            fill="none"
            class="ring-progress ${accentClass}"
            stroke-width="4"
            stroke-dasharray="${filled} ${remainder}"
            stroke-linecap="round"
          ></circle>
        </svg>
        <div class="stat-ring-inner">
          <span class="stat-ring-val">${escapeHtml(ringValue)}</span>
          ${ringUnit ? `<span class="stat-ring-unit">${escapeHtml(ringUnit)}</span>` : ""}
        </div>
      </div>
    </article>
  `;
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
  const totalSegments = Math.max(1, Math.round(Number(segments) || 1));
  const filledCount = Math.max(0, Math.min(totalSegments, Math.round(Number(filledSegments) || 0)));
  const segmentMarkup = Array.from({ length: totalSegments }, (_, index) => `
        <span class="goal-progress-segment ${index < filledCount ? "is-filled" : ""}"></span>
      `).join("");

  return `
    <article class="goal-progress-card ${accentClass}">
      <div class="goal-progress-head">
        <div class="summary-label">${escapeHtml(label)}</div>
        <div class="goal-progress-percent">${clamped}%</div>
      </div>
      <div class="goal-progress-value">${escapeHtml(value)}</div>
      <div class="goal-progress-note">${escapeHtml(note)}</div>
      <div class="goal-progress-bar" style="--segment-count:${totalSegments};">
        ${segmentMarkup}
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

function renderCurrentTab() {
  if (!state.character) return renderOnboarding();
  if (ui.tab === "quests") return renderQuests();
  if (ui.tab === "cycling") return renderCyclingPanel(getCyclingSummary(state));
  if (ui.tab === "fasting") return renderFastingPanel(getFastingSummary(state));
  if (ui.tab === "rewards") return renderRewards();
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
            <button class="primary-button" type="submit">Seal quest</button>
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
}

async function handleClick(event) {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    ui.tab = tab.dataset.tab;
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
