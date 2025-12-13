import Pusher from "pusher";

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

// Store state in Vercel KV or use a simple in-memory store
// Note: In-memory will reset but should work for basic testing
const state = {
  waiting: new Set(),
  partners: new Map(),
  messages: new Map(),
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, userId, message } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "userId required" });
  }

  try {
    switch (action) {
      case "findPartner": {
        // Clean up existing state
        state.waiting.delete(userId);
        const oldPartnerId = state.partners.get(userId);
        if (oldPartnerId) {
          state.partners.delete(userId);
          state.partners.delete(oldPartnerId);
          await pusher.trigger(`user-${oldPartnerId}`, "partnerLeft", {});
        }

        // Try to pair
        if (state.waiting.size > 0) {
          const partnerId = [...state.waiting][0];
          state.waiting.delete(partnerId);
          
          state.partners.set(userId, partnerId);
          state.partners.set(partnerId, userId);
          
          await Promise.all([
            pusher.trigger(`user-${userId}`, "partnerFound", {}),
            pusher.trigger(`user-${partnerId}`, "partnerFound", {}),
          ]);
        } else {
          state.waiting.add(userId);
          await pusher.trigger(`user-${userId}`, "waiting", {});
        }
        break;
      }

      case "sendMessage": {
        const partnerId = state.partners.get(userId);
        if (partnerId && message) {
          await pusher.trigger(`user-${partnerId}`, "chatMessage", { text: message });
        }
        break;
      }

      case "typing": {
        const partnerId = state.partners.get(userId);
        if (partnerId) {
          await pusher.trigger(`user-${partnerId}`, "typing", {});
        }
        break;
      }

      case "stop": {
        state.waiting.delete(userId);
        await pusher.trigger(`user-${userId}`, "stopped", {});
        break;
      }

      case "next": {
        const partnerId = state.partners.get(userId);
        if (partnerId) {
          state.partners.delete(userId);
          state.partners.delete(partnerId);
          await pusher.trigger(`user-${partnerId}`, "partnerLeft", {});
        }
        
        state.waiting.add(userId);
        await pusher.trigger(`user-${userId}`, "waiting", {});
        break;
      }

      default:
        return res.status(400).json({ error: "Invalid action" });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
}
