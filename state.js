export const STORAGE_KEY = "discipline_chronicle_v1";
export const LEGACY_KEYS = ["quest_ledger_v4", "rpg_quest_v3"];
export const FORCE_DEMO_ON_FIRST_LOAD = true;

export const DIFFICULTIES = {
  trivial: { label: "E-Rank", xp: 10, rewardChance: 0.5 },
  easy: { label: "D-Rank", xp: 25, rewardChance: 0.6 },
  medium: { label: "C-Rank", xp: 50, rewardChance: 0.7 },
  hard: { label: "B-Rank", xp: 100, rewardChance: 0.8 },
  epic: { label: "A-Rank", xp: 200, rewardChance: 0.9 },
  legendary: { label: "S-Rank", xp: 500, rewardChance: 1 }
};

export const CATEGORIES = {
  health: { label: "Health", colorClass: "category-health", icon: "Heart" },
  intelligence: { label: "Focus", colorClass: "category-intelligence", icon: "Lore" },
  money: { label: "Money", colorClass: "category-money", icon: "Coin" },
  relationships: { label: "Relationships", colorClass: "category-relationships", icon: "Bond" }
};

export const QUEST_DISCIPLINES = {
  cycling: { label: "Cycling", colorClass: "discipline-cycling" },
  running: { label: "Running", colorClass: "discipline-running" },
  fasting: { label: "Fasting", colorClass: "discipline-fasting" },
  reading: { label: "Reading", colorClass: "discipline-reading" },
  general: { label: "General", colorClass: "discipline-general" }
};

export const CLASSES = {
  warrior: { name: "Wayfinder", bonus: "20% Health quest XP", statBonus: "health" },
  scholar: { name: "Archivist", bonus: "20% Focus quest XP", statBonus: "intelligence" },
  merchant: { name: "Quartermaster", bonus: "20% Money quest XP", statBonus: "money" },
  diplomat: { name: "Envoy", bonus: "20% Relationships quest XP", statBonus: "relationships" },
  adventurer: { name: "Warden", bonus: "5% all quest XP", statBonus: "all" }
};

export const REWARD_TIERS = ["common", "uncommon", "rare", "epic", "legendary"];

export const DEFAULT_REWARDS = [
  { id: "reward_1", name: "Coffee stop and pastry", tier: "common", cooldownDays: 0 },
  { id: "reward_2", name: "Quiet evening with a show", tier: "common", cooldownDays: 0 },
  { id: "reward_3", name: "Long gaming session", tier: "uncommon", cooldownDays: 1 },
  { id: "reward_4", name: "Favourite meal out", tier: "rare", cooldownDays: 3 },
  { id: "reward_5", name: "New cycling kit piece", tier: "epic", cooldownDays: 14 },
  { id: "reward_6", name: "Weekend adventure", tier: "legendary", cooldownDays: 30 }
];

const DEFAULT_CHARACTER = null;

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function toDateKey(input) {
  const date = input instanceof Date ? input : new Date(input);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value) {
  return new Date(`${value}T12:00:00`);
}

export function startOfWeek(input = new Date()) {
  const date = input instanceof Date ? new Date(input) : new Date(input);
  date.setHours(0, 0, 0, 0);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
}

export function weekKey(input = new Date()) {
  return toDateKey(startOfWeek(input));
}

export function weekRange(input = new Date()) {
  const start = startOfWeek(input);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

export function formatDate(input, options = { day: "numeric", month: "short" }) {
  return new Date(input).toLocaleDateString("en-GB", options);
}

export function formatDistanceKm(value) {
  return `${Number(value || 0).toFixed(1)} km`;
}

export function formatMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value || 0)));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}

export function formatHours(value) {
  return `${Number(value || 0).toFixed(1)} h`;
}

export function xpForLevel(level) {
  return level * level * 50 + level * 50;
}

export function getLevel(totalXp = 0) {
  let xp = totalXp;
  let level = 1;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
  }
  return Math.max(1, level);
}

export function xpIntoCurrentLevel(totalXp = 0) {
  let xp = totalXp;
  let level = 1;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
  }
  return xp;
}

export function createDefaultState() {
  return {
    version: 1,
    character: DEFAULT_CHARACTER,
    quests: [],
    rewards: deepClone(DEFAULT_REWARDS),
    rewardHistory: [],
    goals: {
      weeklyQuestTarget: 4
    },
    stats: {
      totalQuests: 0,
      questsByCategory: {},
      questsByDay: {},
      questDayStreakCurrent: 0,
      questDayStreakLongest: 0,
      questLastCompletedDate: null
    },
    training: {
      cycling: {
        weeklyRideTarget: 3,
        weeklyDistanceTargetKm: 90,
        qualifyingRideKm: 20,
        qualifyingRideMinutes: 45,
        rides: [],
        strava: {
          accessToken: "",
          athleteName: "",
          lastSyncAt: null,
          lastSyncStatus: "idle",
          lastError: "",
          autoSyncEnabled: true
        }
      },
      fasting: {
        targetHours: 16,
        weeklyTargetDays: 5,
        logs: []
      },
      running: {
        weeklyRunTarget: 4,
        weeklyDistanceTargetKm: 40,
        qualifyingRunKm: 3,
        qualifyingRunMinutes: 20,
        runs: []
      },
      reading: {
        dailyPageTarget: 30,
        yearlyBookTarget: 12,
        clubMeetingDay: "",
        books: [],
        sessions: []
      }
    },
    disciplines: {
      cycling: true,
      running: false,
      fasting: true,
      reading: false
    }
  };
}

