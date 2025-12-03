export type CellStatus = 'empty' | 'ship' | 'hit' | 'miss' | 'sunk';

export interface Coordinate {
  x: number;
  y: number;
}

export interface Ship {
  id: string;
  size: number; // 1, 2, 3, 4
  coords: Coordinate[];
  hits: number;
}

export interface BoardState {
  grid: CellStatus[][]; // 10x10 grid
  ships: Ship[];
  shotsFired: Coordinate[];
}

export type GamePhase = 'placement' | 'playing' | 'gameOver';

export type Turn = 'player' | 'computer';

export const BOARD_SIZE = 10;

// Russian Rules Fleet: 1x4, 2x3, 3x2, 4x1
export const FLEET_CONFIG = [
  { size: 4, count: 1 },
  { size: 3, count: 2 },
  { size: 2, count: 3 },
  { size: 1, count: 4 },
];

// Multiplayer Types
export type GameMode = 'single' | 'multiplayer';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type NetworkMessage = 
  | { type: 'HELLO' }
  | { type: 'READY' }
  | { type: 'SHOT'; x: number; y: number }
  | { type: 'SHOT_RESULT'; x: number; y: number; result: 'hit' | 'miss' | 'sunk'; sunkShipCoords?: Coordinate[] }
  | { type: 'PLAY_AGAIN' };
