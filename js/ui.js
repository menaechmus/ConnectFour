// Everything the player sees and touches. The rules live in game.js; this
// file draws the current match and turns taps and keys into moves. The
// computer thinks in a worker (thinker.js), so its moves arrive by promise.

import { COLUMNS, ROWS, other, canDrop, newMatch, nextGame, drop, canTakeBack, takeBack, emptyBoard } from './game.js';
import { BOARD, CELL, DISC, AIR, DROP_Y, LABEL_Y, BELOW_Y, columnX, cellXY, columnBox, plateShape, holeRims, backShape } from './board.js';
import { LEVELS, seedOf } from './ai.js';
import { ask, cancelThinking, startThinker } from './thinker.js';
import { emptyStats, loadStats, recordGame } from './stats.js';
import { playSound, setMuted, unlockSound } from './sound.js';
import { startParty } from './celebrate.js';
import { openRoom, joinRoom, cleanCode, CODE_LENGTH } from './net.js';
import { createHost, createGuest, cleanName, sameState, deniedText, MAX_PLAYERS, NAME_LENGTH } from './wifi.js';

// Shown in the About box. Bump both with every release: a browser still
// running a cached copy of this file then shows the old number.
const VERSION = '1.1.0';
const RELEASED = '31 October 2026';

const AI_DELAY = 500; // the least time between a disc landing and the computer's reply
const FALL_MS = 420; // a disc falling the whole height of the board
const LANDS_AT = 0.74; // how far through its fall a disc first touches down
const LINE_MS = 1100; // the winning line glows this long before anything else
const HOLD_MS = 500; // a full board sits this long before Next game
const CLEAR_MS = 380; // the discs falling out at the start of a game
const LIFT_MS = 170; // a disc taken back rising out of its column
const CHEER_MS = 3500; // fireworks and confetti before the box appears
const MAX_THINK_MS = 120000; // Guru's longest think, however far it has been asked to look
const MOST_DISCS = 42; // as far as anyone can ask it to look
const QUIET_MS = 1000; // a think shorter than this doesn't need its progress shown
const SETTINGS_KEY = 'connectfour.settings';
const GAME_KEY = 'connectfour.game';
const STATS_KEY = 'connectfour.stats';
const RECORDED_KEY = 'connectfour.recorded'; // the last Wi-Fi game in this phone's statistics
const WIFI_KEY = 'connectfour.wifi'; // per tab: this tab's part in a Wi-Fi game, for a reload
const TOKEN_KEY = 'connectfour.token'; // per tab: how the host knows this tab again

const $ = id => document.getElementById(id);

// ?store=NAME keeps this page's storage under keys of its own, so that the
// test driver's two frames can be two phones. `tab` storage (sessionStorage)
// lasts as long as the tab, through reloads.
const STORE = new URLSearchParams(location.search).get('store');
const keyed = key => (STORE ? `${key}:${STORE}` : key);

function load(key, tab = false) {
  try {
    return JSON.parse((tab ? sessionStorage : localStorage).getItem(keyed(key)));
  } catch {
    return null;
  }
}

function store(key, value, tab = false) {
  try {
    const place = tab ? sessionStorage : localStorage;
    if (value === null) place.removeItem(keyed(key));
    else place.setItem(keyed(key), JSON.stringify(value));
  } catch {
    // Storage can be switched off (private browsing); the game still plays.
  }
}

// Menu buttons carry their value as text: "true", "5", "hard".
function parseValue(text) {
  if (text === 'true' || text === 'false') return text === 'true';
  return /^\d+$/.test(text) ? Number(text) : text;
}

const clampDiscs = discs => Math.min(MOST_DISCS, Math.max(1, discs));

// Saved settings are only accepted if the menu offers that value.
function loadSettings() {
  const settings = {
    mode: 'ai', difficulty: 'medium', first: 'turns', names: ['', ''], wifiName: '', target: 1, hints: true, undo: true, sound: true, lastStarter: 1,
    guruBy: 'time', guruMs: LEVELS.guru.ms, guruDepth: 20,
  };
  const saved = load(SETTINGS_KEY);
  for (const group of document.querySelectorAll('.choice[data-setting]')) {
    const key = group.dataset.setting;
    const offered = [...group.children].map(button => parseValue(button.dataset.value));
    if (offered.includes(saved?.[key])) settings[key] = saved[key];
  }
  if (Array.isArray(saved?.names)) {
    settings.names = settings.names.map((name, i) => (typeof saved.names[i] === 'string' ? saved.names[i].slice(0, NAME_LENGTH) : name));
  }
  if (typeof saved?.wifiName === 'string') settings.wifiName = saved.wifiName.slice(0, NAME_LENGTH);
  if (saved?.lastStarter === 0 || saved?.lastStarter === 1) settings.lastStarter = saved.lastStarter;
  if (Number.isInteger(saved?.guruDepth)) settings.guruDepth = clampDiscs(saved.guruDepth);
  return settings;
}

// Names are typed in, so they are escaped before going into the page.
const escapeHtml = text => String(text).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

const settings = loadSettings();
const stats = loadStats(load(STATS_KEY));
let match = null;
let cursor = null; // the column the keyboard is on
let hover = null; // the column the mouse is over
let tip = null; // the last hint: { column, text }, or { pending, text } while it is worked out
let messages = []; // what the last action did, in words
let show = null; // an animation in progress (see Animation below)
let looking = false; // the result box is put aside, to study the board
let celebrating = 0; // timer while a win is celebrated and the box waits
let party = null; // the fireworks and confetti, which outlast the celebration a little
let skipClick = false; // the tap that skipped an animation should do nothing else
let resetArmed = false;
let confirmed = null; // what the confirm box's button does
let aiTimer = 0;
let thinking = 0; // the computer's question in hand, as a number; 0 when there is none
let questions = 0;
let searching = null; // how the computer's search is going: { nodes, depth, ms }
let holdingAwake = false; // the screen stays on for a search that may take a while
let lastSearch = null; // what the computer did for its last move, for the Advanced box
let gameSearches = null; // and all its moves this game: { key, moves, nodes, deepest, longest }
let standing = false; // the host has asked the computer to play for the other phone
let undoStats = null; // the statistics, as text, from before the game just finished
// A Wi-Fi game (see the section of that name below).
let session = null; // this phone's part: { role: 'host', host, room, code, trouble } or { role: 'guest', guest, code, players }
let me = 0; // this phone's side in it
let away = []; // sides whose phones are out of touch
let sent = false; // a guest's move is with the host, and not yet answered
let sentColumn = null; // and the column it went to
let inbox = []; // moves and states that came during an animation
let notice = ''; // why the host refused this phone's last move
let wifiBox = null; // what the Wi-Fi box shows: 'host', 'join' or 'ended'
let wifiNote = { text: '', warn: false }; // its status line
let waitingCode = ''; // a shared link's code, while the name is still to type

setMuted(!settings.sound);

// ---- Who is who ---------------------------------------------------------

const wifiGame = () => match?.mode === 'net';
const isHost = () => wifiGame() && session?.role === 'host';
const isGuest = () => wifiGame() && session?.role === 'guest';
const liveWifi = () => Boolean(session) && wifiGame();
// A guest whose link to the host has gone can only wait for it to come back.
const linkDown = () => isGuest() && !session.guest.connected;

const isAi = side => Boolean(match.players[side].ai);
// In a Wi-Fi game each phone calls its own player "You".
const nameOf = side => (wifiGame() && side === me ? 'You' : match.players[side].name);
const isYou = side => nameOf(side) === 'You';
const whose = side => (isYou(side) ? 'Your' : `${nameOf(side)}'s`);
const capital = text => text[0].toUpperCase() + text.slice(1);
// Whether a person took this game or match: in a Wi-Fi game, this phone's
// person. `side` is null after a draw, which nobody took.
const personTook = side => side !== null && (wifiGame() ? side === me : !isAi(side));
const personWon = () => personTook(match.winner);
// Hints: in a Wi-Fi game the host's choice, for both; otherwise the menu's.
const hintsOn = () => (wifiGame() ? match.rules.hints : settings.hints);

// The side that must move now.
const actor = () => (match?.phase === 'play' ? match.turn : null);

const canAct = () => actor() !== null && !isAi(actor()) && !show && (!wifiGame() || (actor() === me && !sent && !linkDown()));

