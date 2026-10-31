// The board's geometry, in the units of its SVG, with no page in sight. Column
// and row count from 0 at the bottom left. Above the board is a strip of open
// air, where a disc waits over the column it would drop into.

import { COLUMNS, ROWS } from './game.js';

export const CELL = 20; // from the centre of one hole to the next
const HOLE = 8; // a hole's radius
export const DISC = 8.8; // a disc is a little wider than its hole
const FRAME = 7; // the blue around the holes
const FOOT = 13; // and below them, where the column numbers go
const CORNER = 8;

export const AIR = 22; // the height of the open air
export const DROP_Y = AIR / 2 + 0.5; // where a disc waits
const PLATE_Y = AIR;

export const BOARD = {
  width: 2 * FRAME + COLUMNS * CELL,
  height: AIR + FRAME + ROWS * CELL + FOOT,
};

export const columnX = column => FRAME + (column + 0.5) * CELL;
const rowY = row => PLATE_Y + FRAME + (ROWS - row - 0.5) * CELL;
export const cellXY = (column, row) => [columnX(column), rowY(row)];
export const LABEL_Y = BOARD.height - 4;

// Where a disc falls clear of the board, when the slider is pulled to empty it.
export const BELOW_Y = BOARD.height + CELL;

// The column buttons, as shares of the board's width and height.
export const columnBox = column => ({
  left: ((FRAME + column * CELL) / BOARD.width) * 100,
  width: (CELL / BOARD.width) * 100,
});

const circlePath = ([x, y], r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

function holes() {
  const cells = [];
  for (let column = 0; column < COLUMNS; column++) {
    for (let row = 0; row < ROWS; row++) cells.push(cellXY(column, row));
  }
  return cells;
}

// The front of the board: a plate with a hole at each cell. Discs are drawn
// behind it, so that one falling shows only through the holes.
export function plateShape() {
  const { width, height } = BOARD;
  const r = CORNER;
  const outline = `M${r} ${PLATE_Y}h${width - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${height - PLATE_Y - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${2 * r - width}a${r} ${r} 0 0 1 ${-r} ${-r}v${PLATE_Y + 2 * r - height}a${r} ${r} 0 0 1 ${r} ${-r}z`;
  return `${outline}${holes().map(cell => circlePath(cell, HOLE)).join('')}`;
}

// A ring round each hole, for the plate's thickness.
export const holeRims = () => holes().map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${HOLE}"/>`).join('');

export const backShape = { x: 2, y: PLATE_Y + 2, width: BOARD.width - 4, height: BOARD.height - PLATE_Y - 4, rx: CORNER };
