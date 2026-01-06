require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const { Client } = require("pg");
const {
  extractVideoIdFromUrl,
  getVideoMetadata,
  getTranscriptWithProxy,
  summarizeTranscript,
} = require("./utils");

const app = express();
const port = process.env.PORT || 3000;

// Database configuration
const isProduction = process.env.NODE_ENV === "production";
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
};

// Initialize DB
async function initDb() {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    await client.query(`
            CREATE TABLE IF NOT EXISTS summaries (
                id SERIAL PRIMARY KEY,
                youtube_url TEXT NOT NULL,
                title TEXT NOT NULL,
                channel_title TEXT NOT NULL,
                thumbnail_url TEXT NOT NULL,
                summary TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            )
        `);
    console.log("Database initialized successfully.");
  } catch (err) {
    console.error("Error initializing database:", err);
  } finally {
    await client.end();
  }
}

initDb();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "static")));

// Routes

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

app.get("/get_summaries", async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const result = await client.query(
      "SELECT * FROM summaries ORDER BY timestamp DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching summaries:", error);
    res.status(500).json({ error: "Failed to fetch summaries." });
  } finally {
    await client.end();
  }
});

app.delete("/delete_summary/:id", async (req, res) => {
  const { id } = req.params;
  const client = new Client(dbConfig);
  try {
    await client.connect();
    await client.query("DELETE FROM summaries WHERE id = $1", [id]);
    res.json({ success: true, message: "Summary deleted successfully." });
  } catch (error) {
    console.error("Error deleting summary:", error);
    res.status(500).json({ error: "Failed to delete summary." });
  } finally {
    await client.end();
  }
});

app.post("/get_video_info", async (req, res) => {
  const { url } = req.body;
  const videoId = extractVideoIdFromUrl(url);

  if (!videoId) {
    return res.status(400).json({ error: "Invalid YouTube URL." });
  }

  try {
    const metadata = await getVideoMetadata(videoId);
    if (!metadata) {
      return res.status(404).json({ error: "Video not found." });
    }
    res.json(metadata);
  } catch (error) {
    res.status(500).json({ error: "An internal API error occurred." });
  }
});

app.post("/summarize", async (req, res) => {
  const { url } = req.body;
  const videoId = extractVideoIdFromUrl(url);

  if (!videoId) {
    return res.status(400).json({ error: "Could not extract video ID." });
  }

  try {
    const transcriptList = await getTranscriptWithProxy(videoId);
    const transcriptText = transcriptList.map((item) => item.text).join(" ");
    const summary = await summarizeTranscript(transcriptText);
    res.json({ summary });
  } catch (error) {
    console.error(
      `--- TRANSCRIPT API ERROR --- \n${error}\n-------------------------`
    );
    const errorMessage = error.toString();

    if (
      errorMessage.toLowerCase().includes("blocked") ||
      errorMessage.toLowerCase().includes("cloud provider")
    ) {
      res.status(500).json({
        error:
          "YouTube has blocked this request. Please ensure your proxy is configured correctly.",
      });
    } else if (errorMessage.toLowerCase().includes("transcript")) {
      res.status(500).json({
        error:
          "Could not retrieve video transcript. The video may not have one, or it might be private.",
      });
    } else {
      res.status(500).json({
        error: `An error occurred while processing the video: ${errorMessage}`,
      });
    }
  }
});

app.post("/save_summary", async (req, res) => {
  const { url, title, channel_title, thumbnail_url, summary } = req.body;

  if (!url || !title || !channel_title || !thumbnail_url || !summary) {
    return res.status(400).json({ error: "Missing data for saving." });
  }

  const client = new Client(dbConfig);
  try {
    await client.connect();
    await client.query(
      "INSERT INTO summaries (youtube_url, title, channel_title, thumbnail_url, summary) VALUES ($1, $2, $3, $4, $5)",
      [url, title, channel_title, thumbnail_url, summary]
    );
    res.json({ message: "Summary saved successfully." });
  } catch (error) {
    console.error("Error saving summary:", error);
    res.status(500).json({ error: "Failed to save summary." });
  } finally {
    await client.end();
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