// The side the host may act for: the other phone's, when it is out of touch
// and must move.
function standIn() {
  if (!isHost() || show || standing) return null;
  const side = actor();
  return side !== null && side !== me && away[side] ? side : null;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Guru's limit, as the worker takes it and in a few words. Asked to look a
// given distance it still stops at MAX_THINK_MS, as the work grows with every
// disc and the distance could otherwise take hours.
const guruLimit = () => (settings.guruBy === 'depth' ? { depth: settings.guruDepth, ms: MAX_THINK_MS } : { ms: settings.guruMs });
const timeWords = ms => (ms < 60000 ? `${Math.round(ms / 100) / 10} s` : `${Math.round(ms / 6000) / 10} min`);
const guruWords = () => (settings.guruBy === 'depth' ? `${settings.guruDepth} discs` : timeWords(settings.guruMs));
const levelNote = ({ level }) => (level === 'guru' ? `Guru, ${guruWords()}` : capital(level));

// Tells one position from the next, to spot an answer that came too late.
const stamp = () => `${match.id}:${match.gameNo}:${match.moves.length}`;

// A take-back of the game just finished also takes it out of the statistics,
// which needs the copy from before it was put in. A reload loses that copy,
// and with it the chance: the game stays as it was counted.
function canUndo() {
  if (!match || show || celebrating || !canTakeBack(match, 0)) return false;
  return match.phase === 'play' || Boolean(undoStats);
}

// ---- Drawing --------------------------------------------------------------

const SVG = 'http://www.w3.org/2000/svg';
const at = (x, y) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;

function drawBoard() {
  const labels = Array.from({ length: COLUMNS }, (unused, column) => `<text x="${columnX(column)}" y="${LABEL_Y}">${column + 1}</text>`).join('');
  const buttons = Array.from({ length: COLUMNS }, (unused, column) => {
    const { left, width } = columnBox(column);
    return `<button class="column" data-column="${column}" style="left: ${left}%; width: ${width}%"></button>`;
  }).join('');
  $('board').innerHTML = `
    <svg viewBox="0 0 ${BOARD.width} ${BOARD.height}" aria-hidden="true">
      <rect class="back" x="${backShape.x}" y="${backShape.y}" width="${backShape.width}" height="${backShape.height}" rx="${backShape.rx}"/>
      <g class="pieces"></g>
      <path class="plate" fill-rule="evenodd" d="${plateShape()}"/>
      <g class="rims">${holeRims()}</g>
      <g class="labels">${labels}</g>
      <g class="marks"></g>
    </svg>
    <div class="columns">${buttons}</div>`;
}

const shownBoard = () => show?.board ?? match.board;

const discHtml = `<circle r="${DISC}"/><circle class="inner" r="${(DISC * 0.68).toFixed(2)}"/>`;

function newDisc(column, row, side) {
  const disc = document.createElementNS(SVG, 'g');
  disc.dataset.key = `${column}:${row}`;
  disc.setAttribute('class', `disc side${side}`);
  const [x, y] = cellXY(column, row);
  disc.style.transform = at(x, y);
  disc.innerHTML = discHtml;
  return disc;
}

const discAt = (column, row) => $('board').querySelector(`.pieces [data-key="${column}:${row}"]`);

// The discs are changed one at a time, not redrawn: one that is falling keeps
// falling, whatever else is drawn meanwhile.
function drawDiscs() {
  const board = shownBoard();
  const pieces = $('board').querySelector('.pieces');
  const wanted = new Set();
  board.forEach((discs, column) => {
    discs.forEach((side, row) => {
      wanted.add(`${column}:${row}`);
      const disc = discAt(column, row);
      if (disc?.classList.contains(`side${side}`)) return;
      disc?.remove();
      pieces.append(newDisc(column, row, side));
    });
  });
  for (const disc of [...pieces.children]) if (!wanted.has(disc.dataset.key)) disc.remove();
}

const ringHtml = ([x, y], kind) => `<g class="${kind}" transform="translate(${x} ${y})"><circle class="ring-edge" r="${DISC - 0.6}"/><circle class="ring-line" r="${DISC - 0.6}"/></g>`;

const waitingDisc = (column, side, classes = '') =>
  `<g class="disc side${side} waiting ${classes}" transform="translate(${columnX(column)} ${DROP_Y})">${discHtml}</g>`;

// What sits over the board: the last disc played, the winning line, a hint,
// and the disc about to drop.
function marksHtml() {
  const board = shownBoard();
  let html = '';
  const line = show ? show.line : match.result?.line;
  if (line) html += line.map(([column, row]) => ringHtml(cellXY(column, row), 'won')).join('');
  else if (!show && match.moves.length) {
    const column = match.moves.at(-1);
    const [x, y] = cellXY(column, board[column].length - 1);
    html += `<circle class="last" cx="${x}" cy="${y}" r="2"/>`;
  }
  if (sentColumn !== null) html += waitingDisc(sentColumn, me, 'sent');
  if (Number.isInteger(tip?.column) && !show) {
    const { column } = tip;
    const x = columnX(column);
    html += ringHtml(cellXY(column, board[column].length), 'tip-mark');
    html += `<g class="tip-mark"><path d="M${x - 6} ${DROP_Y - 5}h12v4h5l-11 11l-11 -11h5z"/></g>`;
  }
  const over = cursor ?? hover;
  if (over !== null && canAct() && canDrop(match.board, over)) {
    html += ringHtml(cellXY(over, match.board[over].length), 'landing');
    if (tip?.column !== over) html += waitingDisc(over, match.turn);
  }
  return html;
}

function drawColumns(acting) {
  const board = shownBoard();
  for (const button of $('board').querySelectorAll('.column')) {
    const column = Number(button.dataset.column);
    const room = ROWS - board[column].length;
    button.setAttribute('aria-disabled', !(acting && room > 0));
    button.setAttribute('aria-label', `Column ${column + 1}, ${room ? `${room} ${room > 1 ? 'spaces' : 'space'} left` : 'full'}`);
  }
}

function render() {
  const table = $('table');
  table.dataset.phase = match.phase;
  table.dataset.showing = show ? 'yes' : 'no'; // for the test driver, as is `thinking`
  table.dataset.thinking = thinking ? 'yes' : 'no';
  const now = actor();
  const score = show?.score ?? match.score;
  [0, 1].forEach(side => {
    const box = document.querySelector(`.score[data-side="${side}"]`);
    box.querySelector('.name').textContent = nameOf(side);
    box.querySelector('.note').textContent = match.players[side].ai ? levelNote(match.players[side]) : '';
    box.querySelector('.points').textContent = match.target > 1 ? score[side] : '';
    box.classList.toggle('active', now === side);
    // A Wi-Fi player whose phone is out of touch is dimmed; on a guest's
    // phone, the host when the link to it has gone.
    box.classList.toggle('away', wifiGame() && (Boolean(away[side]) || (side === 0 && linkDown())));
  });

  drawDiscs();
  $('board').querySelector('.marks').innerHTML = marksHtml();

  $('events').textContent = show?.hush ? '' : messages.join(' ');
  const [prompt, warn] = tip ? [tip.text, false] : promptText();
  $('prompt').textContent = prompt;
  $('prompt').classList.toggle('tip', Boolean(tip));
  $('prompt').classList.toggle('warn', warn);

  const acting = canAct();
  drawColumns(acting);
  const [text, enabled] = mainButton();
  $('btn-main').hidden = !text;
  $('btn-main').textContent = text ?? '';
  $('btn-main').disabled = !enabled;
  $('btn-hint').hidden = !hintsOn();
  $('btn-hint').disabled = !acting || Boolean(tip?.pending);
  $('btn-undo').hidden = !match.rules.undo;
  $('btn-undo').disabled = !canUndo();
  $('btn-sound').setAttribute('aria-pressed', settings.sound);

  // A match's end is shown once its last move has been, and a win once it has
  // been celebrated. The box can be put aside to look at the board.
  $('gameover').hidden = match.phase !== 'over' || Boolean(show) || looking;
  $('gameover').classList.toggle('party', Boolean(celebrating));
  if (!$('gameover').hidden) $('gameover-body').innerHTML = resultHtml();
}

// What the game that just ended came to, in words.
function gameText() {
  const { winner } = match.result;
  if (winner === null) return 'A draw: the board is full. Nobody scores.';
  return isYou(winner) ? 'You win this game.' : `${nameOf(winner)} wins this game.`;
}

// What the prompt says, and whether as a warning.
function promptText() {
  if (show) return [show.prompt ?? '', false];
  if (wifiGame() && match.phase !== 'over') {
    const host = match.players[0].name;
    if (linkDown()) return [`Lost touch with ${host}'s phone. Trying again…`, true];
    if (sent) return ['Sent. Waiting for the host…', false];
    if (isHost() && !session.room) return session.trouble ? [`${session.trouble} Trying again…`, true] : ['Opening the game to the other phone…', false];
    if (notice) return [notice, true];
    const side = standIn();
    if (side !== null) return [`${nameOf(side)}'s phone is out of touch. Wait for it, or press the button to let the computer choose for ${nameOf(side)}.`, true];
    if (standing) return ['The computer is choosing…', false];
    const waiting = actor();
    if (waiting !== null && waiting !== me) {
      if (away[waiting]) return [`${whose(waiting)} turn, but ${nameOf(waiting)}'s phone is out of touch.`, false];
      return [`${whose(waiting)} turn.`, false];
    }
  }
  if (match.phase === 'between') return [gameText(), false];
  const side = actor();
  if (side === null) return ['', false];
  if (isAi(side)) return [thinkingText(side), false];
  return [`${whose(side)} turn. Tap a column to drop a disc.`, false];
}

// A long think shows how far it has got, so that it doesn't look stuck.
function thinkingText(side) {
  const text = `${nameOf(side)} is thinking…`;
  if (match.players[side].level !== 'guru' || !searching || searching.ms < QUIET_MS) return text;
  const seconds = Math.floor(searching.ms / 1000);
  if (settings.guruBy === 'depth') return `${text} ${seconds} s, ${searching.depth} of ${settings.guruDepth} discs ahead`;
  return `${text} ${seconds} s of ${settings.guruMs / 1000}, ${searching.depth} discs ahead`;
}

// The main button is only there when there is something to press: on the
// host's phone it can also act for the other phone while that is out of touch.
function mainButton() {
  const side = standIn();
  if (side !== null) return [`Play for ${nameOf(side)}`, true];
  if (match.phase === 'between') return ['Next game', !sent && !linkDown() && !show];
  if (match.phase === 'over' && looking) return ['See results', true];
  return [null, false];
}

// The box at the end of the match.
function resultHtml() {
  const { score, target, winner, result } = match;
  const single = target === 1;
  const title = isYou(winner) ? `You win${single ? '' : ' the match'}!` : `${nameOf(winner)} wins${single ? '' : ' the match'}`;
  const moves = Math.ceil(result.stones / 2);
  const how = `Four in a row in ${moves} moves.`;
  const rows = [0, 1].map(side => `<tr><th>${escapeHtml(nameOf(side))}</th><td>${score[side]}</td></tr>`).join('');
  const row = match.mode === 'ai' ? stats.ai[match.difficulty] : null;
  // Only the host of a Wi-Fi game can start the next match.
  const again = isGuest()
    ? `<p class="muted">Waiting for ${escapeHtml(match.players[0].name)} to start another match.</p>`
    : '<button class="btn primary" data-do="again">Play again</button>';
  const back = canUndo() ? '<button class="btn" data-do="takeback">Take back</button>' : '';
  return `
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(how)}</p>
    ${single ? '' : `<table class="grid"><thead><tr><th></th><th>Games</th></tr></thead><tbody>${rows}</tbody></table><p class="muted">Match to ${target}.</p>`}
    ${row ? `<p class="muted">${capital(match.difficulty)} computer: ${row.wins} won of ${row.games} played.</p>` : ''}
    ${again}
    ${back ? `<div class="row">${back}<button class="btn" data-do="board">See the board</button></div>` : ''}
    <div class="row">
      ${back ? '' : '<button class="btn" data-do="board">See the board</button>'}
      <button class="btn" data-do="stats">Statistics</button>
      <button class="btn" data-do="menu">Menu</button>
    </div>`;
}

function statsHtml() {
  const percent = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '–');
  const rows = Object.entries(stats.ai)
    .map(([level, row]) =>
      `<tr><th>${capital(level)}</th><td>${row.games}</td><td>${row.wins}</td><td>${row.draws}</td>` +
      `<td>${percent(row.wins, row.games)}</td><td>${row.streak}</td><td>${row.bestStreak}</td></tr>`)
    .join('');
  const people = Object.values(stats.people)
    .filter(person => person.games)
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
    .map(person => `<tr><th>${escapeHtml(person.name)}</th><td>${person.games}</td><td>${person.wins}</td><td>${person.draws}</td><td>${percent(person.wins, person.games)}</td></tr>`)
    .join('');
  const { records } = stats;
  const assisted = Object.entries(stats.ai).filter(([, row]) => row.assisted);
  const helped = assisted.map(([level, row]) => `<dt>Wins using Undo, ${capital(level)}</dt><dd>${row.assisted}</dd>`).join('');
  return `
    <h3>Against the computer</h3>
    <table class="grid">
      <thead><tr><th></th><th>Games</th><th>Won</th><th>Drawn</th><th>Win&nbsp;%</th><th>Streak</th><th>Best</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <dl class="facts">
      <dt>Fastest win</dt><dd>${records.fastestWin ? `${records.fastestWin} moves` : '–'}</dd>
      <dt>Longest game</dt><dd>${records.longestGame ? `${records.longestGame} discs` : '–'}</dd>
      ${helped}
    </dl>
    <h3>Between people</h3>
    ${
      people
        ? `<table class="grid"><thead><tr><th></th><th>Games</th><th>Won</th><th>Drawn</th><th>Win&nbsp;%</th></tr></thead><tbody>${people}</tbody></table>`
        : '<p>No games finished yet.</p>'
    }
    <p class="muted">Finished games are saved in this browser, on this device.</p>`;
}

