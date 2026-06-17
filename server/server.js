const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e8,
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = {};

io.on('connection', (socket) => {

  socket.on('join-room', ({ roomId, username }) => {
    const safeRoomId = roomId || 'main-hub';
    socket.join(safeRoomId);

    if (!rooms[safeRoomId]) {
      rooms[safeRoomId] = {
        documentText: "welcome to our space!\ncreate, share and collaborate in real time.\n\n",
        users: [],
        typingUsers: [],
        messages: []
      };
    }

    rooms[safeRoomId].users = rooms[safeRoomId].users.filter(u => u.id !== socket.id);
    rooms[safeRoomId].users.push({ id: socket.id, username });

    // store username on socket so we can reference it on disconnect
    socket._username = username;
    socket._roomId = safeRoomId;

    io.to(safeRoomId).emit('room-data', rooms[safeRoomId]);

    // notify everyone else that this person joined
    socket.to(safeRoomId).emit('user-joined', username);
  });

  socket.on('text-update', ({ roomId, text }) => {
    const safeRoomId = roomId || 'main-hub';
    if (rooms[safeRoomId]) {
      rooms[safeRoomId].documentText = text;
      socket.to(safeRoomId).emit('text-sync', text);
    }
  });

  socket.on('send-message', ({ roomId, username, msg, type, audioData, fileData, fileName }) => {
    const safeRoomId = roomId || 'main-hub';
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newMessage = { username, msg, type, audioData, fileData, fileName, timestamp, reactions: {} };

    if (rooms[safeRoomId]) {
      rooms[safeRoomId].messages.push(newMessage);
    }

    io.to(safeRoomId).emit('new-message', newMessage);
  });

  socket.on('typing-start', ({ roomId, username }) => {
    const safeRoomId = roomId || 'main-hub';
    if (!rooms[safeRoomId]) return;

    const typing = rooms[safeRoomId].typingUsers;
    if (!typing.includes(username)) {
      typing.push(username);
    }

    io.to(safeRoomId).emit('typing-update', typing);
  });

  socket.on('typing-stop', ({ roomId, username }) => {
    const safeRoomId = roomId || 'main-hub';
    if (!rooms[safeRoomId]) return;

    rooms[safeRoomId].typingUsers = rooms[safeRoomId].typingUsers.filter(u => u !== username);
    io.to(safeRoomId).emit('typing-update', rooms[safeRoomId].typingUsers);
  });

  socket.on('add-reaction', ({ roomId, messageIndex, emoji, username }) => {
    const safeRoomId = roomId || 'main-hub';
    if (!rooms[safeRoomId]) return;

    const message = rooms[safeRoomId].messages[messageIndex];
    if (!message) return;

    if (!message.reactions[emoji]) {
      message.reactions[emoji] = [];
    }

    const alreadyReacted = message.reactions[emoji].includes(username);
    if (alreadyReacted) {
      message.reactions[emoji] = message.reactions[emoji].filter(u => u !== username);
    } else {
      message.reactions[emoji].push(username);
    }

    io.to(safeRoomId).emit('reaction-update', {
      messageIndex,
      reactions: message.reactions
    });
  });

  socket.on('start-timer', ({ roomId, duration }) => {
    const safeRoomId = roomId || 'main-hub';
    if (!rooms[safeRoomId]) return;

    let timeLeft = duration;
    if (rooms[safeRoomId].timerInterval) clearInterval(rooms[safeRoomId].timerInterval);

    rooms[safeRoomId].timerInterval = setInterval(() => {
      timeLeft--;
      io.to(safeRoomId).emit('timer-tick', timeLeft);
      if (timeLeft <= 0) clearInterval(rooms[safeRoomId].timerInterval);
    }, 1000);
  });

  socket.on('disconnect', () => {
    const username = socket._username;
    const roomId = socket._roomId;

    for (const safeRoomId in rooms) {
      rooms[safeRoomId].users = rooms[safeRoomId].users.filter(u => u.id !== socket.id);
      rooms[safeRoomId].typingUsers = rooms[safeRoomId].typingUsers.filter(u => u !== username);
      io.to(safeRoomId).emit('room-data', rooms[safeRoomId]);
    }

    if (username && roomId) {
      socket.to(roomId).emit('user-left', username);
    }
  });

});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));