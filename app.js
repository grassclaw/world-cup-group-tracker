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
elements.groupModal = document.querySelector("#groupModal");
elements.modalContent = document.querySelector("#modalContent");

let activeGroupIndex = null;

function escapeHtml(value = "") {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function getStat(entry, name) {
  return entry.stats.find(stat => stat.name === name)?.value ?? 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formRating(entry) {
  const played = getStat(entry, "gamesPlayed");
  if (!played) return 50;
  const ppg = getStat(entry, "points") / played;
  const gdPerGame = getStat(entry, "pointDifferential") / played;
  const goalsPerGame = getStat(entry, "pointsFor") / played;
  const raw = 50 + 14 * (ppg - 1.5) + 7 * gdPerGame + 3 * (goalsPerGame - 1.25);
  const sampleWeight = played / 3;
  return Math.round(clamp(50 + (raw - 50) * sampleWeight, 15, 85));
}

function matchupProbabilities(entryA, entryB) {
  const ratingA = formRating(entryA);
  const ratingB = formRating(entryB);
  const difference = ratingA - ratingB;
  const draw = clamp(0.29 - Math.abs(difference) * 0.0025, 0.16, 0.29);
  const decisiveShareA = 1 / (1 + Math.pow(10, -difference / 35));
  const winA = (1 - draw) * decisiveShareA;
  return { a: winA, draw, b: 1 - draw - winA, ratingA, ratingB };
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
  elements.groupsGrid.innerHTML = groups.map((group, groupIndex) => {
    const rows = group.standings.entries
      .slice()
      .sort((a, b) => getStat(a, "rank") - getStat(b, "rank"));
    return `<button class="group-table" type="button" data-group-index="${groupIndex}" aria-haspopup="dialog">
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
    </button>`;
  }).join("");
}

function entriesByTeamId(group) {
  return new Map(group.standings.entries.map(entry => [entry.team.id, entry]));
}

function eventsForGroup(group) {
  const teamIds = new Set(group.standings.entries.map(entry => entry.team.id));
  return tournamentData.events
    .filter(event => event.season.slug === "group-stage")
    .filter(event => competitionFor(event).competitors.every(item => teamIds.has(item.team.id)))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function projectGroup(group, events) {
  const entries = group.standings.entries;
  const byId = entriesByTeamId(group);
  const projections = new Map(entries.map(entry => [entry.team.id, getStat(entry, "points")]));
  events.filter(event => stateFor(event) === "pre").forEach(event => {
    const [a, b] = competitionFor(event).competitors;
    const probabilities = matchupProbabilities(byId.get(a.team.id), byId.get(b.team.id));
    projections.set(a.team.id, projections.get(a.team.id) + 3 * probabilities.a + probabilities.draw);
    projections.set(b.team.id, projections.get(b.team.id) + 3 * probabilities.b + probabilities.draw);
  });
  return entries.slice().sort((a, b) => {
    const pointDifference = projections.get(b.team.id) - projections.get(a.team.id);
    return pointDifference || formRating(b) - formRating(a);
  }).map(entry => ({ entry, projectedPoints: projections.get(entry.team.id) }));
}

function modalMatchTeam(competitor, state) {
  return `<div class="group-match-team ${competitor.winner ? "winner" : ""}">
    <span>${teamLogo(competitor.team)}${escapeHtml(competitor.team.shortDisplayName)}</span>
    ${state === "pre" ? "" : `<b>${escapeHtml(competitor.score)}</b>`}
  </div>`;
}

function renderModalMatch(event, byId) {
  const competition = competitionFor(event);
  const state = stateFor(event);
  let lean = "";
  if (state === "pre") {
    const [a, b] = competition.competitors;
    const probabilities = matchupProbabilities(byId.get(a.team.id), byId.get(b.team.id));
    const favorite = probabilities.a >= probabilities.b ? a : b;
    const favoriteChance = Math.max(probabilities.a, probabilities.b);
    lean = `<div class="match-lean">Model lean: ${escapeHtml(favorite.team.shortDisplayName)} ${Math.round(favoriteChance * 100)}% · Draw ${Math.round(probabilities.draw * 100)}%</div>`;
  }
  return `<article class="group-match">
    <div class="group-match-meta"><span>${escapeHtml(formatDate(event.date))}</span><span>${escapeHtml(eventStatus(event))}</span></div>
    ${competition.competitors.map(competitor => modalMatchTeam(competitor, state)).join("")}
    ${lean}
  </article>`;
}

function openGroupModal(groupIndex) {
  if (!tournamentData) return;
  activeGroupIndex = Number(groupIndex);
  const group = tournamentData.groups[activeGroupIndex];
  const events = eventsForGroup(group);
  const byId = entriesByTeamId(group);
  const projection = projectGroup(group, events);
  const ratings = group.standings.entries.slice().sort((a, b) => formRating(b) - formRating(a));
  const matchdays = [events.slice(0, 2), events.slice(2, 4), events.slice(4, 6)];

  elements.modalContent.innerHTML = `
    <div class="modal-hero">
      <div>
        <div class="modal-kicker">Group-stage command center</div>
        <h2 id="modalTitle">${escapeHtml(group.name)}</h2>
        <p>Every team plays the other three once. Results earn table points; the projected order adds expected points from the remaining matches using the transparent form model below.</p>
      </div>
      <div class="projection-card">
        <small>Projected finish</small>
        ${projection.map(({ entry, projectedPoints }, index) => `<div class="projection-row ${index < 2 ? "qualifying" : ""}">
          <span class="seed">${index + 1}</span>
          <span>${teamLogo(entry.team)}${escapeHtml(entry.team.shortDisplayName)}${index < 2 ? " →" : ""}</span>
          <b>${projectedPoints.toFixed(1)} xPTS</b>
        </div>`).join("")}
      </div>
    </div>

    <section class="modal-section">
      <div class="modal-section-head"><h3>All group matches</h3><p>Results are final when marked FT. Upcoming percentages are deterministic estimates based only on tournament performance so far.</p></div>
      <div class="matchdays">
        ${matchdays.map((matches, index) => `<div class="matchday"><b>Matchday ${index + 1}</b>${matches.map(event => renderModalMatch(event, byId)).join("")}</div>`).join("")}
      </div>
    </section>

    <section class="modal-section">
      <div class="modal-section-head"><h3>Deterministic form score</h3><p>A reproducible 15–85 rating. Same inputs always produce the same score; there is no randomness or hidden model.</p></div>
      <div class="model-grid">
        <div class="rating-list">
          ${ratings.map(entry => {
            const played = Math.max(getStat(entry, "gamesPlayed"), 1);
            const rating = formRating(entry);
            return `<div class="rating-row">
              <div><span class="rating-team">${teamLogo(entry.team)}${escapeHtml(entry.team.shortDisplayName)}</span><span class="rating-detail">${(getStat(entry, "points") / played).toFixed(1)} PPG · ${(getStat(entry, "pointDifferential") / played).toFixed(1)} GD/game</span></div>
              <div class="rating-bar"><span style="width:${rating}%"></span></div>
              <span class="rating-score">${rating}</span>
            </div>`;
          }).join("")}
        </div>
        <div class="formula-card">
          <small>The exact formula</small>
          <code>50 + sample × [<br>14(PPG − 1.5)<br>+ 7(GD / game)<br>+ 3(GF / game − 1.25)<br>]</code>
          <p><b>Sample = games played ÷ 3.</b> That pulls early ratings toward 50 so one match does not overpower the forecast. Match leans compare two scores with a fixed logistic curve and reserve 16–29% for a draw.</p>
        </div>
      </div>
      <p class="model-disclaimer">Illustrative form projection, not betting advice. It does not use injuries, lineups, historical strength, or bookmaker odds.</p>
    </section>

    <section class="modal-section">
      <div class="modal-section-head"><h3>How table scoring works</h3><p>Teams are ranked by points, then goal difference, then goals scored, followed by FIFA's remaining tiebreak procedures.</p></div>
      <div class="rules-grid">
        <div class="rule"><strong>3</strong><b>Win</b><p>Three table points for winning a group match.</p></div>
        <div class="rule"><strong>1</strong><b>Draw</b><p>One table point for each team when scores finish level.</p></div>
        <div class="rule"><strong>0</strong><b>Loss</b><p>No table points. Goals still affect goal difference.</p></div>
      </div>
    </section>`;

  elements.groupModal.classList.add("open");
  elements.groupModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  document.querySelector(".modal-close").focus();
}

function closeGroupModal() {
  elements.groupModal.classList.remove("open");
  elements.groupModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  const trigger = document.querySelector(`[data-group-index="${activeGroupIndex}"]`);
  if (trigger) trigger.focus();
  activeGroupIndex = null;
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
  if (activeGroupIndex !== null) openGroupModal(activeGroupIndex);
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
elements.groupsGrid.addEventListener("click", event => {
  const trigger = event.target.closest("[data-group-index]");
  if (trigger) openGroupModal(trigger.dataset.groupIndex);
});
elements.groupModal.addEventListener("click", event => {
  if (event.target.closest("[data-close-modal]")) closeGroupModal();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && elements.groupModal.classList.contains("open")) closeGroupModal();
});
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