const WHY_NO_SEARCH = {
  win: 'it had a winning move',
  block: 'it had to block',
  only: 'only one move was safe',
  lost: 'it had already lost',
  book: 'it played from its opening book',
  failed: 'the search failed, so it played any open column',
};

function lastMoveHtml() {
  if (!lastSearch) return '<p class="muted">Nothing yet. Play the computer, and what it did for its last move shows here.</p>';
  const { level, reason, nodes, depth, ms, memory, solved, score, target, onPage } = lastSearch;
  if (level === 'easy') return '<p class="muted">Easy does no searching: it only looks one disc ahead.</p>';
  if (reason !== 'search') return `<p class="muted">No search was needed: ${WHY_NO_SEARCH[reason]}.</p>`;
  const lookahead = target && !solved && depth < target ? `reached ${depth} of ${target}, stopped at ${timeWords(ms)}` : `${depth} discs`;
  const speed = ms ? `${(nodes / ms / 1000).toFixed(1)} million/s` : '–';
  const result = !solved ? 'Not proved yet' : score > 0 ? 'Proved: it wins' : score < 0 ? 'Proved: it loses' : 'Proved: a draw';
  return `
    <dl class="facts">
      <dt>Level</dt><dd>${capital(level)}</dd>
      <dt>Positions calculated</dt><dd>${nodes.toLocaleString('en')}</dd>
      <dt>Lookahead</dt><dd>${lookahead}</dd>
      <dt>Time</dt><dd>${(ms / 1000).toFixed(1)} s</dd>
      <dt>Speed</dt><dd>${speed}</dd>
      <dt>Memory</dt><dd>${memory} MB</dd>
      <dt>Result</dt><dd>${result}</dd>
    </dl>
    ${onPage ? '<p class="muted">This move ran on the page with a short limit, because the background worker was not available.</p>' : ''}`;
}

function advancedHtml() {
  const game = gameSearches;
  const totals = game?.moves
    ? `<dl class="facts">
        <dt>Moves searched</dt><dd>${game.moves}</dd>
        <dt>Positions calculated</dt><dd>${game.nodes.toLocaleString('en')}</dd>
        <dt>Deepest lookahead</dt><dd>${game.deepest} discs</dd>
        <dt>Longest think</dt><dd>${(game.longest / 1000).toFixed(1)} s</dd>
      </dl>`
    : '<p class="muted">No searches yet this game.</p>';
  return `<h3>Last move</h3>${lastMoveHtml()}<h3>This game</h3>${totals}`;
}

function drawAdvanced() {
  const byTime = settings.guruBy === 'time';
  $('row-guru-time').hidden = !byTime;
  $('row-guru-depth').hidden = byTime;
  $('guru-depth').value = settings.guruDepth;
  $('guru-note').textContent = byTime
    ? 'Guru stops sooner if it proves the result. A slower device looks less far in the same time.'
    : `Guru takes as long as it needs, up to ${timeWords(MAX_THINK_MS)}. Each extra disc takes longer than the last, and a slower device may not get there.`;
  $('advanced-stats').innerHTML = advancedHtml();
}

