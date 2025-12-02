import { BOARD_SIZE, BoardState, CellStatus, Coordinate, FLEET_CONFIG, Ship } from '../types';

// Create an empty 10x10 grid
export const createEmptyGrid = (): CellStatus[][] => {
  return Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill('empty'));
};

export const createEmptyBoard = (): BoardState => ({
  grid: createEmptyGrid(),
  ships: [],
  shotsFired: [],
});

// Check if a coordinate is within bounds
export const isValidCoordinate = (x: number, y: number): boolean => {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
};

// Check if placement is valid (including diagonal spacing rules for Russian battleship)
export const isValidPlacement = (
  grid: CellStatus[][],
  x: number,
  y: number,
  size: number,
  vertical: boolean
): boolean => {
  const coords: Coordinate[] = [];
  for (let i = 0; i < size; i++) {
    const cx = vertical ? x : x + i;
    const cy = vertical ? y + i : y;
    if (!isValidCoordinate(cx, cy)) return false;
    coords.push({ x: cx, y: cy });
  }

  // Check neighbors for every cell in the potential ship
  for (const coord of coords) {
    // Check the cell itself
    if (grid[coord.y][coord.x] !== 'empty') return false;

    // Check all 8 surrounding cells
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = coord.x + dx;
        const ny = coord.y + dy;
        if (isValidCoordinate(nx, ny)) {
          if (grid[ny][nx] !== 'empty') return false;
        }
      }
    }
  }

  return true;
};

// Place a ship on the board (mutates grid copy usually, but here returns new state helpers)
export const placeShipOnGrid = (
  currentGrid: CellStatus[][],
  currentShips: Ship[],
  x: number,
  y: number,
  size: number,
  vertical: boolean
): { grid: CellStatus[][]; ship: Ship } | null => {
  if (!isValidPlacement(currentGrid, x, y, size, vertical)) return null;

  const newGrid = currentGrid.map((row) => [...row]);
  const newShipCoords: Coordinate[] = [];

  for (let i = 0; i < size; i++) {
    const cx = vertical ? x : x + i;
    const cy = vertical ? y + i : y;
    newGrid[cy][cx] = 'ship';
    newShipCoords.push({ x: cx, y: cy });
  }

  const newShip: Ship = {
    id: Math.random().toString(36).substr(2, 9),
    size,
    coords: newShipCoords,
    hits: 0,
  };

  return { grid: newGrid, ship: newShip };
};

// Auto-generate a board
export const generateRandomBoard = (): BoardState => {
  let grid = createEmptyGrid();
  let ships: Ship[] = [];

  // Iterate through fleet config
  // Sort large to small to make placement easier
  const fleet = [...FLEET_CONFIG].sort((a, b) => b.size - a.size);

  for (const shipType of fleet) {
    for (let i = 0; i < shipType.count; i++) {
      let placed = false;
      let attempts = 0;
      while (!placed && attempts < 1000) {
        const vertical = Math.random() > 0.5;
        const x = Math.floor(Math.random() * BOARD_SIZE);
        const y = Math.floor(Math.random() * BOARD_SIZE);

        const result = placeShipOnGrid(grid, ships, x, y, shipType.size, vertical);
        if (result) {
          grid = result.grid;
          ships.push(result.ship);
          placed = true;
        }
        attempts++;
      }
      if (!placed) {
        // Retry entire board generation if stuck (rare with this logic but possible)
        return generateRandomBoard();
      }
    }
  }

  return { grid, ships, shotsFired: [] };
};

// Check if a ship is sunk
export const isSunk = (ship: Ship): boolean => {
  return ship.hits >= ship.size;
};

