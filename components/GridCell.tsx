import React from 'react';
import { CellStatus } from '../types';
import { X, Circle, Flame } from 'lucide-react';

interface GridCellProps {
  x: number;
  y: number;
  status: CellStatus;
  isPlayer: boolean; // True if this is the player's board (show ships)
  onClick?: (x: number, y: number) => void;
  onHover?: (x: number, y: number) => void;
  disabled?: boolean;
}

const GridCell: React.FC<GridCellProps> = ({ 
  x, 
  y, 
  status, 
  isPlayer, 
  onClick, 
  onHover,
  disabled 
}) => {
  
  let content = null;
  let bgClass = "bg-blue-500/10 hover:bg-blue-500/20"; // Default water
  let borderClass = "border-blue-200/50";

  // Visual logic
  if (status === 'miss') {
    content = <Circle className="w-3 h-3 text-blue-900/40 fill-blue-900/40" />;
    bgClass = "bg-blue-100";
  } else if (status === 'hit') {
    content = <Flame className="w-5 h-5 text-orange-500 animate-pulse" />;
    bgClass = "bg-orange-100 border-orange-300";
    borderClass = "border-orange-300";
  } else if (status === 'sunk') {
    content = <X className="w-6 h-6 text-red-600 font-bold" />;
    bgClass = "bg-red-200 border-red-400";
    borderClass = "border-red-400";
  } else if (status === 'ship') {
    if (isPlayer) {
      bgClass = "bg-slate-600 border-slate-500";
      borderClass = "border-slate-500";
    } else {
      // Enemy ship hidden
      bgClass = "bg-blue-500/10 hover:bg-blue-500/30"; 
    }
  }

  // Interactive states for Enemy board
  if (!isPlayer && !disabled && status !== 'hit' && status !== 'miss' && status !== 'sunk') {
    bgClass += " cursor-crosshair hover:bg-red-500/20";
  } else if (!isPlayer && disabled) {
     bgClass += " cursor-not-allowed";
  }

  // Interactive states for Player board (Placement)
  if (isPlayer && !disabled && (status === 'empty' || status === 'ship')) {
      // Handled by parent hover usually, but base style here
      bgClass += " cursor-pointer";
  }


  return (
    <div
      onClick={() => !disabled && onClick && onClick(x, y)}
      onMouseEnter={() => !disabled && onHover && onHover(x, y)}
      className={`
        w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 
        border ${borderClass} 
        flex items-center justify-center 
        transition-colors duration-200
        ${bgClass}
      `}
    >
      {content}
    </div>
  );
};

export default GridCell;