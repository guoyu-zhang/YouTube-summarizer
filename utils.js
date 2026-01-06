require('dotenv').config();
const { google } = require('googleapis');
const OpenAI = require('openai');
const { YoutubeTranscript } = require('youtube-transcript');
const { HttpsProxyAgent } = require('https-proxy-agent');

const OPENROUTER_API_KEY = process.env.OPENROUTER_KEY;
const YOUTUBE_API_KEY = process.env.GOOGLE_CLOUD_API_KEY;

const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: OPENROUTER_API_KEY,
});

const youtube = google.youtube({
    version: 'v3',
    auth: YOUTUBE_API_KEY
});

function extractVideoIdFromUrl(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

async function getVideoMetadata(videoId) {
    try {
        const response = await youtube.videos.list({
            part: 'snippet',
            id: videoId
        });

        if (!response.data.items || response.data.items.length === 0) {
            return null;
        }

        const videoSnippet = response.data.items[0].snippet;
        return {
            title: videoSnippet.title,
            channel_title: videoSnippet.channelTitle,
            thumbnail_url: videoSnippet.thumbnails.high.url
        };
    } catch (error) {
        console.error("--- YOUTUBE API ERROR --- \n", error, "\n-------------------------");
        throw error;
    }
}

async function getTranscriptWithProxy(videoId) {
    const proxyUsername = process.env.PROXY_USERNAME;
    const proxyPassword = process.env.PROXY_PASSWORD;

    // Direct connection first if no proxy creds (simpler logic for Node)
    // Note: youtube-transcript doesn't easily support proxies in the same way. 
    // We will attempt direct first.
    
    // NOTE: youtube-transcript package does not support proxy configuration out of the box in the same way 
    // as the python library. Implementing robust proxy support would require patching fetch or using a 
    // different library. For now, we will default to direct connection as that is what most users use locally.
    // If proxy is strictly required, we would need to look into 'https-proxy-agent' and global fetch patching.
    
    // Attempt direct connection
    try {
        console.log(`Attempting to get transcript for video ${videoId}...`);
        const transcriptList = await YoutubeTranscript.fetchTranscript(videoId);
        return transcriptList;
    } catch (error) {
        console.error(`Direct transcript fetch failed: ${error}`);
        throw error;
    }
}

async function summarizeTranscript(transcript) {
    try {
        const prompt = `
        You are a helpful assistant that summarizes YouTube videos for users.
        Summarize the following YouTube video transcript in a clear and structured way.
        Transcript:
        """
        ${transcript}
        """
        Please include the following in your summary:
        1. **Key Points or Sections**: List the main topics or arguments made in the video, broken down into detailed bullet points. Please expand these points to get the full idea across to lay users. For hard to understand concepts, it is best to expand on it further in a clear way.
        2. **Conclusion or Takeaway**: Summarize the main message or action the video encourages.
        Make the language natural and viewer-friendly. Avoid repetition and filler.
        `;

        const response = await client.chat.completions.create({
            model: "xiaomi/mimo-v2-flash:free",
            messages: [
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        });

        return response.choices[0].message.content;
    } catch (error) {
        return `An error occurred during summarization: ${error}`;
    }
}

module.exports = {
    extractVideoIdFromUrl,
    getVideoMetadata,
    getTranscriptWithProxy,
    summarizeTranscript
};
