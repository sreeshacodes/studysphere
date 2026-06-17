"use client";
import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

let socket;

const REACTIONS = ['👍', '❤️', '😂', '🔥', '👀'];

export default function StudyRoom({ params }) {
  const rawParams = params || {};

  const [username, setUsername] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState('main-hub');
  const [hasEnteredName, setHasEnteredName] = useState(false);
  const [text, setText] = useState('');
  const [users, setUsers] = useState([]);
  const [timer, setTimer] = useState(1500);
  const [messages, setMessages] = useState([]);
  const [currentMsg, setCurrentMsg] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [activeReactionPicker, setActiveReactionPicker] = useState(null);

  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    if (rawParams.roomId) {
      setRoomId(rawParams.roomId);
      setRoomInput(rawParams.roomId);
    }
  }, [rawParams.roomId]);

  useEffect(() => {
    if (!hasEnteredName) return;

    const BACKEND_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';
    socket = io(BACKEND_URL);

    socket.emit('join-room', { roomId, username });

    socket.on('room-data', (data) => {
      setText(data.documentText);
      setUsers(data.users || []);
    });

    socket.on('text-sync', (syncedText) => setText(syncedText));
    socket.on('timer-tick', (timeLeft) => setTimer(timeLeft));
    socket.on('new-message', (msg) => setMessages((prev) => [...prev, msg]));

    socket.on('user-joined', (name) => {
      setMessages((prev) => [
        ...prev,
        { type: 'system', msg: `${name} joined the room`, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      ]);
    });

    socket.on('user-left', (name) => {
      setMessages((prev) => [
        ...prev,
        { type: 'system', msg: `${name} left the room`, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      ]);
    });

    socket.on('typing-update', (currentlyTyping) => {
      setTypingUsers(currentlyTyping.filter((u) => u !== username));
    });

    socket.on('reaction-update', ({ messageIndex, reactions }) => {
      setMessages((prev) =>
        prev.map((m, i) => (i === messageIndex ? { ...m, reactions } : m))
      );
    });

    return () => socket.disconnect();
  }, [hasEnteredName, roomId, username]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // close reaction picker when clicking outside
  useEffect(() => {
    const handler = () => setActiveReactionPicker(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const handleEntrySubmit = (e) => {
    e.preventDefault();
    if (!username.trim()) return;

    const cleanRoom = roomInput.trim()
      ? roomInput.trim().toLowerCase().replace(/\s+/g, '-')
      : 'main-hub';

    setRoomId(cleanRoom);
    setHasEnteredName(true);
  };

  const handleTextChange = (e) => {
    const val = e.target.value;
    setText(val);
    if (socket?.connected) {
      socket.emit('text-update', { roomId, text: val });
    }
  };

  const handleChatInput = (e) => {
    setCurrentMsg(e.target.value);

    if (!socket?.connected) return;

    socket.emit('typing-start', { roomId, username });

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing-stop', { roomId, username });
    }, 1500);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!currentMsg.trim()) return;
    socket.emit('typing-stop', { roomId, username });
    socket.emit('send-message', { roomId, username, msg: currentMsg.trim(), type: 'text' });
    setCurrentMsg('');
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = () => {
      socket.emit('send-message', {
        roomId,
        username,
        type: 'file',
        fileData: reader.result,
        fileName: file.name,
      });
    };
  };

  const handleCopyLink = () => {
    const url = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  const handleReaction = (messageIndex, emoji) => {
    socket.emit('add-reaction', { roomId, messageIndex, emoji, username });
    setActiveReactionPicker(null);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          socket.emit('send-message', { roomId, username, type: 'voice', audioData: reader.result });
        };
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      alert('Microphone access denied or unsupported browser.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  if (!hasEnteredName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#1C1C1B] text-[#E2E2DE]">
        <form onSubmit={handleEntrySubmit} className="bg-[#2A2A29] p-8 rounded-2xl shadow-2xl w-96 border border-[#6A5D52]">
          <h1 className="text-4xl font-semibold text-center mb-1 text-[#E2E2DE] tracking-tight">Common Room</h1>
          <p className="text-sm text-[#979086] text-center mb-6 leading-relaxed">
            A fully encrypted vault for your files, audios, text and notes.
          </p>

          <div className="mb-4">
            <label className="block text-xs font-bold uppercase tracking-widest text-[#B7AC9B] mb-2">Username</label>
            <input
              type="text"
              required
              placeholder="eg: blair or andrew"
              className="w-full bg-[#1C1C1B] border border-[#6A5D52] rounded-xl p-3 text-[#E2E2DE] focus:outline-none focus:border-[#B7AC9B] text-base font-mono"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold uppercase tracking-widest text-[#B7AC9B] mb-2">Room Name</label>
            <input
              type="text"
              placeholder="main hub, coding space, discordgc"
              className="w-full bg-[#1C1C1B] border border-[#6A5D52] rounded-xl p-3 text-[#E2E2DE] focus:outline-none focus:border-[#B7AC9B] text-base font-mono"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
            />
            <p className="text-xs text-[#979086] mt-1.5 leading-tight">
              If left blank, you will automatically join the general workspace.
            </p>
          </div>

          <button
            type="submit"
            className="w-full bg-[#B7AC9B] text-[#1C1C1B] font-semibold p-3 rounded-xl hover:bg-[#E2E2DE] transition text-base tracking-wide capitalize"
          >
            launch room
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#1C1C1B] text-[#E2E2DE] font-sans antialiased">
      <header className="flex items-center justify-between px-6 py-4 bg-[#2A2A29] border-b border-[#6A5D52]/40">
        <h2 className="text-base font-medium text-[#B7AC9B]">
          Space:{' '}
          <span className="text-[#E2E2DE] font-mono bg-[#1C1C1B] px-2.5 py-1 rounded border border-[#6A5D52] text-sm ml-1">
            {roomId}
          </span>
        </h2>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCopyLink}
            className="text-xs bg-[#1C1C1B] border border-[#6A5D52]/50 px-3 py-1.5 rounded-lg text-[#B7AC9B] hover:text-[#E2E2DE] hover:border-[#979086] transition"
          >
            {linkCopied ? '✓ Copied!' : '🔗 Share Room'}
          </button>
          <div className="text-sm text-[#979086] bg-[#1C1C1B] border border-[#6A5D52]/30 px-3 py-1.5 rounded-lg">
            Operator: <span className="text-[#E2E2DE] font-medium">{username}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 bg-[#2A2A29] p-4 flex flex-col justify-between border-r border-[#6A5D52]/40">
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#979086] mb-2">
                Connected Crew ({users.length})
              </h3>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {users.map((u, i) => (
                  <div
                    key={i}
                    className="text-sm bg-[#1C1C1B] px-2.5 py-1 rounded-lg border border-[#6A5D52]/30 flex items-center space-x-2 text-[#E2E2DE]"
                  >
                    <span className="w-1.5 h-1.5 bg-[#B7AC9B] rounded-full animate-pulse" />
                    <span>{u.username}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col bg-[#1C1C1B]/60 rounded-2xl border border-[#6A5D52]/30 p-3 overflow-hidden mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#979086] mb-2">Live Logs</h3>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-sm">
                {messages.map((m, i) => {
                  if (m.type === 'system') {
                    return (
                      <div key={i} className="text-center text-xs text-[#6A5D52] py-1">
                        {m.msg}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={i}
                      className="bg-[#2A2A29] p-2.5 rounded-xl border border-[#6A5D52]/20 relative group"
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-[#B7AC9B]">{m.username}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#979086] font-mono">{m.timestamp}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveReactionPicker(activeReactionPicker === i ? null : i);
                            }}
                            className="opacity-0 group-hover:opacity-100 text-[#6A5D52] hover:text-[#B7AC9B] transition text-xs"
                          >
                            ＋
                          </button>
                        </div>
                      </div>

                      {m.type === 'voice' && (
                        <div className="mt-1 bg-[#1C1C1B] p-1.5 rounded-lg border border-[#6A5D52]/40">
                          <audio
                            src={m.audioData}
                            controls
                            className="w-full h-7 filter sepia contrast-125 opacity-90"
                            preload="auto"
                          />
                        </div>
                      )}

                      {m.type === 'file' && (
                        <div className="mt-1 bg-[#1C1C1B] p-2 rounded-lg border border-[#6A5D52]/30 text-center">
                          {m.fileData.startsWith('data:image/') ? (
                            <img
                              src={m.fileData}
                              alt="Shared attachment"
                              className="max-w-full h-auto rounded-lg max-h-40 mx-auto object-contain shadow-md"
                            />
                          ) : (
                            <a
                              href={m.fileData}
                              download={m.fileName}
                              className="text-[#B7AC9B] hover:text-[#E2E2DE] font-medium underline flex items-center justify-center space-x-1"
                            >
                              <span>📄 Download {m.fileName.substring(0, 18)}...</span>
                            </a>
                          )}
                        </div>
                      )}

                      {m.type === 'text' && (
                        <p className="text-[#E2E2DE]/90 break-words leading-relaxed">{m.msg}</p>
                      )}

                      {m.reactions && Object.keys(m.reactions).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {Object.entries(m.reactions).map(([emoji, users]) =>
                            users.length > 0 ? (
                              <span
                                key={emoji}
                                onClick={() => handleReaction(i, emoji)}
                                className="text-xs bg-[#1C1C1B] border border-[#6A5D52]/40 rounded-full px-2 py-0.5 cursor-pointer hover:border-[#B7AC9B] transition"
                              >
                                {emoji} {users.length}
                              </span>
                            ) : null
                          )}
                        </div>
                      )}

                      {activeReactionPicker === i && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute bottom-full right-0 mb-1 bg-[#2A2A29] border border-[#6A5D52]/50 rounded-xl px-2 py-1.5 flex gap-1.5 shadow-lg z-10"
                        >
                          {REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => handleReaction(i, emoji)}
                              className="hover:scale-125 transition-transform text-base"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {typingUsers.length > 0 && (
                <div className="text-xs text-[#6A5D52] italic px-1 py-1">
                  {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
                </div>
              )}

              <form onSubmit={handleSendMessage} className="mt-2 flex gap-1.5 items-center">
                <input
                  type="text"
                  placeholder="Type transmission..."
                  className="flex-1 bg-[#1C1C1B] border border-[#6A5D52]/50 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#B7AC9B] text-[#E2E2DE] placeholder-[#979086]/40 transition"
                  value={currentMsg}
                  onChange={handleChatInput}
                  disabled={isRecording}
                />

                <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

                <button
                  type="button"
                  onClick={() => fileInputRef.current.click()}
                  className="p-2 rounded-xl bg-[#1C1C1B] border border-[#6A5D52]/50 text-[#B7AC9B] hover:text-[#E2E2DE] hover:border-[#979086] text-sm transition"
                >
                  📎
                </button>

                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`p-2 rounded-xl border text-sm transition ${
                    isRecording
                      ? 'bg-red-950/40 border-red-800 text-red-400 animate-pulse'
                      : 'bg-[#1C1C1B] border-[#6A5D52]/50 text-[#B7AC9B] hover:text-[#E2E2DE]'
                  }`}
                >
                  {isRecording ? '🛑' : '🎤'}
                </button>

                <button
                  type="submit"
                  className="bg-[#B7AC9B] text-[#1C1C1B] hover:bg-[#E2E2DE] px-3 py-2 rounded-xl text-sm font-medium transition"
                >
                  Send
                </button>
              </form>
            </div>
          </div>

          <div className="bg-[#1C1C1B]/40 p-3.5 rounded-xl border border-[#6A5D52]/30 text-center">
            <div className="text-2xl font-mono text-[#B7AC9B] font-medium tracking-tight mb-2">
              {Math.floor(timer / 60)}:{timer % 60 < 10 ? '0' : ''}{timer % 60}
            </div>
            <button
              onClick={() => socket.emit('start-timer', { roomId, duration: 1500 })}
              className="w-full text-sm bg-[#1C1C1B] hover:bg-[#6A5D52]/20 py-2 rounded-lg text-[#E2E2DE] border border-[#6A5D52]/50 transition font-medium"
            >
              Initialize Sprint
            </button>
          </div>
        </aside>

        <main className="flex-1 p-4 flex flex-col bg-[#1C1C1B]">
          <textarea
            className="flex-1 w-full bg-[#2A2A29] border border-[#6A5D52]/30 rounded-2xl p-5 font-mono text-base text-[#E2E2DE] focus:outline-none resize-none shadow-2xl leading-relaxed"
            value={text}
            onChange={handleTextChange}
            placeholder="Enter group research text inputs..."
          />
        </main>
      </div>
    </div>
  );
}
