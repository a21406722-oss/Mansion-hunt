// server.js
// Mansion Hunt - multiplayer treasure hunt server
// Run with: npm install && npm start
// Listens on process.env.PORT or 3000

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Game data: master list of possible hiding spots, grouped by room.
// Each level reveals 10 NEW objects from spots not yet used in that room.
// If a room runs out of unique spots, spots are recycled with new object
// flavor names so the game can continue indefinitely.
// ---------------------------------------------------------------------------

const ROOMS = [
  'Entrance Hall', 'Library', 'Dining Room', 'Kitchen', 'Ballroom',
  'Music Room', 'Study', 'Conservatory', 'Wine Cellar', 'Attic'
];

// Hiding spot positions (x, y, z) roughly laid out per room in the mansion.
// These correspond to actual coordinates used by the client's mansion model.
const HIDING_SPOTS = [
  // Entrance Hall
  { room: 'Entrance Hall', pos: [0, 1.2, -2] },
  { room: 'Entrance Hall', pos: [3, 0.5, 1] },
  { room: 'Entrance Hall', pos: [-3, 2.4, 1] },
  // Library
  { room: 'Library', pos: [10, 1.5, -10] },
  { room: 'Library', pos: [13, 0.8, -12] },
  { room: 'Library', pos: [8, 2.6, -8] },
  // Dining Room
  { room: 'Dining Room', pos: [-10, 0.9, -10] },
  { room: 'Dining Room', pos: [-13, 1.6, -8] },
  { room: 'Dining Room', pos: [-8, 0.4, -13] },
  // Kitchen
  { room: 'Kitchen', pos: [-16, 1.0, -2] },
  { room: 'Kitchen', pos: [-18, 0.6, 2] },
  { room: 'Kitchen', pos: [-14, 1.8, 0] },
  // Ballroom
  { room: 'Ballroom', pos: [0, 1.4, 16] },
  { room: 'Ballroom', pos: [5, 0.5, 19] },
  { room: 'Ballroom', pos: [-5, 2.8, 19] },
  // Music Room
  { room: 'Music Room', pos: [16, 0.9, 4] },
  { room: 'Music Room', pos: [19, 1.7, 8] },
  { room: 'Music Room', pos: [14, 0.5, 9] },
  // Study
  { room: 'Study', pos: [10, 1.1, 10] },
  { room: 'Study', pos: [13, 0.6, 13] },
  { room: 'Study', pos: [8, 2.2, 12] },
  // Conservatory
  { room: 'Conservatory', pos: [-10, 0.7, 10] },
  { room: 'Conservatory', pos: [-14, 1.5, 13] },
  { room: 'Conservatory', pos: [-8, 2.0, 14] },
  // Wine Cellar
  { room: 'Wine Cellar', pos: [-16, -3.2, -14] },
  { room: 'Wine Cellar', pos: [-19, -3.0, -10] },
  { room: 'Wine Cellar', pos: [-13, -3.4, -17] },
  // Attic
  { room: 'Attic', pos: [0, 7.5, -14] },
  { room: 'Attic', pos: [4, 7.2, -17] },
  { room: 'Attic', pos: [-4, 7.8, -16] }
];