function showAdvanced() {
  drawAdvanced();
  $('advanced').hidden = false;
}

// ---- Animation ----------------------------------------------------------
//
// While something is shown (a disc falling, the winning line, the board
// emptying), the board draws `show` instead of the match: the position as it
// stood, moved on one step at a time. Each step changes `show`, the board is
// drawn, and the step then sets its pieces moving. Input waits, and a tap or
// key skips to the end, where the match already is. A step marked `soft` only
// ends early: the tap goes on to do what it was for, so a disc in the air
// never swallows the next move. A step marked `still` is shown even with
// reduced motion, as there is no other way to see what it shows.

function runShow(steps, before) {
  show = { board: before.board, score: before.score, line: null, prompt: '', soft: false, steps, timer: 0 };
  nextStep();
}

function nextStep() {
  if (!show) return;
  const step = show.steps.shift();
  if (!step) {
    endShow();
    return;
  }
  show.soft = Boolean(step.soft);
  step.change?.();
  render();
  step.animate?.();
  show.timer = setTimeout(nextStep, step.wait ?? 0);
}

// Also called early, when a tap or key skips the animation.
function endShow() {
  if (!show) return;
  clearTimeout(show.timer);
  show = null;
  finish();
}

// A fall takes longer the farther it goes, as if under gravity.
const fallMs = row => Math.round(FALL_MS * Math.sqrt((ROWS - row) / ROWS));

// A disc falling from the air above its column, with a small bounce.
function fall(disc, column, row, ms) {
  const [x, y] = cellXY(column, row);
  const bounce = 1 + (ROWS - row) * 0.45;
  disc?.animate(
    [
      { transform: at(x, DROP_Y), easing: 'cubic-bezier(0.5, 0, 1, 0.65)' },
      { transform: at(x, y), offset: LANDS_AT, easing: 'ease-out' },
      { transform: at(x, y - bounce), offset: 0.87, easing: 'ease-in' },
      { transform: at(x, y), offset: 1 },
    ],
    { duration: ms, fill: 'backwards' },
  );
}

function dropStep({ side, column, row }) {
  const ms = fallMs(row);
  return {
    soft: true,
    change() {
      show.board = show.board.map((discs, i) => (i === column ? [...discs, side] : discs));
    },
    animate() {
      fall(discAt(column, row), column, row, ms);
      playSound('drop', (ms * LANDS_AT) / 1000);
    },
    wait: ms,
  };
}

// The game is decided: its line glows and the score moves on. The sound here
// is for a game within a match; a match's own end has the fanfare, in finish().
function lineStep(event) {
  return {
    still: true,
    change() {
      show.board = match.board;
      show.line = event.line;
      show.score = match.score;
      show.prompt = gameText();
    },
    animate() {
      if (!event.match) playSound(personTook(event.side) ? 'chime' : 'lose');
    },
    wait: LINE_MS,
  };
}

function drawStep() {
  return {
    still: true,
    change() {
      show.board = match.board;
      show.prompt = gameText();
    },
    animate() {
      playSound('draw');
    },
    wait: HOLD_MS,
  };
}

// The slider pulled: every disc drops out of the bottom of the board.
function clearStep() {
  return {
    soft: true,
    animate() {
      playSound('clear');
      for (const disc of $('board').querySelectorAll('.pieces .disc')) {
        const [column, row] = disc.dataset.key.split(':').map(Number);
        const [x, y] = cellXY(column, row);
        disc.animate([{ transform: at(x, y), easing: 'ease-in' }, { transform: at(x, BELOW_Y) }], { duration: CLEAR_MS, delay: row * 14, fill: 'both' });
      }
    },
    wait: CLEAR_MS + 40,
  };
}

// A take-back: the discs rise out of their columns.
function liftSteps(removed) {
  return [
    {
      soft: true,
      animate() {
        playSound('place');
        for (const { column, row } of removed) {
          const [x, y] = cellXY(column, row);
          discAt(column, row)?.animate([{ transform: at(x, y), easing: 'ease-in' }, { transform: at(x, -CELL) }], { duration: LIFT_MS, fill: 'both' });
        }
      },
      wait: LIFT_MS,
    },
  ];
}

// The steps that show what a change to the match did.
function stepsFor(events, before) {
  const steps = [];
  for (const event of events) {
    if (event.type === 'start' && before.board.some(discs => discs.length)) steps.push(clearStep());
    else if (event.type === 'drop') steps.push(dropStep(event));
    else if (event.type === 'win') steps.push(lineStep(event));
    else if (event.type === 'draw') steps.push(drawStep());
    else if (event.type === 'takeback') steps.push(...liftSteps(event.removed));
  }
  return steps;
}

// ---- Actions ------------------------------------------------------------

function describe(events) {
  const out = [];
  for (const event of events) {
    if (event.type === 'start') out.push(isYou(event.side) ? 'You go first.' : `${nameOf(event.side)} goes first.`);
    else if (event.type === 'drop' && !isYou(event.side)) out.push(`${nameOf(event.side)} played column ${event.column + 1}.`);
    else if (event.type === 'win') out.push('Four in a row!');
    else if (event.type === 'takeback') out.push(event.removed.length > 1 ? 'Took back your move and the reply.' : 'Took back your move.');
  }
  return out;
}

// The sounds of a change shown with no animation, which would have made them.
function soundEvents(events) {
  for (const event of events) {
    if (event.type === 'drop') playSound('drop');
    else if (event.type === 'takeback') playSound('place');
  }
}

// What the match looked like before a change.
const snapshot = () => ({ board: match.board.map(discs => [...discs]), phase: match.phase, score: [...match.score], actor: actor() });

// Runs one action on the match, then shows what it did.
function commit(action) {
  const before = snapshot();
  action();
  settle(before);
}

// Everything that follows a change to the match, made here or, on a guest's
// phone in a Wi-Fi game, by the host: what it says, saving, statistics,
// sending it to the other phone, then the animation, and after it the
// sounds, the celebration and the computer's next move. While the host looks
// at the menu its game goes on unseen.
function settle(before) {
  if (tip?.pending) cancelThinking();
  tip = null;
  notice = '';
  sentColumn = null;
  looking = false;
  messages = describe(match.events);
  if (!isGuest()) store(GAME_KEY, match.phase === 'over' ? null : match);
  if (match.phase === 'play') undoStats = null;
  else if (before.phase === 'play') record();
  if (isHost()) session.host.share(match);
  const seen = !$('table').hidden;
  if (wifiGame() && seen) alertTurn(before);
  const steps = seen ? stepsFor(match.events, before).filter(step => step.still || !reducedMotion()) : [];
  if (steps.length) {
    runShow(steps, before);
    return;
  }
  if (seen) soundEvents(match.events);
  finish();
}

// After a change has been shown: the end of the match, the board as it now
// is, anything that arrived meanwhile, and the computer's next move.
function finish() {
  if (match.phase === 'over' && !$('table').hidden) playSound(personWon() ? 'win' : 'lose', 0.2);
  celebrate();
  render();
  drainInbox();
  scheduleAi();
}

// A finished game counts once in this phone's statistics, though the last
// state of a Wi-Fi game can reach a phone more than once.
function record() {
  if (wifiGame()) {
    const key = `${match.id}:${match.gameNo}`;
    if (load(RECORDED_KEY) === key) return;
    store(RECORDED_KEY, key);
  }
  if (match.mode === 'ai') undoStats = JSON.stringify(stats);
  recordGame(stats, match);
  store(STATS_KEY, stats);
}

// A win by a person is celebrated before the box appears: fireworks and
// confetti. A win for the computer goes straight to the box.
function celebrate() {
  if (match.phase !== 'over' || !personWon() || reducedMotion() || $('table').hidden || celebrating) return;
  party = startParty($('party'), () => playSound('firework'));
  celebrating = setTimeout(() => endCelebration(), CHEER_MS);
}

// Shows the box. Also called early, when a tap or key skips the celebration;
// then the fireworks stop too, instead of fading out behind it.
function endCelebration(skipped = false) {
  if (!celebrating) return;
  clearTimeout(celebrating);
  celebrating = 0;
  if (skipped) stopParty();
  render();
}

function stopParty() {
  clearTimeout(celebrating);
  celebrating = 0;
  party?.stop();
  party = null;
}

