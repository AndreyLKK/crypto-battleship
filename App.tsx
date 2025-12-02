import React, { useState, useEffect, useRef } from 'react';
import { 
  BoardState, 
  GamePhase, 
  Turn, 
  FLEET_CONFIG, 
  Coordinate,
  Ship,
  GameMode,
  ConnectionStatus,
  NetworkMessage
} from './types';
import { 
  createEmptyBoard, 
  generateRandomBoard, 
  processShot, 
  getComputerMove,
  placeShipOnGrid,
  isValidPlacement,
  updateBoardWithResult
} from './utils/gameLogic';
import Board from './components/Board';
import { RefreshCw, Play, RotateCw, Trophy, AlertTriangle, Anchor, Users, User, Link as LinkIcon, Copy, ArrowLeft } from 'lucide-react';

const App: React.FC = () => {
  // --- View State ---
  const [view, setView] = useState<'menu' | 'setup' | 'game'>('menu');
  const [gameMode, setGameMode] = useState<GameMode>('single');

  // --- Multiplayer State ---
  const [peerId, setPeerId] = useState<string>('');
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected');
  const [opponentIdInput, setOpponentIdInput] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [remotePeerId, setRemotePeerId] = useState<string | null>(null);
  const [opponentReady, setOpponentReady] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);

  // PeerJS refs
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);

  // --- Game State ---
  const [phase, setPhase] = useState<GamePhase>('placement');
  const [turn, setTurn] = useState<Turn>('player');
  const [winner, setWinner] = useState<Turn | null>(null);
  const [message, setMessage] = useState<string>("Расставьте корабли или нажмите 'Случайно'");

  // Board State
  const [playerBoard, setPlayerBoard] = useState<BoardState>(createEmptyBoard());
  const [enemyBoard, setEnemyBoard] = useState<BoardState>(createEmptyBoard());

  // Placement State
  const [currentShipIndex, setCurrentShipIndex] = useState(0); 
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [previewCoords, setPreviewCoords] = useState<Coordinate[]>([]);
  const [isValidPreview, setIsValidPreview] = useState(true);

  // Stats for MP victory check
  // In MP, we don't know enemy ships. We track hits.
  // Victory condition: we hit 20 ship cells (4+3*2+2*3+1*4 = 20)
  const TOTAL_SHIP_CELLS = 20;

  const shipsToPlace = React.useMemo(() => {
    const list: number[] = [];
    FLEET_CONFIG.forEach(type => {
      for (let i = 0; i < type.count; i++) list.push(type.size);
    });
    return list.sort((a, b) => b - a);
  }, []);

  // --- Initialization & Cleanup ---
  useEffect(() => {
    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  const resetGame = () => {
    setPhase('placement');
    setPlayerBoard(createEmptyBoard());
    setEnemyBoard(createEmptyBoard());
    setTurn('player');
    setWinner(null);
    setCurrentShipIndex(0);
    setPlayerReady(false);
    setOpponentReady(false);
    setMessage(gameMode === 'multiplayer' ? "Расставьте корабли и нажмите 'ГОТОВ'" : "Расставьте корабли или нажмите 'Случайно'");
    
    if (gameMode === 'multiplayer' && isHost) {
        // Host goes first by default in new game
        setTurn('player');
    } else if (gameMode === 'multiplayer') {
        setTurn('computer');
    }
  };

  const handleMainMenu = () => {
      if (connRef.current) connRef.current.close();
      if (peerRef.current) peerRef.current.destroy();
      setPeerId('');
      setConnStatus('disconnected');
      setRemotePeerId(null);
      setOpponentReady(false);
      setPlayerReady(false);
      setIsHost(false);
      setView('menu');
  };

  // --- Multiplayer Connection Logic ---
  
  const initPeer = (id: string | null = null) => {
    if (peerRef.current) peerRef.current.destroy();
    setConnStatus('connecting');

    // Access Peer from global scope (added via CDN)
    const Peer = (window as any).Peer;
    if (!Peer) {
        alert("PeerJS library not loaded");
        return;
    }

    const peer = new Peer(id);
    peerRef.current = peer;

    peer.on('open', (id: string) => {
      console.log('My peer ID is: ' + id);
      setPeerId(id);
      if (!remotePeerId) { 
         // If we are host and just opened, we are waiting
      }
    });

    peer.on('connection', (conn: any) => {
      console.log('Incoming connection from: ' + conn.peer);
      handleConnection(conn);
    });

    peer.on('error', (err: any) => {
      console.error(err);
      setConnStatus('error');
      setMessage("Ошибка соединения: " + err.type);
    });
  };

  const connectToPeer = () => {
    if (!opponentIdInput) return;
    if (!peerRef.current) initPeer();
    
    // Give peer a moment to init if just created
    setTimeout(() => {
        if (peerRef.current) {
            const conn = peerRef.current.connect(opponentIdInput);
            handleConnection(conn);
        }
    }, 500);
  };

  const handleConnection = (conn: any) => {
    connRef.current = conn;
    setRemotePeerId(conn.peer);
    
    conn.on('open', () => {
      console.log('Connected to: ' + conn.peer);
      setConnStatus('connected');
      setView('game');
      resetGame();
      // Send HELLO
      conn.send({ type: 'HELLO' });
    });

    conn.on('data', (data: NetworkMessage) => {
      handleNetworkMessage(data);
    });

    conn.on('close', () => {
      console.log('Connection closed');
      setConnStatus('disconnected');
      setMessage("Соединение с противником разорвано.");
      setPhase('gameOver'); // Or just pause
    });
  };

  const handleNetworkMessage = (msg: NetworkMessage) => {
    console.log("Received:", msg);
    
    switch (msg.type) {
        case 'HELLO':
            // Connection confirmed
            break;
        case 'READY':
            setOpponentReady(true);
            if (playerReady) {
                // Both ready, start game
                startGameMultiplayer();
            } else {
                setMessage("Противник готов! Ожидает вас.");
            }
            break;
        case 'SHOT':
            handleIncomingShot(msg.x, msg.y);
            break;
        case 'SHOT_RESULT':
            handleShotResult(msg.x, msg.y, msg.result, msg.sunkShipCoords);
            break;
        case 'PLAY_AGAIN':
             // Reset request
             resetGame();
             setMessage("Противник хочет сыграть снова. Расставьте корабли.");
             break;
    }
  };

  const sendNetworkMessage = (msg: NetworkMessage) => {
      if (connRef.current && connRef.current.open) {
          connRef.current.send(msg);
      }
  };

  // --- Game Loop Logic ---

  const randomizePlayerShips = () => {
    setPlayerBoard(generateRandomBoard());
    setCurrentShipIndex(shipsToPlace.length); // All placed
    if (gameMode === 'multiplayer') {
        setMessage("Корабли расставлены. Нажмите 'ГОТОВ'.");
    } else {
        setMessage("Корабли расставлены. Готовы к бою?");
    }
  };

  const startGameSingle = () => {
    if (currentShipIndex < shipsToPlace.length) {
      setMessage("Сначала расставьте все корабли!");
      return;
    }
    setEnemyBoard(generateRandomBoard());
    setPhase('playing');
    setMessage("Игра началась! Ваш ход.");
  };

  const setMultiplayerReady = () => {
      if (currentShipIndex < shipsToPlace.length) {
          setMessage("Сначала расставьте все корабли!");
          return;
      }
      setPlayerReady(true);
      sendNetworkMessage({ type: 'READY' });
      
      if (opponentReady) {
          startGameMultiplayer();
      } else {
          setMessage("Ожидаем готовности противника...");
      }
  };

  const startGameMultiplayer = () => {
      setPhase('playing');
      // Host moves first
      if (isHost) {
          setTurn('player');
          setMessage("Игра началась! Ваш ход (Вы Хост).");
      } else {
          setTurn('computer');
          setMessage("Игра началась! Ход противника.");
      }
  };

  // --- Placement Logic ---

  const handlePlacementHover = (x: number, y: number) => {
    if (phase !== 'placement' || currentShipIndex >= shipsToPlace.length) {
      setPreviewCoords([]);
      return;
    }

    const size = shipsToPlace[currentShipIndex];
    const vertical = orientation === 'vertical';
    const coords: Coordinate[] = [];
    let valid = true;

    for (let i = 0; i < size; i++) {
        const cx = vertical ? x : x + i;
        const cy = vertical ? y + i : y;
        if (cx < 0 || cx >= 10 || cy < 0 || cy >= 10) {
            valid = false; 
            break;
        }
        coords.push({ x: cx, y: cy });
    }

    if (valid) {
      valid = isValidPlacement(playerBoard.grid, x, y, size, vertical);
    }
    
    setIsValidPreview(valid);
    setPreviewCoords(coords);
  };

  const handlePlacementClick = (x: number, y: number) => {
    if (phase !== 'placement' || currentShipIndex >= shipsToPlace.length) return;

    const size = shipsToPlace[currentShipIndex];
    const vertical = orientation === 'vertical';

    const result = placeShipOnGrid(playerBoard.grid, playerBoard.ships, x, y, size, vertical);
    
    if (result) {
      setPlayerBoard({
        ...playerBoard,
        grid: result.grid,
        ships: [...playerBoard.ships, result.ship]
      });
      setCurrentShipIndex(prev => prev + 1);
      setPreviewCoords([]);
      
      if (currentShipIndex + 1 >= shipsToPlace.length) {
          if (gameMode === 'multiplayer') {
             setMessage("Нажмите 'ГОТОВ', чтобы начать.");
          } else {
             setMessage("Все корабли готовы. Нажмите 'В БОЙ'!");
          }
      }
    }
  };

  const toggleOrientation = () => {
    setOrientation(prev => prev === 'horizontal' ? 'vertical' : 'horizontal');
  };

  // --- Gameplay Logic ---

  const checkWinner = (isLocalPlayer: boolean, currentEnemyBoard: BoardState) => {
    // Single Player check
    if (gameMode === 'single') {
        const enemyLost = currentEnemyBoard.ships.every(s => s.hits >= s.size);
        if (enemyLost) {
          setPhase('gameOver');
          setWinner('player');
          setMessage("ПОБЕДА! Флот противника уничтожен!");
          return true;
        }
        
        const playerLost = playerBoard.ships.every(s => s.hits >= s.size);
        if (playerLost) {
          setPhase('gameOver');
          setWinner('computer');
          setMessage("ПОРАЖЕНИЕ. Ваш флот пошел ко дну.");
          return true;
        }
    } else {
        // Multiplayer Check
        // If I am active player (just shot), I check if I won
        // To win, I need to have sunk all enemy ships. 
        // In MP, we count 'hit' and 'sunk' cells on enemy board.
        let hitCount = 0;
        for(let r=0; r<10; r++) for(let c=0; c<10; c++) {
            if (currentEnemyBoard.grid[r][c] === 'hit' || currentEnemyBoard.grid[r][c] === 'sunk') hitCount++;
        }
        
        if (hitCount >= TOTAL_SHIP_CELLS) {
            setPhase('gameOver');
            setWinner('player');
            setMessage("ПОБЕДА! Вы уничтожили флот врага!");
            return true;
        }
    }
    return false;
  };

  // Called when we receive a shot from opponent
  const handleIncomingShot = (x: number, y: number) => {
      // Process shot on my board
      const { board: newPlayerBoard, result, sunkShipCoords } = processShot(playerBoard, x, y);
      
      if (result === 'already_shot') return;

      setPlayerBoard(newPlayerBoard);
      
      // Notify opponent of result
      sendNetworkMessage({ 
          type: 'SHOT_RESULT', 
          x, y, result, 
          sunkShipCoords: result === 'sunk' ? sunkShipCoords : undefined 
      });

      // Check if I lost
      const myHitCount = newPlayerBoard.grid.flat().filter(c => c === 'hit' || c === 'sunk').length;
      if (myHitCount >= TOTAL_SHIP_CELLS) {
          setPhase('gameOver');
          setWinner('computer'); // Opponent won
          setMessage("ПОРАЖЕНИЕ! Противник уничтожил ваш флот.");
          return;
      }

      // Turn logic
      if (result === 'miss') {
          setTurn('player'); // My turn now
          setMessage("Противник промахнулся! Ваш ход.");
      } else {
          setMessage("Противник попал! Он стреляет снова.");
          // Still opponent's turn
      }
  };

  // Called when we receive result of OUR shot
  const handleShotResult = (x: number, y: number, result: 'hit'|'miss'|'sunk', sunkShipCoords?: Coordinate[]) => {
      const newEnemyBoard = updateBoardWithResult(enemyBoard, x, y, result, sunkShipCoords);
      setEnemyBoard(newEnemyBoard);

      if (checkWinner(true, newEnemyBoard)) return;

      if (result === 'miss') {
          setTurn('computer'); // Pass turn
          setMessage("Промах! Ход противника...");
      } else {
          const msg = result === 'sunk' ? "Убил! Ходите снова!" : "Ранил! Ходите снова!";
          setMessage(msg);
          // Keep turn
      }
  };

  const handlePlayerCellClick = (x: number, y: number) => {
    if (phase !== 'playing' || turn !== 'player') return;

    // In Single Player
    if (gameMode === 'single') {
        const { board: newEnemyBoard, result } = processShot(enemyBoard, x, y);
        if (result === 'already_shot') return;

        setEnemyBoard(newEnemyBoard);

        if (checkWinner(true, newEnemyBoard)) return;

        if (result === 'miss') {
          setMessage("Промах! Ход противника...");
          setTurn('computer');
        } else {
          const msg = result === 'sunk' ? "Убил! Ходите снова!" : "Ранил! Ходите снова!";
          setMessage(msg);
        }
    } else {
        // Multiplayer Shot
        // Check if already shot locally to avoid network spam
        if (enemyBoard.grid[y][x] !== 'empty' && enemyBoard.grid[y][x] !== 'ship') return;

        // Optimistic UI? No, wait for result usually. 
        // But we can mark it as 'pending' if we wanted. For now just send.
        sendNetworkMessage({ type: 'SHOT', x, y });
    }
  };

  // AI Turn Effect (Single Player Only)
  useEffect(() => {
    if (gameMode === 'single' && phase === 'playing' && turn === 'computer') {
      const timer = setTimeout(() => {
        const move = getComputerMove(playerBoard);
        const { board: newPlayerBoard, result } = processShot(playerBoard, move.x, move.y);
        
        setPlayerBoard(newPlayerBoard);

        // Check if AI won
        const playerLost = newPlayerBoard.ships.every(s => s.hits >= s.size);
        if (playerLost) {
          setPhase('gameOver');
          setWinner('computer');
          setMessage("ПОРАЖЕНИЕ. Ваш флот пошел ко дну.");
          return;
        }

        if (result === 'miss') {
          setMessage("Противник промахнулся. Ваш ход!");
          setTurn('player');
        } else {
            const msg = result === 'sunk' ? "Ваш корабль уничтожен! Противник продолжает атаку." : "Попадание по вашему кораблю! Противник атакует снова.";
            setMessage(msg);
            // AI keeps turn, effect will re-run because playerBoard changed? 
            // We need to trigger it again. 
            // In App.tsx I added `playerBoard` dependency to this effect logic implicitly via re-render, 
            // but we need to ensure shots count changes.
        }
      }, 800);

      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, phase, playerBoard.shotsFired.length, gameMode]); 

  // --- Render Sections ---

  const renderMenu = () => (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 animate-fade-in">
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-blue-100 max-w-md w-full text-center">
             <div className="flex justify-center mb-6 text-blue-600">
                 <Anchor className="w-20 h-20" />
             </div>
             <h1 className="text-4xl font-black text-slate-800 mb-2 tracking-tight">МОРСКОЙ БОЙ</h1>
             <p className="text-slate-500 mb-8">Классическая стратегия для адмиралов</p>
             
             <div className="flex flex-col gap-4">
                 <button 
                    onClick={() => { setGameMode('single'); setView('game'); resetGame(); }}
                    className="flex items-center justify-center gap-3 w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg transition-transform hover:scale-105 active:scale-95"
                 >
                     <User size={24} /> Один игрок
                 </button>
                 <button 
                    onClick={() => { setGameMode('multiplayer'); setView('setup'); }}
                    className="flex items-center justify-center gap-3 w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold shadow-lg transition-transform hover:scale-105 active:scale-95"
                 >
                     <Users size={24} /> Играть с другом
                 </button>
             </div>
          </div>
      </div>
  );

  const renderSetup = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 animate-fade-in">
         <div className="flex w-full max-w-md justify-start">
             <button onClick={() => setView('menu')} className="flex items-center text-slate-500 hover:text-slate-800 font-medium">
                 <ArrowLeft size={20} className="mr-1"/> Назад
             </button>
         </div>

         <div className="bg-white p-8 rounded-2xl shadow-xl border border-blue-100 max-w-md w-full">
            <h2 className="text-2xl font-bold text-center mb-6 text-slate-800">Сетевая Игра</h2>
            
            {/* Connection Status Indicator */}
            {connStatus === 'connecting' && (
                <div className="p-4 bg-yellow-50 text-yellow-700 rounded-lg mb-4 text-center animate-pulse">
                    Подключение...
                </div>
            )}
            
            {!peerId ? (
                 <div className="flex flex-col gap-4">
                    <button 
                        onClick={() => { setIsHost(true); initPeer(); }}
                        className="py-3 px-4 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg font-bold transition-colors text-left flex items-center gap-3"
                    >
                        <div className="bg-blue-600 p-2 rounded text-white"><LinkIcon size={20}/></div>
                        <div>
                            <div className="text-sm opacity-70">Вариант 1</div>
                            Создать игру (Хост)
                        </div>
                    </button>
                    <button 
                        onClick={() => { setIsHost(false); initPeer(); }}
                        className="py-3 px-4 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg font-bold transition-colors text-left flex items-center gap-3"
                    >
                        <div className="bg-green-600 p-2 rounded text-white"><Users size={20}/></div>
                        <div>
                            <div className="text-sm opacity-70">Вариант 2</div>
                            Присоединиться к другу
                        </div>
                    </button>
                 </div>
            ) : (
                <div className="flex flex-col gap-6">
                    {isHost ? (
                        <div className="text-center">
                            <p className="text-sm text-slate-500 mb-2">Отправьте этот ID другу:</p>
                            <div className="flex items-center gap-2 bg-slate-100 p-3 rounded-lg border border-slate-200 mb-4">
                                <code className="flex-1 font-mono font-bold text-lg text-slate-700 break-all">{peerId}</code>
                                <button 
                                    onClick={() => navigator.clipboard.writeText(peerId)}
                                    className="p-2 hover:bg-white rounded-md text-slate-500 hover:text-blue-600 transition-colors"
                                    title="Копировать"
                                >
                                    <Copy size={20} />
                                </button>
                            </div>
                            <div className="flex items-center justify-center gap-2 text-slate-500 animate-pulse">
                                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                Ожидание подключения...
                            </div>
                        </div>
                    ) : (
                        <div className="text-center">
                             <p className="text-sm text-slate-500 mb-2">Введите ID друга:</p>
                             <input 
                                type="text"
                                value={opponentIdInput}
                                onChange={(e) => setOpponentIdInput(e.target.value)}
                                placeholder="ID хоста"
                                className="w-full p-3 border border-slate-300 rounded-lg font-mono text-center text-lg mb-4 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                             />
                             <button 
                                onClick={connectToPeer}
                                disabled={!opponentIdInput}
                                className={`w-full py-3 rounded-lg font-bold text-white transition-all
                                    ${opponentIdInput ? 'bg-green-600 hover:bg-green-700 shadow-md' : 'bg-slate-300 cursor-not-allowed'}
                                `}
                             >
                                Подключиться
                             </button>
                        </div>
                    )}
                </div>
            )}
         </div>
    </div>
  );

  const currentShipSize = shipsToPlace[currentShipIndex];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-800">
      
      {/* Header */}
      <header className="bg-white shadow-sm p-4 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2 cursor-pointer" onClick={handleMainMenu}>
            <Anchor className="text-blue-600 w-8 h-8" />
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">МОРСКОЙ БОЙ</h1>
          </div>

          {view === 'game' && (
            <>
                <div className={`px-4 py-2 rounded-full font-medium text-sm md:text-base shadow-sm transition-colors duration-300
                    ${phase === 'playing' && turn === 'player' ? 'bg-green-100 text-green-800 border border-green-200' : ''}
                    ${phase === 'playing' && turn === 'computer' ? 'bg-red-100 text-red-800 border border-red-200' : ''}
                    ${phase === 'gameOver' ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' : ''}
                    ${phase === 'placement' ? 'bg-blue-50 text-blue-700 border border-blue-200' : ''}
                `}>
                    {message}
                </div>

                <div className="flex gap-2">
                    {phase === 'placement' && (
                    <>
                        <button 
                        onClick={randomizePlayerShips} 
                        className="flex items-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-sm font-medium transition-colors"
                        >
                        <RefreshCw size={16} /> Случайно
                        </button>
                        <button 
                        onClick={gameMode === 'single' ? startGameSingle : setMultiplayerReady}
                        disabled={currentShipIndex < shipsToPlace.length || (gameMode === 'multiplayer' && playerReady)}
                        className={`flex items-center gap-2 px-6 py-2 rounded text-sm font-bold text-white shadow-md transition-all
                            ${(currentShipIndex < shipsToPlace.length || playerReady)
                                ? 'bg-gray-400 cursor-not-allowed opacity-50' 
                                : 'bg-green-600 hover:bg-green-700 hover:scale-105 active:scale-95'}
                        `}
                        >
                        {playerReady ? 'ОЖИДАНИЕ...' : (gameMode === 'single' ? 'В БОЙ' : 'ГОТОВ')} 
                        {!playerReady && <Play size={16} fill="currentColor" />}
                        </button>
                    </>
                    )}
                    {(phase === 'playing' || phase === 'gameOver') && (
                        <button 
                        onClick={gameMode === 'single' ? resetGame : () => {
                            if (connStatus === 'connected') {
                                sendNetworkMessage({type: 'PLAY_AGAIN'});
                                resetGame();
                            } else {
                                handleMainMenu();
                            }
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 rounded text-sm font-medium transition-colors"
                        >
                        <RefreshCw size={16} /> {gameMode === 'single' ? 'Рестарт' : 'Играть еще'}
                        </button>
                    )}
                    {gameMode === 'multiplayer' && (
                        <button 
                            onClick={handleMainMenu}
                            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 rounded text-sm font-medium transition-colors"
                        >
                            Выход
                        </button>
                    )}
                </div>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col items-center justify-center p-4 md:p-8 overflow-y-auto w-full">
        
        {view === 'menu' && renderMenu()}
        {view === 'setup' && renderSetup()}
        
        {view === 'game' && (
            <>
                {phase === 'placement' && (
                    <div className="mb-6 flex flex-col items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200 max-w-lg w-full">
                        <div className="flex justify-between w-full items-center">
                            <span className="font-semibold text-slate-600 text-sm uppercase tracking-wide">Режим расстановки</span>
                            <button 
                                onClick={toggleOrientation}
                                className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium bg-blue-50 px-3 py-1 rounded"
                            >
                                <RotateCw size={16} /> Повернуть (R)
                            </button>
                        </div>
                        
                        {currentShipIndex < shipsToPlace.length ? (
                            <div className="text-center">
                                <p className="text-slate-500 mb-2">Разместите корабль:</p>
                                <div className="flex gap-1 justify-center bg-blue-100 p-2 rounded-lg inline-flex">
                                    {Array(currentShipSize).fill(0).map((_, i) => (
                                        <div key={i} className="w-6 h-6 bg-slate-600 border border-slate-500 rounded-sm"></div>
                                    ))}
                                </div>
                                <p className="text-xs text-slate-400 mt-2">Осталось: {shipsToPlace.length - currentShipIndex}</p>
                            </div>
                        ) : (
                            <div className="text-green-600 font-bold flex items-center gap-2">
                                <Trophy size={20} /> Флот готов к бою!
                            </div>
                        )}
                    </div>
                )}

                <div className="flex flex-col lg:flex-row gap-8 lg:gap-16 items-start justify-center w-full">
                
                {/* Player Board */}
                <div className={`transition-opacity duration-500 ${(phase === 'playing' && turn === 'computer') ? 'opacity-100 ring-4 ring-red-200 rounded-xl' : 'opacity-90'}`}>
                    <Board 
                        title="Ваш Флот" 
                        boardState={playerBoard} 
                        isPlayer={true} 
                        highlightShips={true}
                        onCellHover={handlePlacementHover}
                        onCellClick={handlePlacementClick}
                        previewCoords={phase === 'placement' ? previewCoords : []}
                        isValidPreview={isValidPreview}
                        disabled={phase !== 'placement'}
                    />
                    <div className="mt-4 text-center">
                        <div className="text-sm text-slate-500">
                             {gameMode === 'single' ? "Живых кораблей" : "Попаданий по вам"}: {
                                gameMode === 'single' 
                                ? playerBoard.ships.filter(s => !s.hits || s.hits < s.size).length
                                : playerBoard.grid.flat().filter(c => c === 'hit' || c === 'sunk').length + "/20"
                             }
                        </div>
                    </div>
                </div>

                {/* Spacer / VS Badge */}
                {(phase === 'playing' || phase === 'gameOver') && (
                    <div className="hidden lg:flex flex-col items-center justify-center self-center text-slate-300 font-black text-4xl italic">
                        VS
                    </div>
                )}

                {/* Enemy Board */}
                {(phase === 'playing' || phase === 'gameOver') && (
                    <div className={`transition-all duration-300 ${turn === 'player' ? 'scale-105 shadow-2xl ring-4 ring-green-200 rounded-xl' : 'opacity-80 grayscale-[0.3]'}`}>
                        <Board 
                            title={gameMode === 'single' ? "Флот Компьютера" : "Флот Противника"} 
                            boardState={enemyBoard} 
                            isPlayer={false} 
                            onCellClick={handlePlayerCellClick}
                            disabled={turn !== 'player' || phase === 'gameOver'}
                        />
                        <div className="mt-4 text-center">
                            <div className="text-sm text-slate-500">
                                {gameMode === 'single' ? "Живых кораблей" : "Ваши попадания"}: {
                                   gameMode === 'single'
                                   ? enemyBoard.ships.filter(s => !s.hits || s.hits < s.size).length
                                   : enemyBoard.grid.flat().filter(c => c === 'hit' || c === 'sunk').length + "/20"
                                }
                            </div>
                        </div>
                    </div>
                )}
                </div>
            </>
        )}

        {phase === 'placement' && view === 'game' && (
             <div className="sr-only">Press R to rotate</div>
        )}

      </main>

      {/* Footer */}
      <footer className="p-4 text-center text-slate-400 text-xs">
         Морской Бой &copy; {new Date().getFullYear()} • React + PeerJS • Правила СНГ
      </footer>

      {/* Game Over Modal */}
      {phase === 'gameOver' && view === 'game' && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
              <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center transform transition-all scale-100">
                  {winner === 'player' ? (
                      <div className="mb-4 flex justify-center">
                          <Trophy className="w-16 h-16 text-yellow-500" />
                      </div>
                  ) : (
                      <div className="mb-4 flex justify-center">
                          <AlertTriangle className="w-16 h-16 text-red-500" />
                      </div>
                  )}
                  <h2 className="text-3xl font-bold mb-2">
                      {winner === 'player' ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ'}
                  </h2>
                  <p className="text-slate-600 mb-6">
                      {winner === 'player' 
                        ? (gameMode === 'single' ? 'Вы блестяще разгромили вражеский флот.' : 'Вы уничтожили флот друга!') 
                        : (gameMode === 'single' ? 'Искусственный интеллект оказался хитрее.' : 'Ваш друг оказался сильнее.')}
                  </p>
                  <button 
                    onClick={gameMode === 'single' ? resetGame : () => {
                         if (connStatus === 'connected') {
                            sendNetworkMessage({type: 'PLAY_AGAIN'});
                            resetGame();
                         } else {
                            handleMainMenu();
                         }
                    }}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-lg transition-transform active:scale-95"
                  >
                    Сыграть еще раз
                  </button>
                  <button onClick={handleMainMenu} className="mt-3 text-sm text-slate-500 hover:text-slate-800 underline">
                      В меню
                  </button>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;