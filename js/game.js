// The rules of Connect Four and of a match, with no page in sight. A match is
// one plain object that survives JSON, changed only by the actions here. Each
// action lists what it did in match.events, for the page to show, and throws
// if the move is not allowed.
//
// The board is seven columns, each a list of sides from the bottom up, so
// board[3][0] is the lowest disc of the middle column. Side 0 is red and side
// 1 yellow. match.moves is every column played this game, in order: with
// match.starter it is the whole game, and the computer thinks from it.

export const COLUMNS = 7;
export const ROWS = 6;
export const CELLS = COLUMNS * ROWS;
export const TARGETS = [1, 3, 5];
const CONNECT = 4;

export const other = side => 1 - side;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export const emptyBoard = () => Array.from({ length: COLUMNS }, () => []);

export const canDrop = (board, column) => Number.isInteger(column) && column >= 0 && column < COLUMNS && board[column].length < ROWS;

export const openColumns = board => board.flatMap((discs, column) => (discs.length < ROWS ? [column] : []));

// The side that played the `n`th disc of a game, from 0.
export const moverOf = (starter, n) => (n % 2 ? other(starter) : starter);

// The board that `moves` leave.
export function boardOf(moves, starter) {
  const board = emptyBoard();
  moves.forEach((column, n) => board[column].push(moverOf(starter, n)));
  return board;
}

// Every disc in a line of four or more through this one, as [column, row]:
// empty if there is none. Filling the gap in X X X _ X lights all five, and a
// disc can complete two lines at once.
export function lineThrough(board, column, row) {
  const side = board[column][row];
  const cells = new Map();
  for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const run = [[column, row]];
    for (const way of [1, -1]) {
      for (let c = column + dc * way, r = row + dr * way; board[c]?.[r] === side; c += dc * way, r += dr * way) run.push([c, r]);
    }
    if (run.length >= CONNECT) for (const cell of run) cells.set(cell.join(), cell);
  }
  return [...cells.values()].sort(([a, b], [c, d]) => a - c || b - d);
}

// ---- The match ----------------------------------------------------------

// Tells one match from the next, for the phones of a Wi-Fi game.
let made = 0;
const newId = () => `${Date.now().toString(36)}${(made++).toString(36)}`;

const defaultPlayers = (mode, difficulty) =>
  mode === 'ai' ? [{ name: 'You' }, { name: 'Computer', ai: true, level: difficulty }] : [{ name: 'Player 1' }, { name: 'Player 2' }];

const seated = ({ name, ai = false, level }, difficulty) => ({ name, ai, ...(ai ? { level: level ?? difficulty } : {}) });

// Who plays first in the first game of a match. `first` is 'you', 'computer'
// or 'turns'; only 'turns' uses `starter`, which is passed in so that "take
// turns" alternates from one match to the next as well as within one.
const opening = (first, starter) => (first === 'you' ? 0 : first === 'computer' ? 1 : starter);

// `players` is two of { name, ai, level }; a computer plays at its own
// `level`, which against the computer is `difficulty`. Side 0 is always a
// person when there is a computer to play.
export function newMatch({ mode = 'ai', difficulty = 'medium', target = 1, first = 'turns', starter = 0, hints = true, undo = true, players = defaultPlayers(mode, difficulty) } = {}) {
  check(TARGETS.includes(target), 'A match is to 1, 3 or 5 games');
  check(players.length === 2, 'Connect Four is a game for two');
  const match = {
    v: 1,
    id: newId(),
    mode,
    difficulty,
    target,
    first,
    rules: { hints: Boolean(hints), undo: mode === 'ai' && Boolean(undo) },
    players: players.map(player => seated(player, difficulty)),
    score: [0, 0],
    winner: null, // the side that wins the match
    gameNo: 0,
    starter: opening(first, starter),
    events: [],
  };
  startGame(match);
  return match;
}

function startGame(match) {
  match.gameNo++;
  Object.assign(match, { board: emptyBoard(), moves: [], takeBacks: 0, result: null, phase: 'play', turn: match.starter });
  match.events.push({ type: 'start', side: match.turn });
}

// The next game of a match: a draw changes who starts as a win does.
export function nextGame(match) {
  check(match.phase === 'between', 'The game is not over yet');
  match.events = [];
  if (match.first === 'turns') match.starter = other(match.starter);
  startGame(match);
}

export function drop(match, side, column) {
  check(match.phase === 'play' && match.turn === side, "Not this side's turn");
  check(canDrop(match.board, column), 'That column is full');
  match.events = [];
  const row = match.board[column].length;
  match.board[column].push(side);
  match.moves.push(column);
  match.events.push({ type: 'drop', side, column, row });
  const line = lineThrough(match.board, column, row);
  if (line.length) endGame(match, side, line);
  else if (match.moves.length === CELLS) endGame(match, null, []);
  else match.turn = other(side);
}

// `result` is this game's end and `winner` the match's. A draw scores nothing
// and is never the end of a match, so a finished match always has a winner.
function endGame(match, winner, line) {
  match.result = { winner, line, stones: match.moves.length };
  if (winner === null) {
    match.phase = 'between';
    match.events.push({ type: 'draw' });
    return;
  }
  match.score[winner]++;
  const won = match.score[winner] >= match.target;
  match.phase = won ? 'over' : 'between';
  if (won) match.winner = winner;
  match.events.push({ type: 'win', side: winner, line, match: won });
}

// A person playing the computer may take back moves, as far as the start of
// this game: their own last disc, and the computer's answer to it if there is
// one. That includes the move that lost or drew the game, but a game they won
// stays won.
export function canTakeBack(match, side) {
  if (!match.rules.undo || match.result?.winner === side) return false;
  return match.moves.some((column, n) => moverOf(match.starter, n) === side);
}

export function takeBack(match, side) {
  check(canTakeBack(match, side), 'There is no move to take back');
  match.events = [];
  if (Number.isInteger(match.result?.winner)) match.score[match.result.winner]--;
  Object.assign(match, { result: null, winner: null, phase: 'play', turn: side });
  const removed = [];
  while (removed.at(-1)?.side !== side) {
    const mover = moverOf(match.starter, match.moves.length - 1);
    const column = match.moves.pop();
    match.board[column].pop();
    removed.push({ side: mover, column, row: match.board[column].length });
  }
  match.takeBacks++;
  match.events.push({ type: 'takeback', side, removed });
}