// The computer's move: its question goes to the worker, and the answer is
// played after a short pause however quickly it came, unless the game has
// moved on by then. Leaving the table, taking back a move or starting again
// all end the question with stopAi().
function scheduleAi() {
  stopAi();
  if (!match || show || isGuest() || $('table').hidden) return;
  const side = actor();
  if (side === null || !isAi(side)) return;
  const question = ++questions;
  const asked = performance.now();
  const { level } = match.players[side];
  const limit = level === 'guru' ? guruLimit() : null;
  thinking = question;
  holdingAwake = level === 'guru';
  keepAwake(awakeWanted());
  render();
  const answered = result => {
    if (thinking !== question) return;
    noteSearch(level, result, limit);
    aiTimer = setTimeout(() => {
      if (thinking !== question) return;
      endThinking();
      commit(() => drop(match, side, result.column));
    }, Math.max(0, AI_DELAY - (performance.now() - asked)));
  };
  const heard = progress => {
    if (thinking !== question) return;
    searching = progress;
    if (!show && !tip) $('prompt').textContent = thinkingText(side);
  };
  ask({ type: 'move', moves: match.moves, level, seed: seedOf(match), limit }, heard).then(answered, () => {
    // A cancelled question has been replaced. Anything else is a failed
    // search, and the game must go on: any open column will do.
    if (thinking === question) answered({ column: match.board.findIndex((discs, column) => canDrop(match.board, column)) });
  });
}

function endThinking() {
  thinking = 0;
  searching = null;
  holdingAwake = false;
  keepAwake(awakeWanted());
}

function stopAi() {
  clearTimeout(aiTimer);
  if (!thinking) return;
  endThinking();
  cancelThinking();
}

// Remembers what the computer did, for the Advanced box.
function noteSearch(level, result, limit) {
  lastSearch = { level, target: limit?.depth ?? 0, reason: 'failed', ...result };
  const key = `${match.id}:${match.gameNo}`;
  if (gameSearches?.key !== key) gameSearches = { key, moves: 0, nodes: 0, deepest: 0, longest: 0 };
  if (!result.nodes) return;
  gameSearches.moves++;
  gameSearches.nodes += result.nodes;
  gameSearches.deepest = Math.max(gameSearches.deepest, result.depth);
  gameSearches.longest = Math.max(gameSearches.longest, result.ms);
}

// A move by the person who must act here: run here, or on a guest's phone in
// a Wi-Fi game sent to the host, whose answer comes back as the next state or
// as a refusal.
function act(move) {
  if (isGuest()) {
    notice = '';
    sent = session.guest.send(move);
    sentColumn = sent && move.t === 'drop' ? move.column : null;
    render();
    return;
  }
  const side = actor();
  commit(() => apply(side, move));
}

// A move made by `side`, from this phone or (on the host's) the other. `next`
// starts the next game only from the game the phone was looking at.
function apply(side, move) {
  if (move.t === 'drop') drop(match, side, move.column);
  else if (move.t === 'next' && match.phase === 'between' && move.game === match.gameNo) nextGame(match);
}

function onColumn(column) {
  if (!canAct() || !canDrop(match.board, column)) return;
  act({ t: 'drop', column });
}

function onMain() {
  if (show) return;
  if (looking) {
    looking = false;
    render();
    return;
  }
  if (match.phase === 'between') {
    if (!sent && !linkDown()) act({ t: 'next', game: match.gameNo });
    return;
  }
  const side = standIn();
  if (side !== null) playFor(side);
}

function onUndo() {
  if (!canUndo()) return;
  stopAi();
  if (match.phase !== 'play') {
    const before = loadStats(JSON.parse(undoStats));
    for (const key of Object.keys(stats)) delete stats[key];
    Object.assign(stats, before);
    store(STATS_KEY, stats);
  }
  stopParty();
  commit(() => takeBack(match, 0));
}

// A hint is worked out by the worker. Anything that changes the position
// throws it away: settle() clears `tip`, and an answer only lands on its own.
function onHint() {
  if (!hintsOn() || !canAct() || tip?.pending) return;
  const asked = stamp();
  tip = { pending: asked, text: 'Thinking…' };
  render();
  const heard = result => {
    if (tip?.pending !== asked) return;
    tip = result;
    render();
  };
  ask({ type: 'hint', moves: match.moves, seed: seedOf(match) }).then(heard, () => heard(null));
}

function toggleSound() {
  settings.sound = !settings.sound;
  store(SETTINGS_KEY, settings);
  setMuted(!settings.sound);
  unlockSound();
  playSound('place'); // heard only when sound has just come back on
  $('btn-sound').setAttribute('aria-pressed', settings.sound);
}

function confirmFirst(title, text, button, action) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('btn-confirm').textContent = button;
  confirmed = action;
  $('confirm').hidden = false;
}

// On the host's phone, the main button also acts for the other phone while
// it is out of touch: it plays what a hint would say, after asking.
function playFor(side) {
  const name = nameOf(side);
  confirmFirst(`Play for ${name}?`, `${name}'s phone is out of touch. The computer makes its best choice for ${name}.`, 'Play', () => {
    if (standIn() !== side) return;
    const asked = stamp();
    standing = true;
    render();
    const done = result => {
      standing = false;
      if (result && standIn() === side && stamp() === asked) commit(() => drop(match, side, result.column));
      else render();
    };
    ask({ type: 'hint', moves: match.moves, seed: seedOf(match) }).then(done, () => done(null));
  });
}

// ---- Wi-Fi games ------------------------------------------------------------

// Each person plays on their own phone. The host's phone keeps the real
// match and runs every move; the other sends its moves and gets the match back
// after each one (wifi.js), over a direct link between the phones (net.js).

// Moves and states that arrive during an animation wait until it is over.
function whenIdle(task) {
  if (show) inbox.push(task);
  else task();
}

function drainInbox() {
  while (inbox.length && !show) inbox.shift()();
}

// This phone's turn: a chime as the other disc lands, and a buzz where the
// phone can.
function alertTurn(before) {
  if (actor() !== me || before.actor === me) return;
  playSound('turn', FALL_MS / 1000);
  try {
    navigator.vibrate?.(120);
  } catch {
    // no buzz, then
  }
}

// The screen stays on while this phone is in a Wi-Fi game, as a phone that
// sleeps drops out, and while Guru thinks, as a phone that sleeps stops it.
// The browser lets the lock go whenever the page is hidden, so it is asked for
// again each time the page comes back.
const awakeWanted = () => Boolean(session) || holdingAwake;
let wakeLock = null;
let askingLock = false;
async function keepAwake(on) {
  if (!on) {
    const lock = wakeLock;
    wakeLock = null;
    lock?.release().catch(() => {});
    return;
  }
  if (wakeLock || askingLock || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
  askingLock = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (awakeWanted()) {
      wakeLock = lock;
      lock.addEventListener('release', () => {
        if (wakeLock === lock) wakeLock = null;
      });
    } else lock.release().catch(() => {});
  } catch {
    // Refused (on low battery, say): the game goes on without it.
  }
  askingLock = false;
}

document.addEventListener('visibilitychange', () => keepAwake(awakeWanted()));

// Hosting and joining need a name, which the other phone sees.
function needName() {
  $('wifi-name').classList.add('want');
  $('wifi-name').focus();
}

// The host knows this tab again by its token, which lasts as long as the tab.
function wifiToken() {
  let token = load(TOKEN_KEY, true);
  if (typeof token !== 'string' || !token) {
    token = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    store(TOKEN_KEY, token, true);
  }
  return token;
}

// What this tab is doing in a Wi-Fi game, so that a reload goes back to it.
function storeWifi() {
  store(WIFI_KEY, session ? { role: session.role, code: session.code } : null, true);
}

// Ends this phone's part in the Wi-Fi game. The host's ends it for both; a
// guest gives up its seat, which the host keeps in case it comes back.
function endWifi() {
  if (!session) return;
  stopAi();
  const ending = session;
  session = null;
  storeWifi();
  if (ending.role === 'host') {
    // The room outlasts the goodbye a moment: closing it hangs up at once.
    ending.host.close('ended');
    setTimeout(() => ending.room?.close(), 1000);
  } else {
    ending.guest.leave();
    if (wifiGame()) match = null;
  }
  away = [];
  sent = false;
  sentColumn = null;
  standing = false;
  inbox = [];
  keepAwake(false);
}

// Runs `action` once this phone has left its Wi-Fi game, asking first while
// that game is being played.
function leaving(action) {
  const playing = liveWifi() && match.phase !== 'over';
  if (!playing) {
    endWifi();
    action();
    return;
  }
  const hosting = session.role === 'host';
  confirmFirst(
    hosting ? 'End the Wi-Fi game?' : 'Leave the Wi-Fi game?',
    hosting ? 'The other phone will be told that it has ended.' : 'Your seat is kept: join again with the same name to take it back.',
    hosting ? 'End it' : 'Leave',
    () => {
      endWifi();
      action();
    },
  );
}