const QUEST_DISCIPLINE_PATTERNS = {
  cycling: [/\bride(s|r|ing)?\b/i, /\bbike(s|d|ing)?\b/i, /\bcycl(e|es|ing|ist)?\b/i, /\bstrava\b/i],
  running: [/\brun(s|ning)?\b/i, /\bjog(s|ging)?\b/i, /\bpace\b/i, /\b(5k|10k|half marathon|marathon)\b/i],
  fasting: [/\bfast(s|ing)?\b/i, /\b16:8\b/i, /\b18[\s-]?hour\b/i, /\bmeal window(s)?\b/i, /\beating window(s)?\b/i],
  reading: [/\bread(ing)?\b/i, /\bbook(s)?\b/i, /\bpage(s)?\b/i, /\bchapter(s)?\b/i, /\bbook club\b/i]
};

function inferQuestDiscipline(raw = {}) {
  if (QUEST_DISCIPLINES[raw.discipline]) return raw.discipline;

  const haystack = [raw.title, raw.description, raw.notes, raw.chainId]
    .filter(Boolean)
    .join(" ");

  if (!haystack.trim()) return "general";

  for (const [discipline, patterns] of Object.entries(QUEST_DISCIPLINE_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(haystack))) return discipline;
  }

  return "general";
}

function hasMeaningfulState(state) {
  if (!state || typeof state !== "object") return false;
  if (state.character) return true;
  if (Array.isArray(state.quests) && state.quests.length) return true;
  if (Array.isArray(state.rewardHistory) && state.rewardHistory.length) return true;
  if (Array.isArray(state.training?.cycling?.rides) && state.training.cycling.rides.length) return true;
  if (Array.isArray(state.training?.fasting?.logs) && state.training.fasting.logs.length) return true;
  if (Array.isArray(state.training?.running?.runs) && state.training.running.runs.length) return true;
  if (Array.isArray(state.training?.reading?.books) && state.training.reading.books.length) return true;
  if (Array.isArray(state.training?.reading?.sessions) && state.training.reading.sessions.length) return true;
  return false;
}

function isoAt(date) {
  return new Date(date).toISOString();
}

function offsetDate(base, dayOffset, hour = 8, minute = 0) {
  const next = new Date(base);
  next.setHours(hour, minute, 0, 0);
  next.setDate(next.getDate() + dayOffset);
  return next;
}

function buildDemoQuestStats(quests) {
  const completed = quests.filter((quest) => quest.state === "completed" && quest.completedAt);
  const questsByCategory = {};
  const questsByDay = {};

  for (const quest of completed) {
    questsByCategory[quest.category] = (questsByCategory[quest.category] || 0) + 1;
    const key = toDateKey(quest.completedAt);
    questsByDay[key] = (questsByDay[key] || 0) + 1;
  }

  const completionKeys = uniqueSortedDateKeys(Object.keys(questsByDay));
  const streak = buildConsecutiveRun(completionKeys, 1);

  return {
    totalQuests: completed.length,
    questsByCategory,
    questsByDay,
    questDayStreakCurrent: streak.current,
    questDayStreakLongest: streak.longest,
    questLastCompletedDate: streak.lastKey
  };
}

