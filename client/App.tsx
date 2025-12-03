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
import { RefreshCw, Play, RotateCw, Trophy, AlertTriangle, Anchor, Users, User, Link as LinkIcon, Copy, ArrowLeft, Loader2, XCircle, Info, Share2, Globe, Settings, Server, Zap, Wifi, Smartphone, CheckCircle2 } from 'lucide-react';

// --- CONFIGURATION ---
// Список STUN/TURN серверов для обхода NAT
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    // Free OpenRelay Project (помогает пробивать NAT на мобильных сетях)
    { 
        urls: 'turn:openrelay.metered.ca:80', 
        username: 'openrelayproject', 
        credential: 'openrelayproject' 
    },
    { 
        urls: 'turn:openrelay.metered.ca:443', 
        username: 'openrelayproject', 
        credential: 'openrelayproject' 
    },
    { 
        urls: 'turn:openrelay.metered.ca:443?transport=tcp', 
        username: 'openrelayproject', 
        credential: 'openrelayproject' 
    }
];

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
  const [connectionStep, setConnectionStep] = useState<string>('');

  // --- Server Settings State (Persisted) ---
  const [useCustomServer, setUseCustomServer] = useState(() => localStorage.getItem('mp_useCustom') === 'true');
  const [customHost, setCustomHost] = useState(() => localStorage.getItem('mp_host') || ''); 
  
  const [showServerSettings, setShowServerSettings] = useState(false);

  // Persistence
  useEffect(() => {
      localStorage.setItem('mp_useCustom', String(useCustomServer));
      localStorage.setItem('mp_host', customHost);
  }, [useCustomServer, customHost]);

  // PeerJS refs
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const connTimeoutRef = useRef<any>(null);

  // --- Game State ---
  const [phase, setPhase] = useState<GamePhase>('placement');
  const [turn, setTurn] = useState<Turn>('player');
  const [winner, setWinner] = useState<Turn | null>(null);
  const [message, setMessage] = useState<string>("Расставьте корабли");

  // Board State
  const [playerBoard, setPlayerBoard] = useState<BoardState>(createEmptyBoard());
  const [enemyBoard, setEnemyBoard] = useState<BoardState>(createEmptyBoard());

  // Refs for Board State to solve closure issues in Event Listeners
  const playerBoardRef = useRef(playerBoard);
  const enemyBoardRef = useRef(enemyBoard);

  useEffect(() => {
    playerBoardRef.current = playerBoard;
  }, [playerBoard]);

  useEffect(() => {
    enemyBoardRef.current = enemyBoard;
  }, [enemyBoard]);


  // Placement State
  const [currentShipIndex, setCurrentShipIndex] = useState(0); 
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [previewCoords, setPreviewCoords] = useState<Coordinate[]>([]);
  const [isValidPreview, setIsValidPreview] = useState(true);

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
        const fullStr = hash.replace('#join=', '');
        const [code, hostConfig] = fullStr.split('?host=');
        
        if (code) {
            setGameMode('multiplayer');
            setView('setup');
            setSetupState('joining');
            setOpponentIdInput(code);

            // Если в ссылке был хост, применяем его
            if (hostConfig) {
                setUseCustomServer(true);
                setCustomHost(hostConfig);
            }
        }
    }

    // iOS/Mobile Lifecycle handler
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && peerRef.current && peerRef.current.disconnected) {
            console.log("Tab visible, reconnecting to signaling server...");
            setConnectionStep("Восстановление связи с сервером...");
            peerRef.current.reconnect();
        }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (peerRef.current) peerRef.current.destroy();
      if (connTimeoutRef.current) clearTimeout(connTimeoutRef.current);
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
    setMessage(gameMode === 'multiplayer' ? "Расставьте корабли и нажмите 'ГОТОВ'" : "Расставьте корабли");
    
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
      setConnectionStep('');
      window.history.pushState("", document.title, window.location.pathname + window.location.search);
      setView('menu');
  };

  const cancelSetup = () => {
      if (peerRef.current) peerRef.current.destroy();
      setPeerId('');
      setConnStatus('disconnected');
      setMpError(null);
      setConnectionStep('');
      setSetupState('select');
      window.history.pushState("", document.title, window.location.pathname + window.location.search);
  };

  const cleanHostUrl = (url: string) => {
      return url.replace('https://', '').replace('http://', '').replace(/\/$/, '');
  };

  // --- Multiplayer Connection Logic ---
  
  const initPeer = () => {
    if (peerRef.current) peerRef.current.destroy();
    
    setPeerId('');
    setMpError(null);
    setConnectionStep('Соединение с сигнальным сервером...');

    const Peer = (window as any).Peer;
    if (!Peer) {
        setMpError("Ошибка: Библиотека PeerJS не загружена.");
        return;
    }

    let peerConfig: any = {
        debug: 1, 
        pingInterval: 5000, // Important for mobile to keep connection alive
        config: {
            iceServers: ICE_SERVERS,
            iceTransportPolicy: 'all',
        }
    };

    // Настройка подключения к серверу
    if (useCustomServer && customHost) {
        const cleanHost = cleanHostUrl(customHost);
        peerConfig = {
            ...peerConfig,
            host: cleanHost,
            port: 443,
            path: '/peerjs/myapp', // Путь с вашего сервера (как в server/index.js)
            secure: true,
        };
        console.log(`Connecting to CUSTOM server: ${cleanHost}`);
    } else {
        peerConfig = {
            ...peerConfig,
            host: '0.peerjs.com',
            port: 443,
            path: '/',
            secure: true,
        };
        console.log("Connecting to PUBLIC server");
    }

    try {
        const peer = new Peer(undefined, peerConfig);
        peerRef.current = peer;

        peer.on('open', (id: string) => {
            console.log('My Peer ID:', id);
            setPeerId(id);
            setConnectionStep('Сервер подключен. Ожидание соперника...');
            setMpError(null);
            
            // Генерация "Умной ссылки"
            const baseUrl = window.location.href.split('#')[0];
            let shareUrl = `${baseUrl}#join=${id}`;
            if (useCustomServer && customHost) {
                shareUrl += `?host=${cleanHostUrl(customHost)}`;
            }
            setShareLink(shareUrl);

            // Если мы Joiner, сразу коннектимся
            if (!isHost && opponentIdInput) {
                connectToPeer();
            }
        });

        peer.on('connection', (conn: any) => {
            console.log('Incoming P2P connection:', conn.peer);
            handleConnection(conn);
        });

        peer.on('error', (err: any) => {
            console.error('Peer Error:', err);
            let msg = "Ошибка соединения.";
            
            if (err.type === 'peer-unavailable') msg = "Игрок с таким ID не найден (он оффлайн?).";
            if (err.type === 'network') msg = "Ошибка сети (Фаервол/NAT блокирует).";
            if (err.type === 'server-error') msg = "Сигнальный сервер недоступен.";
            if (err.type === 'disconnected') msg = "Потеряна связь с сервером.";
            
            if (!useCustomServer && (err.type === 'network' || err.type === 'server-error')) {
                msg += " Попробуйте использовать свой Render-сервер.";
            }

            setMpError(msg);
            setConnStatus('error');
            setConnectionStep('Сбой.');
        });
        
        peer.on('disconnected', () => {
             // Только если не в игре
             if (connStatus !== 'connected') {
                setConnectionStep('Потеря сигнала сервера. Реконнект...');
                peer.reconnect();
             }
        });
    } catch (e: any) {
        setMpError("Критическая ошибка инициализации: " + e.message);
    }
  };

  const startHosting = () => {
      setSetupState('hosting');
      setIsHost(true);
      initPeer();
  };

  const startJoining = () => {
      setSetupState('joining');
      setIsHost(false);
      initPeer(); 
  };

  const connectToPeer = () => {
    if (!opponentIdInput) return;
    const cleanId = opponentIdInput.trim();
    setMpError(null);
    setConnStatus('connecting');
    setConnectionStep(`Стучимся к ${cleanId}...`);
    
    if (!peerRef.current || !peerRef.current.id) {
         setMpError("Сначала дождитесь подключения к серверу (крутится спиннер).");
         return;
    }

    try {
        const conn = peerRef.current.connect(cleanId, {
            reliable: true,
            serialization: 'json'
        });
        
        handleConnection(conn);
    } catch (e: any) {
        setMpError("Ошибка вызова connect: " + e.message);
    }
  };

  const handleConnection = (conn: any) => {
    connRef.current = conn;
    
    // Таймер на случай если NAT не пробился
    connTimeoutRef.current = setTimeout(() => {
        if (connStatus !== 'connected' && view !== 'game') {
             setMpError("Таймаут соединения. Оператор связи блокирует P2P. Попробуйте отключить VPN или использовать свой сервер.");
             setConnStatus('error');
             conn.close();
        }
    }, 15000);

    conn.on('open', () => {
        clearTimeout(connTimeoutRef.current);
        console.log("Connection OPENED!");
        setConnStatus('connected');
        setRemotePeerId(conn.peer);
        setMpError(null);
        setConnectionStep('Соединение установлено!');
        
        // Small delay for iOS stability before sending data
        setTimeout(() => {
            sendData({ type: 'HELLO' });
        }, 500);
    });

    conn.on('data', (data: NetworkMessage) => {
        console.log("Received data:", data);
        handleData(data);
    });

    conn.on('close', () => {
        console.log("Connection CLOSED");
        setConnStatus('disconnected');
        setRemotePeerId(null);
        setMpError("Соперник отключился.");
        if (view === 'game') {
            setMessage("Соперник отключился. Игра прервана.");
            setPhase('gameOver');
        }
    });
    
    conn.on('error', (err: any) => {
        console.error("Connection Error:", err);
        setMpError("Ошибка в соединении: " + err);
    });
  };

  const sendData = (msg: NetworkMessage) => {
      if (connRef.current && connRef.current.open) {
          connRef.current.send(msg);
      }
  };

  const handleData = (data: NetworkMessage) => {
      switch (data.type) {
          case 'HELLO':
              // Handshake complete
              break;
          case 'READY':
              setOpponentReady(true);
              break;
          case 'SHOT':
              handleIncomingShot(data.x, data.y);
              break;
          case 'SHOT_RESULT':
              handleShotResult(data.x, data.y, data.result, data.sunkShipCoords);
              break;
          case 'PLAY_AGAIN':
              setOpponentReady(false);
              setPlayerReady(false);
              resetGame();
              break;
      }
  };

  // --- Game Actions ---

  const handleIncomingShot = (x: number, y: number) => {
      // FIX: Use REF to get current state, otherwise we use stale closure (empty board)
      const currentBoard = playerBoardRef.current;
      const { board: newBoard, result, sunkShipCoords } = processShot(currentBoard, x, y);
      setPlayerBoard(newBoard);

      // Notify opponent of result
      sendData({ 
          type: 'SHOT_RESULT', 
          x, 
          y, 
          result: result === 'already_shot' ? 'miss' : result, // fallback
          sunkShipCoords 
      });

      // Turn logic
      if (result === 'miss') {
          setTurn('player');
          setMessage("Ваш ход!");
      } else {
          setMessage("Противник попал и ходит снова!");
          // Check loss
          const allSunk = newBoard.ships.every(s => s.hits >= s.size);
          if (allSunk) {
              setPhase('gameOver');
              setWinner('computer'); // computer = remote player here
              setMessage("Вы проиграли!");
          }
      }
  };

  const handleShotResult = (x: number, y: number, result: 'hit' | 'miss' | 'sunk', sunkShipCoords?: Coordinate[]) => {
      // FIX: Use REF for enemy board as well to be safe
      const currentEnemyBoard = enemyBoardRef.current;
      const newEnemyBoard = updateBoardWithResult(currentEnemyBoard, x, y, result, sunkShipCoords);
      setEnemyBoard(newEnemyBoard);

      if (result === 'miss') {
          setTurn('computer'); // computer = waiting for remote
          setMessage("Промах. Ход противника.");
      } else {
          setMessage("Попадание! Ходите снова.");
          // Check win (count sunk cells)
          let totalSunk = 0;
          newEnemyBoard.grid.forEach(row => row.forEach(cell => {
               if (cell === 'sunk') totalSunk++;
          }));
          
          if (totalSunk >= 20) { // 4*1 + 3*2 + 2*3 + 1*4 = 4+6+6+4 = 20
               setPhase('gameOver');
               setWinner('player');
               setMessage("Вы победили!");
          }
      }
  };

  const handleCellClick = (x: number, y: number, isPlayerBoard: boolean) => {
    if (phase === 'placement' && isPlayerBoard) {
       placeShip(x, y);
    } else if (phase === 'playing' && !isPlayerBoard) {
       makeMove(x, y);
    }
  };

  const placeShip = (x: number, y: number) => {
      if (currentShipIndex >= shipsToPlace.length) return;
      const size = shipsToPlace[currentShipIndex];
      
      const result = placeShipOnGrid(playerBoard.grid, playerBoard.ships, x, y, size, orientation === 'vertical');
      
      if (result) {
          setPlayerBoard({
              ...playerBoard,
              grid: result.grid,
              ships: [...playerBoard.ships, result.ship]
          });
          setCurrentShipIndex(currentShipIndex + 1);
          
          if (currentShipIndex + 1 >= shipsToPlace.length) {
              setMessage("Все корабли расставлены! Нажмите 'ГОТОВ'.");
          }
      }
  };

  const startGame = () => {
      if (gameMode === 'single') {
        setEnemyBoard(generateRandomBoard());
        setPhase('playing');
        setTurn('player');
        setMessage("Ваш ход!");
      } else {
          // Multiplayer ready logic
          setPlayerReady(true);
          sendData({ type: 'READY' });
          if (opponentReady) {
               setPhase('playing');
               setTurn(isHost ? 'player' : 'computer'); // Host goes first usually
               setMessage(isHost ? "Ваш ход!" : "Ход противника...");
          } else {
              setMessage("Ожидаем готовности соперника...");
          }
      }
  };
  
  // MP: Check if both ready
  useEffect(() => {
      if (gameMode === 'multiplayer' && phase === 'placement' && playerReady && opponentReady) {
          setPhase('playing');
          setTurn(isHost ? 'player' : 'computer');
          setMessage(isHost ? "Оба готовы! Ваш ход." : "Оба готовы! Ход противника.");
      }
  }, [playerReady, opponentReady, phase, gameMode, isHost]);

  const makeMove = (x: number, y: number) => {
      if (turn !== 'player') return;
      
      // Check already fired
      if (enemyBoard.shotsFired.some(s => s.x === x && s.y === y)) return;

      if (gameMode === 'single') {
          const { board, result, sunkShipCoords } = processShot(enemyBoard, x, y);
          setEnemyBoard(board);

          if (result === 'miss') {
              setTurn('computer');
              setMessage("Промах! Ход компьютера...");
              setTimeout(computerTurn, 1000);
          } else {
              setMessage(result === 'sunk' ? "Корабль потоплен!" : "Попадание!");
              // Check Win
              const allSunk = board.ships.every(s => s.hits >= s.size);
              if (allSunk) {
                  setPhase('gameOver');
                  setWinner('player');
                  setMessage("Победа!");
              }
          }
      } else {
          // Multiplayer
          sendData({ type: 'SHOT', x, y });
          // Optimistic update handled when result comes back, 
          // or we can mark as 'fired' temporarily? 
          // Better wait for valid result to keep sync.
      }
  };

  const computerTurn = () => {
    if (phase !== 'playing') return;
    
    // Simple AI helper
    // In a real app we would pass the whole board state to AI to cheat or remember hits
    // but here we just need to know where not to shoot.
    // We pass playerBoard to AI logic
    
    setPlayerBoard(prev => {
        const move = getComputerMove(prev);
        const { board, result } = processShot(prev, move.x, move.y);
        
        let nextTurn: Turn = 'computer';
        let msg = "Компьютер попал!";
        
        if (result === 'miss') {
            nextTurn = 'player';
            msg = "Компьютер промахнулся. Ваш ход!";
        } else if (result === 'sunk') {
             msg = "Компьютер потопил ваш корабль!";
        }

        // Check Loss
        const allSunk = board.ships.every(s => s.hits >= s.size);
        if (allSunk) {
            setPhase('gameOver');
            setWinner('computer');
            msg = "Вы проиграли!";
        } else if (nextTurn === 'computer') {
            setTimeout(computerTurn, 1000);
        } else {
            setTurn('player');
        }

        setMessage(msg);
        return board;
    });
  };

  const handleCellHover = (x: number, y: number) => {
    if (phase === 'placement' && currentShipIndex < shipsToPlace.length) {
        const size = shipsToPlace[currentShipIndex];
        const vertical = orientation === 'vertical';
        
        if (isValidPlacement(playerBoard.grid, x, y, size, vertical)) {
            setIsValidPreview(true);
            const coords = [];
            for(let i=0; i<size; i++) {
                coords.push({
                    x: vertical ? x : x + i,
                    y: vertical ? y + i : y
                });
            }
            setPreviewCoords(coords);
        } else {
            setIsValidPreview(false);
            // Show invalid red squares
             const coords = [];
            for(let i=0; i<size; i++) {
                const cx = vertical ? x : x + i;
                const cy = vertical ? y + i : y;
                if (cx < 10 && cy < 10) coords.push({x:cx, y:cy});
            }
            setPreviewCoords(coords);
        }
    } else {
        setPreviewCoords([]);
    }
  };

  // --- RENDERERS ---

  const renderMenu = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8 animate-fade-in">
        <div className="text-center space-y-4">
             <div className="inline-block p-4 rounded-full bg-blue-100 mb-4">
                <Anchor className="w-16 h-16 text-blue-600" />
             </div>
             <h1 className="text-4xl md:text-5xl font-black text-blue-900 tracking-tight">
                МОРСКОЙ БОЙ
             </h1>
             <p className="text-blue-600/80 text-lg">Классическая стратегия</p>
        </div>

        <div className="flex flex-col gap-4 w-full max-w-xs">
            <button 
                onClick={() => { setGameMode('single'); setView('game'); resetGame(); }}
                className="flex items-center justify-center gap-3 p-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-600/20 transition-all transform hover:-translate-y-1 font-bold text-lg"
            >
                <User className="w-6 h-6" />
                Один Игрок
            </button>
            <button 
                onClick={() => { setGameMode('multiplayer'); setView('setup'); setSetupState('select'); }}
                className="flex items-center justify-center gap-3 p-4 bg-white hover:bg-gray-50 text-blue-700 border-2 border-blue-200 rounded-xl shadow-lg transition-all transform hover:-translate-y-1 font-bold text-lg"
            >
                <Users className="w-6 h-6" />
                Играть с Другом
            </button>
        </div>
    </div>
  );

  const renderServerSettings = () => (
      <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm">
          <h3 className="font-bold text-gray-700 mb-2 flex items-center gap-2">
              <Server className="w-4 h-4" /> Настройки сервера
          </h3>
          
          <div className="flex gap-2 mb-3">
              <button 
                onClick={() => { setUseCustomServer(false); setCustomHost(''); }}
                className={`flex-1 py-1 px-2 rounded text-xs font-medium border ${!useCustomServer ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white text-gray-600'}`}
              >
                  Публичный (PeerJS)
              </button>
              <button 
                onClick={() => setUseCustomServer(true)}
                className={`flex-1 py-1 px-2 rounded text-xs font-medium border ${useCustomServer ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white text-gray-600'}`}
              >
                  Свой сервер
              </button>
          </div>

          {useCustomServer && (
              <div className="space-y-3">
                   <div>
                       <label className="block text-xs text-gray-500 mb-1">Ваш Render URL:</label>
                       <input 
                          type="text" 
                          placeholder="battleship-server.onrender.com"
                          value={customHost}
                          onChange={(e) => setCustomHost(e.target.value)}
                          className="w-full p-2 border rounded text-gray-800"
                       />
                   </div>
                   <div className="text-[10px] text-gray-400">
                       Порт: 443 | Secure: true | Path: /peerjs/myapp
                   </div>
                   <div className="flex gap-2">
                        <button 
                             onClick={() => setCustomHost('battleship-server.onrender.com')} // Пример
                             className="text-xs text-blue-500 underline"
                        >
                            Пример Render
                        </button>
                        <button 
                             onClick={() => setCustomHost('localhost')}
                             className="text-xs text-blue-500 underline"
                        >
                             Localhost (для dev)
                        </button>
                   </div>
              </div>
          )}
      </div>
  );

  const renderMultiplayerSetup = () => {
    if (setupState === 'select') {
        return (
            <div className="max-w-md mx-auto w-full animate-fade-in">
                <button onClick={handleMainMenu} className="mb-6 flex items-center text-gray-500 hover:text-blue-600">
                    <ArrowLeft className="w-5 h-5 mr-1" /> Назад
                </button>
                
                <h2 className="text-3xl font-bold text-center text-blue-900 mb-8">Сетевая Игра</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                    <button 
                        onClick={startHosting}
                        className="flex flex-col items-center p-6 bg-blue-600 text-white rounded-xl shadow-lg hover:bg-blue-700 transition-all"
                    >
                        <Wifi className="w-10 h-10 mb-3" />
                        <span className="font-bold text-lg">Создать</span>
                        <span className="text-sm opacity-80">Стать Хостом</span>
                    </button>
                    <button 
                        onClick={startJoining}
                        className="flex flex-col items-center p-6 bg-white text-blue-700 border-2 border-blue-200 rounded-xl shadow-lg hover:bg-blue-50 transition-all"
                    >
                        <Smartphone className="w-10 h-10 mb-3" />
                        <span className="font-bold text-lg">Подключиться</span>
                        <span className="text-sm opacity-80">Ввести Код</span>
                    </button>
                </div>

                <div className="text-center">
                    <button 
                        onClick={() => setShowServerSettings(!showServerSettings)}
                        className="text-gray-400 text-sm hover:text-gray-600 flex items-center justify-center mx-auto"
                    >
                        <Settings className="w-4 h-4 mr-1" /> Настройки соединения
                    </button>
                    {showServerSettings && renderServerSettings()}
                </div>
            </div>
        );
    }

    if (connStatus === 'connected') {
        return (
             <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-6 animate-fade-in">
                 <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
                     <CheckCircle2 className="w-10 h-10 text-green-600" />
                 </div>
                 <h2 className="text-2xl font-bold text-green-700">Подключено!</h2>
                 <p className="text-gray-600">Соперник: {remotePeerId}</p>
                 <button 
                    onClick={() => { setView('game'); resetGame(); }}
                    className="px-8 py-3 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700 font-bold"
                 >
                    Начать Игру
                 </button>
             </div>
        );
    }

    return (
        <div className="max-w-md mx-auto w-full animate-fade-in">
            <div className="bg-white p-6 rounded-2xl shadow-xl border border-blue-100">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-gray-800">
                        {setupState === 'hosting' ? 'Лобби (Хост)' : 'Подключение'}
                    </h2>
                    <button onClick={cancelSetup} className="text-gray-400 hover:text-red-500">
                        <XCircle className="w-6 h-6" />
                    </button>
                </div>

                {/* STATUS & ERROR */}
                {mpError && (
                    <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-start">
                        <AlertTriangle className="w-5 h-5 mr-2 shrink-0" />
                        {mpError}
                    </div>
                )}
                
                <div className="mb-6 p-3 bg-blue-50 text-blue-800 rounded-lg text-sm flex items-center">
                     {(!peerId && !mpError) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Info className="w-4 h-4 mr-2" />}
                     {connectionStep || "Инициализация..."}
                </div>

                {/* HOST VIEW */}
                {setupState === 'hosting' && (
                    <div className="space-y-6">
                         <div className="space-y-2">
                             <label className="text-sm font-bold text-gray-500 uppercase tracking-wide">Ваш ID (Код):</label>
                             <div className="flex gap-2">
                                 <code className="flex-1 block p-4 bg-gray-100 rounded-lg text-lg font-mono font-bold tracking-widest text-center select-all border border-gray-200">
                                     {peerId || '...'}
                                 </code>
                                 <button 
                                     onClick={() => navigator.clipboard.writeText(peerId)}
                                     disabled={!peerId}
                                     className="p-3 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 disabled:opacity-50"
                                     title="Копировать ID"
                                 >
                                     <Copy className="w-6 h-6" />
                                 </button>
                             </div>
                         </div>

                         <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-gray-200"></span>
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-white px-2 text-gray-500">ИЛИ</span>
                            </div>
                         </div>

                         <div className="space-y-2">
                             <button 
                                onClick={() => {
                                    if(shareLink) {
                                        navigator.clipboard.writeText(shareLink);
                                        setConnectionStep("Ссылка скопирована!");
                                    }
                                }}
                                disabled={!shareLink}
                                className="w-full flex items-center justify-center gap-2 p-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-bold shadow-md"
                             >
                                <Share2 className="w-5 h-5" />
                                Скопировать ссылку другу
                             </button>
                             <p className="text-xs text-center text-gray-400">Отправьте эту ссылку другу, и он подключится автоматически.</p>
                         </div>

                         <div className="flex justify-center mt-8">
                             <div className="flex items-center gap-2 text-blue-600">
                                 <Loader2 className="w-5 h-5 animate-spin" />
                                 <span className="font-medium animate-pulse">Ожидание подключения...</span>
                             </div>
                         </div>
                    </div>
                )}

                {/* JOIN VIEW */}
                {setupState === 'joining' && (
                    <div className="space-y-4">
                         <div>
                             <label className="text-sm font-bold text-gray-500 uppercase tracking-wide">Введите ID Хоста:</label>
                             <input 
                                type="text" 
                                value={opponentIdInput}
                                onChange={(e) => setOpponentIdInput(e.target.value)}
                                placeholder="Например: a1b2-c3d4..."
                                className="w-full mt-1 p-4 bg-white border-2 border-blue-200 rounded-lg text-lg font-mono focus:border-blue-500 focus:outline-none transition-colors"
                             />
                         </div>

                         <button 
                             onClick={connectToPeer}
                             disabled={!peerId || !opponentIdInput || connStatus === 'connecting'}
                             className="w-full py-4 bg-blue-600 text-white rounded-lg font-bold shadow-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                         >
                             {connStatus === 'connecting' ? <Loader2 className="animate-spin" /> : <Zap />}
                             ПОДКЛЮЧИТЬСЯ
                         </button>
                         
                         {!peerId && (
                             <p className="text-xs text-center text-orange-500">Ждем подключения к серверу...</p>
                         )}
                    </div>
                )}
            </div>
        </div>
    );
  };

  const renderPlacementControls = () => (
      <div className="flex flex-col items-center gap-4 mt-6 p-4 bg-white rounded-xl shadow-lg border border-blue-100 max-w-lg mx-auto w-full animate-slide-up">
          <div className="flex justify-between items-center w-full">
              <h3 className="text-lg font-bold text-gray-700">Расстановка флота</h3>
              <button 
                  onClick={() => setOrientation(prev => prev === 'horizontal' ? 'vertical' : 'horizontal')}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium text-sm transition-colors"
              >
                  <RotateCw className="w-4 h-4" /> 
                  {orientation === 'horizontal' ? 'Горизонтально' : 'Вертикально'}
              </button>
          </div>
          
          <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
             <div 
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                style={{ width: `${(currentShipIndex / shipsToPlace.length) * 100}%` }}
             ></div>
          </div>
          
          <div className="flex justify-between w-full text-sm text-gray-500 font-mono">
              <span>Корабль: {currentShipIndex + 1}/{shipsToPlace.length}</span>
              <span>Размер: {shipsToPlace[currentShipIndex]} кл.</span>
          </div>

          <div className="flex w-full gap-2 mt-2">
                <button 
                    onClick={() => {
                        setPlayerBoard(generateRandomBoard());
                        setCurrentShipIndex(shipsToPlace.length);
                        setMessage("Случайная расстановка готова");
                    }}
                    className="flex-1 py-3 border-2 border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 font-bold transition-all"
                >
                    <RefreshCw className="inline-block w-4 h-4 mr-2" />
                    Случайно
                </button>
                <button 
                    onClick={() => {
                        setPlayerBoard(createEmptyBoard());
                        setCurrentShipIndex(0);
                    }}
                    className="px-4 py-3 border-2 border-red-200 text-red-500 rounded-lg hover:bg-red-50 font-bold"
                >
                    Сброс
                </button>
          </div>

          {currentShipIndex >= shipsToPlace.length && (
              <button 
                  onClick={startGame}
                  className="w-full py-4 mt-2 bg-green-500 hover:bg-green-600 text-white rounded-lg shadow-lg shadow-green-500/30 font-bold text-xl tracking-wider transition-all transform hover:scale-[1.02]"
              >
                  <Play className="inline-block w-6 h-6 mr-2" />
                  {gameMode === 'multiplayer' && !playerReady ? "ГОТОВ К БОЮ" : 
                   gameMode === 'multiplayer' && playerReady ? "ОЖИДАНИЕ..." : 
                   "НАЧАТЬ ИГРУ"}
              </button>
          )}
      </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 text-gray-800 font-sans selection:bg-blue-200">
      <div className="max-w-4xl mx-auto px-4 py-6 md:py-8">
        
        {/* HEADER */}
        {view !== 'menu' && (
            <div className="flex justify-between items-center mb-6 animate-fade-in">
                <h1 className="text-2xl font-black text-blue-900 tracking-tight flex items-center gap-2">
                    <Anchor className="w-6 h-6 text-blue-600" />
                    МОРСКОЙ БОЙ
                </h1>
                <div className="flex items-center gap-2">
                    {gameMode === 'multiplayer' && (
                        <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${connStatus === 'connected' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                             <div className={`w-2 h-2 rounded-full ${connStatus === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                             {connStatus === 'connected' ? 'ONLINE' : 'OFFLINE'}
                        </div>
                    )}
                    <button 
                        onClick={handleMainMenu}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                        title="В меню"
                    >
                        <ArrowLeft className="w-6 h-6" />
                    </button>
                </div>
            </div>
        )}

        {/* MAIN CONTENT */}
        <main>
            {view === 'menu' && renderMenu()}
            {view === 'setup' && renderMultiplayerSetup()}
            
            {view === 'game' && (
                <div className="space-y-6 animate-fade-in">
                    
                    {/* Game Status Bar */}
                    <div className={`
                        p-4 rounded-xl text-center shadow-lg transition-all duration-300 font-bold text-lg border-l-4
                        ${phase === 'gameOver' 
                            ? (winner === 'player' ? 'bg-green-100 text-green-800 border-green-500' : 'bg-red-100 text-red-800 border-red-500') 
                            : (turn === 'player' ? 'bg-blue-600 text-white border-blue-800' : 'bg-white text-gray-700 border-gray-300')}
                    `}>
                        {phase === 'gameOver' && <Trophy className="inline-block w-6 h-6 mr-2 mb-1" />}
                        {message}
                    </div>

                    {/* Boards Container */}
                    <div className="flex flex-col md:flex-row justify-center items-center md:items-start gap-8 select-none">
                        
                        {/* Player Board */}
                        <div className={`${turn !== 'player' && phase === 'playing' ? 'opacity-70 scale-95 grayscale-[0.3]' : ''} transition-all duration-500`}>
                            <Board 
                                boardState={playerBoard}
                                isPlayer={true}
                                highlightShips={true}
                                title="ВАШ ФЛОТ"
                                onCellClick={(x, y) => handleCellClick(x, y, true)}
                                onCellHover={handleCellHover}
                                previewCoords={previewCoords}
                                isValidPreview={isValidPreview}
                                disabled={phase !== 'placement'}
                            />
                        </div>

                        {/* Enemy Board (Only shown in Playing/GameOver) */}
                        {phase !== 'placement' && (
                             <div className={`${turn === 'player' ? 'scale-105 shadow-2xl ring-4 ring-blue-400/30 rounded-xl' : ''} transition-all duration-500`}>
                                <Board 
                                    boardState={enemyBoard}
                                    isPlayer={false}
                                    title={gameMode === 'single' ? "КОМПЬЮТЕР" : "СОПЕРНИК"}
                                    onCellClick={(x, y) => handleCellClick(x, y, false)}
                                    disabled={turn !== 'player' || phase === 'gameOver'}
                                />
                            </div>
                        )}
                    </div>

                    {/* Controls */}
                    {phase === 'placement' && renderPlacementControls()}
                    
                    {phase === 'gameOver' && (
                        <div className="flex justify-center mt-8 animate-bounce">
                             <button 
                                onClick={gameMode === 'multiplayer' ? () => { sendData({type:'PLAY_AGAIN'}); setOpponentReady(false); setPlayerReady(false); resetGame(); } : resetGame}
                                className="px-8 py-4 bg-blue-600 text-white rounded-full font-bold shadow-xl hover:bg-blue-700 transition-transform transform hover:-translate-y-1 text-xl flex items-center gap-2"
                             >
                                <RefreshCw />
                                ИГРАТЬ СНОВА
                             </button>
                        </div>
                    )}
                </div>
            )}
        </main>
      </div>
    </div>
  );
};

export default App;