// Host a game: a room under a new code, and the box that shows the code and
// who has joined, where Start begins the match.
function hostGame() {
  const name = cleanName(settings.wifiName);
  if (!name) {
    needName();
    return;
  }
  leaving(() => {
    const host = createHost({ name, version: VERSION, onmove: hostMove, onchange: hostChanged });
    session = { role: 'host', host, room: null, code: '', trouble: '' };
    keepAwake(true);
    showWifi('host');
    reopen(session);
  });
}

// Opens the room for `attempt`, a host's session: under its code when it has
// one (a saved match), otherwise a new one. During a match a failure is tried
// again; in the box, Try again does that.
async function reopen(attempt) {
  try {
    const room = await openRoom({ code: attempt.code || null, onlink: link => attempt.host.attach(link) });
    if (session !== attempt) {
      room.close();
      return;
    }
    Object.assign(attempt, { room, code: room.code, trouble: '' });
    if (wifiGame() && match.net) match.net.code = room.code;
    storeWifi();
  } catch (error) {
    if (session !== attempt) return;
    attempt.trouble = error.message;
    if (wifiGame() && attempt.host.started) setTimeout(() => session === attempt && reopen(attempt), 5000);
  }
  drawWifi();
  if (match && !$('table').hidden) render();
}

// A Wi-Fi match saved on the host's phone: its code is opened again, and the
// other phone, which keeps trying, comes back by itself.
function resumeHosting(saved) {
  const seats = saved.net?.seats ?? saved.players.map(player => ({ name: player.name, token: null }));
  const host = createHost({ name: saved.players[0].name, version: VERSION, seats, onmove: hostMove, onchange: hostChanged });
  session = { role: 'host', host, room: null, code: saved.net?.code ?? '', trouble: '' };
  me = 0;
  away = host.away();
  start(saved);
  storeWifi();
  reopen(session);
}

// The other phone joined, came back or dropped out. The lobby shows it; in a
// match, it is sent the match again, and its name dims or lights up.
function hostChanged() {
  if (session?.role !== 'host') return;
  if (wifiGame() && session.host.started) {
    away = session.host.away();
    match.net = { code: session.code, seats: session.host.saved() };
    if (match.phase !== 'over') store(GAME_KEY, match);
    session.host.share(match);
    if (!$('table').hidden) render();
  }
  drawWifi();
}

// A guest's move, run here as the host's own are, after any animation that
// is under way. A press of Next game from a phone a game behind is let go.
function hostMove(seat, move) {
  if (!isHost() || !session.host.started) return;
  const attempt = session;
  whenIdle(() => {
    if (session !== attempt || !wifiGame()) return;
    if (move.t === 'next' && (match.phase !== 'between' || move.game !== match.gameNo)) return;
    const before = snapshot();
    try {
      apply(seat, move);
    } catch (error) {
      session.host.refuse(seat, error.message);
      return;
    }
    settle(before);
  });
}

// Start, in the host's box: a match with the host's length and hints. After
// one match the first move passes to the other phone.
function startWifiGame() {
  if (session?.role !== 'host' || !session.room || session.host.players().length < 2) return;
  const starter = wifiGame() ? other(match.starter) : 0;
  const players = session.host.begin();
  const next = newMatch({ mode: 'net', target: settings.target, first: 'turns', starter, hints: settings.hints, players });
  next.net = { code: session.code, seats: session.host.saved() };
  me = 0;
  away = session.host.away();
  hideWifi();
  start(next, true);
}

// Play again, on the host's phone: back to the lobby, which someone else may
// join if the other phone has gone.
function hostAgain() {
  session.host.reopen();
  showWifi('host');
}

// Join a game: the box asks for the code. A shared link brings its code,
// and then joins straight away.
function openJoin(code = '') {
  if (!cleanName(settings.wifiName)) {
    waitingCode = code;
    needName();
    return;
  }
  waitingCode = '';
  leaving(() => {
    showWifi('join');
    $('join-code').value = cleanCode(code);
    if (code) joinGame();
  });
}

async function joinGame() {
  if (session) return;
  const code = cleanCode($('join-code').value);
  if (code.length !== CODE_LENGTH) {
    wifiStatus(`A code has ${CODE_LENGTH} letters.`, true);
    return;
  }
  const guest = createGuest({
    name: cleanName(settings.wifiName),
    token: wifiToken(),
    version: VERSION,
    connect: () => joinRoom(code),
    onmessage: guestHeard,
    onlink: guestLink,
  });
  const attempt = { role: 'guest', guest, code, players: null };
  session = attempt;
  keepAwake(true);
  wifiStatus('');
  try {
    await guest.join();
  } catch (error) {
    if (session !== attempt) return;
    session = null;
    storeWifi(); // a reload no longer tries this game
    keepAwake(false);
    wifiStatus(error.message, true);
    return;
  }
  if (session === attempt) storeWifi();
}

// What the host sends a guest.
function guestHeard(message) {
  if (session?.role !== 'guest') return;
  if (message.t === 'lobby') {
    session.players = message.players;
    // After a match, its results stay on screen until the host starts the next.
    if (wifiGame()) return;
    me = message.seat;
    if (!wifiBox) showWifi('join');
    drawWifi();
  } else if (message.t === 'state') {
    const attempt = session;
    session.players = message.game.players.map((player, seat) => ({ name: player.name, here: !message.away[seat] }));
    whenIdle(() => session === attempt && guestState(message));
  } else if (message.t === 'refused') {
    sent = false;
    sentColumn = null;
    notice = message.message;
    if (match && !$('table').hidden) render();
  } else {
    // The host ended the game, or would not take this phone back.
    const host = session.players?.[0]?.name ?? 'The host';
    endWifi();
    showMenu();
    showWifi('ended', message.t === 'closed' ? `${host} ended the game.` : deniedText(message, VERSION));
  }
}

// The match as the host sends it. A new one starts here; the one already here
// moves on as if the move were made on this phone; one this phone has already
// only says who is there. A phone that arrives at a finished game, having
// reloaded or lost touch, has not counted it yet.
function guestState({ seat, game: next, away: gone }) {
  me = seat;
  away = gone;
  if (!wifiGame() || match.id !== next.id) {
    hideWifi();
    start(next, next.events.some(event => event.type === 'start'));
    if (match.phase !== 'play') record();
    return;
  }
  if (sameState(match, next)) {
    if (!$('table').hidden) render();
    return;
  }
  const before = snapshot();
  match = next;
  sent = false;
  settle(before);
}

// The link to the host went, or came back. A move sent just before it went
// may never be answered: the next state will tell.
function guestLink(up) {
  if (!up) {
    sent = false;
    sentColumn = null;
  }
  if (match && !$('table').hidden) render();
  drawWifi();
}

// Resume on the menu: back to the Wi-Fi game this phone is in, or else the
// saved match, which for a Wi-Fi game's host opens its code again.
function resume() {
  if (liveWifi()) {
    $('menu').hidden = true;
    $('table').hidden = false;
    render();
    keepAwake(true);
    return;
  }
  const saved = load(GAME_KEY);
  if (saved?.v !== 1) return;
  if (saved.mode === 'net') resumeHosting(saved);
  else start(saved);
}

