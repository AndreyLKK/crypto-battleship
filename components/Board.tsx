import React from 'react';
import { BoardState, Coordinate } from '../types';
import GridCell from './GridCell';

interface BoardProps {
  boardState: BoardState;
  isPlayer: boolean;
  onCellClick?: (x: number, y: number) => void;
  onCellHover?: (x: number, y: number) => void;
  highlightShips?: boolean; // For showing player ships
  disabled?: boolean;
  title: string;
  previewCoords?: Coordinate[]; // For ship placement preview
  isValidPreview?: boolean;
}

const Board: React.FC<BoardProps> = ({ 
  boardState, 
  isPlayer, 
  onCellClick, 
  onCellHover,
  highlightShips = false,
  disabled = false,
  title,
  previewCoords = [],
  isValidPreview = true
}) => {
  return (
    <div className="flex flex-col items-center">
      <h2 className={`mb-3 text-xl font-bold tracking-wider ${isPlayer ? 'text-blue-700' : 'text-red-700'}`}>
        {title}
      </h2>
      
      <div className="relative p-2 bg-blue-50 rounded-lg shadow-xl border-2 border-blue-200">
        {/* Coordinates Labels - Top */}
        <div className="flex pl-8 mb-1">
            {['А','Б','В','Г','Д','Е','Ж','З','И','К'].map(char => (
                <div key={char} className="w-8 sm:w-9 md:w-10 text-center text-xs font-mono text-blue-400 font-bold">
                    {char}
                </div>
            ))}
        </div>

        <div className="flex">
            {/* Coordinates Labels - Left */}
            <div className="flex flex-col pr-1 pt-1 space-y-0">
                 {[1,2,3,4,5,6,7,8,9,10].map(num => (
                    <div key={num} className="h-8 sm:h-9 md:h-10 flex items-center justify-center text-xs font-mono text-blue-400 font-bold w-6">
                        {num}
                    </div>
                ))}
            </div>

            {/* The Grid */}
            <div className="grid grid-cols-10 gap-px bg-blue-200 border border-blue-300 overflow-hidden rounded shadow-inner">
            {boardState.grid.map((row, y) => (
                row.map((cellStatus, x) => {
                
                // Determine if this cell is part of the placement preview
                const isPreview = previewCoords.some(c => c.x === x && c.y === y);
                
                // Override status for preview visualization if empty
                let displayStatus = cellStatus;
                
                // Custom Rendering for Preview (hacky but effective overlay via inline style or logic)
                // We'll wrap the GridCell in a relative div to apply overlays if needed, 
                // but GridCell is simple enough to handle props.
                
                return (
                    <div key={`${x}-${y}`} className="relative">
                        <GridCell
                            x={x}
                            y={y}
                            status={displayStatus}
                            isPlayer={highlightShips}
                            onClick={onCellClick}
                            onHover={onCellHover}
                            disabled={disabled}
                        />
                        {isPreview && (
                            <div className={`absolute inset-0 opacity-60 pointer-events-none ${isValidPreview ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        )}
                    </div>
                );
                })
            ))}
            </div>
        </div>
      </div>
    </div>
  );
};

export default Board;