// Flavor names cycle so recycled spots still feel like "new" objects each level.
const OBJECT_NAMES = [
  'Brass Pocket Watch', 'Cracked Porcelain Doll', 'Silver Letter Opener',
  'Faded Family Portrait', 'Ivory Chess Piece', 'Tarnished Locket',
  'Velvet Jewelry Box', 'Antique Magnifying Glass', 'Dusty Music Box',
  'Engraved Hip Flask', 'Moth-Eaten Glove', 'Sealed Wax Letter',
  'Bronze Compass', 'Crystal Decanter Stopper', 'Hand-Carved Pipe',
  'Gilded Hand Mirror', 'Pressed Flower Book', 'Old Theatre Ticket',
  'Silk Embroidered Fan', 'Forgotten House Key', 'Cameo Brooch',
  'Yellowed Sheet Music', 'Pewter Candlestick', 'Glass Eye Marble',
  'Torn Map Fragment', 'Rusted Skeleton Key', 'Beaded Coin Purse',
  'Carved Wooden Duck', 'Stained Glass Shard', 'Wind-Up Tin Soldier'
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateLevelObjects(level, usedSpotIndices) {
  // Pick 10 spots for this level: prefer unused ones, recycle if exhausted.
  const allIndices = HIDING_SPOTS.map((_, i) => i);
  const unused = allIndices.filter(i => !usedSpotIndices.has(i));
  let pool = unused.length >= 10 ? unused : allIndices; // recycle once exhausted
  const chosen = shuffle(pool).slice(0, 10);

  const objects = chosen.map((spotIdx, n) => {
    const spot = HIDING_SPOTS[spotIdx];
    const nameIdx = (level * 7 + n * 3) % OBJECT_NAMES.length; // deterministic-ish variety
    return {
      id: `L${level}-${spotIdx}-${Date.now()}-${n}`,
      spotIndex: spotIdx,
      room: spot.room,
      pos: spot.pos,
      name: OBJECT_NAMES[nameIdx],
      foundBy: null
    };
  });

  chosen.forEach(i => usedSpotIndices.add(i));
  return objects;
}

// Reshuffles positions for only the NOT-YET-FOUND objects in the current
// level. Found objects keep their id/position/foundBy so progress/score is
// never undone. Called whenever any player (re)connects to the room.
function reshuffleUnfoundObjects(state) {
  const foundObjects = state.objects.filter(o => o.foundBy);
  const unfoundCount = state.objects.length - foundObjects.length;
  if (unfoundCount === 0) return; // nothing to reshuffle, level is complete

  // Pick fresh random spots for the unfound slots, avoiding spots already
  // occupied by this level's found objects so two objects don't overlap.
  const occupied = new Set(foundObjects.map(o => o.spotIndex));
  const allIndices = HIDING_SPOTS.map((_, i) => i).filter(i => !occupied.has(i));
  const chosen = shuffle(allIndices).slice(0, unfoundCount);

  let n = 0;
  const newUnfound = chosen.map((spotIdx) => {
    const spot = HIDING_SPOTS[spotIdx];
    const nameIdx = (state.level * 7 + (n++) * 3) % OBJECT_NAMES.length;
    return {
      id: `L${state.level}-${spotIdx}-${Date.now()}-${n}`,
      spotIndex: spotIdx,
      room: spot.room,
      pos: spot.pos,
      name: OBJECT_NAMES[nameIdx],
      foundBy: null
    };
  });

  state.objects = [...foundObjects, ...newUnfound];
}

// ---------------------------------------------------------------------------
// Room/lobby state
// ---------------------------------------------------------------------------

/** gameRooms: Map<code, GameRoomState> */
const gameRooms = new Map();

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (gameRooms.has(code));
  return code;
}

function createGameRoom(hostSocketId, hostName) {
  const code = makeRoomCode();
  const usedSpotIndices = new Set();
  const level = 1;
  const objects = generateLevelObjects(level, usedSpotIndices);

  const state = {
    code,
    level,
    usedSpotIndices,
    objects, // current level's objects {id, spotIndex, room, pos, name, foundBy}
    players: new Map(), // socketId -> { id, name, color, pos, rot, score, connected }
    createdAt: Date.now()
  };
  gameRooms.set(code, state);
  return state;
}

function publicObjectsList(state) {
  return state.objects.map(o => ({
    id: o.id, room: o.room, pos: o.pos, name: o.name, found: !!o.foundBy
  }));
}

function publicPlayersList(state) {
  return Array.from(state.players.values()).map(p => ({
    id: p.id, name: p.name, color: p.color, pos: p.pos, rot: p.rot, score: p.score
  }));
}

function leaderboard(state) {
  return publicPlayersList(state)
    .sort((a, b) => b.score - a.score)
    .map(p => ({ name: p.name, score: p.score, color: p.color }));
}