// The address that opens this game's Join box, sent with the phone's own
// Share sheet, or else copied.
async function shareLink() {
  if (session?.role !== 'host' || !session.code) return;
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('join', session.code);
  const net = new URLSearchParams(location.search).get('net');
  if (net) url.searchParams.set('net', net);
  try {
    if (navigator.share) await navigator.share({ title: 'Connect Four', text: `Join my Connect Four game: the code is ${session.code}.`, url: url.href });
    else {
      await navigator.clipboard.writeText(url.href);
      wifiStatus('Link copied. Paste it into a message to the other player.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') wifiStatus(url.href);
  }
}

// The Wi-Fi box: the host's code and lobby, a guest's join and wait, or why
// a Wi-Fi game ended.
function showWifi(kind, text = '') {
  wifiBox = kind;
  wifiNote = { text, warn: kind === 'ended' };
  $('wifi').hidden = false;
  drawWifi();
  if (kind === 'join' && !session && matchMedia('(pointer: fine)').matches) $('join-code').focus();
}

function hideWifi() {
  wifiBox = null;
  $('wifi').hidden = true;
}

function wifiStatus(text, warn = false) {
  wifiNote = { text, warn };
  drawWifi();
}

// Cancel (or Leave) gives up the lobby and goes to the menu; after a Wi-Fi
// game has ended, OK goes there too.
function cancelWifi() {
  const ended = wifiBox === 'ended';
  hideWifi();
  if (!ended) endWifi();
  showMenu();
}

function drawWifi() {
  if (!wifiBox) return;
  const hosting = wifiBox === 'host' && session?.role === 'host';
  const guest = wifiBox === 'join' && session?.role === 'guest' ? session.guest : null;
  const players = hosting ? session.host.players() : guest ? session.players : null;
  const owner = players?.[0]?.name ?? 'the host';
  let title = 'Wi-Fi game';
  let text = '';
  let { text: status, warn } = wifiNote;
  let goLabel = null;
  let cancel = 'Cancel';
  let listed = false;
  if (wifiBox === 'ended') {
    goLabel = 'OK';
    cancel = null;
  } else if (wifiBox === 'host') {
    title = 'Host a game';
    if (hosting && session.room) {
      text = 'On the other phone, choose Wi-Fi, tap Join a game and enter:';
      listed = true;
      goLabel = 'Start';
      if (!status) status = players.length < MAX_PLAYERS ? 'Waiting for the other player to join…' : 'Both here: start when you are ready.';
    } else if (hosting && session.trouble) {
      [status, warn] = [session.trouble, true];
      goLabel = 'Try again';
    } else if (hosting) text = 'Opening a game…';
  } else {
    title = 'Join a game';
    if (!guest) {
      text = "Enter the code on the host's screen.";
      goLabel = 'Join';
    } else if (guest.connected && players) {
      text = `You are in ${owner}'s game.`;
      listed = true;
      cancel = 'Leave';
      if (!status) status = `Waiting for ${owner} to start…`;
    } else if (players) {
      text = `Lost touch with ${owner}'s phone. Trying again…`;
      listed = true;
      cancel = 'Leave';
    } else text = `Connecting to game ${session.code}…`;
  }
  $('wifi-title').textContent = title;
  $('wifi-text').textContent = text;
  $('wifi-text').hidden = !text;
  const code = hosting && session.room ? session.code : '';
  $('wifi-code').hidden = !code;
  $('wifi-code').innerHTML = [...code].map(letter => `<span>${letter}</span>`).join('');
  $('wifi-code').setAttribute('aria-label', `Code ${[...code].join(' ')}`);
  $('btn-share').hidden = !code;
  $('join-code').hidden = !(wifiBox === 'join' && !guest);
  $('wifi-players').hidden = !listed;
  const mine = hosting ? 0 : me;
  const entry = (player, seat) =>
    `<li${player.here ? '' : ' class="away"'}><i class="side${seat}"></i><span>${escapeHtml(player.name)}${seat === mine ? ' <span class="muted">(you)</span>' : ''}</span></li>`;
  $('wifi-players').innerHTML = listed ? players.map(entry).join('') : '';
  $('wifi-status').textContent = status;
  $('wifi-status').classList.toggle('warn', warn);
  $('btn-wifi-go').hidden = !goLabel;
  $('btn-wifi-go').textContent = goLabel ?? '';
  $('btn-wifi-go').disabled = goLabel === 'Start' && (players?.length ?? 0) < MAX_PLAYERS;
  $('btn-wifi-cancel').hidden = !cancel;
  $('btn-wifi-cancel').textContent = cancel ?? '';
}

// ---- The keyboard's cursor ------------------------------------------------

// The arrow keys move along the columns with room left, starting from the
// middle, and focus goes with them for a screen reader to follow.
function moveCursor(step) {
  const open = Array.from({ length: COLUMNS }, (unused, column) => column).filter(column => canDrop(match.board, column));
  if (!open.length) return;
  const i = open.indexOf(cursor);
  const middle = open.reduce((best, column) => (Math.abs(column - 3) < Math.abs(best - 3) ? column : best));
  const next = i < 0 ? middle : open[(i + step + open.length) % open.length];
  $('board').querySelector(`[data-column="${next}"]`).focus({ preventScroll: true });
  cursor = next; // after the focus moves, which clears it
  render();
}

function pressCursor() {
  if (cursor === null) moveCursor(1);
  else onColumn(cursor);
}

// ---- Screens ------------------------------------------------------------

// The players for a new match from the menu. Two people typing the same name
// become "Ann" and "Ann 2", so that every message names one person.
function playersFor() {
  if (settings.mode === 'ai') return [{ name: 'You' }, { name: 'Computer', ai: true, level: settings.difficulty }];
  const players = [];
  settings.names.forEach((typed, i) => {
    const wanted = typed.replace(/\s+/g, ' ').trim() || `Player ${i + 1}`;
    let name = wanted;
    for (let n = 2; players.some(other => other.name.toLowerCase() === name.toLowerCase()); n++) {
      name = `${wanted.slice(0, NAME_LENGTH - String(n).length - 1)} ${n}`;
    }
    players.push({ name });
  });
  return players;
}

// A Wi-Fi game goes on while its host looks at the menu: the other phone's
// moves keep coming. Anything being shown is cut short.
function showMenu() {
  stopAi();
  tip = null;
  if (show) {
    clearTimeout(show.timer);
    show = null;
  }
  stopParty();
  for (const group of document.querySelectorAll('.choice[data-setting]')) {
    for (const button of group.children) {
      button.setAttribute('aria-pressed', parseValue(button.dataset.value) === settings[group.dataset.setting]);
    }
  }
  const { mode } = settings;
  $('menu').dataset.mode = mode;
  $('row-difficulty').hidden = mode !== 'ai';
  $('row-first').hidden = mode !== 'ai';
  $('row-undo').hidden = mode !== 'ai';
  $('btn-advanced').hidden = mode !== 'ai';
  $('row-names').hidden = mode !== 'local';
  $('row-wifi-name').hidden = mode !== 'net';
  $('row-wifi').hidden = mode !== 'net';
  $('btn-new').hidden = mode === 'net';
  for (const field of document.querySelectorAll('[data-name]')) field.value = settings.names[Number(field.dataset.name)];
  $('wifi-name').value = settings.wifiName;

  // Resume goes back to a Wi-Fi game this phone is in, or else to the saved match.
  const saved = liveWifi() ? null : load(GAME_KEY);
  const canResume = liveWifi() ? match.phase !== 'over' : saved?.v === 1 && saved.phase !== 'over' && Array.isArray(saved.board);
  $('btn-resume').hidden = !canResume;
  if (liveWifi()) $('btn-resume').textContent = 'Back to the Wi-Fi game';
  else if (canResume) {
    const what = saved.mode === 'net' ? 'Wi-Fi game' : saved.target > 1 ? 'match' : 'game';
    $('btn-resume').textContent = `Resume ${what}${saved.target > 1 ? ` (${saved.score.join('–')}, to ${saved.target})` : ''}`;
  }
  for (const id of ['btn-new', 'btn-host', 'btn-join']) $(id).classList.toggle('primary', !canResume);

  for (const id of ['table', 'gameover', 'confirm']) $(id).hidden = true;
  $('menu').hidden = false;
  drainInbox();
}

// `fresh` is a match just begun. If its board has come straight from a finished
// one, that one's discs fall out first.
function start(saved = null, fresh = !saved) {
  const replaced = fresh && match && !$('table').hidden ? match.board : null;
  stopParty();
  stopAi();
  match = saved ?? newMatch({
    mode: settings.mode,
    difficulty: settings.difficulty,
    target: settings.target,
    first: settings.mode === 'ai' ? settings.first : 'turns',
    starter: other(settings.lastStarter),
    hints: settings.hints,
    undo: settings.undo,
    players: playersFor(),
  });
  if (!wifiGame()) {
    me = 0;
    away = [];
    if (fresh) {
      settings.lastStarter = match.starter;
      store(SETTINGS_KEY, settings);
    }
  }
  cursor = null;
  tip = null;
  messages = [];
  notice = '';
  sent = false;
  sentColumn = null;
  standing = false;
  inbox = [];
  show = null;
  looking = false;
  undoStats = null;
  drawBoard();
  $('menu').hidden = true;
  $('table').hidden = false;
  keepAwake(awakeWanted());
  if (fresh) {
    settle({ ...snapshot(), actor: null, ...(replaced ? { board: replaced } : {}) }); // a new match: whoever starts is told it is their turn
    return;
  }
  if (!isGuest()) store(GAME_KEY, match.phase === 'over' ? null : match);
  if (isHost()) session.host.share(match);
  render();
  scheduleAi();
}

// Play again: the same players, length and level, whatever the menu now says,
// with the first move passing on where the match takes turns.
function playAgain() {
  const { mode, difficulty, target, first, starter, rules, players } = match;
  start(newMatch({ mode, difficulty, target, first, starter: other(starter), ...rules, players: players.map(({ name, ai, level }) => ({ name, ai, level })) }), true);
}

function showStats() {
  resetArmed = false;
  $('btn-reset').textContent = 'Reset statistics';
  $('stats-body').innerHTML = statsHtml();
  $('stats').hidden = false;
}

// ---- Wiring -------------------------------------------------------------

for (const place of [$('menu'), $('advanced')]) {
  place.addEventListener('click', event => {
    const button = event.target.closest('.choice button');
    if (!button) return;
    settings[button.parentElement.dataset.setting] = parseValue(button.dataset.value);
    store(SETTINGS_KEY, settings);
    setMuted(!settings.sound);
    showMenu();
    if (!$('advanced').hidden) drawAdvanced();
  });
}

// Anything can be typed, so it is put right when the field is left.
$('guru-depth').addEventListener('change', event => {
  const typed = Number.parseInt(event.target.value, 10);
  settings.guruDepth = Number.isNaN(typed) ? settings.guruDepth : clampDiscs(typed);
  store(SETTINGS_KEY, settings);
  drawAdvanced();
});

for (const field of document.querySelectorAll('[data-name]')) {
  field.addEventListener('input', () => {
    settings.names[Number(field.dataset.name)] = field.value.slice(0, NAME_LENGTH);
    store(SETTINGS_KEY, settings);
  });
}

$('wifi-name').addEventListener('input', event => {
  event.target.classList.remove('want');
  settings.wifiName = event.target.value.slice(0, NAME_LENGTH);
  store(SETTINGS_KEY, settings);
});

$('btn-new').addEventListener('click', () => leaving(() => start()));
$('btn-resume').addEventListener('click', resume);
$('btn-host').addEventListener('click', hostGame);
$('btn-join').addEventListener('click', () => openJoin(waitingCode));
$('btn-share').addEventListener('click', shareLink);
$('btn-wifi-cancel').addEventListener('click', cancelWifi);
$('btn-wifi-go').addEventListener('click', () => {
  if (wifiBox === 'ended') cancelWifi();
  else if (wifiBox === 'join') joinGame();
  else if (session?.role === 'host' && !session.room) {
    session.trouble = '';
    drawWifi();
    reopen(session);
  } else startWifiGame();
});
$('join-code').addEventListener('input', event => {
  event.target.value = cleanCode(event.target.value);
  if (wifiNote.warn) wifiStatus('');
});
$('join-code').addEventListener('keydown', event => {
  if (event.key === 'Enter') joinGame();
});
$('btn-confirm').addEventListener('click', () => {
  $('confirm').hidden = true;
  const action = confirmed;
  confirmed = null;
  action?.();
});

$('btn-stats').addEventListener('click', showStats);
$('btn-rules').addEventListener('click', () => {
  $('rules').hidden = false;
});
$('about-version').textContent = `Version ${VERSION} · ${RELEASED}`;
$('btn-about').addEventListener('click', () => {
  $('about').hidden = false;
});
$('btn-advanced').addEventListener('click', showAdvanced);
$('btn-menu').addEventListener('click', showMenu);
$('btn-main').addEventListener('click', onMain);
$('btn-undo').addEventListener('click', onUndo);
$('btn-hint').addEventListener('click', onHint);
$('btn-sound').addEventListener('click', toggleSound);

const columnOf = event => {
  const button = event.target.closest?.('.column');
  return button ? Number(button.dataset.column) : null;
};

$('board').addEventListener('click', event => {
  const column = columnOf(event);
  if (column !== null) onColumn(column);
});

// Only a mouse hovers: a finger drops the disc where it taps.
function setHover(column) {
  if (hover === column) return;
  hover = column;
  if (match && !$('table').hidden) render();
}

$('board').addEventListener('pointerover', event => {
  if (event.pointerType === 'mouse') setHover(columnOf(event));
});
$('board').addEventListener('pointerleave', () => setHover(null));
$('board').addEventListener('focusin', event => {
  if (!event.target.matches('.column:focus-visible')) return;
  cursor = columnOf(event);
  render();
});
$('board').addEventListener('focusout', () => {
  if (cursor === null) return;
  cursor = null;
  render();
});

$('gameover').addEventListener('click', event => {
  const action = event.target.dataset.do;
  if (action === 'again') {
    if (isHost()) hostAgain();
    else playAgain();
  } else if (action === 'takeback') onUndo();
  else if (action === 'board') {
    looking = true;
    render();
  } else if (action === 'stats') showStats();
  else if (action === 'menu') showMenu();
});

// The first press arms the button, the second erases.
$('btn-reset').addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    $('btn-reset').textContent = 'Tap again to erase';
    return;
  }
  Object.assign(stats, emptyStats());
  store(STATS_KEY, stats);
  undoStats = null;
  showStats();
});

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => {
    button.closest('.overlay').hidden = true;
  });
}

