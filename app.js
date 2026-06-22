const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200";
const STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026";
const REFRESH_MS = 60_000;

const STAGES = [
  ["round-of-32", "Round of 32"],
  ["round-of-16", "Round of 16"],
  ["quarterfinals", "Quarterfinals"],
  ["semifinals", "Semifinals"],
  ["final", "Final"]
];

const zones = [
  { label: "LOCAL", value: Intl.DateTimeFormat().resolvedOptions().timeZone },
  { label: "ET", value: "America/New_York" },
  { label: "PT", value: "America/Los_Angeles" },
  { label: "UTC", value: "UTC" }
];

let zoneIndex = 0;
let activeZone = zones[0].value;
let tournamentData = null;

const elements = {
  syncState: document.querySelector("#syncState"),
  matchStrip: document.querySelector("#matchStrip"),
  bracketBoard: document.querySelector("#bracketBoard"),
  groupsGrid: document.querySelector("#groupsGrid"),
  refreshButton: document.querySelector("#refreshButton"),
  timezoneButton: document.querySelector("#timezoneButton"),
  timezoneLabel: document.querySelector("#timezoneLabel"),
  progressCount: document.querySelector("#progressCount"),
  progressBar: document.querySelector("#progressBar"),
  progressLabel: document.querySelector("#progressLabel"),
  footerUpdate: document.querySelector("#footerUpdate")
};

function escapeHtml(value = "") {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function getStat(entry, name) {
  return entry.stats.find(stat => stat.name === name)?.value ?? 0;
}

function formatTime(date, options = {}) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: activeZone,
    hour: "numeric",
    minute: "2-digit",
    ...options
  }).format(new Date(date));
}

function formatDate(date, includeTime = false) {
  const options = { timeZone: activeZone, month: "short", day: "numeric" };
  if (includeTime) Object.assign(options, { hour: "numeric", minute: "2-digit" });
  return new Intl.DateTimeFormat("en-US", options).format(new Date(date));
}

function localDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: activeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(date));
}

function competitionFor(event) {
  return event.competitions[0];
}

function stateFor(event) {
  return competitionFor(event).status?.type?.state || event.status.type.state;
}

function teamLogo(team) {
  const src = team.logo || team.logos?.[0]?.href;
  return src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" />` : "";
}

function shortTeamName(name) {
  return name
    .replace("Third Place Group", "3rd from")
    .replace(" Winner", " winner")
    .replace(" 2nd Place", " runner-up");
}

function renderMatchTeam(competitor, className = "live-team") {
  const score = competitor.score === undefined ? "" : `<b>${escapeHtml(competitor.score)}</b>`;
  return `<div class="${className} ${competitor.winner ? "winner" : ""}">
    <span>${teamLogo(competitor.team)}${escapeHtml(shortTeamName(competitor.team.displayName))}</span>${score}
  </div>`;
}

function eventStatus(event) {
  const status = competitionFor(event).status?.type || event.status.type;
  if (status.state === "in") return status.shortDetail || "LIVE";
  if (status.state === "post") return status.shortDetail || "FT";
  return formatTime(event.date);
}

function selectMatchCenterEvents(events) {
  const now = new Date();
  const todayKey = localDateKey(now);
  const sameDay = events.filter(event => localDateKey(event.date) === todayKey);
  const live = events.filter(event => stateFor(event) === "in");

  if (live.length) {
    const nearby = events.filter(event => stateFor(event) !== "post" && new Date(event.date) > now);
    return [...live, ...nearby].slice(0, 4);
  }
  if (sameDay.length) return sameDay.slice(0, 4);

  const future = events.filter(event => new Date(event.date) > now).slice(0, 4);
  if (future.length) return future;
  return events.filter(event => stateFor(event) === "post").slice(-4).reverse();
}

function renderMatchCenter(events) {
  const selected = selectMatchCenterEvents(events);
  elements.matchStrip.innerHTML = selected.map(event => {
    const competition = competitionFor(event);
    const state = stateFor(event);
    const venue = competition.venue?.fullName || event.venue?.fullName || "Venue TBA";
    return `<article class="live-match">
      <div class="live-match-top">
        <span>${escapeHtml(event.season.slug.replaceAll("-", " "))}</span>
        <span class="${state === "in" ? "in-play" : ""}">${escapeHtml(eventStatus(event))}</span>
      </div>
      ${competition.competitors.map(team => renderMatchTeam(team)).join("")}
      <div class="live-match-bottom">${escapeHtml(formatDate(event.date))} · ${escapeHtml(venue)}</div>
    </article>`;
  }).join("");
}

function renderBracketGame(event) {
  const competition = competitionFor(event);
  const state = stateFor(event);
  const competitors = competition.competitors;
  const placeholder = competitors.every(item => !item.team.logo);
  return `<article class="knockout-game ${state === "in" ? "live" : ""}">
    <div class="game-meta">
      <span>${escapeHtml(formatDate(event.date))}</span>
      <span class="${state === "in" ? "live-label" : ""}">${escapeHtml(eventStatus(event))}</span>
    </div>
    ${competitors.map(team => renderMatchTeam(team, `bracket-team${placeholder ? " placeholder" : ""}`)).join("")}
  </article>`;
}