export function createDemoState() {
  const demo = createDefaultState();
  const now = new Date();
  const currentWeekStart = startOfWeek(now);
  const previousWeekStart = offsetDate(currentWeekStart, -7, 7, 0);
  const twoWeeksAgoStart = offsetDate(currentWeekStart, -14, 7, 0);

  demo.goals.weeklyQuestTarget = 4;

  demo.character = {
    name: "Mika",
    title: "The Relentless Builder",
    class: "adventurer",
    xp: 3825,
    gold: 540,
    hp: 142,
    stats: {
      vitality: 18,
      wisdom: 16,
      fortune: 14,
      charisma: 13
    }
  };

  const quest1Id = uid("quest");
  const quest2Id = uid("quest");
  const quest3Id = uid("quest");
  const quest4Id = uid("quest");
  const quest5Id = uid("quest");
  const quest6Id = uid("quest");
  const quest7Id = uid("quest");
  const quest8Id = uid("quest");
  const quest9Id = uid("quest");
  const quest10Id = uid("quest");

  demo.quests = [
    {
      id: quest1Id,
      title: "Define the spring cut rules",
      description: "Write the non-negotiables for fasting, cycling volume, and recovery so the week has rules instead of moods.",
      category: "health",
      discipline: "general",
      difficulty: "medium",
      state: "completed",
      dueDate: toDateKey(offsetDate(now, -10)),
      recurrence: "none",
      chainId: "Spring Cut Phase",
      prerequisiteIds: [],
      bonusObjectives: [
        { id: uid("bonus"), title: "Set a calorie floor", done: true },
        { id: uid("bonus"), title: "List trigger foods to avoid buying", done: true }
      ],
      createdAt: isoAt(offsetDate(now, -12)),
      startedAt: isoAt(offsetDate(now, -11)),
      completedAt: isoAt(offsetDate(now, -10)),
      failedAt: null,
      notes: "This quest establishes the ruleset for the cut."
    },
    {
      id: quest2Id,
      title: "Hit three qualifying rides this week",
      description: "Use rides as the backbone habit that stabilises discipline everywhere else.",
      category: "health",
      discipline: "cycling",
      difficulty: "hard",
      state: "completed",
      dueDate: toDateKey(offsetDate(now, -3)),
      recurrence: "weekly",
      chainId: "Road to 100 km",
      prerequisiteIds: [],
      bonusObjectives: [
        { id: uid("bonus"), title: "One ride above 40 km", done: true },
        { id: uid("bonus"), title: "One ride with notes on pacing", done: true }
      ],
      createdAt: isoAt(offsetDate(now, -9)),
      startedAt: isoAt(offsetDate(now, -8)),
      completedAt: isoAt(offsetDate(now, -3)),
      failedAt: null,
      notes: "Cycling is the keystone habit."
    },
    {
      id: quest3Id,
      title: "Keep a 16:8 fasting streak for five days",
      description: "Log every fasting window and write one line about hunger, energy, or environment.",
      category: "health",
      discipline: "fasting",
      difficulty: "hard",
      state: "in_progress",
      dueDate: toDateKey(offsetDate(now, 2)),
      recurrence: "weekly",
      chainId: "Spring Cut Phase",
      prerequisiteIds: [quest1Id],
      bonusObjectives: [
        { id: uid("bonus"), title: "Add a note to every logged fast", done: true },
        { id: uid("bonus"), title: "Finish one fast above 18 hours", done: false }
      ],
      createdAt: isoAt(offsetDate(now, -2)),
      startedAt: isoAt(offsetDate(now, -1)),
      completedAt: null,
      failedAt: null,
      notes: "This week is about repeatability, not punishment."
    },
    {
      id: quest4Id,
      title: "Simulate the first 100 km ride",
      description: "Build confidence with a long endurance ride once the weekly consistency block is in place.",
      category: "health",
      discipline: "cycling",
      difficulty: "epic",
      state: "available",
      dueDate: toDateKey(offsetDate(now, 10)),
      recurrence: "none",
      chainId: "Road to 100 km",
      prerequisiteIds: [quest2Id],
      bonusObjectives: [
        { id: uid("bonus"), title: "Fuel on the bike without overeating after", done: false },
        { id: uid("bonus"), title: "Write a full pacing review", done: false }
      ],
      createdAt: isoAt(offsetDate(now, -1)),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      notes: "Locked behind the consistency work."
    },
    {
      id: quest5Id,
      title: "Ship the first public build log",
      description: "Write and publish a short update on the app so momentum stays visible.",
      category: "intelligence",
      discipline: "general",
      difficulty: "medium",
      state: "available",
      dueDate: toDateKey(offsetDate(now, 3)),
      recurrence: "none",
      chainId: "Creator Arc",
      prerequisiteIds: [],
      bonusObjectives: [
        { id: uid("bonus"), title: "Share one screenshot of the product", done: false }
      ],
      createdAt: isoAt(offsetDate(now, -1)),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      notes: "Documentation creates accountability."
    },
    {
      id: quest6Id,
      title: "Book a proper bike fit",
      description: "Resolve fit discomfort before volume climbs again.",
      category: "money",
      discipline: "cycling",
      difficulty: "easy",
      state: "completed",
      dueDate: toDateKey(offsetDate(now, -18)),
      recurrence: "none",
      chainId: "Road to 100 km",
      prerequisiteIds: [],
      bonusObjectives: [],
      createdAt: isoAt(offsetDate(now, -21)),
      startedAt: isoAt(offsetDate(now, -20)),
      completedAt: isoAt(offsetDate(now, -18)),
      failedAt: null,
      notes: "Health investment, not a luxury."
    },
    {
      id: quest7Id,
      title: "Plan this week's meal windows",
      description: "Write the planned eating windows before the week starts.",
      category: "health",
      discipline: "fasting",
      difficulty: "easy",
      state: "completed",
      dueDate: toDateKey(offsetDate(now, -1)),
      recurrence: "weekly",
      chainId: "Spring Cut Phase",
      prerequisiteIds: [quest1Id],
      bonusObjectives: [
        { id: uid("bonus"), title: "Remove one obvious binge trigger from the house", done: true }
      ],
      createdAt: isoAt(offsetDate(now, -3)),
      startedAt: isoAt(offsetDate(now, -2)),
      completedAt: isoAt(offsetDate(now, -1)),
      failedAt: null,
      notes: "Planning removes emotional negotiation."
    },
    {
      id: quest8Id,
      title: "Sunrise interval session",
      description: "A sharp threshold ride before work.",
      category: "health",
      discipline: "cycling",
      difficulty: "hard",
      state: "failed",
      dueDate: toDateKey(offsetDate(now, -5)),
      recurrence: "none",
      chainId: "Road to 100 km",
      prerequisiteIds: [],
      bonusObjectives: [],
      createdAt: isoAt(offsetDate(now, -6)),
      startedAt: isoAt(offsetDate(now, -5, 5, 0)),
      completedAt: null,
      failedAt: isoAt(offsetDate(now, -5, 8, 0)),
      notes: "Bad sleep and poor prep. Good lesson."
    },
    {
      id: quest9Id,
      title: "Zero sugar for 14 days",
      description: "An overly aggressive challenge that looked good on paper and broke in practice.",
      category: "health",
      discipline: "fasting",
      difficulty: "medium",
      state: "abandoned",
      dueDate: toDateKey(offsetDate(now, -7)),
      recurrence: "none",
      chainId: "Spring Cut Phase",
      prerequisiteIds: [],
      bonusObjectives: [],
      createdAt: isoAt(offsetDate(now, -14)),
      startedAt: isoAt(offsetDate(now, -13)),
      completedAt: null,
      failedAt: isoAt(offsetDate(now, -7)),
      notes: "Too rigid. Replaced by the fasting ledger."
    },
    {
      id: quest10Id,
      title: "Record one social event without derailing the cut",
      description: "Go out, enjoy the evening, and still close the day intentionally.",
      category: "relationships",
      discipline: "general",
      difficulty: "medium",
      state: "available",
      dueDate: toDateKey(offsetDate(now, 4)),
      recurrence: "none",
      chainId: "Composure Arc",
      prerequisiteIds: [],
      bonusObjectives: [
        { id: uid("bonus"), title: "Write one line on what made the evening easier", done: false }
      ],
      createdAt: isoAt(offsetDate(now, -1)),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      notes: "Discipline should survive real life."
    }
  ];

  demo.rewards = [
    { id: uid("reward"), name: "Flat white and pastry stop", tier: "common", cooldownDays: 0 },
    { id: uid("reward"), name: "Two hours of guilt-free gaming", tier: "common", cooldownDays: 0 },
    { id: uid("reward"), name: "Cinema night", tier: "uncommon", cooldownDays: 2 },
    { id: uid("reward"), name: "Takeaway meal with no compromise", tier: "rare", cooldownDays: 4 },
    { id: uid("reward"), name: "New cycling jersey", tier: "epic", cooldownDays: 14 },
    { id: uid("reward"), name: "Weekend away", tier: "legendary", cooldownDays: 30 }
  ];

  demo.rewardHistory = [
    {
      id: uid("history"),
      name: "Cinema night",
      tier: "uncommon",
      questTitle: "Hit three qualifying rides this week",
      unlockedAt: isoAt(offsetDate(now, -3, 20, 0))
    },
    {
      id: uid("history"),
      name: "Flat white and pastry stop",
      tier: "common",
      questTitle: "Plan this week's meal windows",
      unlockedAt: isoAt(offsetDate(now, -1, 13, 0))
    }
  ];

  demo.training.cycling.weeklyRideTarget = 3;
  demo.training.cycling.weeklyDistanceTargetKm = 110;
  demo.training.cycling.qualifyingRideKm = 20;
  demo.training.cycling.qualifyingRideMinutes = 45;
  demo.training.cycling.rides = [
    {
      id: uid("ride"),
      source: "strava",
      stravaId: "ride_demo_1",
      name: "Tempo loop before work",
      startAt: isoAt(offsetDate(currentWeekStart, 0, 6, 15)),
      distanceKm: 31.4,
      movingTimeMin: 74,
      elevationM: 280,
      note: "Legs woke up after 20 minutes. Kept the effort steady."
    },
    {
      id: uid("ride"),
      source: "strava",
      stravaId: "ride_demo_2",
      name: "Evening endurance ride",
      startAt: isoAt(offsetDate(currentWeekStart, 1, 17, 40)),
      distanceKm: 42.7,
      movingTimeMin: 101,
      elevationM: 402,
      note: "Kept heart rate calm and resisted sprinting on climbs."
    },
    {
      id: uid("ride"),
      source: "manual",
      stravaId: "",
      name: "Recovery spin and podcast",
      startAt: isoAt(offsetDate(currentWeekStart, 2, 18, 5)),
      distanceKm: 24.2,
      movingTimeMin: 58,
      elevationM: 116,
      note: "This one was purely for consistency."
    },
    {
      id: uid("ride"),
      source: "strava",
      stravaId: "ride_demo_3",
      name: "Saturday group ride",
      startAt: isoAt(offsetDate(previousWeekStart, 5, 7, 10)),
      distanceKm: 68.5,
      movingTimeMin: 163,
      elevationM: 620,
      note: "A proper confidence ride. Nutrition stayed under control after."
    },
    {
      id: uid("ride"),
      source: "strava",
      stravaId: "ride_demo_4",
      name: "Midweek threshold intervals",
      startAt: isoAt(offsetDate(previousWeekStart, 2, 6, 0)),
      distanceKm: 27.3,
      movingTimeMin: 66,
      elevationM: 210,
      note: "Hard start, strong finish."
    },
    {
      id: uid("ride"),
      source: "strava",
      stravaId: "ride_demo_5",
      name: "Coffee loop",
      startAt: isoAt(offsetDate(previousWeekStart, 0, 6, 40)),
      distanceKm: 22.1,
      movingTimeMin: 51,
      elevationM: 154,
      note: "Just enough to keep the weekly chain alive."
    },
    {
      id: uid("ride"),
      source: "strava",
      stravaId: "ride_demo_6",
      name: "Long aerobic base ride",
      startAt: isoAt(offsetDate(twoWeeksAgoStart, 6, 6, 35)),
      distanceKm: 79.4,
      movingTimeMin: 188,
      elevationM: 710,
      note: "First ride that made 100 km feel realistic."
    },
    {
      id: uid("ride"),
      source: "strava",
      stravaId: "ride_demo_7",
      name: "Commuter recovery spin",
      startAt: isoAt(offsetDate(twoWeeksAgoStart, 2, 17, 15)),
      distanceKm: 21.9,
      movingTimeMin: 48,
      elevationM: 94,
      note: "Low drama. Exactly the point."
    },
    {
      id: uid("ride"),
      source: "strava",
      stravaId: "ride_demo_8",
      name: "Lunch break tempo effort",
      startAt: isoAt(offsetDate(twoWeeksAgoStart, 0, 12, 10)),
      distanceKm: 29.8,
      movingTimeMin: 71,
      elevationM: 230,
      note: "Tough to start, great after 15 minutes."
    }
  ];
  demo.training.cycling.strava = {
    accessToken: "",
    athleteName: "Demo Rider",
    lastSyncAt: isoAt(offsetDate(now, -1, 18, 0)),
    lastSyncStatus: "success",
    lastError: "",
    autoSyncEnabled: true
  };

  demo.training.fasting.targetHours = 16;
  demo.training.fasting.weeklyTargetDays = 5;
  demo.training.fasting.logs = [
    {
      id: uid("fast"),
      startAt: isoAt(offsetDate(currentWeekStart, -1, 20, 30)),
      endAt: isoAt(offsetDate(currentWeekStart, 0, 12, 45)),
      hours: 16.25,
      note: "Morning ride felt easier after a clean fast close."
    },
    {
      id: uid("fast"),
      startAt: isoAt(offsetDate(currentWeekStart, 0, 20, 10)),
      endAt: isoAt(offsetDate(currentWeekStart, 1, 13, 0)),
      hours: 16.83,
      note: "Worked late, but the window stayed intact."
    },
    {
      id: uid("fast"),
      startAt: isoAt(offsetDate(currentWeekStart, 1, 19, 55)),
      endAt: isoAt(offsetDate(currentWeekStart, 2, 12, 20)),
      hours: 16.42,
      note: "Hunger peaked at 10:30 then faded."
    },
    {
      id: uid("fast"),
      startAt: isoAt(offsetDate(previousWeekStart, 3, 20, 20)),
      endAt: isoAt(offsetDate(previousWeekStart, 4, 13, 5)),
      hours: 16.75,
      note: "Social dinner the night before, still closed the fast well."
    },
    {
      id: uid("fast"),
      startAt: isoAt(offsetDate(previousWeekStart, 2, 20, 0)),
      endAt: isoAt(offsetDate(previousWeekStart, 3, 12, 10)),
      hours: 16.16,
      note: "Kept caffeine and water high, made the morning simple."
    },
    {
      id: uid("fast"),
      startAt: isoAt(offsetDate(previousWeekStart, 1, 20, 40)),
      endAt: isoAt(offsetDate(previousWeekStart, 2, 12, 50)),
      hours: 16.16,
      note: "One of the easiest fasts of the block."
    }
  ];

  demo.stats = buildDemoQuestStats(demo.quests);

  demo.disciplines = { cycling: true, running: true, fasting: true, reading: true };

  demo.training.running = {
    weeklyRunTarget: 4,
    weeklyDistanceTargetKm: 40,
    qualifyingRunKm: 3,
    qualifyingRunMinutes: 20,
    runs: [
      { id: uid("run"), source: "strava", stravaId: "run_demo_1", name: "Morning tempo run", startAt: isoAt(offsetDate(currentWeekStart, 0, 6, 30)), distanceKm: 8.2, movingTimeMin: 46, elevationM: 62, avgPaceMinPerKm: 5.6, note: "Legs felt heavy for the first 2 km then settled." },
      { id: uid("run"), source: "manual", stravaId: "", name: "Easy recovery jog", startAt: isoAt(offsetDate(currentWeekStart, 1, 17, 0)), distanceKm: 5.1, movingTimeMin: 31, elevationM: 28, avgPaceMinPerKm: 6.1, note: "Easy and conversational." },
      { id: uid("run"), source: "strava", stravaId: "run_demo_2", name: "Long slow distance", startAt: isoAt(offsetDate(previousWeekStart, 5, 7, 0)), distanceKm: 12.3, movingTimeMin: 74, elevationM: 110, avgPaceMinPerKm: 6.0, note: "First run that made a half marathon feel realistic." },
      { id: uid("run"), source: "strava", stravaId: "run_demo_3", name: "Interval session", startAt: isoAt(offsetDate(previousWeekStart, 2, 6, 15)), distanceKm: 7.4, movingTimeMin: 38, elevationM: 44, avgPaceMinPerKm: 5.1, note: "6x800m. Hard but felt strong." }
    ]
  };

  demo.training.reading = {
    dailyPageTarget: 30,
    yearlyBookTarget: 12,
    clubMeetingDay: "Friday",
    books: [
      { id: uid("book"), title: "The Name of the Wind", author: "Patrick Rothfuss", totalPages: 374, currentPage: 187, startedAt: isoAt(offsetDate(now, -14)), finishedAt: null, clubPick: true, color: "#7f1d1d", initials: "NW", note: "" },
      { id: uid("book"), title: "Atomic Habits", author: "James Clear", totalPages: 320, currentPage: 320, startedAt: isoAt(offsetDate(now, -60)), finishedAt: isoAt(offsetDate(now, -21)), clubPick: false, color: "#1e3a5f", initials: "AH", note: "Changed how I think about streaks." },
      { id: uid("book"), title: "Deep Work", author: "Cal Newport", totalPages: 296, currentPage: 296, startedAt: isoAt(offsetDate(now, -90)), finishedAt: isoAt(offsetDate(now, -45)), clubPick: false, color: "#3b0764", initials: "DW", note: "Required reading for the Creator Arc." }
    ],
    sessions: [
      { id: uid("session"), bookId: "", date: isoAt(offsetDate(now, -1, 21, 15)), pages: 35, note: "The story picked up after the Eolian scene." },
      { id: uid("session"), bookId: "", date: isoAt(offsetDate(now, -2, 20, 0)), pages: 28, note: "Slower reading — took notes." },
      { id: uid("session"), bookId: "", date: isoAt(offsetDate(now, -3, 21, 30)), pages: 41, note: "Could not put it down." }
    ]
  };

  return normalizeState(demo);
}