// Browsers only allow sound once the page has been tapped or typed at, so every
// tap and key wakes the audio. Either one also skips an animation in progress,
// and then does nothing else: it must not also press a button. The exception
// is a disc falling, which is skipped and lets the tap carry on, so that the
// board always answers at once.
for (const type of ['pointerdown', 'keydown']) {
  document.addEventListener(
    type,
    event => {
      unlockSound();
      const soft = Boolean(show?.soft) && !celebrating;
      const busy = Boolean(show) || Boolean(celebrating);
      skipClick = busy && !soft;
      if (!busy) return;
      endCelebration(true); // first, as the end of an animation can start one
      endShow();
      if (type === 'keydown' && !soft) {
        event.stopPropagation();
        // Stop Enter or Space pressing the focused button, but leave browser
        // shortcuts such as reload alone.
        if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
      }
    },
    true,
  );
}

// The click that follows a skipping tap is dropped before anything sees it.
document.addEventListener(
  'click',
  event => {
    if (!skipClick) return;
    skipClick = false;
    event.stopPropagation();
    event.preventDefault();
  },
  true,
);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!$('wifi').hidden) {
      cancelWifi();
      return;
    }
    const open = ['rules', 'stats', 'about', 'confirm', 'advanced'].filter(id => !$(id).hidden);
    for (const id of open) $(id).hidden = true;
    if (!open.length && match && !$('table').hidden && cursor !== null) {
      cursor = null;
      render();
    }
    return;
  }
  if (event.target.matches?.('input')) return;
  const busy = !match || $('table').hidden || !$('rules').hidden || !$('stats').hidden || !$('confirm').hidden || !$('about').hidden || !$('advanced').hidden;
  if (busy || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (event.key === 'Enter' && event.target !== $('btn-menu')) {
    event.preventDefault(); // Enter always does the next thing, whichever has focus
    if (canAct()) pressCursor();
    else onMain();
  } else if (key === 'h') onHint();
  else if (key === 'm') toggleSound();
  else if (key === 'u' || event.key === 'Backspace') {
    event.preventDefault();
    onUndo();
  } else if (event.key === ' ') {
    if (canAct()) {
      event.preventDefault();
      pressCursor();
    }
  } else if (/^[1-7]$/.test(event.key)) onColumn(Number(event.key) - 1);
  else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && canAct()) {
    event.preventDefault();
    moveCursor(event.key === 'ArrowLeft' ? -1 : 1);
  }
});

startThinker();
showMenu();

// A tab that was in a Wi-Fi game (reloaded, or brought back by the browser)
// goes straight back to it. A shared link opens the Join box with its code.
{
  const was = load(WIFI_KEY, true);
  const saved = load(GAME_KEY);
  const address = new URL(location.href);
  const code = cleanCode(address.searchParams.get('join') ?? '');
  if (address.searchParams.has('join')) {
    address.searchParams.delete('join');
    history.replaceState(null, '', address.href);
  }
  if (was?.role === 'host' && saved?.v === 1 && saved.mode === 'net' && saved.phase !== 'over') resumeHosting(saved);
  else if (was?.role === 'guest' && was.code) openJoin(was.code);
  else if (code) {
    settings.mode = 'net';
    store(SETTINGS_KEY, settings);
    showMenu();
    openJoin(code);
  }
}
