export const GAME_OPTIONS = [
  { id: "game_1", name: "Game 1: Triple P" },
  { id: "game_2", name: "Game 2: Sea State 5" },
  { id: "game_3", name: "Game 3: Bridgewatch Under Pressure" },
  { id: "game_4", name: "Game 4: Full Salvo" },
  { id: "game_5", name: "Game 5: Cargo Capture" },
  { id: "game_6", name: "Game 6: Silent Convoy" },
  { id: "game_7", name: "Game 7: Minefield" },
  { id: "game_8", name: "Game 8: Marker Maze" },
  { id: "game_9", name: "Game 9: Cannonball" },
  { id: "game_10", name: "Game 10: Dead Reckoning" },
  { id: "game_11", name: "Game 11: Shuttle Siege" },
  { id: "inject_1", name: "Inject 1: Underway" },
  { id: "inject_2", name: "Inject 2: Knot Showdown" }
];

export const TEAM_OPTIONS = [
  "Team 1",
  "Team 2",
  "Team 3",
  "Team 4",
  "Team 5",
  "Team 6",
  "Team 7"
];

export function getGame(gameId) {
  return GAME_OPTIONS.find((game) => game.id === gameId);
}

export function getTeam(teamIndex) {
  const index = Number(teamIndex);
  return TEAM_OPTIONS[index - 1] || "";
}

export function formatSingaporeTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

export function normalizePbTime(input) {
  const value = String(input || "").trim();
  const colonMatch = value.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
  if (colonMatch) {
    if (colonMatch[3] !== undefined) {
      return `${colonMatch[1].padStart(2, "0")}:${colonMatch[2]}:${colonMatch[3]}`;
    }
    return `${colonMatch[1].padStart(2, "0")}:${colonMatch[2]}`;
  }

  const secondsMatch = value.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)?$/i);
  if (secondsMatch) {
    const totalSeconds = Number(secondsMatch[1]);
    if (Number.isFinite(totalSeconds)) {
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = Math.round(totalSeconds % 60);
      return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
  }

  return "";
}

export function normalizePoints(input) {
  const value = String(input || "").trim();
  const match = value.match(/^-?\d+(?:\.\d+)?$/);
  return match ? value : "";
}
