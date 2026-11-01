// The computer's four levels and its hints. Easy doesn't search at all: it
// looks one disc ahead, and not always. The others all use the same search
// (engine.js) and differ only in how far it looks and how much noise is added
// to its scores, as Backgammon's levels do. Everything here works from the
// list of columns played, so it can run in the worker (see worker.js) as
// easily as on the page.

import { boardOf, lineThrough, openColumns, COLUMNS, ROWS } from './game.js';
import { think, rngOf, PROVED } from './engine.js';

// Noise blurs a level's judgement of quiet positions but never a proved win or
// loss, whose scores are far beyond it. So Hard is sharp in a fight and can
// still be outplayed: its noise is what leaves room to beat it, and Medium
// differs by not looking ahead. Tuned by self-play (dev/tune.html), where each
// beats the level below about 80% of the time.
export const LEVELS = {
  easy: { takeWin: 0.9, block: 0.7 },
  medium: { depth: 1, noise: 50 },
  hard: { depth: 4, noise: 60 },
  guru: { ms: 3000, book: true, defend: true },
};

// Hints use the search with a short budget, and the book, but no noise: a hint
// is the best the computer can find quickly.
const HINT = { ms: 600, book: true };

// How many of the 69 possible lines pass through each cell: the centre is on
// the most, which makes it a good place for a disc when nothing else is going on.
const CELL_LINES = (() => {
  const cells = Array.from({ length: COLUMNS }, () => new Array(ROWS).fill(0));
  for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    for (let c = 0; c < COLUMNS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const line = [0, 1, 2, 3].map(n => [c + dc * n, r + dr * n]);
        if (line.every(([x, y]) => x >= 0 && x < COLUMNS && y >= 0 && y < ROWS)) for (const [x, y] of line) cells[x][y]++;
      }
    }
  }
  return cells;
})();

// The columns where this side's next disc would finish a line.
function winningColumns(board, side) {
  return openColumns(board).filter(column => {
    const row = board[column].length;
    board[column].push(side);
    const won = lineThrough(board, column, row).length > 0;
    board[column].pop();
    return won;
  });
}

const sideToMove = moves => moves.length % 2;

function easyMove(moves, { takeWin, block }, random) {
  const board = boardOf(moves, 0);
  const me = sideToMove(moves);
  const wins = winningColumns(board, me);
  if (wins.length && random() < takeWin) return wins[Math.floor(random() * wins.length)];
  const threats = winningColumns(board, 1 - me);
  if (threats.length && random() < block) return threats[Math.floor(random() * threats.length)];
  const open = openColumns(board);
  let pick = random() * open.reduce((sum, column) => sum + CELL_LINES[column][board[column].length], 0);
  for (const column of open) {
    pick -= CELL_LINES[column][board[column].length];
    if (pick < 0) return column;
  }
  return open.at(-1);
}

// The move for `level`, as { column }. `limit` is { ms } or { nodes } to use
// in place of the level's own, and `seed` a number that stays the same all
// game: a position answered once is answered the same way again.
export function chooseMove({ moves, level, seed = 1, limit = null, fresh = false }) {
  const settings = LEVELS[level];
  if (level === 'easy') return { column: easyMove(moves, settings, rngOf(Math.imul(seed, 53) + moves.length)) };
  return think(moves, { ...settings, ...(limit ?? {}), seed, fresh });
}

const columnName = column => `column ${column + 1}`;

// The best move for the side to move, and why, as { column, text }. The side
// asking is told what it can use, in the order that matters to them.
export function hint({ moves, seed = 1, limit = null, fresh = false }) {
  const { column, score, solved, reason } = think(moves, { ...HINT, ...(limit ?? {}), seed, fresh });
  const where = columnName(column);
  const capital = `Column ${column + 1}`;
  if (reason === 'win') return { column, text: `${capital} wins the game.` };
  if (reason === 'block') return { column, text: `${capital} blocks a win for the other side.` };
  if (reason === 'lost') return { column, text: `They have two ways to win now. ${capital} blocks one and hopes.` };
  if (reason === 'only') return { column, text: `${capital} is the only move that doesn't hand over the game.` };
  if (reason === 'book') return { column, text: `${capital}: the middle is the strongest place to play.` };
  if (solved && score >= PROVED) return { column, text: `${capital} leads to a forced win, if you keep finding the moves.` };
  if (solved && score <= -PROVED) return { column, text: `Every move loses against perfect play. ${capital} holds out longest.` };
  if (solved) return { column, text: `${capital} holds the draw.` };
  return { column, text: `Try ${where}: it looks strongest.` };
}

// One question from the page, as thinker.js sends them: { type: 'move' | 'hint', ... }.
export const answer = request => (request.type === 'hint' ? hint(request) : chooseMove(request));

// A number for the game in hand, the same all game and through a reload.
export function seedOf(match) {
  let seed = match.gameNo;
  for (const letter of String(match.id)) seed = (Math.imul(seed, 31) + letter.charCodeAt(0)) | 0;
  return seed;
}
