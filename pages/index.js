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
  const videoOverlayRef = useRef(null);
  const nextResetRef = useRef(null);
  const typingTimerRef = useRef(null);
  const showNoteTimerRef = useRef(null);
  const pcRef = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [showVideo, setShowVideo] = useState(false);
  const [remoteActive, setRemoteActive] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const [skipNotice, setSkipNotice] = useState("");
  const skipTimerRef = useRef(null);

  const showSkip = (text) => {
    setSkipNotice(text);
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    skipTimerRef.current = setTimeout(() => setSkipNotice(""), 3500);
  };

  const addDebug = (msg) => {
    setDebugLogs((d) => [...d.slice(-20), `${new Date().toLocaleTimeString()} - ${msg}`]);
    console.log(msg);
  };

  const apiCall = async (action, data = {}) => {
    try {
      addDebug(`API call -> ${action}`);
      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId, ...data }),
      });
    } catch (error) {
      addDebug(`API call failed: ${action} ${error?.message || error}`);
    }
  };

  const stopVideoCall = () => {
    try {
      if (pcRef.current) {
        pcRef.current.close();
      }
    } catch (e) {
      console.warn("Error closing pc", e);
    }
    pcRef.current = null;

    if (localVideoRef.current && localVideoRef.current.srcObject) {
      try {
        localVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      } catch (e) {
        console.warn("Error stopping local tracks", e);
      }
      localVideoRef.current.srcObject = null;
      if (localStreamRef.current) {
        try {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
        } catch (e) {
          console.warn("Error stopping localStreamRef tracks", e);
        }
        localStreamRef.current = null;
      }
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setShowVideo(false);
    setRemoteActive(false);
  };

  const startVideoCall = async (opts = {}) => {
    const { force = false } = opts;
    try {
      // Show the video UI immediately so the preview slot appears while permissions prompt.
      setShowVideo(true);
      setSystemNote("Opening camera…");
      // reuse any prefetched local stream to avoid re-prompting for permissions
      const localStream = localStreamRef.current || (await navigator.mediaDevices.getUserMedia({ video: true, audio: true }));
      localStreamRef.current = localStream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
        localVideoRef.current.muted = true;
        try {
          // Attempt to play the local preview (user gesture should allow this)
          await localVideoRef.current.play();
        } catch (e) {
          console.warn("localVideo play() failed:", e);
        }
      }

      // If we're in a chat or forced, create a peer connection and initiate a full call.
      if (canChat || force) {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        pcRef.current = pc;

        pc.ontrack = (e) => {
          addDebug("pc.ontrack -> streams: " + JSON.stringify((e.streams || []).map((s) => s.id)) + " tracks:" + (e.track ? e.track.kind : "no-track"));
          if (remoteVideoRef.current) {
            try {
              // Prefer the incoming MediaStream if provided
              if (e.streams && e.streams[0]) {
                remoteVideoRef.current.srcObject = e.streams[0];
                addDebug("Attached incoming stream to remoteVideo");
              } else if (e.track) {
                // Fallback for browsers/devices that provide `track` but no streams
                const ms = new MediaStream();
                ms.addTrack(e.track);
                remoteVideoRef.current.srcObject = ms;
                addDebug("Attached fallback MediaStream (e.track) to remoteVideo");
              } else {
                addDebug("pc.ontrack: no streams and no track found");
              }

              // Ensure remote is muted so autoplay isn't blocked
              remoteVideoRef.current.muted = true;
              remoteVideoRef.current.play().catch((err) => {
                console.warn("remoteVideo play() error:", err);
                addDebug("remoteVideo play error: " + (err?.message || err));
              });
            } catch (err) {
              console.warn("remoteVideo attach/play failed:", err);
            }
          }
          setRemoteActive(true);
        };

        pc.onicecandidate = (e) => {
          addDebug("pc.onicecandidate -> " + (e.candidate ? e.candidate.candidate : "null"));
          if (e.candidate) apiCall("webrtc-ice", { candidate: e.candidate });
        };

        pc.onconnectionstatechange = () => {
          console.log("pc.connectionState ->", pc.connectionState);
        };

        pc.oniceconnectionstatechange = () => {
          console.log("pc.iceConnectionState ->", pc.iceConnectionState);
        };

        // add tracks from the prefetched or newly-acquired local stream
        localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await apiCall("webrtc-offer", { offer: pc.localDescription });
      }

      // Show the video area for preview or active call
      setShowVideo(true);
    } catch (err) {
      console.error("startVideoCall error", err);
      // Try a simpler constraint if more complex one failed
      try {
        const localStream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          localVideoRef.current.muted = true;
          try {
            await localVideoRef.current.play();
          } catch (e) {
            console.warn("localVideo play() failed (fallback):", e);
          }
        }
        setSystemNote("Camera preview available (fallback).");
      } catch (err2) {
        console.error("Fallback getUserMedia failed:", err2);
        setSystemNote("Camera not available — check permissions and try again.");
        stopVideoCall();
      }
    }
  };

  const toggleVideo = async () => {
    if (showVideo) {
      stopVideoCall();
      return;
    }

    // Start preview on any user gesture when not disconnected.
    if (status === "disconnected") return;
    await startVideoCall();
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

    channel.bind("partnerFound", async (data) => {
      // data: { partnerId, initiator }
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

    // WebRTC signaling messages
    // WebRTC signaling handlers removed (video functionality disabled)

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

  useEffect(() => {
    // Stop the video/preview only when disconnected.
    // Keep preview active during `waiting` so users who opened the video before
    // pressing Start continue to see their local preview while matching.
    if (status === "disconnected") {
      stopVideoCall();
    }
  }, [status]);

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
    showSkip("You skipped.");
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

          

          <div
            className="composer"
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              width: "100%",
              flexWrap: "nowrap",
            }}
          >
            <button
              className="secondary"
              onClick={handleNext}
              disabled={!canChat && status !== "waiting"}
              style={{ minWidth: 88 }}
            >
              {confirmNext ? "Sure?" : "Next"}
            </button>

            <textarea
              rows={1}
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
              style={{ flex: 1, minWidth: 240, resize: "none" }}
            />

            <button
              className="primary"
              onClick={sendMessage}
              disabled={!canChat || !input.trim()}
              style={{ minWidth: 88 }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