function normalizeQuestState(raw) {
  if (raw.state) return raw.state;
  if (raw.status === "completed") return "completed";
  if (raw.status === "abandoned") return "abandoned";
  return "available";
}

function normalizeQuest(raw) {
  const bonusObjectives = Array.isArray(raw.bonusObjectives)
    ? raw.bonusObjectives
        .filter(Boolean)
        .map((objective) => {
          if (typeof objective === "string") {
            return { id: uid("bonus"), title: objective, done: false };
          }
          return {
            id: objective.id || uid("bonus"),
            title: objective.title || "",
            done: Boolean(objective.done)
          };
        })
        .filter((objective) => objective.title.trim())
    : [];

  const prerequisiteIds = Array.isArray(raw.prerequisiteIds)
    ? raw.prerequisiteIds.filter(Boolean)
    : Array.isArray(raw.prerequisites)
      ? raw.prerequisites.filter(Boolean)
      : [];

  return {
    id: raw.id || uid("quest"),
    title: raw.title || "Untitled quest",
    description: raw.description || "",
    category: CATEGORIES[raw.category] ? raw.category : "health",
    discipline: inferQuestDiscipline(raw),
    difficulty: DIFFICULTIES[raw.difficulty] ? raw.difficulty : "easy",
    state: normalizeQuestState(raw),
    dueDate: raw.dueDate || null,
    recurrence: raw.recurrence || "none",
    chainId: raw.chainId || "",
    prerequisiteIds,
    bonusObjectives,
    createdAt: raw.createdAt || new Date().toISOString(),
    startedAt: raw.startedAt || null,
    completedAt: raw.completedAt || null,
    failedAt: raw.failedAt || null,
    notes: raw.notes || ""
  };
}

