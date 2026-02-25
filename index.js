const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

const serviceAccount = require("./dwarkadhish-e1aa8-firebase-adminsdk-fbsvc-e1fdd9808a.json");
const cors = require("cors");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();
app.use(bodyParser.json());

app.use(cors());

app.post("/api/save-token", async (req, res) => {
  const { userId, token } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ message: "Missing userId or token" });
  }

  try {
    const userRef = db.collection("users").doc(userId);

    await userRef.set(
      {
        fcmTokens: admin.firestore.FieldValue.arrayUnion(token),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Save token error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/send-notification", async (req, res) => {
  console.log("Received notification request:", req.body);
  const { title, body, senderId, visibleTo } = req.body;

  if (!senderId) {
    return res.status(400).json({ message: "Missing senderId" });
  }

  try {
    const usersSnapshot = await db.collection("users").get();

    let tokens = [];

    usersSnapshot.forEach((doc) => {
      if (doc.id !== senderId) {
        // If visibleTo is provided and the user is not in the array, skip
        if (visibleTo && Array.isArray(visibleTo) && !visibleTo.includes(doc.id)) {
          return;
        }

        const data = doc.data();
        if (data.fcmTokens && Array.isArray(data.fcmTokens)) {
          tokens.push(...data.fcmTokens);
        }
      }
    });

    if (tokens.length === 0) {
      console.log("No tokens found");
      return res.json({ success: false, message: "No users to notify" });
    }

    console.log("Sending to tokens:", tokens.length);

    const message = {
      notification: {
        title: title || "New Message",
        body: body || "",
      },
      android: {
        priority: "high",
      },
      tokens: tokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    res.json({
      success: true,
      sent: response.successCount,
      failed: response.failureCount,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


async function removeInvalidTokens(tokens, results) {
  for (let i = 0; i < results.length; i++) {
    const error = results[i].error;

    if (error) {
      const failedToken = tokens[i];
      const usersSnapshot = await db.collection("users").get();

      usersSnapshot.forEach(async (doc) => {
        const data = doc.data();

        if (data.fcmTokens?.includes(failedToken)) {
          await db.collection("users").doc(doc.id).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(failedToken),
          });
        }
      });
    }
  }
}
/* =========================
   REMOVE INVALID TOKENS
========================= */
async function cleanupInvalidTokens(tokens, responses) {
  for (let i = 0; i < responses.length; i++) {
    if (!responses[i].success) {
      const failedToken = tokens[i];

      const usersSnapshot = await db.collection("users").get();

      usersSnapshot.forEach(async (doc) => {
        const data = doc.data();
        if (data.fcmTokens?.includes(failedToken)) {
          await db.collection("users").doc(doc.id).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(failedToken),
          });

        }
      });
    }
  }
}

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/app-release.apk");
})

app.listen(80, () => {
  console.log("Server running on port 80");

});
