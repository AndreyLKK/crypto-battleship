import React, { useState, useEffect, useRef } from 'react';
import { 
  BoardState, 
  GamePhase, 
  Turn, 
  FLEET_CONFIG, 
  Coordinate,
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
import { RefreshCw, Play, RotateCw, Trophy, AlertTriangle, Anchor, Users, User, Link as LinkIcon, Copy, ArrowLeft, Loader2, XCircle, Info, Share2, Globe, Settings, Server } from 'lucide-react';

// --- CONFIGURATION START ---
// Список STUN серверов для пробива NAT (мобильный интернет)
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
];
// --- CONFIGURATION END ---

const App: React.FC = () => {
  // --- View State ---
  const [view, setView] = useState<'menu' | 'setup' | 'game'>('menu');
  const [gameMode, setGameMode] = useState<GameMode>('single');

  // --- Multiplayer State ---
  const [setupState, setSetupState] = useState<'select' | 'hosting' | 'joining'>('select');
  const [peerId, setPeerId] = useState<string>('');
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected');
  const [opponentIdInput, setOpponentIdInput] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [remotePeerId, setRemotePeerId] = useState<string | null>(null);
  const [opponentReady, setOpponentReady] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string>('');

  // --- Server Settings State ---
  const [useCustomServer, setUseCustomServer] = useState(false);
  const [customHost, setCustomHost] = useState('localhost'); // Default to local
  const [customPort, setCustomPort] = useState('9000');      // Default local port
  const [customPath, setCustomPath] = useState('/peerjs/myapp'); // Matches your server setup
  const [customSecure, setCustomSecure] = useState(false);   // False for localhost
  const [showServerSettings, setShowServerSettings] = useState(false);

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
    // Check URL for join code
    const hash = window.location.hash;
    if (hash.startsWith('#join=')) {
        const code = hash.replace('#join=', '');
        if (code) {
            setGameMode('multiplayer');
            setView('setup');
            setSetupState('joining');
            setOpponentIdInput(code);
            // Auto-init peer for joining (using default public server initially unless config saved)
            // For simplicity in this flow, we let them click "Connect" which calls initPeer
        }
    }

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
      setSetupState('select');
      setMpError(null);
      setShareLink('');
      // Clear URL hash
      window.history.pushState("", document.title, window.location.pathname + window.location.search);
      setView('menu');
  };

  const cancelSetup = () => {
      if (peerRef.current) peerRef.current.destroy();
      setPeerId('');
      setConnStatus('disconnected');
      setMpError(null);
      setSetupState('select');
      window.history.pushState("", document.title, window.location.pathname + window.location.search);
  };

  // --- Multiplayer Connection Logic ---
  
  const initPeer = () => {
    // Destroy previous instance if any
    if (peerRef.current) peerRef.current.destroy();
    
    setPeerId('');
    setMpError(null);

    const Peer = (window as any).Peer;
    if (!Peer) {
        setMpError("Библиотека PeerJS не загружена. Проверьте интернет.");
        return;
    }

    let peerConfig: any = {
        debug: 2, 
        config: {
            iceServers: ICE_SERVERS,
            iceTransportPolicy: 'all',
            iceCandidatePoolSize: 10,
        },
        pingInterval: 5000,
    };

    if (useCustomServer && customHost) {
        // Clean the host input
        let host = customHost.replace('https://', '').replace('http://', '').replace(/\/$/, '');
        peerConfig = {
            ...peerConfig,
            host: host,
            port: Number(customPort) || 443,
            path: customPath,
            secure: customSecure,
        };
        console.log("Connecting to custom server:", peerConfig);
    } else {
        peerConfig = {
            ...peerConfig,
            host: '0.peerjs.com',
            port: 443,
            path: '/',
            secure: true,
        };
        console.log("Connecting to public server");
    }

    const peer = new Peer(undefined, peerConfig);
    
    peerRef.current = peer;

    peer.on('open', (id: string) => {
      console.log('My peer ID is: ' + id);
      setPeerId(id);
      
      // Create shareable link
      const url = window.location.href.split('#')[0];
      setShareLink(`${url}#join=${id}`);
    });

    peer.on('connection', (conn: any) => {
      console.log('Incoming connection from: ' + conn.peer);
      handleConnection(conn);
    });

    peer.on('error', (err: any) => {
      console.error(err);
      let errorMsg = "Ошибка соединения.";
      if (err.type === 'peer-unavailable') errorMsg = "Игрок с таким ID не найден (или он оффлайн).";
      if (err.type === 'network') errorMsg = "Ошибка сети/фаервола.";
      if (err.type === 'browser-incompatible') errorMsg = "Ваш браузер устарел.";
      if (err.type === 'disconnected') errorMsg = "Отключено от сигнального сервера.";
      if (err.type === 'server-error') errorMsg = "Ошибка сервера PeerJS. Попробуйте позже.";
      if (err.type === 'invalid-id') errorMsg = "Некорректный ID.";
      
      // Specific check for custom server failures
      if (useCustomServer && (err.type === 'network' || err.type === 'server-error')) {
          errorMsg += " Проверьте адрес и порт вашего сервера.";
      }

      // If we are joining and fail, show specific help
      if (!isHost && err.type === 'peer-unavailable') {
         errorMsg = "Неверный ID или хост еще не создал игру.";
      }

      setMpError(errorMsg);
      setConnStatus('error');
    });
    
    peer.on('disconnected', () => {
        // Only auto-reconnect if we were already connected to someone
        if (connStatus === 'connected' && peer.id) {
             peer.reconnect();
        }
    });
  };

  const startHosting = () => {
      setSetupState('hosting');
      setIsHost(true);
      initPeer();
  };

  const startJoining = () => {
      setSetupState('joining');
      setIsHost(false);
      // Don't init peer immediately for joining, wait for user to click connect or if they have ID
      // Actually, we need a peer ID to connect TO someone.
      initPeer(); 
  };

  const connectToPeer = () => {
    if (!opponentIdInput) return;
    const cleanId = opponentIdInput.trim();
    setMpError(null);
    setConnStatus('connecting');
    
    // Ensure we have our own ID first
    if (!peerRef.current || !peerRef.current.id) {
         setMpError("Инициализация... Попробуйте еще раз через секунду.");
         if (!peerRef.current || peerRef.current.destroyed) initPeer();
         return;
    }

    try {
        const conn = peerRef.current.connect(cleanId, {
            reliable: true,
            serialization: 'json'
        });
        
        if (!conn) {
            setMpError("Не удалось создать подключение.");
            setConnStatus('disconnected');
            return;
        }
        handleConnection(conn);
    } catch (e) {
        console.error(e);
        setMpError("Ошибка при подключении.");
        setConnStatus('disconnected');
    }
  };

  const handleConnection = (conn: any) => {
    connRef.current = conn;
    
    // Safety timeout
    const timeout = setTimeout(() => {
        if (connStatus !== 'connected' && view !== 'game') {
             // If still not fully connected after 15s
             setMpError("Долгое соединение. Возможно NAT блокирует трафик.");
             setConnStatus('error');
        }
    }, 15000);

    conn.on('open', () => {
      clearTimeout(timeout);
      console.log('Connected to: ' + conn.peer);
      setRemotePeerId(conn.peer);
      setConnStatus('connected');
      setView('game');
      resetGame();
      // Send HELLO to confirm protocol
      conn.send({ type: 'HELLO' });
    });

    conn.on('data', (data: NetworkMessage) => {
      handleNetworkMessage(data);
    });

    conn.on('close', () => {
      console.log('Connection closed');
      setConnStatus('disconnected');
      setMessage("Соединение с противником разорвано.");
      // Optional: Force back to menu or show modal
    });
    
    conn.on('error', (err: any) => {
        console.error("Connection error:", err);
        setMpError("Ошибка соединения с пиром.");
    });
  };

  const handleNetworkMessage = (msg: NetworkMessage) => {
    console.log("Received:", msg);
    
    switch (msg.type) {
        case 'HELLO':
            // Connection confirmed logic if needed
            break;
        case 'READY':
            setOpponentReady(true);
            if (playerReady) {
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

  const handleIncomingShot = (x: number, y: number) => {
      const { board: newPlayerBoard, result, sunkShipCoords } = processShot(playerBoard, x, y);
      
      if (result === 'already_shot') return;

      setPlayerBoard(newPlayerBoard);
      
      sendNetworkMessage({ 
          type: 'SHOT_RESULT', 
          x, y, result, 
          sunkShipCoords: result === 'sunk' ? sunkShipCoords : undefined 
      });

      const myHitCount = newPlayerBoard.grid.flat().filter(c => c === 'hit' || c === 'sunk').length;
      if (myHitCount >= TOTAL_SHIP_CELLS) {
          setPhase('gameOver');
          setWinner('computer');
          setMessage("ПОРАЖЕНИЕ! Противник уничтожил ваш флот.");
          return;
      }

      if (result === 'miss') {
          setTurn('player');
          setMessage("Противник промахнулся! Ваш ход.");
      } else {
          setMessage("Противник попал! Он стреляет снова.");
      }
  };

  const handleShotResult = (x: number, y: number, result: 'hit'|'miss'|'sunk', sunkShipCoords?: Coordinate[]) => {
      const newEnemyBoard = updateBoardWithResult(enemyBoard, x, y, result, sunkShipCoords);
      setEnemyBoard(newEnemyBoard);

      if (checkWinner(true, newEnemyBoard)) return;

      if (result === 'miss') {
          setTurn('computer');
          setMessage("Промах! Ход противника...");
      } else {
          const msg = result === 'sunk' ? "Убил! Ходите снова!" : "Ранил! Ходите снова!";
          setMessage(msg);
      }
  };

  const handlePlayerCellClick = (x: number, y: number) => {
    if (phase !== 'playing' || turn !== 'player') return;

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
        if (enemyBoard.grid[y][x] !== 'empty' && enemyBoard.grid[y][x] !== 'ship') return;
        sendNetworkMessage({ type: 'SHOT', x, y });
    }
  };

  useEffect(() => {
    if (gameMode === 'single' && phase === 'playing' && turn === 'computer') {
      const timer = setTimeout(() => {
        const move = getComputerMove(playerBoard);
        const { board: newPlayerBoard, result } = processShot(playerBoard, move.x, move.y);
        
        setPlayerBoard(newPlayerBoard);

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
        }
      }, 800);

      return () => clearTimeout(timer);
    }
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
                    onClick={() => { setGameMode('multiplayer'); setView('setup'); setSetupState('select'); }}
                    className="flex items-center justify-center gap-3 w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold shadow-lg transition-transform hover:scale-105 active:scale-95"
                 >
                     <Globe size={24} /> Играть по сети
                 </button>
             </div>
          </div>
      </div>
  );

  const renderSetup = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 animate-fade-in px-4">
         <div className="flex w-full max-w-md justify-start">
             <button onClick={handleMainMenu} className="flex items-center text-slate-500 hover:text-slate-800 font-medium">
                 <ArrowLeft size={20} className="mr-1"/> Назад в меню
             </button>
         </div>

         <div className="bg-white p-8 rounded-2xl shadow-xl border border-blue-100 max-w-md w-full relative">
            <h2 className="text-2xl font-bold text-center mb-6 text-slate-800">Сетевая Игра</h2>

            {/* ERROR MESSAGE */}
            {mpError && (
                 <div className="mb-4 p-3 bg-red-100 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-2">
                     <AlertTriangle size={16} className="min-w-[16px]" /> 
                     <span>{mpError}</span>
                 </div>
            )}
            
            {/* SERVER SETTINGS TOGGLE (Visible in Select Mode) */}
            {setupState === 'select' && (
                <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <button 
                        onClick={() => setShowServerSettings(!showServerSettings)}
                        className="flex items-center gap-2 text-slate-600 font-medium text-sm hover:text-blue-600 transition-colors w-full justify-between"
                    >
                        <span className="flex items-center gap-2"><Settings size={16}/> Настройки сервера</span>
                        <span className="text-xs text-slate-400">{useCustomServer ? 'Свой сервер' : 'Публичный'}</span>
                    </button>
                    
                    {showServerSettings && (
                        <div className="mt-4 animate-fade-in pt-2 border-t border-slate-200 space-y-3">
                            <label className="flex items-center gap-2 mb-3 cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={useCustomServer} 
                                    onChange={(e) => setUseCustomServer(e.target.checked)}
                                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                />
                                <span className="text-sm font-semibold text-slate-700">Использовать свой сервер</span>
                            </label>
                            
                            {useCustomServer && (
                                <div className="space-y-3 p-2 bg-slate-100 rounded">
                                    <div className="space-y-1">
                                        <label className="text-xs text-slate-500 font-medium block">Хост (Host)</label>
                                        <input 
                                            type="text"
                                            value={customHost}
                                            onChange={(e) => setCustomHost(e.target.value)}
                                            placeholder="localhost"
                                            className="w-full p-2 text-sm border border-slate-300 rounded outline-none"
                                        />
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="space-y-1 flex-1">
                                            <label className="text-xs text-slate-500 font-medium block">Порт (Port)</label>
                                            <input 
                                                type="text"
                                                value={customPort}
                                                onChange={(e) => setCustomPort(e.target.value)}
                                                placeholder="9000"
                                                className="w-full p-2 text-sm border border-slate-300 rounded outline-none"
                                            />
                                        </div>
                                        <div className="space-y-1 flex-1">
                                            <label className="text-xs text-slate-500 font-medium block">Путь (Path)</label>
                                            <input 
                                                type="text"
                                                value={customPath}
                                                onChange={(e) => setCustomPath(e.target.value)}
                                                placeholder="/peerjs/myapp"
                                                className="w-full p-2 text-sm border border-slate-300 rounded outline-none"
                                            />
                                        </div>
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input 
                                            type="checkbox" 
                                            checked={customSecure} 
                                            onChange={(e) => setCustomSecure(e.target.checked)}
                                            className="w-4 h-4 text-blue-600 rounded"
                                        />
                                        <span className="text-xs text-slate-600">Secure (HTTPS/SSL)</span>
                                    </label>
                                    <div className="text-[10px] text-slate-400 italic">
                                        Для localhost: Порт 9000, Secure ВЫКЛ.<br/>
                                        Для Render/Glitch: Порт 443, Secure ВКЛ.
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* STATE: SELECT MODE */}
            {setupState === 'select' && (
                 <div className="flex flex-col gap-4">
                    <button 
                        onClick={startHosting}
                        disabled={useCustomServer && !customHost}
                        className={`py-4 px-5 border rounded-xl font-bold transition-colors text-left flex items-center gap-4 group
                            ${useCustomServer && !customHost 
                                ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                : 'bg-blue-50 text-blue-800 hover:bg-blue-100 border-blue-200'}
                        `}
                    >
                        <div className={`p-3 rounded-lg text-white shadow-md transition-transform ${useCustomServer && !customHost ? 'bg-slate-400' : 'bg-blue-600 group-hover:scale-110'}`}>
                            <LinkIcon size={24}/>
                        </div>
                        <div>
                            <div className="text-lg">Создать игру</div>
                            <div className="text-sm opacity-60 font-normal">Стать хостом и получить код</div>
                        </div>
                    </button>

                    <button 
                        onClick={startJoining}
                        disabled={useCustomServer && !customHost}
                        className={`py-4 px-5 border rounded-xl font-bold transition-colors text-left flex items-center gap-4 group
                            ${useCustomServer && !customHost 
                                ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                : 'bg-green-50 text-green-800 hover:bg-green-100 border-green-200'}
                        `}
                    >
                        <div className={`p-3 rounded-lg text-white shadow-md transition-transform ${useCustomServer && !customHost ? 'bg-slate-400' : 'bg-green-600 group-hover:scale-110'}`}>
                            <Users size={24}/>
                        </div>
                        <div>
                            <div className="text-lg">Подключиться</div>
                            <div className="text-sm opacity-60 font-normal">Ввести код друга</div>
                        </div>
                    </button>
                 </div>
            )}

            {/* STATE: HOSTING */}
            {setupState === 'hosting' && (
                <div className="flex flex-col items-center animate-fade-in">
                    {!peerId ? (
                        <div className="flex flex-col items-center py-8">
                             <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-4" />
                             <p className="text-slate-500">Генерация кода...</p>
                             {useCustomServer && <p className="text-xs text-slate-400 mt-2">Сервер: {customHost}:{customPort}</p>}
                        </div>
                    ) : (
                        <div className="w-full text-center">
                            <p className="text-sm text-slate-500 mb-2">Отправьте этот код другу:</p>
                            <div className="flex items-center gap-2 bg-slate-100 p-3 rounded-lg border border-slate-200 mb-4">
                                <code className="flex-1 font-mono font-bold text-xl text-slate-700 break-all">{peerId}</code>
                                <button 
                                    onClick={() => { navigator.clipboard.writeText(peerId); setMessage("Код скопирован!"); setTimeout(() => setMessage(""), 2000); }}
                                    className="p-2 hover:bg-white rounded-md text-slate-500 hover:text-blue-600 transition-colors"
                                    title="Копировать Код"
                                >
                                    <Copy size={20} />
                                </button>
                            </div>

                            <button 
                                onClick={() => { navigator.clipboard.writeText(shareLink); setMessage("Ссылка скопирована!"); setTimeout(() => setMessage(""), 2000); }}
                                className="w-full flex items-center justify-center gap-2 py-2 mb-6 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg font-medium transition-colors"
                            >
                                <Share2 size={18} /> Копировать ссылку на игру
                            </button>
                            
                            <div className="flex items-center justify-center gap-2 text-slate-500 animate-pulse mb-6">
                                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                Ожидание подключения...
                            </div>
                            
                            <div className="text-xs text-slate-400 bg-slate-50 p-2 rounded border border-slate-100 mb-2 flex items-start gap-1 text-left">
                                <Server size={14} className="mt-0.5 shrink-0" />
                                <span>{useCustomServer ? `Сервер: ${customHost} (${customPort})` : "Сервер: Public (0.peerjs.com)"}</span>
                            </div>
                        </div>
                    )}
                    
                    <button 
                        onClick={cancelSetup}
                        className="mt-2 text-slate-400 hover:text-red-500 text-sm flex items-center gap-1 transition-colors"
                    >
                        <XCircle size={16} /> Отмена
                    </button>
                </div>
            )}

            {/* STATE: JOINING */}
            {setupState === 'joining' && (
                <div className="flex flex-col items-center animate-fade-in w-full">
                     <div className="w-full mb-6">
                         <p className="text-sm text-slate-500 mb-2 text-left">Введите код хоста:</p>
                         <input 
                            type="text"
                            value={opponentIdInput}
                            onChange={(e) => setOpponentIdInput(e.target.value)}
                            placeholder="Например: a1b2c3..."
                            className="w-full p-3 border border-slate-300 rounded-lg font-mono text-center text-lg focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder:text-slate-300"
                         />
                     </div>

                     <button 
                        onClick={connectToPeer}
                        disabled={!opponentIdInput || connStatus === 'connecting'}
                        className={`w-full py-3 rounded-lg font-bold text-white transition-all flex items-center justify-center gap-2
                            ${opponentIdInput && connStatus !== 'connecting' 
                                ? 'bg-green-600 hover:bg-green-700 shadow-md hover:scale-[1.02]' 
                                : 'bg-slate-300 cursor-not-allowed'}
                        `}
                     >
                        {connStatus === 'connecting' ? (
                            <>
                                <Loader2 className="animate-spin" size={20}/> Подключение...
                            </>
                        ) : (
                            'Подключиться'
                        )}
                     </button>
                     
                     <div className="mt-4 text-xs text-slate-400 bg-slate-50 p-2 rounded border border-slate-100 flex flex-col items-start gap-1 w-full text-left">
                        <div className="flex gap-1">
                             <Info size={14} className="mt-0.5 shrink-0" />
                             <span>Если долго не подключается, проверьте, что код верен.</span>
                        </div>
                        {useCustomServer && <div className="text-[10px] mt-1 text-slate-500 pl-5">Сервер: {customHost}:{customPort}</div>}
                     </div>
                     
                     <button 
                        onClick={cancelSetup}
                        className="mt-6 text-slate-400 hover:text-red-500 text-sm flex items-center gap-1 transition-colors"
                    >
                        <XCircle size={16} /> Отмена
                    </button>
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