function normalizeReward(raw) {
  return {
    id: raw.id || uid("reward"),
    name: raw.name || "Unnamed reward",
    tier: REWARD_TIERS.includes(raw.tier) ? raw.tier : "common",
    cooldownDays: Number.isFinite(Number(raw.cooldownDays)) ? Number(raw.cooldownDays) : 0
  };
}

function normalizeRide(raw) {
  const startAt = raw.startAt || raw.date || raw.start_date || raw.start_date_local || new Date().toISOString();
  return {
    id: raw.id || uid("ride"),
    source: raw.source || "manual",
    stravaId: raw.stravaId ? String(raw.stravaId) : "",
    name: raw.name || "Ride logged",
    startAt,
    distanceKm: Number(raw.distanceKm || raw.distance || 0),
    movingTimeMin: Number(raw.movingTimeMin || raw.movingTime || 0),
    elevationM: Number(raw.elevationM || raw.elevation || 0),
    note: raw.note || ""
  };
}

function normalizeFastLog(raw) {
  const startAt = raw.startAt || new Date().toISOString();
  const endAt = raw.endAt || startAt;
  const hours = Number.isFinite(Number(raw.hours))
    ? Number(raw.hours)
    : Math.max(0, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 36e5);

  return {
    id: raw.id || uid("fast"),
    startAt,
    endAt,
    hours,
    note: raw.note || ""
  };
}