function renderBracket(events) {
  elements.bracketBoard.innerHTML = STAGES.map(([slug, label]) => {
    const roundEvents = events
      .filter(event => event.season.slug === slug)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    return `<section class="bracket-column" aria-label="${label}">
      <div class="round-title"><b>${label}</b><span>${roundEvents.length} matches</span></div>
      ${roundEvents.map(renderBracketGame).join("")}
    </section>`;
  }).join("");
}

function renderGroups(groups) {
  elements.groupsGrid.innerHTML = groups.map(group => {
    const rows = group.standings.entries
      .slice()
      .sort((a, b) => getStat(a, "rank") - getStat(b, "rank"));
    return `<article class="group-table">
      <div class="group-table-head"><b>${escapeHtml(group.name)}</b><span>PL · GD · PTS</span></div>
      ${rows.map(entry => {
        const rank = getStat(entry, "rank");
        const advanced = getStat(entry, "advanced") === 1;
        return `<div class="standing-row ${rank <= 2 ? "in-position" : ""} ${advanced ? "advanced" : ""}">
          <span class="rank">${rank}</span>
          <span class="standing-team">${teamLogo(entry.team)}<span>${escapeHtml(entry.team.shortDisplayName)}</span>${advanced ? '<i class="advance-check" title="Advanced">✓</i>' : ""}</span>
          <span class="standing-stat">${getStat(entry, "gamesPlayed")}</span>
          <span class="standing-stat">${getStat(entry, "pointDifferential") > 0 ? "+" : ""}${getStat(entry, "pointDifferential")}</span>
          <span class="standing-stat points">${getStat(entry, "points")}</span>
        </div>`;
      }).join("")}
    </article>`;
  }).join("");
}

function renderProgress(events) {
  const completed = events.filter(event => stateFor(event) === "post").length;
  const live = events.filter(event => stateFor(event) === "in").length;
  const percent = Math.round((completed / events.length) * 100);
  elements.progressCount.textContent = `${completed} / ${events.length}`;
  elements.progressBar.style.width = `${percent}%`;
  elements.progressLabel.textContent = live ? `${live} match${live > 1 ? "es" : ""} live · ${percent}% complete` : `${percent}% complete`;
}

function renderAll() {
  if (!tournamentData) return;
  renderMatchCenter(tournamentData.events);
  renderBracket(tournamentData.events);
  renderGroups(tournamentData.groups);
  renderProgress(tournamentData.events);
}

async function loadTournament() {
  elements.refreshButton.disabled = true;
  elements.syncState.className = "sync-state";
  elements.syncState.innerHTML = "<i></i> Updating";
  try {
    const [scoreboardResponse, standingsResponse] = await Promise.all([
      fetch(SCOREBOARD_URL),
      fetch(STANDINGS_URL)
    ]);
    if (!scoreboardResponse.ok || !standingsResponse.ok) throw new Error("Live feed unavailable");
    const [scoreboard, standings] = await Promise.all([
      scoreboardResponse.json(),
      standingsResponse.json()
    ]);
    tournamentData = { events: scoreboard.events, groups: standings.children };
    renderAll();
    const updated = new Date();
    elements.syncState.className = "sync-state live";
    elements.syncState.innerHTML = "<i></i> Live data";
    elements.footerUpdate.textContent = `Updated ${formatTime(updated)} · Refreshes every minute`;
  } catch (error) {
    elements.syncState.className = "sync-state error";
    elements.syncState.innerHTML = "<i></i> Feed offline";
    if (!tournamentData) {
      elements.matchStrip.innerHTML = '<div class="loading-card">Live scores could not load. Use “Refresh scores” to retry.</div>';
      elements.bracketBoard.innerHTML = '<div class="bracket-loading">The bracket feed is temporarily unavailable.</div>';
      elements.groupsGrid.innerHTML = '<div class="loading-card pale">The standings feed is temporarily unavailable.</div>';
    }
  } finally {
    elements.refreshButton.disabled = false;
  }
}

function setToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: activeZone, day: "2-digit", month: "short" }).formatToParts(new Date());
  document.querySelector("#todayDay").textContent = parts.find(part => part.type === "day").value;
  document.querySelector("#todayMonth").textContent = parts.find(part => part.type === "month").value.toUpperCase();
}

elements.refreshButton.addEventListener("click", loadTournament);
elements.timezoneButton.addEventListener("click", () => {
  zoneIndex = (zoneIndex + 1) % zones.length;
  activeZone = zones[zoneIndex].value;
  elements.timezoneLabel.textContent = zones[zoneIndex].label;
  setToday();
  renderAll();
});

setToday();
loadTournament();
setInterval(loadTournament, REFRESH_MS);