const PLAYER_COLORS = [
  '#C9A24B', '#7B8FA3', '#B5564B', '#5E8C61', '#8E6FA3', '#D08A3E', '#4B8FA0', '#A85C8C'
];

io.on('connection', (socket) => {

  socket.on('create_room', ({ name }) => {
    const playerName = (name || 'Guest').toString().slice(0, 20);
    const state = createGameRoom(socket.id, playerName);
    socket.join(state.code);

    const color = PLAYER_COLORS[0];
    state.players.set(socket.id, {
      id: socket.id, name: playerName, color, pos: [0, 1, 0], rot: 0, score: 0
    });
    socket.data.roomCode = state.code;

    socket.emit('room_created', {
      code: state.code,
      level: state.level,
      objects: publicObjectsList(state),
      players: publicPlayersList(state),
      you: socket.id
    });
  });

  socket.on('join_room', ({ name, code }) => {
    const roomCode = (code || '').toString().toUpperCase().trim();
    const state = gameRooms.get(roomCode);
    if (!state) {
      socket.emit('join_error', { message: 'That code doesn\'t match an open hunt. Check it and try again.' });
      return;
    }
    const playerName = (name || 'Guest').toString().slice(0, 20);
    socket.join(roomCode);
    const color = PLAYER_COLORS[state.players.size % PLAYER_COLORS.length];
    state.players.set(socket.id, {
      id: socket.id, name: playerName, color, pos: [0, 1, 0], rot: 0, score: 0
    });
    socket.data.roomCode = roomCode;

    // Any join/rejoin (including a browser refresh) reshuffles the spots of
    // objects that haven't been found yet, for the whole room.
    reshuffleUnfoundObjects(state);

    socket.emit('room_joined', {
      code: state.code,
      level: state.level,
      objects: publicObjectsList(state),
      players: publicPlayersList(state),
      you: socket.id
    });

    socket.to(roomCode).emit('player_joined', {
      player: { id: socket.id, name: playerName, color, pos: [0, 1, 0], rot: 0, score: 0 }
    });

    // Tell everyone already in the room that the layout just got reshuffled.
    socket.to(roomCode).emit('objects_reshuffled', {
      objects: publicObjectsList(state)
    });
  });

  socket.on('move', ({ pos, rot }) => {
    const code = socket.data.roomCode;
    const state = code && gameRooms.get(code);
    if (!state) return;
    const p = state.players.get(socket.id);
    if (!p) return;
    p.pos = pos;
    p.rot = rot;
    socket.to(code).emit('player_moved', { id: socket.id, pos, rot });
  });

  socket.on('collect_object', ({ objectId }) => {
    const code = socket.data.roomCode;
    const state = code && gameRooms.get(code);
    if (!state) return;
    const obj = state.objects.find(o => o.id === objectId);
    const player = state.players.get(socket.id);
    if (!obj || !player) return;
    if (obj.foundBy) return; // already claimed by someone

    obj.foundBy = socket.id;
    player.score += 1;

    io.to(code).emit('object_found', {
      objectId,
      foundBy: socket.id,
      foundByName: player.name,
      scores: leaderboard(state)
    });

    const allFound = state.objects.every(o => o.foundBy);
    if (allFound) {
      state.level += 1;
      state.objects = generateLevelObjects(state.level, state.usedSpotIndices);
      io.to(code).emit('level_up', {
        level: state.level,
        objects: publicObjectsList(state)
      });
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const state = code && gameRooms.get(code);
    if (!state) return;
    state.players.delete(socket.id);
    socket.to(code).emit('player_left', { id: socket.id });

    if (state.players.size === 0) {
      // clean up empty rooms after a short delay in case of refresh/reconnect
      setTimeout(() => {
        const s = gameRooms.get(code);
        if (s && s.players.size === 0) gameRooms.delete(code);
      }, 60000);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Mansion Hunt server running on port ${PORT}`);
});