function normalizeRun(raw) {
  const startAt = raw.startAt || new Date().toISOString();
  return {
    id: raw.id || uid("run"),
    source: raw.source || "manual",
    stravaId: raw.stravaId ? String(raw.stravaId) : "",
    name: raw.name || "Run logged",
    startAt,
    distanceKm: Number(raw.distanceKm || 0),
    movingTimeMin: Number(raw.movingTimeMin || 0),
    elevationM: Number(raw.elevationM || 0),
    avgPaceMinPerKm: Number(raw.avgPaceMinPerKm || 0),
    note: raw.note || ""
  };
}

function normalizeCharacter(raw) {
  if (!raw) return null;
  return {
    name: raw.name || "Hunter",
    title: raw.title || "",
    class: CLASSES[raw.class] ? raw.class : "adventurer",
    xp: Number(raw.xp || 0),
    gold: Number(raw.gold || 0),
    hp: Number.isFinite(Number(raw.hp)) ? Number(raw.hp) : null,
    stats: {
      vitality: Number(raw.stats?.vitality || 10),
      wisdom: Number(raw.stats?.wisdom || 10),
      fortune: Number(raw.stats?.fortune || 10),
      charisma: Number(raw.stats?.charisma || 10)
    }
  };
}

export function normalizeState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== "object") return base;

  const next = {
    ...base,
    ...raw,
    character: normalizeCharacter(raw.character),
    quests: Array.isArray(raw.quests) ? raw.quests.map(normalizeQuest) : base.quests,
    rewards: Array.isArray(raw.rewards) && raw.rewards.length ? raw.rewards.map(normalizeReward) : base.rewards,
    rewardHistory: Array.isArray(raw.rewardHistory) ? raw.rewardHistory : [],
    goals: {
      ...base.goals,
      ...(raw.goals || {})
    },
    stats: {
      ...base.stats,
      ...(raw.stats || {}),
      questsByCategory: { ...base.stats.questsByCategory, ...((raw.stats || {}).questsByCategory || {}) },
      questsByDay: { ...base.stats.questsByDay, ...((raw.stats || {}).questsByDay || {}) }
    },
    training: {
      cycling: {
        ...base.training.cycling,
        ...((raw.training || {}).cycling || {}),
        rides: Array.isArray(raw.training?.cycling?.rides)
          ? raw.training.cycling.rides.map(normalizeRide)
          : base.training.cycling.rides,
        strava: {
          ...base.training.cycling.strava,
          ...((raw.training || {}).cycling?.strava || {})
        }
      },
      fasting: {
        ...base.training.fasting,
        ...((raw.training || {}).fasting || {}),
        logs: Array.isArray(raw.training?.fasting?.logs)
          ? raw.training.fasting.logs.map(normalizeFastLog)
          : base.training.fasting.logs
      },
      running: {
        ...base.training.running,
        ...((raw.training || {}).running || {}),
        runs: Array.isArray(raw.training?.running?.runs)
          ? raw.training.running.runs.map(normalizeRun)
          : base.training.running.runs
      },
      reading: {
        ...base.training.reading,
        ...((raw.training || {}).reading || {}),
        books: Array.isArray(raw.training?.reading?.books) ? raw.training.reading.books : base.training.reading.books,
        sessions: Array.isArray(raw.training?.reading?.sessions) ? raw.training.reading.sessions : base.training.reading.sessions
      }
    },
    disciplines: {
      ...base.disciplines,
      ...(raw.disciplines || {})
    }
  };

  next.quests.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  next.training.cycling.rides.sort((left, right) => new Date(right.startAt).getTime() - new Date(left.startAt).getTime());
  next.training.fasting.logs.sort((left, right) => new Date(right.endAt).getTime() - new Date(left.endAt).getTime());
  next.training.running.runs.sort((left, right) => new Date(right.startAt).getTime() - new Date(left.startAt).getTime());

  return next;
}

