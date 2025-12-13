import { useEffect, useRef, useState } from "react";
import Pusher from "pusher-js";

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
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [showStrangerNote, setShowStrangerNote] = useState(false);
  const [userId] = useState(() => crypto.randomUUID());
  const pusherRef = useRef(null);
  const channelRef = useRef(null);
  const logRef = useRef(null);
  const nextResetRef = useRef(null);
  const typingTimerRef = useRef(null);
  const showNoteTimerRef = useRef(null);

  const apiCall = async (action, data = {}) => {
    try {
      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId, ...data }),
      });
    } catch (error) {
      console.error("API call failed:", error);
    }
  };

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_PUSHER_KEY || !process.env.NEXT_PUBLIC_PUSHER_CLUSTER) {
      setStatus("disconnected");
      setSystemNote("Setup required: Add Pusher credentials to Vercel environment variables");
      console.error("Missing Pusher credentials. Add NEXT_PUBLIC_PUSHER_KEY and NEXT_PUBLIC_PUSHER_CLUSTER to your environment variables.");
      return;
    }

    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    });
    pusherRef.current = pusher;

    const channel = pusher.subscribe(`user-${userId}`);
    channelRef.current = channel;

    pusher.connection.bind("connected", () => {
      setStatus("connected");
      setSystemNote("Ready. Press Start to find a stranger.");
    });

    pusher.connection.bind("disconnected", () => {
      setStatus("disconnected");
      setSystemNote("Offline. Check connection and refresh if needed.");
    });

    channel.bind("waiting", () => {
      setStatus("waiting");
      pushSystem("Looking for a stranger…");
    });

    channel.bind("partnerFound", () => {
      setStatus("chatting");
      pushSystem("You're now chatting with a stranger. Be kind!");
      // show a short-lived placeholder indicating stranger arrived
      setShowStrangerNote(true);
      if (showNoteTimerRef.current) clearTimeout(showNoteTimerRef.current);
      showNoteTimerRef.current = setTimeout(() => setShowStrangerNote(false), 8000);
    });

    channel.bind("chatMessage", (data) => {
      if (!data?.text) return;
      pushMessage("stranger", data.text);
      // remove placeholder when first real message arrives
      setShowStrangerNote(false);
      if (showNoteTimerRef.current) {
        clearTimeout(showNoteTimerRef.current);
        showNoteTimerRef.current = null;
      }
    });

    channel.bind("typing", () => {
      setPartnerTyping(true);
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
      typingTimerRef.current = setTimeout(() => setPartnerTyping(false), 1600);
    });

    channel.bind("partnerLeft", () => {
      pushSystem("Stranger left. Click Next to find someone new.");
      setStatus("connected");
      setSystemNote("Ready. Press Start to find a stranger.");
    });

    channel.bind("partnerSkipped", () => {
      pushMessage("system", "Stranger skipped you.");
      setStatus("connected");
      setSystemNote("Ready. Press Start to find a stranger.");
    });

    channel.bind("stopped", () => {
      setStatus("connected");
      setSystemNote("Stopped. Start when you are ready.");
    });

    return () => {
      channel.unbind_all();
      channel.unsubscribe();
      pusher.disconnect();
      if (showNoteTimerRef.current) {
        clearTimeout(showNoteTimerRef.current);
        showNoteTimerRef.current = null;
      }
    };
  }, [userId]);

  // Set a CSS variable with the app's inner height to avoid mobile
  // viewport jumps when the on-screen keyboard appears. We update the
  // variable on resize/orientation/focus events so the layout uses the
  // value of `window.innerHeight` rather than unstable viewport units.
  useEffect(() => {
    if (typeof window === "undefined") return;

    let resizeTimer = null;
    const setAppHeight = () => {
      document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
    };

    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        setAppHeight();
        resizeTimer = null;
      }, 50);
    };

    setAppHeight();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", setAppHeight);
    // focusin/focusout helps when the keyboard opens on mobile
    window.addEventListener("focusin", setAppHeight);
    window.addEventListener("focusout", setAppHeight);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", setAppHeight);
      window.removeEventListener("focusin", setAppHeight);
      window.removeEventListener("focusout", setAppHeight);
      if (resizeTimer) clearTimeout(resizeTimer);
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

  const pushMessage = (author, text) => {
    // Hide the transient "Stranger is in the chat." placeholder when any real
    // message is added (either by you or the stranger).
    if (author === "you" || author === "stranger") {
      setShowStrangerNote(false);
      if (showNoteTimerRef.current) {
        clearTimeout(showNoteTimerRef.current);
        showNoteTimerRef.current = null;
      }
    }

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), author, text }]);
  };

  const pushSystem = (text) => {
    setSystemNote(text);
  };

  const startChat = () => {
    setMessages([]);
    // reset any transient placeholder from previous sessions
    setShowStrangerNote(false);
    setSystemNote("Connecting…");
    setConfirmNext(false);
    apiCall("findPartner");
  };

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed || status !== "chatting") return;
    // locally add message and hide any transient placeholder
    pushMessage("you", trimmed);
    apiCall("sendMessage", { message: trimmed });
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
    pushMessage("system", "You skipped.");
    setStatus("connected");
    setSystemNote("Ready. Press Start to find a stranger.");
    apiCall("next");
  };

  const handleStop = () => {
    if (status !== "waiting") return;
    apiCall("stop");
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
          <div className="actions" style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 10, flex: 1 }}>
              <button className="primary" onClick={startChat} disabled={status === "waiting" || status === "chatting"}>
                Start
              </button>
              <button className="secondary danger" onClick={handleStop} disabled={status !== "waiting"}>
                Stop
              </button>
            </div>
            <div className={`status ${currentStatus.className}`} style={{ minWidth: "100px" }}>
              <span className="status-dot" />
              <span>{currentStatus.label}</span>
            </div>
          </div>

          <div className="log" ref={logRef}>
            {status === "chatting" && (
              <div className="message system">
                <div className="bubble">Stranger is in the chat.</div>
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
                if (status === "chatting") {
                  apiCall("typing");
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