// Process a shot locally (Player vs AI or validating incoming shot)
export const processShot = (
  board: BoardState,
  x: number,
  y: number
): { board: BoardState; result: 'hit' | 'miss' | 'sunk' | 'already_shot'; sunkShipCoords?: Coordinate[] } => {
  if (!isValidCoordinate(x, y)) return { board, result: 'already_shot' }; // Should not happen
  
  const cell = board.grid[y][x];
  if (cell === 'hit' || cell === 'miss' || cell === 'sunk') {
    return { board, result: 'already_shot' };
  }

  const newGrid = board.grid.map((row) => [...row]);
  const newShips = board.ships.map((s) => ({ ...s })); // Deep copy needed for hits
  let result: 'hit' | 'miss' | 'sunk' = 'miss';
  let sunkShipCoords: Coordinate[] | undefined;

  if (cell === 'ship') {
    newGrid[y][x] = 'hit';
    result = 'hit';

    // Find the ship and increment hits
    const shipIndex = newShips.findIndex((s) =>
      s.coords.some((c) => c.x === x && c.y === y)
    );

    if (shipIndex !== -1) {
      newShips[shipIndex].hits += 1;
      if (isSunk(newShips[shipIndex])) {
        result = 'sunk';
        sunkShipCoords = newShips[shipIndex].coords;
        // Mark all coords of this ship as 'sunk'
        newShips[shipIndex].coords.forEach((c) => {
          newGrid[c.y][c.x] = 'sunk';
        });

        // Mark surroundings as 'miss' (Quality of Life)
        const surrounding = getSurroundingCells(newShips[shipIndex]);
        surrounding.forEach((c) => {
          if (newGrid[c.y][c.x] === 'empty') {
            newGrid[c.y][c.x] = 'miss';
          }
        });
      }
    }
  } else {
    newGrid[y][x] = 'miss';
  }

  return {
    board: {
      grid: newGrid,
      ships: newShips,
      shotsFired: [...board.shotsFired, { x, y }],
    },
    result,
    sunkShipCoords
  };
};

// Update board based on external result (Multiplayer Shooter view)
export const updateBoardWithResult = (
  board: BoardState,
  x: number,
  y: number,
  result: 'hit' | 'miss' | 'sunk',
  sunkShipCoords?: Coordinate[]
): BoardState => {
  const newGrid = board.grid.map((row) => [...row]);
  const newShots = [...board.shotsFired, { x, y }];
  
  // Note: For the enemy board in MP, we don't have ships array populated usually
  // until we hit them. We just visualize the grid.

  if (result === 'miss') {
    newGrid[y][x] = 'miss';
  } else if (result === 'hit') {
    newGrid[y][x] = 'hit';
  } else if (result === 'sunk') {
    newGrid[y][x] = 'sunk';
    if (sunkShipCoords) {
      // Mark entire ship as sunk
      sunkShipCoords.forEach(c => {
        newGrid[c.y][c.x] = 'sunk';
      });
      // Mark surroundings as miss
      sunkShipCoords.forEach(c => {
         for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = c.x + dx;
                const ny = c.y + dy;
                if (isValidCoordinate(nx, ny) && newGrid[ny][nx] === 'empty') {
                    newGrid[ny][nx] = 'miss';
                }
            }
         }
      });
    }
  }

  return {
    ...board,
    grid: newGrid,
    shotsFired: newShots
  };
};


const getSurroundingCells = (ship: Ship): Coordinate[] => {
  const coords: Coordinate[] = [];
  ship.coords.forEach((c) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (isValidCoordinate(nx, ny)) {
          coords.push({ x: nx, y: ny });
        }
      }
    }
  });
  return coords;
};

// AI Logic
export const getComputerMove = (board: BoardState): Coordinate => {
  // Strategy:
  // 1. If there is a 'hit' ship that is not 'sunk', target adjacent cells.
  // 2. Otherwise, fire randomly (parity hunting or pure random).

  const hits = [];
  for(let y=0; y<BOARD_SIZE; y++) {
    for(let x=0; x<BOARD_SIZE; x++) {
      if(board.grid[y][x] === 'hit') {
        hits.push({x, y});
      }
    }
  }

  if (hits.length > 0) {
    // Found a damaged ship. Try neighbors.
    const targets: Coordinate[] = [];
    
    for (const h of hits) {
        const neighbors = [
            { x: h.x, y: h.y - 1 },
            { x: h.x, y: h.y + 1 },
            { x: h.x - 1, y: h.y },
            { x: h.x + 1, y: h.y },
        ];
        
        for (const n of neighbors) {
            if (isValidCoordinate(n.x, n.y)) {
                const status = board.grid[n.y][n.x];
                if (status === 'empty' || status === 'ship') {
                    targets.push(n);
                }
            }
        }
    }

    if (targets.length > 0) {
        return targets[Math.floor(Math.random() * targets.length)];
    }
  }

  // Random Move
  let x, y;
  do {
    x = Math.floor(Math.random() * BOARD_SIZE);
    y = Math.floor(Math.random() * BOARD_SIZE);
  } while (
    board.grid[y][x] === 'hit' || 
    board.grid[y][x] === 'miss' || 
    board.grid[y][x] === 'sunk'
  );

  return { x, y };
};