function migrateLegacyState(raw) {
  const base = createDefaultState();
  const normalized = normalizeState({
    ...base,
    character: raw.character || null,
    quests: raw.quests || [],
    rewards: raw.rewards || base.rewards,
    stats: raw.stats || base.stats
  });
  return normalized;
}

export function loadState() {
  try {
    const primary = localStorage.getItem(STORAGE_KEY);
    if (primary) {
      const normalizedPrimary = normalizeState(JSON.parse(primary));
      if (FORCE_DEMO_ON_FIRST_LOAD && !hasMeaningfulState(normalizedPrimary)) return createDemoState();
      return normalizedPrimary;
    }

    if (FORCE_DEMO_ON_FIRST_LOAD) return createDemoState();

    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) return migrateLegacyState(JSON.parse(legacy));
    }
  } catch (error) {
    console.error("Failed to load saved state.", error);
  }

  return createDefaultState();
}

export function saveState(state) {
  const normalized = normalizeState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function exportState(state) {
  return JSON.stringify(normalizeState(state), null, 2);
}

export function importState(rawText) {
  return normalizeState(JSON.parse(rawText));
}

export function getQuestById(state, questId) {
  return state.quests.find((quest) => quest.id === questId) || null;
}

export function getQuestNameMap(state) {
  return new Map(state.quests.map((quest) => [quest.id, quest.title]));
}

export function prerequisitesComplete(state, quest) {
  if (!quest.prerequisiteIds.length) return true;
  return quest.prerequisiteIds.every((prerequisiteId) => {
    const prerequisite = getQuestById(state, prerequisiteId);
    return prerequisite && prerequisite.state === "completed";
  });
}

export function countQuestBonuses(quest) {
  return (quest.bonusObjectives || []).filter((objective) => objective.done).length;
}

export function computeQuestReward(state, quest) {
  const difficulty = DIFFICULTIES[quest.difficulty] || DIFFICULTIES.easy;
  const completedBonuses = countQuestBonuses(quest);
  const bonusMultiplier = 1 + completedBonuses * 0.25;
  const character = state.character;
  let classMultiplier = 1;
  if (character) {
    if (character.class === "adventurer") classMultiplier += 0.05;
    if (CLASSES[character.class]?.statBonus === quest.category) classMultiplier += 0.2;
  }

  const todayKey = toDateKey(new Date());
  const firstQuestToday = !state.stats.questsByDay?.[todayKey];
  const xp = Math.round(difficulty.xp * bonusMultiplier * classMultiplier + (firstQuestToday ? 25 : 0));
  const gold = Math.max(5, Math.round(difficulty.xp / 8));
  return { xp, gold };
}

export function calculateHp(character) {
  if (!character) return 100;
  return 100 + character.stats.vitality * 5;
}

export function calculateMp(character) {
  if (!character) return 50;
  return 50 + character.stats.wisdom * 3;
}

function buildConsecutiveRun(sortedKeys, stepDays) {
  if (!sortedKeys.length) return { current: 0, longest: 0, lastKey: null };
  let longest = 1;
  let running = 1;
  for (let index = 1; index < sortedKeys.length; index += 1) {
    const previous = parseDateKey(sortedKeys[index - 1]).getTime();
    const current = parseDateKey(sortedKeys[index]).getTime();
    const diffDays = Math.round((current - previous) / 86400000);
    if (diffDays === stepDays) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 1;
    }
  }

  let current = 1;
  for (let index = sortedKeys.length - 1; index > 0; index -= 1) {
    const currentTime = parseDateKey(sortedKeys[index]).getTime();
    const previousTime = parseDateKey(sortedKeys[index - 1]).getTime();
    const diffDays = Math.round((currentTime - previousTime) / 86400000);
    if (diffDays === stepDays) current += 1;
    else break;
  }

  return { current, longest, lastKey: sortedKeys[sortedKeys.length - 1] };
}

