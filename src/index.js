export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle different routes
    if (url.pathname === '/') {
      return new Response(getLobbyHTML(), {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache'
        }
      });
    }
    
    if (url.pathname === '/game') {
      return new Response(getGameHTML(), {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache'
        }
      });
    }
    
    // API endpoints
    if (url.pathname === '/api/join-game' && request.method === 'POST') {
      return handleJoinGame(request, env);
    }
    
    if (url.pathname === '/api/game-state' && request.method === 'GET') {
      return handleGetGameState(request, env);
    }
    
    if (url.pathname === '/api/complete-task' && request.method === 'POST') {
      return handleCompleteTask(request, env);
    }
    
    if (url.pathname === '/api/partner-request' && request.method === 'POST') {
      return handlePartnerRequest(request, env);
    }
    
    return new Response('Not found', { status: 404 });
  }
};

async function handleJoinGame(request, env) {
  try {
    const { playerName, gameId } = await request.json();
    
    if (!playerName || !gameId) {
      return new Response(JSON.stringify({ error: 'Missing playerName or gameId' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Get current game state
    const gameKey = `game:${gameId}`;
    const gameData = await env.GAME_DATA.get(gameKey);
    let game;
    
    if (!gameData) {
      // Create new game
      game = {
        id: gameId,
        players: [],
        tasks: generateDailyTasks(),
        startTime: null,
        endTime: null,
        duration: 20 * 60 * 1000, // 20 minutes
        partnerships: {},
        completedTasks: {},
        sillyTasks: generateSillyTasks()
      };
    } else {
      game = JSON.parse(gameData);
    }
    
    // Check if player already exists
    const existingPlayer = game.players.find(p => p.name === playerName);
    if (existingPlayer) {
      return new Response(JSON.stringify({ error: 'Player name already taken' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Add player
    const playerId = Date.now().toString();
    game.players.push({
      id: playerId,
      name: playerName,
      score: 0,
      partner: null,
      tasksCompleted: 0
    });
    
    // Save game state
    await env.GAME_DATA.put(gameKey, JSON.stringify(game));
    
    return new Response(JSON.stringify({ 
      success: true, 
      playerId,
      gameState: game 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleGetGameState(request, env) {
  try {
    const url = new URL(request.url);
    const gameId = url.searchParams.get('gameId');
    
    if (!gameId) {
      return new Response(JSON.stringify({ error: 'Missing gameId' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const gameKey = `game:${gameId}`;
    const gameData = await env.GAME_DATA.get(gameKey);
    
    if (!gameData) {
      return new Response(JSON.stringify({ error: 'Game not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(gameData, {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleCompleteTask(request, env) {
  try {
    const { gameId, playerId, taskId, partnerRequired } = await request.json();
    
    const gameKey = `game:${gameId}`;
    const gameData = await env.GAME_DATA.get(gameKey);
    
    if (!gameData) {
      return new Response(JSON.stringify({ error: 'Game not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const game = JSON.parse(gameData);
    const player = game.players.find(p => p.id === playerId);
    
    if (!player) {
      return new Response(JSON.stringify({ error: 'Player not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Check if task requires partner
    if (partnerRequired && !player.partner) {
      return new Response(JSON.stringify({ error: 'This task requires a partner' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Mark task as completed
    if (!game.completedTasks[taskId]) {
      game.completedTasks[taskId] = {
        completedBy: playerId,
        partner: player.partner,
        timestamp: Date.now()
      };
      
      // Award points
      const task = [...game.tasks.daily, ...game.tasks.weekly, ...game.sillyTasks].find(t => t.id === taskId);
      if (task) {
        player.score += task.points || 10;
        player.tasksCompleted++;
        
        // Award points to partner too
        if (player.partner) {
          const partner = game.players.find(p => p.id === player.partner);
          if (partner) {
            partner.score += task.points || 10;
            partner.tasksCompleted++;
          }
        }
      }
    }
    
    await env.GAME_DATA.put(gameKey, JSON.stringify(game));
    
    return new Response(JSON.stringify({ success: true, gameState: game }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handlePartnerRequest(request, env) {
  try {
    const { gameId, playerId, targetPlayerId } = await request.json();
    
    const gameKey = `game:${gameId}`;
    const gameData = await env.GAME_DATA.get(gameKey);
    const game = JSON.parse(gameData);
    
    const player = game.players.find(p => p.id === playerId);
    const targetPlayer = game.players.find(p => p.id === targetPlayerId);
    
    if (!player || !targetPlayer) {
      return new Response(JSON.stringify({ error: 'Player not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Set partnership
    player.partner = targetPlayerId;
    targetPlayer.partner = playerId;
    
    await env.GAME_DATA.put(gameKey, JSON.stringify(game));
    
    return new Response(JSON.stringify({ success: true, gameState: game }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function generateDailyTasks() {
  return {
    daily: [
      { id: 'dishes', name: 'Do the dishes', time: 3, points: 15, partnerRequired: false },
      { id: 'kitchen_counter', name: 'Wipe kitchen counters', time: 2, points: 10, partnerRequired: false },
      { id: 'make_beds', name: 'Make all beds', time: 2, points: 10, partnerRequired: false },
      { id: 'bathroom_quick', name: 'Quick bathroom wipe down', time: 2, points: 10, partnerRequired: false },
      { id: 'living_room_tidy', name: 'Tidy living room', time: 3, points: 15, partnerRequired: false }
    ],
    weekly: [
      { id: 'deep_clean_bathroom', name: 'Deep clean bathroom', time: 8, points: 40, partnerRequired: true },
      { id: 'vacuum_house', name: 'Vacuum entire house', time: 6, points: 30, partnerRequired: true },
      { id: 'deep_clean_kitchen', name: 'Deep clean kitchen', time: 10, points: 50, partnerRequired: true },
      { id: 'mop_floors', name: 'Mop all floors', time: 5, points: 25, partnerRequired: true },
      { id: 'laundry_complete', name: 'Complete laundry cycle', time: 4, points: 20, partnerRequired: false }
    ]
  };
}

function generateSillyTasks() {
  const sillyTasks = [
    { id: 'freestyle_rap', name: 'Perform a 30-second freestyle rap about cleaning', time: 1, points: 25, partnerRequired: false },
    { id: 'dust_dance', name: 'Do the "dust bunny dance" while dusting', time: 2, points: 20, partnerRequired: false },
    { id: 'sing_dishwashing', name: 'Sing an opera about dishwashing', time: 2, points: 20, partnerRequired: false },
    { id: 'sock_puppet_show', name: 'Perform a sock puppet show about laundry', time: 3, points: 30, partnerRequired: true },
    { id: 'backwards_vacuum', name: 'Vacuum while walking backwards', time: 3, points: 25, partnerRequired: false },
    { id: 'mop_limbo', name: 'Do the limbo while mopping', time: 2, points: 25, partnerRequired: false },
    { id: 'toilet_monologue', name: 'Deliver a dramatic monologue to the toilet', time: 1, points: 20, partnerRequired: false },
    { id: 'superhero_cleaning', name: 'Clean like your favorite superhero', time: 2, points: 20, partnerRequired: false }
  ];
  
  // Return 3-4 random silly tasks
  return sillyTasks.sort(() => 0.5 - Math.random()).slice(0, 4);
}

function getLobbyHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cleaning Party - Lobby</title>
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
    <div id="root"></div>
    
    <script type="text/babel">
        const { useState, useEffect } = React;

        const LobbyPage = () => {
          const [playerName, setPlayerName] = useState('');
          const [gameId, setGameId] = useState('');
          const [isJoining, setIsJoining] = useState(false);
          const [error, setError] = useState('');

          useEffect(() => {
            // Generate a random game ID if none provided
            if (!gameId) {
              setGameId(Math.random().toString(36).substring(2, 8).toUpperCase());
            }
          }, []);

          const joinGame = async () => {
            if (!playerName.trim()) {
              setError('Please enter your name');
              return;
            }

            setIsJoining(true);
            setError('');

            try {
              const response = await fetch('/api/join-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: playerName.trim(), gameId })
              });

              const data = await response.json();

              if (data.success) {
                // Store player info and redirect to game
                sessionStorage.setItem('playerId', data.playerId);
                sessionStorage.setItem('gameId', gameId);
                sessionStorage.setItem('playerName', playerName);
                window.location.href = '/game';
              } else {
                setError(data.error || 'Failed to join game');
              }
            } catch (err) {
              setError('Connection error. Please try again.');
            } finally {
              setIsJoining(false);
            }
          };

          return React.createElement('div', { 
            className: "min-h-screen bg-gradient-to-br from-red-900 via-purple-900 to-black flex items-center justify-center p-6" 
          },
            React.createElement('div', { className: "bg-gray-900 rounded-lg shadow-2xl p-8 max-w-md w-full border border-red-500" },
              React.createElement('div', { className: "text-center mb-8" },
                React.createElement('h1', { className: "text-4xl font-bold text-red-400 mb-2" }, "🔥 Cleaning Party 🔥"),
                React.createElement('p', { className: "text-gray-300" }, "The devilishly fun cleaning game!")
              ),
              
              React.createElement('div', { className: "space-y-6" },
                React.createElement('div', null,
                  React.createElement('label', { className: "block text-red-300 font-semibold mb-2" }, "Your Devilish Name"),
                  React.createElement('input', {
                    type: "text",
                    value: playerName,
                    onChange: (e) => setPlayerName(e.target.value),
                    placeholder: "Enter your name...",
                    className: "w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white focus:border-red-500 focus:outline-none",
                    maxLength: 20,
                    onKeyPress: (e) => e.key === 'Enter' && joinGame()
                  })
                ),
                
                React.createElement('div', null,
                  React.createElement('label', { className: "block text-red-300 font-semibold mb-2" }, "Game Room Code"),
                  React.createElement('input', {
                    type: "text",
                    value: gameId,
                    onChange: (e) => setGameId(e.target.value.toUpperCase()),
                    placeholder: "Enter room code...",
                    className: "w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white focus:border-red-500 focus:outline-none font-mono text-center",
                    maxLength: 6
                  })
                ),
                
                error && React.createElement('div', { className: "text-red-400 text-sm text-center" }, error),
                
                React.createElement('button', {
                  onClick: joinGame,
                  disabled: isJoining,
                  className: "w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
                }, isJoining ? "Summoning..." : "Join the Chaos!"),
                
                React.createElement('div', { className: "text-center text-gray-400 text-sm" },
                  React.createElement('p', null, "Share the room code with friends!"),
                  React.createElement('p', { className: "mt-2" }, "🎯 Complete tasks • 👥 Partner up • ⏰ Beat the clock")
                )
              )
            )
          );
        };

        ReactDOM.render(React.createElement(LobbyPage), document.getElementById('root'));
    </script>
</body>
</html>`;
}

function getGameHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cleaning Party - Game</title>
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
    <div id="root"></div>
    
    <script type="text/babel">
        const { useState, useEffect } = React;

        const GamePage = () => {
          const [gameState, setGameState] = useState(null);
          const [timeLeft, setTimeLeft] = useState(0);
          const [gameStatus, setGameStatus] = useState('waiting'); // waiting, playing, finished
          const [myPlayer, setMyPlayer] = useState(null);

          const playerId = sessionStorage.getItem('playerId');
          const gameId = sessionStorage.getItem('gameId');
          const playerName = sessionStorage.getItem('playerName');

          useEffect(() => {
            if (!playerId || !gameId) {
              window.location.href = '/';
              return;
            }

            loadGameState();
            const interval = setInterval(loadGameState, 2000); // Poll every 2 seconds
            return () => clearInterval(interval);
          }, []);

          useEffect(() => {
            if (gameState) {
              const player = gameState.players.find(p => p.id === playerId);
              setMyPlayer(player);

              if (gameState.startTime && !gameState.endTime) {
                setGameStatus('playing');
                const elapsed = Date.now() - gameState.startTime;
                const remaining = Math.max(0, gameState.duration - elapsed);
                setTimeLeft(remaining);

                if (remaining > 0) {
                  const timer = setTimeout(() => {
                    setTimeLeft(prev => Math.max(0, prev - 1000));
                  }, 1000);
                  return () => clearTimeout(timer);
                } else {
                  setGameStatus('finished');
                }
              }
            }
          }, [gameState]);

          const loadGameState = async () => {
            try {
              const response = await fetch(\`/api/game-state?gameId=\${gameId}\`);
              const data = await response.json();
              if (response.ok) {
                setGameState(data);
              }
            } catch (error) {
              console.error('Failed to load game state:', error);
            }
          };

          const startGame = async () => {
            // Start the game timer
            const updatedGame = {
              ...gameState,
              startTime: Date.now(),
              endTime: null
            };
            setGameState(updatedGame);
            setGameStatus('playing');
          };

          const completeTask = async (task) => {
            try {
              const response = await fetch('/api/complete-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  gameId,
                  playerId,
                  taskId: task.id,
                  partnerRequired: task.partnerRequired
                })
              });

              const data = await response.json();
              if (data.success) {
                setGameState(data.gameState);
              } else {
                alert(data.error);
              }
            } catch (error) {
              console.error('Failed to complete task:', error);
            }
          };

          const partnerWith = async (targetPlayerId) => {
            try {
              const response = await fetch('/api/partner-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId, playerId, targetPlayerId })
              });

              const data = await response.json();
              if (data.success) {
                setGameState(data.gameState);
              }
            } catch (error) {
              console.error('Failed to partner:', error);
            }
          };

          const formatTime = (ms) => {
            const minutes = Math.floor(ms / 60000);
            const seconds = Math.floor((ms % 60000) / 1000);
            return \`\${minutes}:\${seconds.toString().padStart(2, '0')}\`;
          };

          const calculateGrade = (score, maxPossibleScore) => {
            const percentage = (score / maxPossibleScore) * 100;
            if (percentage >= 90) return 'S';
            if (percentage >= 80) return 'A';
            if (percentage >= 70) return 'B';
            if (percentage >= 60) return 'C';
            if (percentage >= 50) return 'D';
            return 'Purgatory';
          };

          if (!gameState) {
            return React.createElement('div', { className: "min-h-screen bg-gray-900 flex items-center justify-center" },
              React.createElement('div', { className: "text-white text-xl" }, "Loading...")
            );
          }

          const allTasks = [...gameState.tasks.daily, ...gameState.tasks.weekly, ...gameState.sillyTasks];
          const maxScore = allTasks.reduce((sum, task) => sum + task.points, 0);

          if (gameStatus === 'finished') {
            const sortedPlayers = [...gameState.players].sort((a, b) => b.score - a.score);
            
            return React.createElement('div', { className: "min-h-screen bg-gradient-to-br from-purple-900 to-black p-6" },
              React.createElement('div', { className: "max-w-4xl mx-auto" },
                React.createElement('div', { className: "bg-gray-900 rounded-lg p-8 text-center border border-purple-500" },
                  React.createElement('h1', { className: "text-4xl font-bold text-purple-400 mb-6" }, "🎉 Game Over! 🎉"),
                  React.createElement('div', { className: "grid gap-4" },
                    sortedPlayers.map((player, index) => {
                      const grade = calculateGrade(player.score, maxScore);
                      const gradeColor = {
                        'S': 'text-yellow-400',
                        'A': 'text-green-400',
                        'B': 'text-blue-400',
                        'C': 'text-orange-400',
                        'D': 'text-red-400',
                        'Purgatory': 'text-gray-400'
                      }[grade];
                      
                      return React.createElement('div', {
                        key: player.id,
                        className: \`flex justify-between items-center p-4 bg-gray-800 rounded-lg \${player.id === playerId ? 'border-2 border-purple-400' : ''}\`
                      },
                        React.createElement('div', { className: "flex items-center gap-3" },
                          React.createElement('span', { className: "text-2xl" }, index === 0 ? '👑' : \`#\${index + 1}\`),
                          React.createElement('span', { className: "text-white font-semibold" }, player.name)
                        ),
                        React.createElement('div', { className: "text-right" },
                          React.createElement('div', { className: \`text-2xl font-bold \${gradeColor}\` }, grade),
                          React.createElement('div', { className: "text-gray-300" }, \`\${player.score} pts\`)
                        )
                      );
                    })
                  ),
                  React.createElement('button', {
                    onClick: () => window.location.href = '/',
                    className: "mt-8 bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg"
                  }, "Play Again")
                )
              )
            );
          }

          return React.createElement('div', { className: "min-h-screen bg-gradient-to-br from-red-900 via-purple-900 to-black p-4" },
            React.createElement('div', { className: "max-w-6xl mx-auto" },
              // Header
              React.createElement('div', { className: "bg-gray-900 rounded-lg p-6 mb-6 border border-red-500" },
                React.createElement('div', { className: "flex justify-between items-center mb-4" },
                  React.createElement('h1', { className: "text-3xl font-bold text-red-400" }, "🔥 Cleaning Party"),
                  gameStatus === 'playing' && React.createElement('div', { className: "text-right" },
                    React.createElement('div', { className: "text-2xl font-bold text-yellow-400" }, formatTime(timeLeft)),
                    React.createElement('div', { className: "text-gray-300" }, "Time Left")
                  )
                ),
                
                React.createElement('div', { className: "flex justify-between items-center" },
                  React.createElement('div', { className: "text-white" },
                    React.createElement('span', { className: "text-gray-300" }, "Room: "),
                    React.createElement('span', { className: "font-mono text-yellow-400" }, gameId)
                  ),
                  gameStatus === 'waiting' && React.createElement('button', {
                    onClick: startGame,
                    className: "bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg"
                  }, "Start Game!")
                )
              ),

              React.createElement('div', { className: "grid lg:grid-cols-3 gap-6" },
                // Players Panel
                React.createElement('div', { className: "bg-gray-900 rounded-lg p-6 border border-purple-500" },
                  React.createElement('h2', { className: "text-xl font-bold text-purple-400 mb-4" }, "👥 Players"),
                  React.createElement('div', { className: "space-y-3" },
                    gameState.players.map(player => {
                      const isMe = player.id === playerId;
                      const partner = player.partner ? gameState.players.find(p => p.id === player.partner) : null;
                      
                      return React.createElement('div', {
                        key: player.id,
                        className: \`p-3 rounded-lg \${isMe ? 'bg-purple-800' : 'bg-gray-800'}\`
                      },
                        React.createElement('div', { className: "flex justify-between items-center" },
                          React.createElement('div', null,
                            React.createElement('div', { className: \`font-semibold \${isMe ? 'text-purple-200' : 'text-white'}\` }, 
                              player.name + (isMe ? ' (You)' : '')
                            ),
                            partner && React.createElement('div', { className: "text-sm text-gray-400" }, 
                              \`Partner: \${partner.name}\`
                            )
                          ),
                          React.createElement('div', { className: "text-right" },
                            React.createElement('div', { className: "text-yellow-400 font-bold" }, \`\${player.score}pts\`),
                            !isMe && !myPlayer?.partner && !player.partner && React.createElement('button', {
                              onClick: () => partnerWith(player.id),
                              className: "text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded mt-1"
                            }, "Partner")
                          )
                        )
                      );
                    })
                  )
                ),

                // Tasks Panel
                React.createElement('div', { className: "lg:col-span-2 space-y-6" },
                  // Daily Tasks
                  React.createElement('div', { className: "bg-gray-900 rounded-lg p-6 border border-green-500" },
                    React.createElement('h2', { className: "text-xl font-bold text-green-400 mb-4" }, "🏠 Daily Tasks"),
                    React.createElement('div', { className: "grid sm:grid-cols-2 gap-3" },
                      gameState.tasks.daily.map(task => {
                        const isCompleted = gameState.completedTasks[task.id];
                        return React.createElement('div', {
                          key: task.id,
                          className: \`p-3 rounded-lg border-2 cursor-pointer transition-all \${
                            isCompleted 
                              ? 'bg-green-900 border-green-500' 
                              : 'bg-gray-800 border-gray-600 hover:border-green-400'
                          }\`,
                          onClick: () => !isCompleted && gameStatus === 'playing' && completeTask(task)
                        },
                          React.createElement('div', { className: "flex justify-between items-center" },
                            React.createElement('div', null,
                              React.createElement('div', { className: \`font-semibold \${isCompleted ? 'text-green-300 line-through' : 'text-white'}\` }, task.name),
                              React.createElement('div', { className: "text-sm text-gray-400" }, \`\${task.time}min • \${task.points}pts\`)
                            ),
                            isCompleted && React.createElement('span', { className: "text-green-400 text-xl" }, '✓')
                          )
                        );
                      })
                    )
                  ),

                  // Weekly Tasks
                  React.createElement('div', { className: "bg-gray-900 rounded-lg p-6 border border-blue-500" },
                    React.createElement('h2', { className: "text-xl font-bold text-blue-400 mb-4" }, "🏋️ Big Tasks (Require Partner)"),
                    React.createElement('div', { className: "grid sm:grid-cols-2 gap-3" },
                      gameState.tasks.weekly.map(task => {
                        const isCompleted = gameState.completedTasks[task.id];
                        const canComplete = myPlayer?.partner || !task.partnerRequired;
                        
                        return React.createElement('div', {
                          key: task.id,
                          className: \`p-3 rounded-lg border-2 transition-all \${
                            isCompleted 
                              ? 'bg-blue-900 border-blue-500' 
                              : canComplete 
                                ? 'bg-gray-800 border-gray-600 hover:border-blue-400 cursor-pointer'
                                : 'bg-gray-800 border-gray-700 opacity-50'
                          }\`,
                          onClick: () => !isCompleted && canComplete && gameStatus === 'playing' && completeTask(task)
                        },
                          React.createElement('div', { className: "flex justify-between items-start" },
                            React.createElement('div', null,
                              React.createElement('div', { className: \`font-semibold \${isCompleted ? 'text-blue-300 line-through' : 'text-white'}\` }, task.name),
                              React.createElement('div', { className: "text-sm text-gray-400" }, \`\${task.time}min • \${task.points}pts\`),
                              task.partnerRequired && React.createElement('div', { className: "text-xs text-orange-400 mt-1" }, '👥 Partner Required')
                            ),
                            React.createElement('div', null,
                              isCompleted && React.createElement('span', { className: "text-blue-400 text-xl" }, '✓'),
                              !canComplete && !isCompleted && React.createElement('span', { className: "text-gray-500 text-xl" }, '🔒')
                            )
                          )
                        );
                      })
                    )
                  ),

                  // Silly Tasks
                  React.createElement('div', { className: "bg-gray-900 rounded-lg p-6 border border-yellow-500" },
                    React.createElement('h2', { className: "text-xl font-bold text-yellow-400 mb-4" }, "🎭 Silly Tasks"),
                    React.createElement('div', { className: "grid sm:grid-cols-2 gap-3" },
                      gameState.sillyTasks.map(task => {
                        const isCompleted = gameState.completedTasks[task.id];
                        const canComplete = !task.partnerRequired || myPlayer?.partner;
                        
                        return React.createElement('div', {
                          key: task.id,
                          className: \`p-3 rounded-lg border-2 transition-all \${
                            isCompleted 
                              ? 'bg-yellow-900 border-yellow-500' 
                              : canComplete 
                                ? 'bg-gray-800 border-gray-600 hover:border-yellow-400 cursor-pointer'
                                : 'bg-gray-800 border-gray-700 opacity-50'
                          }\`,
                          onClick: () => !isCompleted && canComplete && gameStatus === 'playing' && completeTask(task)
                        },
                          React.createElement('div', { className: "flex justify-between items-start" },
                            React.createElement('div', null,
                              React.createElement('div', { className: \`font-semibold \${isCompleted ? 'text-yellow-300 line-through' : 'text-white'}\` }, task.name),
                              React.createElement('div', { className: "text-sm text-gray-400" }, \`\${task.time}min • \${task.points}pts\`),
                              task.partnerRequired && React.createElement('div', { className: "text-xs text-orange-400 mt-1" }, '👥 Partner Required')
                            ),
                            React.createElement('div', null,
                              isCompleted && React.createElement('span', { className: "text-yellow-400 text-xl" }, '✓'),
                              !canComplete && !isCompleted && React.createElement('span', { className: "text-gray-500 text-xl" }, '🔒')
                            )
                          )
                        );
                      })
                    )
                  )
                )
              ),

              // Game Instructions
              gameStatus === 'waiting' && React.createElement('div', { className: "mt-6 bg-gray-900 rounded-lg p-6 border border-gray-600" },
                React.createElement('h3', { className: "text-lg font-bold text-gray-300 mb-3" }, "🎮 How to Play"),
                React.createElement('div', { className: "grid md:grid-cols-3 gap-4 text-sm text-gray-400" },
                  React.createElement('div', null,
                    React.createElement('div', { className: "font-semibold text-green-400 mb-1" }, "🏠 Daily Tasks"),
                    React.createElement('p', null, "Quick solo tasks anyone can do. Good for getting started!")
                  ),
                  React.createElement('div', null,
                    React.createElement('div', { className: "font-semibold text-blue-400 mb-1" }, "🏋️ Big Tasks"),
                    React.createElement('p', null, "High-value tasks that require teamwork. Partner up first!")
                  ),
                  React.createElement('div', null,
                    React.createElement('div', { className: "font-semibold text-yellow-400 mb-1" }, "🎭 Silly Tasks"),
                    React.createElement('p', null, "Fun bonus tasks for extra points. Some need a partner to witness!")
                  )
                )
              )
            )
          );
        };

        ReactDOM.render(React.createElement(GamePage), document.getElementById('root'));
    </script>
</body>
</html>`;
}
