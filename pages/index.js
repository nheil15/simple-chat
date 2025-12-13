import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const statusCopy = {
  disconnected: { label: "Offline", className: "offline" },
  connected: { label: "Ready", className: "online" },
  waiting: { label: "Matching…", className: "waiting" },
  chatting: { label: "Chatting", className: "online" },
};

export default function Home() {
  const [status, setStatus] = useState("disconnected");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [systemNote, setSystemNote] = useState("Hit Start to begin.");
  const [confirmNext, setConfirmNext] = useState(false);
  const [botMode, setBotMode] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const socketRef = useRef(null);
  const logRef = useRef(null);
  const nextResetRef = useRef(null);
  const botTimerRef = useRef(null);
  const typingTimerRef = useRef(null);

  useEffect(() => {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;
    const socket = io(socketUrl, { path: "/api/socket", transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("connected");
      setSystemNote("Ready. Press Start to find a stranger.");
    });

    socket.on("waiting", () => {
      setStatus("waiting");
      pushSystem("Looking for a stranger…");
    });

    socket.on("partnerFound", () => {
      setStatus("chatting");
      pushSystem("You're now chatting with a stranger. Be kind!");
    });

    socket.on("chatMessage", (payload) => {
      if (!payload?.text) return;
      pushMessage("stranger", payload.text);
    });

    socket.on("typing", () => {
      setPartnerTyping(true);
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
      typingTimerRef.current = setTimeout(() => setPartnerTyping(false), 1600);
    });

    socket.on("partnerLeft", () => {
      pushSystem("Stranger left. Click Next to find someone new.");
      setStatus("connected");
      setSystemNote("Ready. Press Start to find a stranger.");
    });

    socket.on("stopped", () => {
      setStatus("connected");
      setSystemNote("Stopped. Start when you are ready.");
    });

    socket.on("disconnect", () => {
      setStatus("disconnected");
      setSystemNote("Offline. Check connection and refresh if needed.");
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    setConfirmNext(false);
    if (nextResetRef.current) {
      clearTimeout(nextResetRef.current);
      nextResetRef.current = null;
    }
  }, [status]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (botTimerRef.current) {
        clearTimeout(botTimerRef.current);
      }
    };
  }, []);

  const pushMessage = (author, text) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), author, text }]);
  };

  const pushSystem = (text) => {
    setSystemNote(text);
  };

  const startChat = () => {
    setMessages([]);
    setSystemNote("Connecting…");
    setConfirmNext(false);
    setBotMode(false);
    socketRef.current?.emit("findPartner");
  };

  const startBotChat = () => {
    if (botTimerRef.current) {
      clearTimeout(botTimerRef.current);
    }
    setBotMode(true);
    setMessages([]);
    setSystemNote("Chatting with a test bot. Type to see replies.");
    setStatus("chatting");
    setConfirmNext(false);
    pushMessage("system", "Bot joined the room.");
  };

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed || status !== "chatting") return;
    pushMessage("you", trimmed);
    if (botMode) {
      if (botTimerRef.current) {
        clearTimeout(botTimerRef.current);
      }
      setPartnerTyping(true);
      botTimerRef.current = setTimeout(() => {
        const canned = [
          "Hey there! I'm just a test bot.",
          "I echo: " + trimmed,
          "Try 'Next' to reset me.",
          "Type something else!",
        ];
        const reply = canned[Math.floor(Math.random() * canned.length)];
        pushMessage("stranger", reply);
        setPartnerTyping(false);
        botTimerRef.current = null;
      }, 800 + Math.random() * 900);
    } else {
      socketRef.current?.emit("chatMessage", trimmed);
    }
    setInput("");
    setPartnerTyping(false);
  };

  const handleNext = () => {
    if (!confirmNext) {
      setConfirmNext(true);
      setSystemNote("Press Next again to skip.");
      nextResetRef.current = setTimeout(() => {
        setConfirmNext(false);
        nextResetRef.current = null;
      }, 3500);
      return;
    }

    if (nextResetRef.current) {
      clearTimeout(nextResetRef.current);
      nextResetRef.current = null;
    }

    pushSystem("Ending chat…");
    setConfirmNext(false);

    if (botMode) {
      if (botTimerRef.current) {
        clearTimeout(botTimerRef.current);
        botTimerRef.current = null;
      }
      setBotMode(false);
      setStatus("connected");
      return;
    }

    socketRef.current?.emit("next");
  };

  const handleStop = () => {
    if (status !== "waiting") return;
    socketRef.current?.emit("stopFinding");
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const currentStatus = statusCopy[status] ?? statusCopy.disconnected;
  const canChat = status === "chatting";

  return (
    <div className="container">
      <div className="grid">
        <div className="panel chat-box">
          <div className="actions" style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="primary" onClick={startChat} disabled={status === "waiting" || status === "chatting"}>
                Start
              </button>
              <button className="secondary danger" onClick={handleStop} disabled={status !== "waiting"}>
                Stop
              </button>
              <button className="secondary" onClick={startBotChat} disabled={status === "waiting" || status === "chatting"}>
                Bot test
              </button>
            </div>
            <div className={`status ${currentStatus.className}`}>
              <span className="status-dot" />
              <span>{currentStatus.label}</span>
            </div>
          </div>

          <div className="log" ref={logRef}>
            {messages.length === 0 && (
              <div className="message system">
                <div className="bubble">No messages yet.</div>
              </div>
            )}
             {messages.map((msg) => (
               <div key={msg.id} className={`message ${msg.author}`}>
                 <div className="bubble">{msg.text}</div>
               </div>
             ))}
          </div>
          <div className="system-note" aria-live="polite">
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
              {status !== "chatting" && <span>{systemNote || ""}</span>}
              {status === "chatting" && partnerTyping && (
                <span className="typing typing-inline" aria-label="Partner is typing">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              )}
            </div>
          </div>

          <div className="composer">
            <textarea
              rows={2}
              placeholder={canChat ? "Type a message…" : "Wait for a match to chat"}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (!botMode && status === "chatting") {
                  socketRef.current?.emit("typing");
                }
              }}
              onKeyDown={handleKey}
              disabled={!canChat}
            />
            <button className="primary" onClick={sendMessage} disabled={!canChat || !input.trim()}>
              Send
            </button>
            <button className="secondary" onClick={handleNext} disabled={!canChat && status !== "waiting"}>
              {confirmNext ? "Sure?" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