function uniqueSortedDateKeys(values) {
  return [...new Set(values)].sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
}

export function getCyclingSummary(state, now = new Date()) {
  const cycling = state.training.cycling;
  const rides = [...cycling.rides].sort((left, right) => new Date(right.startAt).getTime() - new Date(left.startAt).getTime());
  const qualifies = (ride) =>
    ride.distanceKm >= cycling.qualifyingRideKm || ride.movingTimeMin >= cycling.qualifyingRideMinutes;

  const qualifyingRides = rides.filter(qualifies);
  const currentWeek = weekRange(now);
  const weekRideSet = qualifyingRides.filter((ride) => {
    const rideDate = new Date(ride.startAt);
    return rideDate >= currentWeek.start && rideDate <= currentWeek.end;
  });

  const weekDistanceKm = weekRideSet.reduce((sum, ride) => sum + ride.distanceKm, 0);
  const weekMinutes = weekRideSet.reduce((sum, ride) => sum + ride.movingTimeMin, 0);
  const dailyKeys = uniqueSortedDateKeys(qualifyingRides.map((ride) => toDateKey(ride.startAt)));
  const dayStreak = buildConsecutiveRun(dailyKeys, 1);

  const ridesByWeek = new Map();
  for (const ride of qualifyingRides) {
    const key = weekKey(ride.startAt);
    const bucket = ridesByWeek.get(key) || { count: 0, distanceKm: 0 };
    bucket.count += 1;
    bucket.distanceKm += ride.distanceKm;
    ridesByWeek.set(key, bucket);
  }

  const winningWeekKeys = uniqueSortedDateKeys(
    [...ridesByWeek.entries()]
      .filter(([, value]) => value.count >= cycling.weeklyRideTarget || value.distanceKm >= cycling.weeklyDistanceTargetKm)
      .map(([key]) => key)
  );
  const weekStreak = buildConsecutiveRun(winningWeekKeys, 7);

  return {
    rides,
    qualifyingRides,
    currentWeek: {
      rideCount: weekRideSet.length,
      distanceKm: weekDistanceKm,
      movingTimeMin: weekMinutes,
      ridesRemaining: Math.max(0, cycling.weeklyRideTarget - weekRideSet.length),
      distanceRemainingKm: Math.max(0, cycling.weeklyDistanceTargetKm - weekDistanceKm),
      targetMet:
        weekRideSet.length >= cycling.weeklyRideTarget || weekDistanceKm >= cycling.weeklyDistanceTargetKm
    },
    dayStreak,
    weekStreak,
    lastRide: rides[0] || null
  };
}

export function getFastingSummary(state, now = new Date()) {
  const fasting = state.training.fasting;
  const logs = [...fasting.logs].sort((left, right) => new Date(right.endAt).getTime() - new Date(left.endAt).getTime());
  const qualifyingLogs = logs.filter((log) => log.hours >= fasting.targetHours);
  const currentWeek = weekRange(now);
  const weekLogs = qualifyingLogs.filter((log) => {
    const logDate = new Date(log.endAt);
    return logDate >= currentWeek.start && logDate <= currentWeek.end;
  });

  const dateKeys = uniqueSortedDateKeys(qualifyingLogs.map((log) => toDateKey(log.endAt)));
  const streak = buildConsecutiveRun(dateKeys, 1);

  return {
    logs,
    qualifyingLogs,
    currentWeek: {
      completedDays: weekLogs.length,
      targetDays: fasting.weeklyTargetDays,
      targetMet: weekLogs.length >= fasting.weeklyTargetDays
    },
    streak,
    lastFast: logs[0] || null
  };
}

export function getQuestSummary(state) {
  const quests = state.quests;
  const completed = quests.filter((quest) => quest.state === "completed").length;
  const failed = quests.filter((quest) => quest.state === "failed").length;
  const abandoned = quests.filter((quest) => quest.state === "abandoned").length;
  const inProgress = quests.filter((quest) => quest.state === "in_progress").length;
  const available = quests.filter((quest) => quest.state === "available" && prerequisitesComplete(state, quest)).length;
  const locked = quests.filter((quest) => quest.state === "available" && !prerequisitesComplete(state, quest)).length;
  const overdue = quests.filter((quest) => {
    if (!quest.dueDate) return false;
    if (quest.state === "completed" || quest.state === "failed" || quest.state === "abandoned") return false;
    return new Date(quest.dueDate).getTime() < new Date().setHours(0, 0, 0, 0);
  }).length;

  return {
    total: quests.length,
    completed,
    failed,
    abandoned,
    closed: completed + failed + abandoned,
    inProgress,
    available,
    locked,
    overdue
  };
}
