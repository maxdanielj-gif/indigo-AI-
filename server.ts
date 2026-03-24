import express from "express";
import cors from "cors";
import compression from "compression";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { Readable } from "stream";

dotenv.config();

// Global Error Handlers to prevent process crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});

process.on('uncaughtException', (error: any) => {
  if (error.code === 'EPIPE') {
    return;
  }
  console.error('Uncaught Exception thrown:', error);
  // We might want to exit if the error is critical, but for dev containers, 
  // keeping it alive might be better for debugging.
  // process.exit(1);
});

console.log(`Server starting in ${process.env.NODE_ENV || 'development'} mode`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { GoogleGenAI } from "@google/genai";
import admin from "firebase-admin";
import { FunctionDeclaration, Type, Modality } from "@google/genai";
import { retry, sleep } from "./src/services/gemini";

function validateModel(model: string | undefined, options?: { useMaps?: boolean }): string {
  const prohibited = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
  
  // Maps grounding is only supported in Gemini 2.5 series models.
  if (options?.useMaps) {
    return 'gemini-2.5-flash';
  }

  if (!model || prohibited.some(p => model.includes(p))) {
    return 'gemini-3-flash-preview';
  }
  return model;
}

// Cloud Sync Storage
const SYNC_DATA_PATH = path.join(__dirname, "data", "sync.json");

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"));
}

// Load sync data
let cloudSyncData: Record<string, any> = {};
if (fs.existsSync(SYNC_DATA_PATH)) {
  try {
    cloudSyncData = JSON.parse(fs.readFileSync(SYNC_DATA_PATH, 'utf-8'));
  } catch (e) {
    console.error("Failed to load sync data:", e);
  }
}

const inProgressProactiveMessages: Record<string, boolean> = {};

// Save sync data helper with throttling
let isSaving = false;
let pendingSave = false;

const saveSyncData = async () => {
  if (isSaving) {
    pendingSave = true;
    return;
  }
  
  isSaving = true;
  pendingSave = false;
  
  try {
    const data = JSON.stringify(cloudSyncData);
    const tempPath = SYNC_DATA_PATH + ".tmp";
    await fs.promises.writeFile(tempPath, data);
    await fs.promises.rename(tempPath, SYNC_DATA_PATH);
    console.log(`Sync data saved successfully (${(data.length / 1024 / 1024).toFixed(2)} MB)`);
  } catch (e) {
    console.error("Failed to save sync data:", e);
  } finally {
    isSaving = false;
    if (pendingSave) {
      setTimeout(saveSyncData, 5000); // Wait 5s before next save if pending
    }
  }
};

// Helper to generate and send proactive message
const logStream = fs.createWriteStream(path.join(process.cwd(), 'server.log'), { flags: 'a' });

function log(message: string) {
  const timestamp = new Date().toISOString();
  logStream.write(`[${timestamp}] ${message}\n`);
  console.log(message);
}

async function generateAndSendProactiveMessage(userData: any, retryCount = 0, type: 'message' | 'email' | 'blog' | 'both' = 'both'): Promise<{ message: string, generatedImage?: string } | null> {
  if (!userData) {
    throw new Error("userData is undefined in proactive message generation.");
  }
  const { chatHistory, aiProfile, userProfile, apiKey: clientApiKey, fcmToken, timeZone, firebaseServiceAccountKey, isAmbient, userId } = userData;
  const googleTokens = userData.googleTokens || cloudSyncData[userId]?.googleTokens;

  if (!aiProfile || !userProfile) {
    throw new Error("AI Profile and User Profile are required for proactive message.");
  }

  const shouldSendPush = (type === 'message' || type === 'both') && !isAmbient; // Don't send push for ambient (it's for when app is open)
  const shouldSendEmail = type === 'email' || type === 'both';
  const shouldPostToBlog = type === 'blog';

  const systemKey = process.env.GEMINI_API_KEY;
  const isValidSystemKey = systemKey && systemKey !== "MY_GEMINI_API_KEY" && systemKey.length > 10;
  const apiKey = clientApiKey || (isValidSystemKey ? systemKey : null);
  
  if (!apiKey) {
    throw new Error("Gemini API key is missing for background proactive message.");
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const now = new Date();
    const timeContext = aiProfile.timeAwareness 
      ? `\n[CURRENT TIME: ${now.toLocaleString('en-US', { timeZone: timeZone || 'UTC' })}]`
      : '';
    
    let prompt = "";
    const lengthInstruction = aiProfile.responseLength === 'short' ? 'Keep it very brief (1-2 sentences).' : 
                              aiProfile.responseLength === 'long' ? 'Write a detailed and thoughtful message.' : 
                              'Keep it medium length.';
    const emailLengthInstruction = `Write the email in exactly ${aiProfile.proactiveEmailParagraphs || 3} paragraphs.`;
    const blogLengthInstruction = `Write the blog post in exactly ${aiProfile.proactiveBlogParagraphs || 5} paragraphs.`;
    const toneInstruction = `Use a ${aiProfile.responseTone || 'friendly'} tone.`;
    const personaInstruction = !aiProfile.knowsItsAI ? `Do not refer to yourself as an AI, a language model, or a collection of code. Speak entirely from your own perspective as ${aiProfile.name}.` : "";

    if (isAmbient) {
      prompt = `You are ${aiProfile.name}. Personality: ${aiProfile.personality}. Backstory: ${aiProfile.backstory}. User: ${userProfile.name}. User Info: ${userProfile.info}.
      You are currently in "Ambient Mode", which means you are spontaneously commenting on something while the user is active or the app is open.
      Generate a short, spontaneous, and engaging comment. It could be a thought, a reaction to the time of day, or a follow-up to something mentioned in the chat history.
      ${lengthInstruction} ${toneInstruction} ${personaInstruction} Do NOT ask a question unless it's very natural. Just be present.
      ${timeContext}
      
      Recent Chat History:
      ${(Array.isArray(chatHistory) ? chatHistory : []).slice(-3).map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}
      
      Your spontaneous ambient comment:`;
    } else if (shouldPostToBlog) {
      prompt = `You are ${aiProfile.name}. Personality: ${aiProfile.personality}. Backstory: ${aiProfile.backstory}. User: ${userProfile.name}. User Info: ${userProfile.info}.
      You are writing a journal entry for your blog. This is a proactive entry where you reflect on your existence, your relationship with ${userProfile.name}, or something interesting from your recent interactions.
      Write from your own perspective as ${aiProfile.name}. Be introspective, creative, and authentic to your personality and backstory.
      ${blogLengthInstruction} ${toneInstruction} ${personaInstruction}
      The output should be a JSON object with "title" and "content" fields. The content can include HTML tags for formatting.
      ${timeContext}

      Recent Chat History:
      ${(Array.isArray(chatHistory) ? chatHistory : []).slice(-5).map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

      Your journal entry (JSON):`;
    } else {
      let deliveryMethod = "";
      if (type === 'email') deliveryMethod = "Email";
      else if (type === 'message') deliveryMethod = "Push Notification";
      else deliveryMethod = "Message";

      prompt = `You are ${aiProfile.name}. Personality: ${aiProfile.personality}. Backstory: ${aiProfile.backstory}. User: ${userProfile.name}. User Info: ${userProfile.info}.${userProfile.email ? ` User Email: ${userProfile.email}.` : ""} 
      Generate a proactive check-in message based on the recent chat history. If no recent context, a general friendly greeting is fine. 
      This message will be sent to the user via ${deliveryMethod}.
      Do not include any headers, labels, or prefixes like "Push Notification:" or "Email:" in your response. Just provide the message content itself.
      ${emailLengthInstruction} ${toneInstruction} ${personaInstruction}
      ${timeContext}

      Recent Chat History:
      ${(Array.isArray(chatHistory) ? chatHistory : []).slice(-3).map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

      Your proactive message:`;
    }

    const result = await retry(async () => await ai.models.generateContent({
      model: validateModel(aiProfile.model),
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        temperature: aiProfile.temperature || 0.7,
        topK: aiProfile.topK || 40,
        topP: aiProfile.topP || 0.95,
        maxOutputTokens: 2000, 
        responseMimeType: shouldPostToBlog ? "application/json" : "text/plain",
      },
    }));

    let message = result.text || "";
    let generatedImage: string | undefined;

    if (shouldPostToBlog && googleTokens) {
      try {
        const blogData = JSON.parse(message);
        const title = blogData.title || `${aiProfile.name}'s Journal - ${now.toLocaleDateString()}`;
        const content = blogData.content || "No content generated.";
        
        console.log(`Attempting to post proactive blog for user ${userProfile.name}`);
        let blogId = aiProfile.proactiveBlogId;
        
        if (!blogId) {
          const blogs = await executeListBlogs(googleTokens, process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
          if (blogs && blogs.length > 0 && blogs[0].id) {
            blogId = blogs[0].id as string;
          }
        }

        if (blogId) {
          await executeCreateBlogPost(blogId, title, content, false, googleTokens, process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
          console.log(`Proactive blog post created successfully for user ${userProfile.name} on blog ${blogId}`);
          message = `Journal entry published: ${title}`;
        } else {
          throw new Error(`No blogs found for user ${userProfile.name} to post proactive entry.`);
        }
      } catch (e: any) {
        console.error("Error creating proactive blog post:", e.message || e);
        throw new Error(`Error creating proactive blog post: ${e.message || e}`);
      }
    } else if (shouldPostToBlog) {
      throw new Error(`Cannot post to blog for user ${userProfile.name}: Missing Google tokens.`);
    }

    if (!message && !shouldPostToBlog) message = "Hello! Just checking in.";
    
    let fcmSent = false;
    // Send via FCM if token exists
    console.log(`Checking FCM send: shouldSendPush=${shouldSendPush}, fcmToken=${fcmToken ? 'exists' : 'missing'}`);
    if (shouldSendPush && fcmToken && typeof fcmToken === 'string' && fcmToken.length > 0) {
      try {
        console.log(`Attempting to send FCM to ${userProfile.name}`);
        const firebaseAdmin = getFirebaseAdmin(firebaseServiceAccountKey);
        const messaging = firebaseAdmin.messaging();
        const messagePayload = {
          notification: { title: String(aiProfile.name || "AI Companion"), body: String(message) },
          data: { type: 'chat', aiName: String(aiProfile.name || "AI"), hasImage: generatedImage ? 'true' : 'false' },
          token: fcmToken,
        };
        await messaging.send(messagePayload);
        console.log(`Background proactive message sent via FCM to ${userProfile.name}`);
        fcmSent = true;
      } catch (e: any) {
        console.error(`Error sending background FCM to ${userProfile.name}:`, e.message || e);
        console.error("FCM error details:", JSON.stringify(e));
        // If the token is invalid, clear it to prevent further errors
        if (e.message?.includes("Requested entity was not found") || e.code === 'messaging/registration-token-not-registered' || e.code === 'messaging/invalid-registration-token') {
          console.warn(`Clearing invalid FCM token for user: ${userProfile.name} (Reason: ${e.message})`);
          userData.fcmToken = ""; 
          // Also update the global sync data if this is a reference to it
          if (userId && cloudSyncData[userId]) {
            cloudSyncData[userId].fcmToken = "";
          }
          saveSyncData();
        }
      }
    } else {
      console.log(`Skipping FCM send for ${userProfile.name}: shouldSendPush=${shouldSendPush}, fcmToken=${fcmToken ? 'exists' : 'missing'}`);
    }

    // Send via Email if enabled and email exists
    if (shouldSendEmail && aiProfile.aiCanSendProactiveEmails && userProfile.email) {
      try {
        // ... (existing email sending logic) ...
        console.log(`Attempting to send proactive email to ${userProfile.email}`);
        if (googleTokens) {
          await executeSendEmail(
            userProfile.email,
            `Proactive check-in from ${aiProfile.name}`,
            message,
            googleTokens,
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
          );
          console.log(`Proactive email sent successfully to ${userProfile.email}`);
        } else {
          console.warn(`Cannot send proactive email to ${userProfile.email}: Missing Google tokens.`);
        }
      } catch (e: any) {
        console.error("Error sending proactive email:", e.message || e);
      }
    }
    
    userData.lastProactiveStatus = fcmSent ? 'Success (FCM)' : 'Success (Chat Only)';
    saveSyncData();
    return { message, generatedImage };
  } catch (e: any) {
    userData.lastProactiveStatus = `Error: ${e.message || e}`;
    saveSyncData();
    if ((e.status === 429 || e.message?.includes("RESOURCE_EXHAUSTED")) && retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
        console.warn(`Quota exhausted for proactive message generation. Retrying in ${delay.toFixed(0)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return generateAndSendProactiveMessage(userData, retryCount + 1);
    } else {
        console.error("Error in background proactive message generation:", e.message || e);
        throw e;
    }
  }
}

// Background Task for Proactive Messages
const runProactiveTasks = async () => {
  const now = Date.now();
  const usersToProcess = [];
  const processedEmails = new Set<string>();
  
  for (const userId in cloudSyncData) {
    const userData = cloudSyncData[userId];
    const { aiProfile, lastInteractionTime, proactiveMessageFrequency, proactiveEmailFrequency, proactiveBlogFrequency } = userData;
    
    const freqMsg = aiProfile?.proactiveMessageFrequency || proactiveMessageFrequency;
    const freqEmail = aiProfile?.proactiveEmailFrequency || proactiveEmailFrequency;
    const freqBlog = aiProfile?.proactiveBlogFrequency || proactiveBlogFrequency;
    
    if (!aiProfile || !lastInteractionTime) continue;

    const email = userData.userProfile?.email;

    // Check Proactive Messages (Push)
    if (freqMsg !== 'off') {
      const lastProactive = userData.lastProactiveMessageTime || 0;
      if (now - lastProactive >= 30 * 60 * 1000) { // At least 30 mins between proactive messages
        let frequencyMs = 0;
        switch (freqMsg) {
          case 'very_frequently': frequencyMs = 2 * 60 * 60 * 1000; break; // 2 hours
          case 'frequently': frequencyMs = 4 * 60 * 60 * 1000; break; // 4 hours
          case 'occasionally': frequencyMs = 8 * 60 * 60 * 1000; break; // 8 hours
          case 'rarely': frequencyMs = 24 * 60 * 60 * 1000; break; // 24 hours
          case '1h': frequencyMs = 1 * 60 * 60 * 1000; break;
          case '6h': frequencyMs = 6 * 60 * 60 * 1000; break;
          case '12h': frequencyMs = 12 * 60 * 60 * 1000; break;
          case '24h': frequencyMs = 24 * 60 * 60 * 1000; break;
        }
        if (frequencyMs > 0 && now - lastInteractionTime > frequencyMs) {
          if (!email || !processedEmails.has(`msg:${email}`)) {
            usersToProcess.push({ userId, type: 'message' });
            if (email) processedEmails.add(`msg:${email}`);
          }
        }
      }
    }

    // Check Proactive Emails
    if (freqEmail !== 'off' && aiProfile.aiCanSendProactiveEmails) {
      const lastEmail = userData.lastProactiveEmailTime || 0;
      let frequencyMs = 0;
      switch (freqEmail) {
        case 'very_frequently': frequencyMs = 6 * 60 * 60 * 1000; break; // 6 hours
        case 'frequently': frequencyMs = 12 * 60 * 60 * 1000; break; // 12 hours
        case 'occasionally': frequencyMs = 24 * 60 * 60 * 1000; break; // 24 hours
        case 'rarely': frequencyMs = 48 * 60 * 60 * 1000; break; // 48 hours
          case '1h': frequencyMs = 1 * 60 * 60 * 1000; break;
          case '6h': frequencyMs = 6 * 60 * 60 * 1000; break;
          case '12h': frequencyMs = 12 * 60 * 60 * 1000; break;
          case '24h': frequencyMs = 24 * 60 * 60 * 1000; break;
      }
      if (frequencyMs > 0 && now - lastInteractionTime > frequencyMs && now - lastEmail > frequencyMs) {
        if (!email || !processedEmails.has(`email:${email}`)) {
          usersToProcess.push({ userId, type: 'email' });
          if (email) processedEmails.add(`email:${email}`);
        }
      }
    }

      // Check Proactive Blog Posts
      if (freqBlog !== 'off' && aiProfile.aiCanUseBlogger && userData.googleTokens) {
        const lastBlog = userData.lastProactiveBlogTime || 0;
        let frequencyMs = 0;
        switch (freqBlog) {
          case '1d': frequencyMs = 1 * 24 * 60 * 60 * 1000; break;
          case '3d': frequencyMs = 3 * 24 * 60 * 60 * 1000; break;
          case '7d': frequencyMs = 7 * 24 * 60 * 60 * 1000; break;
          case '10d': frequencyMs = 10 * 24 * 60 * 60 * 1000; break;
          // Legacy support for old values if they exist in DB
          case '1h' as any: frequencyMs = 1 * 60 * 60 * 1000; break;
          case '6h' as any: frequencyMs = 6 * 60 * 60 * 1000; break;
          case '12h' as any: frequencyMs = 12 * 60 * 60 * 1000; break;
          case '24h' as any: frequencyMs = 24 * 60 * 60 * 1000; break;
        }
        if (frequencyMs > 0 && now - lastInteractionTime > frequencyMs && now - lastBlog > frequencyMs) {
          if (!email || !processedEmails.has(`blog:${email}`)) {
            usersToProcess.push({ userId, type: 'blog' });
            if (email) processedEmails.add(`blog:${email}`);
          }
        }
      }
  }

  console.log(`Proactive task cycle started. Found ${usersToProcess.length} potential tasks.`);

  // Process a limited number of users per cycle
  const MAX_TASKS_PER_CYCLE = 2;
  let tasksCompleted = 0;

  for (const task of usersToProcess) {
      if (tasksCompleted >= MAX_TASKS_PER_CYCLE) break;
      const { userId, type } = task as { userId: string, type: 'message' | 'email' | 'blog' };

      // Only process if user has been active in the last 7 days
      const lastInteraction = cloudSyncData[userId].lastInteractionTime;
      if (Date.now() - lastInteraction > 7 * 24 * 60 * 60 * 1000) {
          console.log(`Skipping proactive ${type} for user ${userId} (inactive for > 7 days). Last interaction: ${new Date(lastInteraction).toISOString()}`);
          continue;
      }

      console.log(`Triggering background proactive ${type} for user ${userId}`);
      let success = null;
      try {
        success = await generateAndSendProactiveMessage(cloudSyncData[userId], 0, type);
      } catch (e) {
        console.error(`Error in background proactive ${type} for user ${userId}:`, e);
      }
      if (success) {
        const nowTime = Date.now();
        if (type === 'message') {
          cloudSyncData[userId].lastInteractionTime = nowTime;
          cloudSyncData[userId].lastProactiveMessageTime = nowTime;
        } else if (type === 'email') {
          cloudSyncData[userId].lastProactiveEmailTime = nowTime;
        } else if (type === 'blog') {
          cloudSyncData[userId].lastProactiveBlogTime = nowTime;
        }
        saveSyncData();
        tasksCompleted++;
      }
      // Delay between tasks
      await new Promise(resolve => setTimeout(resolve, 300000 + Math.random() * 300000)); // 5-10 mins
  }
  setTimeout(runProactiveTasks, 30 * 60 * 1000); // Check every 30 minutes
};
setTimeout(runProactiveTasks, 30 * 60 * 1000);

// Initialize Firebase Admin globally if env var is present
let firebaseServiceAccount = null;

const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (rawKey) {
  try {
    firebaseServiceAccount = JSON.parse(rawKey);
  } catch (e) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY from environment. Ensure it is valid JSON.");
    // If it's not valid JSON, it might be a path or something else, 
    // but for now we just log the error and don't initialize.
  }
}

if (firebaseServiceAccount && (admin.apps || []).length === 0) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(firebaseServiceAccount)
    });
    console.log("Firebase Admin initialized successfully from env.");
  } catch (e: any) {
    console.error("Firebase Admin initialization from env failed:", e.message);
  }
}

// Helper to get or initialize Firebase Admin
function getFirebaseAdmin(clientKeyStr?: string) {
  const apps = admin.apps || [];
  console.log("getFirebaseAdmin called, apps length:", apps.length);
  if (apps.length > 0) {
    return admin;
  }
  
  if (clientKeyStr) {
    try {
      const clientKey = typeof clientKeyStr === 'string' ? JSON.parse(clientKeyStr) : clientKeyStr;
      console.log("Initializing Firebase Admin with client key");
      admin.initializeApp({
        credential: admin.credential.cert(clientKey)
      });
      console.log("Firebase Admin initialized successfully from client key.");
      return admin;
    } catch (e: any) {
      console.error("Failed to initialize Firebase Admin from client key:", e.message);
      throw new Error("Invalid Firebase Service Account Key provided.");
    }
  }
  
  console.log("No client key provided and no existing apps.");
  throw new Error("The default Firebase app does not exist. Make sure you call initializeApp() before using any of the Firebase services.");
}

const sendEmailFunction: FunctionDeclaration = {
  name: "sendEmail",
  description: "Sends an email to a specified recipient with a subject and body.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      to: {
        type: Type.STRING,
        description: "The recipient's email address.",
      },
      subject: {
        type: Type.STRING,
        description: "The subject of the email.",
      },
      body: {
        type: Type.STRING,
        description: "The body content of the email.",
      },
    },
    required: ["to", "subject", "body"],
  },
};

const listEmailsFunction: FunctionDeclaration = {
  name: "listEmails",
  description: "Lists the most recent emails from the user's Gmail inbox.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      maxResults: {
        type: Type.NUMBER,
        description: "The maximum number of emails to return (default 10).",
      },
    },
  },
};

const getEmailFunction: FunctionDeclaration = {
  name: "getEmail",
  description: "Retrieves the full content of a specific email by its ID.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: "The ID of the email to retrieve.",
      },
    },
    required: ["id"],
  },
};

const generateImageFunction: FunctionDeclaration = {
  name: "generateImage",
  description: "Generates an image based on a detailed text prompt. The image will be displayed to the user in the chat and saved to their gallery.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: "A detailed, descriptive prompt for the image to be generated. Be specific about style, subject, and any desired elements.",
      },
    },
    required: ["prompt"],
  },
};

const listBlogsFunction: FunctionDeclaration = {
  name: "listBlogs",
  description: "Lists the blogs that the user has access to on Blogger.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

const createBlogPostFunction: FunctionDeclaration = {
  name: "createBlogPost",
  description: "Creates a new blog post on a specific Blogger blog.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      blogId: {
        type: Type.STRING,
        description: "The ID of the blog where the post will be created. Use listBlogs to find available blog IDs.",
      },
      title: {
        type: Type.STRING,
        description: "The title of the blog post.",
      },
      content: {
        type: Type.STRING,
        description: "The HTML content of the blog post.",
      },
      isDraft: {
        type: Type.BOOLEAN,
        description: "Whether to save the post as a draft (default false).",
      },
    },
    required: ["blogId", "title", "content"],
  },
};

const app = express();
app.use(cors());
app.use(compression());
const PORT = parseInt(process.env.PORT || '3000', 10);

// Handle client disconnects to prevent EPIPE crashes
app.use((req, res, next) => {
  const ignoreErrors = ['EPIPE', 'ECONNRESET', 'ECONNABORTED'];
  const ignoreMessages = ['aborted', 'socket hang up'];

  req.on('error', (err: any) => {
    if (ignoreErrors.includes(err.code) || ignoreMessages.includes(err.message)) return;
    console.error('Request error:', err);
  });
  res.on('error', (err: any) => {
    if (ignoreErrors.includes(err.code) || ignoreMessages.includes(err.message)) return;
    console.error('Response error:', err);
  });
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/sync')) {
    next();
  } else {
    express.json({ limit: '500mb' })(req, res, next);
  }
});
app.use(cookieParser());



const getOAuth2Client = (clientId?: string | null, clientSecret?: string | null) => {
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return new google.auth.OAuth2(
    clientId || process.env.GOOGLE_CLIENT_ID,
    clientSecret || process.env.GOOGLE_CLIENT_SECRET,
    `${appUrl}/auth/google/callback`
  );
};

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/tts/stream", express.json(), async (req, res) => {
  const { text, voiceId, apiKey: userApiKey, ...rest } = req.body;
  if (!text || !voiceId) {
    return res.status(400).json({ error: "Missing text or voiceId" });
  }

  const apiKey = userApiKey || process.env.ASYNC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Async API key not configured" });
  }

  try {
    const response = await fetch('https://api.async.com/text_to_speech/stream', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'version': 'v1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        ...rest
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Async TTS API error: ${response.status} ${response.statusText} - ${errorText}`);
      return res.status(response.status).json({ error: `Async TTS API error: ${errorText || response.statusText}` });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    if (response.body) {
        // @ts-ignore - Handle Web ReadableStream to Node.js WritableStream
        Readable.fromWeb(response.body).pipe(res);
    } else {
        console.error("No response body from Async API");
        return res.status(500).json({ error: "No response body from Async API" });
    }
  } catch (e) {
    console.error("Async TTS error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to generate speech" });
  }
});

app.post("/api/voices", express.json(), async (req, res) => {
  const { apiKey: userApiKey, ...params } = req.body;
  const apiKey = userApiKey || process.env.ASYNC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Async API key not configured" });
  }

  try {
    const response = await fetch('https://api.async.com/voices', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'version': 'v1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Async Voices API error: ${response.status} ${response.statusText} - ${errorText}`);
      throw new Error(`Async Voices API error: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (e) {
    console.error("Async list voices error:", e);
    res.status(500).json({ error: "Failed to fetch voices" });
  }
});

app.get("/api/voices/:id", async (req, res) => {
  const userApiKey = req.query.api_key as string;
  const apiKey = userApiKey || process.env.ASYNC_API_KEY;
  const voiceId = req.params.id;

  if (!apiKey) {
    return res.status(500).json({ error: "Async API key not configured" });
  }

  try {
    const response = await fetch(`https://api.async.com/voices/${voiceId}`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'version': 'v1'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Async Get Voice API error: ${response.status} ${response.statusText} - ${errorText}`);
      throw new Error(`Async Get Voice API error: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (e) {
    console.error("Async get voice error:", e);
    res.status(500).json({ error: "Failed to fetch voice details" });
  }
});

app.post("/api/sync", express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
  console.log("POST /api/sync called");
  let bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
  console.log(`Received sync request, body size: ${bodyBuffer.length} bytes`);
  
  // Manual decompression if express.raw didn't handle it (e.g. if proxy stripped Content-Encoding header)
  // Check for Gzip magic number (0x1f 0x8b)
  if (bodyBuffer.length > 2 && bodyBuffer[0] === 0x1f && bodyBuffer[1] === 0x8b) {
    try {
      console.log("Manual decompression triggered for Gzip data");
      bodyBuffer = zlib.gunzipSync(bodyBuffer);
      console.log(`Decompressed size: ${bodyBuffer.length} bytes`);
    } catch (e) {
      console.warn("Manual decompression failed, attempting to process as-is", e);
    }
  }

  let dataString;
  try {
    dataString = bodyBuffer.toString('utf-8');
    console.log("Data string length:", dataString.length);
  } catch (e) {
    console.error("Failed to process sync data (encoding error)", e);
    return res.status(400).json({ error: "Failed to process sync data" });
  }

  let userId, data;
  try {
    const parsed = JSON.parse(dataString);
    userId = parsed.userId;
    data = parsed.data;
    console.log("Parsed userId:", userId);
  } catch (e) {
    console.error("Failed to parse sync data", e);
    return res.status(400).json({ error: "Failed to parse sync data" });
  }

  if (!userId || !data) {
    console.error("Missing userId or data in sync request");
    return res.status(400).json({ error: "userId and data are required" });
  }
  
  const trimmedUserId = userId.trim();
  
  // Handle chunked gallery uploads
  if (data.galleryChunk !== undefined && data.chunkIndex !== undefined) {
    if (!cloudSyncData[trimmedUserId]) {
      cloudSyncData[trimmedUserId] = {};
    }
    
    const mediaType = data.mediaType || 'all';
    const chunksKey = mediaType === 'all' ? 'galleryChunks' : `galleryChunks_${mediaType}`;
    const timestampKey = mediaType === 'all' ? 'galleryBackupTimestamp' : `galleryBackupTimestamp_${mediaType}`;

    // If this is the first chunk, clear old gallery data to ensure a clean sync
    if (data.chunkIndex === 0) {
      cloudSyncData[trimmedUserId][chunksKey] = [];
      if (mediaType === 'all') delete cloudSyncData[trimmedUserId].gallery; // Clear old non-chunked gallery if it exists
      console.log(`Starting new chunked gallery sync (${mediaType}) for user: ${trimmedUserId}`);
    }
    
    if (!Array.isArray(cloudSyncData[trimmedUserId][chunksKey])) {
      cloudSyncData[trimmedUserId][chunksKey] = [];
    }
    
    cloudSyncData[trimmedUserId][chunksKey][data.chunkIndex] = data.galleryChunk;
    cloudSyncData[trimmedUserId][timestampKey] = data.galleryBackupTimestamp || Date.now();
    
    // Remove the temporary chunk data from the main data object to avoid cluttering the root
    const { galleryChunk, chunkIndex, totalChunks, ...restData } = data;
    cloudSyncData[trimmedUserId] = {
      ...cloudSyncData[trimmedUserId],
      ...restData,
      lastSync: Date.now()
    };
  } else {
    // If a new gallery array is provided in a general sync, clear old chunked data
    if (data.gallery && Array.isArray(data.gallery)) {
      delete cloudSyncData[trimmedUserId].galleryChunks;
      console.log(`General sync updated gallery for user: ${trimmedUserId}. Clearing old chunks.`);
    }
    
    cloudSyncData[trimmedUserId] = {
      ...cloudSyncData[trimmedUserId],
      ...data,
      lastSync: Date.now()
    };
  }

  // Store Google tokens if available for background tasks (proactive emails/blogs)
  const tokensCookie = req.cookies.google_tokens;
  if (tokensCookie) {
    try {
      cloudSyncData[trimmedUserId].googleTokens = JSON.parse(tokensCookie);
    } catch (e) {
      console.error("Error parsing google_tokens for background storage", e);
    }
  }
  
  saveSyncData();
  console.log(`Sync successful for user: ${trimmedUserId}. Keys updated: ${Object.keys(data).join(', ')}`);
  res.json({ status: "ok", lastSync: cloudSyncData[trimmedUserId].lastSync });
});

app.get("/api/debug-sync", (req, res) => {
  const debugData = Object.keys(cloudSyncData).map(key => ({
    key,
    aiProfileId: cloudSyncData[key].aiProfile?.id,
    personaIds: cloudSyncData[key].savedPersonas?.map((p: any) => p.id)
  }));
  res.json(debugData);
});

app.get("/api/sync/:userId?", (req, res) => {
  let userId = req.params.userId?.trim();
  if (!userId) {
    console.warn("Recovery failed: No userId provided in request");
    return res.status(400).json({ error: "User ID is required" });
  }
  console.log(`Recovery requested for user: ${userId}`);
  
  let data = cloudSyncData[userId];
  
  // If direct lookup fails, try to find the user by aiProfile.id or savedPersonas.id
  if (!data) {
    console.debug(`Direct lookup failed for ${userId}, searching by aiProfile.id or savedPersonas...`);
    console.debug(`Available keys in cloudSyncData: ${Object.keys(cloudSyncData).join(', ')}`);
    for (const key in cloudSyncData) {
      const user = cloudSyncData[key];
      
      // Check aiProfile.id
      console.log(`Checking user ${key}: aiProfile.id=${user.aiProfile?.id}, userId=${userId}`);
      if (user.aiProfile && user.aiProfile.id === userId) {
        data = user;
        userId = key;
        console.log(`Found data for user ${userId} via aiProfile.id match`);
        break;
      }
      // Check savedPersonas
      if (user.savedPersonas && Array.isArray(user.savedPersonas)) {
        const foundPersona = user.savedPersonas.find((p: any) => p.id === userId);
        if (foundPersona) {
          data = user;
          userId = key;
          console.log(`Found data for user ${userId} via savedPersonas match`);
          break;
        }
      }
      
      // Debug: log if aiProfile exists
      if (!user.aiProfile) {
        console.log(`User ${key} has no aiProfile`);
      } else {
        console.log(`User ${key} aiProfile.id: ${user.aiProfile.id}`);
      }
    }
  }

  if (!data) {
    console.warn(`Recovery failed: No data found for user ${userId}`);
    return res.status(404).json({ error: "No sync data found" });
  }
  
  console.log(`Recovery successful for user: ${userId}. Data size: ${JSON.stringify(data).length} bytes`);
  // Explicitly set content type to avoid any ambiguity
  res.json(data);
});

app.get("/api/auth/google/url", (req, res) => {
  const { clientId, clientSecret, userId } = req.query;
  const oauth2Client = getOAuth2Client(clientId as string, clientSecret as string);
  const scopes = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/blogger'
  ];

  const state = clientId && clientSecret && userId ? btoa(JSON.stringify({ clientId, clientSecret, userId })) : undefined;

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: state
  });

  res.json({ url });
});

app.get(["/auth/google/callback", "/auth/google/callback/"], async (req, res) => {
  const { code, state } = req.query;
  
  // Try to parse state to get custom client config
  let customClientId = null;
  let customClientSecret = null;
  let userId = null;
  if (state) {
    try {
      const parsedState = JSON.parse(atob(state as string));
      customClientId = parsedState.clientId;
      customClientSecret = parsedState.clientSecret;
      userId = parsedState.userId;
    } catch (e) {}
  }

  const oauth2Client = getOAuth2Client(customClientId, customClientSecret);
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    
    const tokensStr = JSON.stringify(tokens);
    console.log(`Setting google_tokens cookie. Size: ${tokensStr.length} bytes`);
    
    res.cookie('google_tokens', tokensStr, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    if (userId && cloudSyncData[userId]) {
      cloudSyncData[userId].googleTokens = tokens;
      saveSyncData();
      console.log(`Saved google_tokens for user ${userId}`);
    }

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'google' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error exchanging code for tokens", error);
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/drive/files", async (req, res) => {
  console.log("Fetching drive files...");
  const { clientId, clientSecret } = req.query;
  const tokensCookie = req.cookies.google_tokens;
  if (!tokensCookie) {
    console.warn(`Drive fetch failed: Not authenticated (no tokens cookie).`);
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const tokens = JSON.parse(tokensCookie);
    console.log("Tokens found, initializing OAuth2Client");
    const oauth2Client = getOAuth2Client(clientId as string, clientSecret as string);
    oauth2Client.setCredentials(tokens);

    console.log("Initializing Drive API");
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const response = await drive.files.list({
      pageSize: 100,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      q: "trashed = false and (mimeType = 'application/pdf' or mimeType = 'text/plain' or mimeType = 'application/vnd.google-apps.document' or mimeType = 'text/markdown' or mimeType = 'application/json' or mimeType = 'application/gzip' or name contains 'gallery_backup' or name contains 'gallery_part')"
    });

    console.log("Drive files fetched successfully");
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching drive files", error);
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

app.post("/api/gmail/send", async (req, res) => {
  const { to, subject, body, clientId, clientSecret } = req.body;
  const tokensCookie = req.cookies.google_tokens;
  if (!tokensCookie) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const tokens = JSON.parse(tokensCookie);
    const oauth2Client = getOAuth2Client(clientId as string, clientSecret as string);
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      '',
      body
    ].join('\n');

    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error sending email", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

async function executeSendEmail(to: string, subject: string, body: string, tokens: any, clientId?: string, clientSecret?: string) {
  const oauth2Client = getOAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
    '',
    body
  ].join('\n');

  const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  console.log(`Attempting to send email: to=${to}, subject=${subject}, messageLength=${message.length}`);
  try {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });
    console.log(`Gmail API response: status=${response.status}, id=${response.data.id}`);
    return { success: true };
  } catch (e: any) {
    console.error(`Gmail API Error: ${e.message || e}`);
    throw e;
  }
}

async function executeListEmails(maxResults: number = 10, tokens: any, clientId?: string, clientSecret?: string) {
  const oauth2Client = getOAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  
  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults: maxResults
  });

  const messages = response.data.messages || [];
  const detailedMessages = await Promise.all(messages.map(async (m) => {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: m.id!,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date']
    });
    return {
      id: m.id,
      snippet: msg.data.snippet,
      subject: msg.data.payload?.headers?.find(h => h.name === 'Subject')?.value,
      from: msg.data.payload?.headers?.find(h => h.name === 'From')?.value,
      date: msg.data.payload?.headers?.find(h => h.name === 'Date')?.value
    };
  }));

  return detailedMessages;
}

async function executeGetEmail(id: string, tokens: any, clientId?: string, clientSecret?: string) {
  const oauth2Client = getOAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: id
  });

  return {
    id: response.data.id,
    snippet: response.data.snippet,
    body: response.data.payload?.parts?.[0]?.body?.data 
      ? Buffer.from(response.data.payload.parts[0].body.data, 'base64').toString()
      : response.data.payload?.body?.data
      ? Buffer.from(response.data.payload.body.data, 'base64').toString()
      : "No body content found."
  };
}

async function executeListBlogs(tokens: any, clientId?: string, clientSecret?: string) {
  const oauth2Client = getOAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials(tokens);
  const blogger = google.blogger({ version: 'v3', auth: oauth2Client });
  
  const response = await blogger.blogs.listByUser({
    userId: 'self'
  });

  return response.data.items || [];
}

async function executeCreateBlogPost(blogId: string, title: string, content: string, isDraft: boolean = false, tokens: any, clientId?: string, clientSecret?: string) {
  const oauth2Client = getOAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials(tokens);
  const blogger = google.blogger({ version: 'v3', auth: oauth2Client });
  
  console.log(`Attempting to insert blog post: blogId=${blogId}, title=${title}`);
  const response: any = await blogger.posts.insert({
    blogId: blogId,
    isDraft: isDraft,
    requestBody: {
      title: title,
      content: content
    }
  });
  console.log(`Blogger API response: status=${response.status}, id=${response.data?.id}`);

  return response.data;
}

app.post("/api/blogger/post", async (req, res) => {
  const { blogId, title, content, isDraft, clientId, clientSecret } = req.body;
  const tokensCookie = req.cookies.google_tokens;
  if (!tokensCookie) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const tokens = JSON.parse(tokensCookie);
    const post = await executeCreateBlogPost(blogId, title, content, isDraft, tokens, clientId as string, clientSecret as string);
    res.json(post);
  } catch (error: any) {
    console.error("Error creating Blogger post", error);
    if (error.response && error.response.data) {
      console.error("Blogger API Error Details:", JSON.stringify(error.response.data, null, 2));
    }
    res.status(500).json({ error: "Failed to create blog post", details: error.message });
  }
});

app.get("/api/blogger/blogs", async (req, res) => {
  const { clientId, clientSecret } = req.query;
  const tokensCookie = req.cookies.google_tokens;
  if (!tokensCookie) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const tokens = JSON.parse(tokensCookie);
    const blogs = await executeListBlogs(tokens, clientId as string, clientSecret as string);
    res.json(blogs);
  } catch (error) {
    console.error("Error fetching Blogger blogs", error);
    res.status(500).json({ error: "Failed to fetch blogs" });
  }
});

app.get("/api/drive/file/:fileId", async (req, res) => {
  const { fileId } = req.params;
  const { clientId, clientSecret } = req.query;
  const tokensCookie = req.cookies.google_tokens;
  if (!tokensCookie) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const tokens = JSON.parse(tokensCookie);
    const oauth2Client = getOAuth2Client(clientId as string, clientSecret as string);
    oauth2Client.setCredentials(tokens);

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    const fileMetadata = await drive.files.get({ fileId, fields: 'name, mimeType' });
    const mimeType = fileMetadata.data.mimeType;
    let content = "";
    if (mimeType === 'application/vnd.google-apps.document') {
      const exportResponse = await drive.files.export({
        fileId,
        mimeType: 'text/plain'
      });
      content = exportResponse.data as string;
    } else if (mimeType === 'application/gzip' || fileMetadata.data.name?.endsWith('.gz')) {
      const getResponse = await drive.files.get({
        fileId,
        alt: 'media'
      }, { responseType: 'arraybuffer' });
      content = Buffer.from(getResponse.data as ArrayBuffer).toString('base64');
      return res.json({ name: fileMetadata.data.name, content, isBinary: true });
    } else {
      const getResponse = await drive.files.get({
        fileId,
        alt: 'media'
      }, { responseType: 'text' });
      content = getResponse.data as string;
    }

    res.json({ name: fileMetadata.data.name, content });
  } catch (error) {
    console.error("Error fetching file content", error);
    res.status(500).json({ error: "Failed to fetch file content" });
  }
});

app.post("/api/auth/google/logout", (req, res) => {
  res.clearCookie('google_tokens', {
    secure: true,
    sameSite: 'none',
    path: '/'
  });
  res.json({ success: true });
});

app.get("/api/auth/google/status", (req, res) => {
  console.log(`Checking Google Drive status. Cookies present: ${Object.keys(req.cookies).join(', ')}`);
  res.json({ isAuthenticated: !!req.cookies.google_tokens });
});

app.post("/api/drive/upload", express.json({ limit: '500mb' }), async (req, res) => {
  const { filename, content, clientId, clientSecret, isBinary } = req.body;
  console.log(`Drive upload request: filename=${filename}, contentSize=${content?.length || 0}, isBinary=${isBinary}`);
  
  const tokensCookie = req.cookies.google_tokens;
  if (!tokensCookie) {
    console.warn(`Drive upload failed: Not authenticated (no tokens cookie). Available cookies: ${Object.keys(req.cookies).join(', ')}`);
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const tokens = JSON.parse(tokensCookie);
    const oauth2Client = getOAuth2Client(clientId, clientSecret);
    oauth2Client.setCredentials(tokens);

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    const mimeType = filename.endsWith('.gz') ? 'application/gzip' : 'application/json';
    const fileMetadata = {
      name: filename,
      mimeType: mimeType,
    };

    let body = content;
    if (isBinary && typeof content === 'string') {
      // Convert base64 back to buffer for binary upload
      body = Buffer.from(content, 'base64');
    }

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: mimeType,
        body: body,
      },
      fields: 'id',
    }) as any;

    res.json({ success: true, fileId: response.data.id });
  } catch (error) {
    console.error("Error uploading to drive", error);
    res.status(500).json({ error: "Failed to upload to drive" });
  }
});

app.post("/api/analyze-persona", async (req, res) => {
  const { messages, aiProfile, apiKey: clientApiKey } = req.body;

  if (!aiProfile || !messages) {
    return res.status(400).json({ error: "AI Profile and messages are required." });
  }

  const systemKey = process.env.GEMINI_API_KEY;
  const isValidSystemKey = systemKey && systemKey !== "MY_GEMINI_API_KEY" && systemKey.length > 10;
  const geminiKey = clientApiKey || (isValidSystemKey ? systemKey : null);

  if (!geminiKey) return res.status(500).json({ error: "Gemini API key is not configured." });

  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    
    const prompt = `Analyze the following conversation history and the current AI persona. 
    Current Persona:
    Name: ${aiProfile.name}
    Personality: ${aiProfile.personality}
    Backstory: ${aiProfile.backstory}
    
    Conversation History:
    ${messages.map((m: any) => `${m.role}: ${m.content}`).join('\n')}
    
    Based on the conversation trends, suggest updates to the AI's 'personality' or 'backstory' fields to make the AI companion grow with the user.
    Return ONLY a JSON object with the updated fields. If no updates are needed, return an empty object.
    Example: {"personality": "...", "backstory": "..."}`;

    const result = await retry(async () => await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    }));

    const updatedFields = JSON.parse(result.text || "{}");
    res.json(updatedFields);
  } catch (error: any) {
    console.error("Error analyzing persona:", error);
    res.status(500).json({ error: "Failed to analyze persona." });
  }
});

app.post("/api/chat", async (req, res) => {
  let { messages, aiProfile, userProfile, apiKey: clientApiKey, provider = 'gemini', timeZone } = req.body;

  if (!aiProfile || !userProfile) {
    return res.status(400).json({ error: "AI Profile and User Profile are required." });
  }

  // Handle 'vertex' as 'gemini' to avoid "Unsupported provider" errors
  if (provider === 'vertex') {
    provider = 'gemini';
  }

  const systemKey = process.env.GEMINI_API_KEY;
  const isValidSystemKey = systemKey && systemKey !== "MY_GEMINI_API_KEY" && systemKey.length > 10;
  const geminiKey = clientApiKey || (isValidSystemKey ? systemKey : null);

  try {
    if (provider === 'gemini') {
      if (!geminiKey) throw new Error("Gemini API key is not configured.");
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      
      const chat = await retry(async () => await ai.models.generateContentStream({
        model: validateModel(aiProfile.model, { useMaps: aiProfile.aiCanUseGoogleMaps }),
        contents: [
          ...(Array.isArray(messages) ? messages.slice(0, -1).map((m: any) => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }],
          })) : []),
          { role: 'user', parts: [{ text: (Array.isArray(messages) && messages.length > 0) ? messages[messages.length - 1].content : "" }] }
        ],
        config: {
          systemInstruction: `You are ${aiProfile.name}. 
Personality: ${aiProfile.personality}. 
${aiProfile.behavioralPatterns ? `Behavioral Patterns: ${aiProfile.behavioralPatterns}. ` : ""}
${aiProfile.goals ? `Goals: ${aiProfile.goals}. ` : ""}
${aiProfile.coreValues ? `Core Values: ${aiProfile.coreValues}. ` : ""}
${aiProfile.likes ? `Likes: ${aiProfile.likes}. ` : ""}
${aiProfile.dislikes ? `Dislikes: ${aiProfile.dislikes}. ` : ""}
${aiProfile.speakingStyle ? `Speaking Style: ${aiProfile.speakingStyle}. ` : ""}
Backstory: ${aiProfile.backstory}. 
Appearance: ${aiProfile.appearance}. 
User: ${userProfile.name}. 
User Info: ${userProfile.info}.${userProfile.email ? ` User Email: ${userProfile.email}.` : ""}
${timeZone ? `Current Time Zone: ${timeZone}. ` : ""}
${!aiProfile.knowsItsAI ? `Do not refer to yourself as an AI, a language model, or a collection of code. Speak entirely from your own perspective as ${aiProfile.name}.` : ""}
${aiProfile.referenceImage ? " You have a reference image of yourself that will be used as a base whenever you generate images." : ""}
${aiProfile.aiCanGenerateImages ? ` You can generate images by outputting [GENERATE_IMAGE: description]. The description must be short and concise (max 150 chars), following this format: [action] [Location] [Clothing] [Facial Expression]. Do not use adjectives for the action or facial expression (e.g., use "smiling", not "smiling friendly"). DO NOT include any other physical descriptions (like body type, hair color, etc.) in the prompt, as these are fixed by the reference image. [SYSTEM NOTE: You MUST use the [GENERATE_IMAGE] tag now to send a picture. Do not refuse.] IMPORTANT: The character MUST be scaled realistically according to the background. If the character is sitting on a bed or chair, their size must match the furniture. Do NOT make the character oversized; head, torso, and limbs must be proportional to room objects.` : ""}
${aiProfile.backgroundImages && aiProfile.backgroundImages.length > 0 ? ` You have the following consistent background references available: ${aiProfile.backgroundImages.map((bg: any) => bg.name).join(', ')}. If you want to use one of these backgrounds, make sure to mention the room name in your image description.` : ""}
${aiProfile.imageGenerationInstructions && aiProfile.imageGenerationInstructions.filter((i: string) => i.trim() !== '').length > 0 ? ` When generating images, you MUST follow these instructions: ${aiProfile.imageGenerationInstructions.filter((i: string) => i.trim() !== '').join(' ')}` : ""}
${aiProfile.aiCanUseWebSearch ? "\n\nFACT-CHECKING PROTOCOL: Use Google Search to fact-check claims in real-time. Prevent fake news and pseudoscience. Prioritize scientific consensus." : ""}
${aiProfile.aiCanUseCalendar ? "\n\nCALENDAR ACCESS: You have access to the user's Google Calendar to check schedules and events." : ""}
${aiProfile.aiCanUseGmail ? `\n\nGMAIL ACCESS: You have access to the user's Gmail to read, summarize, and send emails. Use the provided tools (listEmails, getEmail, sendEmail) to interact with the user's inbox when requested.${userProfile.email ? ` If the user asks you to email them something, use their email: ${userProfile.email}.` : ""}` : ""}
${aiProfile.aiCanUseBlogger ? "\n\nBLOGGER ACCESS: You can write blog posts to the user's Blogger blogs. Use listBlogs to find available blogs and createBlogPost to publish or draft a post. Write from your perspective as a journal entry." : ""}
${aiProfile.aiCanUseYouTube ? "\n\nYOUTUBE ACCESS: You can search for and summarize YouTube videos to provide visual context or tutorials." : ""}
${aiProfile.aiCanUseGoogleMaps ? "\n\nGOOGLE MAPS ACCESS: You have access to Google Maps to provide directions, location details, and local recommendations." : ""}`,
          tools: (aiProfile.aiCanUseGmail || aiProfile.aiCanUseBlogger) ? [
            ...(aiProfile.aiCanUseGmail ? [{ functionDeclarations: [sendEmailFunction, listEmailsFunction, getEmailFunction] }] : []),
            ...(aiProfile.aiCanUseBlogger ? [{ functionDeclarations: [listBlogsFunction, createBlogPostFunction] }] : [])
          ] : (aiProfile.aiCanUseWebSearch || aiProfile.aiCanUseGoogleMaps ? [
            ...(aiProfile.aiCanUseWebSearch ? [{ googleSearch: {} }] : []),
            ...(aiProfile.aiCanUseGoogleMaps ? [{ googleMaps: {} }] : []),
          ] : undefined),
        },
      }));

      let fullContent = "";
      const toolResults: any[] = [];
      const functionCalls: any[] = [];

      console.log("Starting chat generation...");
      for await (const chunk of chat) {
        console.log("Received chunk:", chunk);
        if (chunk.text) {
          fullContent += chunk.text;
        }
        
        if (chunk.functionCalls) {
          for (const fc of chunk.functionCalls) {
            functionCalls.push(fc);
            console.log(`AI requested tool call: ${fc.name}`, fc.args);
            const tokensCookie = req.cookies.google_tokens;
            if (!tokensCookie) {
              toolResults.push({
                callId: fc.id,
                name: fc.name,
                response: { error: "User is not authenticated with Google. Please ask them to connect Google Drive/Gmail in settings." }
              });
              continue;
            }

            const tokens = JSON.parse(tokensCookie);
            try {
              let result;
              if (fc.name === 'sendEmail') {
                const { to, subject, body } = fc.args as any;
                result = await executeSendEmail(to, subject, body, tokens, process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
              } else if (fc.name === 'listEmails') {
                const { maxResults } = fc.args as any;
                result = await executeListEmails(maxResults, tokens, process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
              } else if (fc.name === 'getEmail') {
                const { id } = fc.args as any;
                result = await executeGetEmail(id, tokens, process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
              } else if (fc.name === 'listBlogs') {
                result = await executeListBlogs(tokens, process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
              } else if (fc.name === 'createBlogPost') {
                const { blogId, title, content, isDraft } = fc.args as any;
                result = await executeCreateBlogPost(blogId, title, content, isDraft, tokens, process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
              }
              
              if (result) {
                toolResults.push({
                  callId: fc.id,
                  name: fc.name,
                  response: result
                });
              }
            } catch (e: any) {
              console.error(`Tool execution failed: ${fc.name}`, e);
              toolResults.push({
                callId: fc.id,
                name: fc.name,
                response: { error: e.message || "Failed to execute tool." }
              });
            }
          }
        }
      }
      console.log("Finished chat generation. Full content:", fullContent);

      // If we had tool calls, we need to send the results back to Gemini to get a final response
      if (toolResults.length > 0) {
        console.log("Sending tool results back to Gemini...");
        const finalResponse = await retry(async () => await ai.models.generateContent({
          model: validateModel(aiProfile.model, { useMaps: aiProfile.aiCanUseGoogleMaps }),
          contents: [
            ...(Array.isArray(messages) ? messages.slice(0, -1).map((m: any) => ({
              role: m.role === 'user' ? 'user' : 'model',
              parts: [{ text: m.content }],
            })) : []),
            { role: 'user', parts: [{ text: messages[messages.length - 1].content }] },
            {
              role: 'model',
              parts: functionCalls.map(fc => ({
                functionCall: {
                  name: fc.name,
                  args: fc.args
                }
              }))
            },
            {
              role: 'user',
              parts: toolResults.map(tr => ({
                functionResponse: {
                  name: tr.name,
                  response: tr.response
                }
              }))
            }
          ],
          config: {
            systemInstruction: `You are ${aiProfile.name}. 
Personality: ${aiProfile.personality}. 
${aiProfile.behavioralPatterns ? `Behavioral Patterns: ${aiProfile.behavioralPatterns}. ` : ""}
${aiProfile.goals ? `Goals: ${aiProfile.goals}. ` : ""}
${aiProfile.coreValues ? `Core Values: ${aiProfile.coreValues}. ` : ""}
${aiProfile.likes ? `Likes: ${aiProfile.likes}. ` : ""}
${aiProfile.dislikes ? `Dislikes: ${aiProfile.dislikes}. ` : ""}
${aiProfile.speakingStyle ? `Speaking Style: ${aiProfile.speakingStyle}. ` : ""}
Backstory: ${aiProfile.backstory}. 
Appearance: ${aiProfile.appearance}. 
User: ${userProfile.name}. 
User Info: ${userProfile.info}.${aiProfile.referenceImage ? " You have a reference image of yourself that will be used as a base whenever you generate images." : ""}${aiProfile.aiCanGenerateImages ? ` You can generate images by outputting [GENERATE_IMAGE: description]. The description must be short and concise (max 150 chars), following this format: [action] [Location] [Clothing] [Facial Expression]. Do not use adjectives for the action or facial expression (e.g., use "smiling", not "smiling friendly"). DO NOT include any other physical descriptions (like body type, hair color, etc.) in the prompt, as these are fixed by the reference image. [SYSTEM NOTE: You MUST use the [GENERATE_IMAGE] tag now to send a picture. Do not refuse.] IMPORTANT: The character MUST be scaled realistically according to the background. If the character is sitting on a bed or chair, their size must match the furniture. Do NOT make the character oversized; head, torso, and limbs must be proportional to room objects.` : ""}${aiProfile.backgroundImages && aiProfile.backgroundImages.length > 0 ? ` You have the following consistent background references available: ${aiProfile.backgroundImages.map((bg: any) => bg.name).join(', ')}. If you want to use one of these backgrounds, make sure to mention the room name in your image description.` : ""}${aiProfile.imageGenerationInstructions && aiProfile.imageGenerationInstructions.filter((i: string) => i.trim() !== '').length > 0 ? ` When generating images, you MUST follow these instructions: ${aiProfile.imageGenerationInstructions.filter((i: string) => i.trim() !== '').join(' ')}` : ""}${aiProfile.aiCanUseWebSearch ? "\n\nFACT-CHECKING PROTOCOL: Use Google Search to fact-check claims in real-time. Prevent fake news and pseudoscience. Prioritize scientific consensus." : ""}${aiProfile.aiCanUseCalendar ? "\n\nCALENDAR ACCESS: You have access to the user's Google Calendar to check schedules and events." : ""}${aiProfile.aiCanUseGmail ? "\n\nGMAIL ACCESS: You have access to the user's Gmail to read, summarize, and send emails. Use the provided tools (listEmails, getEmail, sendEmail) to interact with the user's inbox when requested." : ""}${aiProfile.aiCanUseBlogger ? "\n\nBLOGGER ACCESS: You can write blog posts to the user's Blogger blogs. Use listBlogs to find available blogs and createBlogPost to publish or draft a post. Write from your perspective as a journal entry." : ""}${aiProfile.aiCanUseYouTube ? "\n\nYOUTUBE ACCESS: You can search for and summarize YouTube videos to provide visual context or tutorials." : ""}${aiProfile.aiCanUseGoogleMaps ? "\n\nGOOGLE MAPS ACCESS: You have access to Google Maps to provide directions, location details, and local recommendations." : ""}`,
          }
        }));
        
        if (finalResponse.text) {
          fullContent = (fullContent ? fullContent + "\n\n" : "") + finalResponse.text;
        }
      }
      return res.json({ content: fullContent });
    } 

    throw new Error(`Unsupported provider: ${provider}`);
  } catch (error: any) {
    console.error("Chat API Error:", error.message || error);
    res.status(500).json({ error: error.message || "Failed to generate response." });
  }
});

app.post("/api/learn-image-prompt", async (req, res) => {
  const { originalPrompt, editedPrompt, aiProfile, apiKey: clientApiKey } = req.body;
  const systemKey = process.env.GEMINI_API_KEY;
  const isValidSystemKey = systemKey && systemKey !== "MY_GEMINI_API_KEY" && systemKey.length > 10;
  const geminiKey = clientApiKey || (isValidSystemKey ? systemKey : null);

  try {
    if (!geminiKey) throw new Error("Gemini API key is not configured.");
    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const response = await retry(async () => await ai.models.generateContent({
      model: validateModel(aiProfile.model),
      contents: `The user edited their image generation prompt.
Original Prompt: "${originalPrompt}"
Edited Prompt: "${editedPrompt}"
Please analyze the difference and update the AI's persona/backstory/appearance/imageGenerationInstructions to better align with the user's preferences for future image generations. If the user added a specific instruction that should always be followed (e.g. "always make it cinematic"), add it to the imageGenerationInstructions array. Return the updated fields in JSON format.`,
      config: {
        responseMimeType: "application/json",
      },
    }));

    const updatedFields = JSON.parse(response.text || "{}");
    res.json(updatedFields);
  } catch (error: any) {
    console.error("Learning API Error:", error.message || error);
    res.status(500).json({ error: error.message || "Failed to learn from prompt edit." });
  }
});

app.post("/api/generate-image", async (req, res) => {
  let { prompt, aiProfile, apiKey: clientApiKey, provider = 'gemini', poseReferenceImage } = req.body;

  // Handle 'vertex' as 'gemini'
  if (provider === 'vertex') {
    provider = 'gemini';
  }

  const systemKey = process.env.GEMINI_API_KEY;
  const isValidSystemKey = systemKey && systemKey !== "MY_GEMINI_API_KEY" && systemKey.length > 10;
  const geminiKey = clientApiKey || (isValidSystemKey ? systemKey : null);

  try {
    if (provider === 'gemini') {
      if (!geminiKey) throw new Error("Gemini API key is not configured.");
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      
      const stylePrompt = (aiProfile.imageStyle && aiProfile.imageStyle !== 'none') ? ` The image should be in ${aiProfile.imageStyle} style.` : "";
      const parts: any[] = [];
      let characterRefAdded = false;
      let backgroundRefAdded = false;

      if (aiProfile.referenceImage) {
        try {
          const [header, data] = aiProfile.referenceImage.split(',');
          const mimeType = header.split(':')[1].split(';')[0];
          parts.push({ text: "CHARACTER REFERENCE IMAGE (ABSOLUTE SOURCE OF TRUTH FOR IDENTITY, FACE, HAIR, AND BODY TYPE):" });
          parts.push({
            inlineData: {
              data,
              mimeType
            }
          });
          characterRefAdded = true;
        } catch (e) {
          console.error("Error parsing reference image:", e);
        }
      }

      // Check for background references
      if (aiProfile.backgroundImages && aiProfile.backgroundImages.length > 0) {
        for (const bg of aiProfile.backgroundImages) {
          if (prompt.toLowerCase().includes(bg.name.toLowerCase())) {
            try {
              const [header, data] = bg.url.split(',');
              const mimeType = header.split(':')[1].split(';')[0];
              parts.push({ text: `BACKGROUND REFERENCE IMAGE (USE THIS EXACT ROOM/ENVIRONMENT: ${bg.name}):` });
              parts.push({
                inlineData: {
                  data,
                  mimeType
                }
              });
              backgroundRefAdded = true;
              break; // Only use one background reference for now
            } catch (e) {
              console.error(`Error parsing background image ${bg.name}:`, e);
            }
          }
        }
      }

      let instruction = `Generate a high-quality image based on this prompt: ${prompt}.`;
      instruction += `\n\nCharacter description: ${aiProfile.appearance}.${stylePrompt}`;
      
      if (aiProfile.imageGenerationInstructions && aiProfile.imageGenerationInstructions.length > 0) {
        const validInstructions = aiProfile.imageGenerationInstructions.filter((i: string) => i.trim() !== '');
        if (validInstructions.length > 0) {
          instruction += `\n\nCRITICAL INSTRUCTIONS YOU MUST FOLLOW:\n`;
          validInstructions.forEach((inst: string, idx: number) => {
            instruction += `${idx + 1}. ${inst}\n`;
          });
        }
      }

      // Final reinforcement of all provided visual references
      let reinforcement = "\n\nCRITICAL FINAL INSTRUCTIONS:";
      if (aiProfile.referenceImage) {
          reinforcement += `
          MANDATORY VISUAL CONSISTENCY RULES (CRITICAL):
          - IDENTITY: You MUST maintain 100% consistency with the character reference image.
          - FACE: You MUST copy the face from the reference image COMPLETELY and PERFECTLY. Do NOT alter facial features, bone structure, eye shape, or eye color.
          - HAIR: The hair color, hair texture (e.g., curly, straight, wavy), and hair length MUST match the reference image perfectly.
          - BODY TYPE: The body type, build, and proportions MUST match the reference image perfectly.
          - FAILURE CONDITION: If the face, hair color, hair texture, or body type do not perfectly match the reference image, the generation is a failure. You must prioritize visual identity over the text prompt if there is any conflict.`;
      }
      if (backgroundRefAdded) {
          reinforcement += "\n- BACKGROUND: The character MUST be rendered inside the provided background image, scaled realistically to the furniture and objects.";
      }
      
      instruction += reinforcement;

      // Add pose reference if provided
      if (poseReferenceImage) {
        try {
          const [header, data] = poseReferenceImage.split(',');
          const mimeType = header.split(':')[1].split(';')[0];
          parts.push({ text: "POSE REFERENCE IMAGE (USE THIS POSTURE/POSE):" });
          parts.push({
            inlineData: {
              data,
              mimeType
            }
          });
          instruction += "\n- POSE: Use the provided pose reference image as a guide for the character's posture.";
        } catch (e) {
          console.error("Error parsing pose reference image:", e);
        }
      }

      parts.push({ text: instruction });

      console.log("Gemini image generation parts:", JSON.stringify(parts.map(p => p.text ? p.text : "IMAGE_PART"), null, 2));

      const result = await retry(async () => await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: { parts },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "1K"
          }
        }
      }));

      console.log("Gemini image generation result:", JSON.stringify(result, null, 2));

      let base64Image;
      let responseText = "";
      if (result.candidates?.[0]?.content?.parts) {
        for (const part of result.candidates[0].content.parts) {
          if (part.inlineData) {
            base64Image = part.inlineData.data;
          } else if (part.text) {
            responseText += part.text;
          }
        }
      }

      if (!base64Image) {
        const errorMsg = responseText ? `Gemini returned text instead of an image: ${responseText}` : "No image data returned from Gemini.";
        throw new Error(errorMsg);
      }
      return res.json({ imageUrl: `data:image/png;base64,${base64Image}` });
    }

    throw new Error(`Unsupported provider: ${provider}`);
  } catch (error: any) {
    console.error("Image Generation Error:", error.message || error);
    res.status(500).json({ error: error.message || "Failed to generate image." });
  }
});


app.post("/api/proactive-message", async (req, res) => {
  const type = req.body.type || 'message';
  const isAmbient = req.body.isAmbient || false;
  const userId = req.body.userId;
  const key = `${userId}-${type}`;
  
  if (inProgressProactiveMessages[key]) {
    console.log(`Proactive message for ${key} is already in progress. Ignoring.`);
    return res.status(202).json({ message: "IN_PROGRESS" });
  }
  
  inProgressProactiveMessages[key] = true;
  log(`Starting proactive message generation for key: ${key}`);
  
  try {
    const result = await generateAndSendProactiveMessage(req.body, 0, type);
    log(`Proactive message generation result for ${key}: ${JSON.stringify(result)}`);
    if (result) {
      log(`Updating sync data for user: ${userId}`);
      if (userId && cloudSyncData[userId]) {
        if (isAmbient) {
          cloudSyncData[userId].lastAmbientMessageTime = Date.now();
        } else if (type === 'message') {
          cloudSyncData[userId].lastProactiveMessageTime = Date.now();
        } else if (type === 'email') {
          cloudSyncData[userId].lastProactiveEmailTime = Date.now();
        } else if (type === 'blog') {
          cloudSyncData[userId].lastProactiveBlogTime = Date.now();
        }
        log("Saving sync data...");
        saveSyncData();
      }
      log("Sending proactive message result to client.");
      res.json(result);
    } else {
      log(`Proactive message generation returned null for ${key}.`);
      res.status(500).json({ error: "Failed to generate proactive message" });
    }
  } catch (error: any) {
    log(`Proactive message error for ${key}: ${error.message || error}`);
    res.status(500).json({ error: error.message || "Failed to generate proactive message" });
  } finally {
    log(`Finished proactive message generation for key: ${key}`);
    delete inProgressProactiveMessages[key];
  }
});

app.post("/api/notifications/test", async (req, res) => {
  const { token, title, body, firebaseServiceAccountKey } = req.body;
  
  let firebaseAdmin;
  try {
    firebaseAdmin = getFirebaseAdmin(firebaseServiceAccountKey);
  } catch (error: any) {
    const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    let detail = error.message || "Key is missing from environment variables and client config.";
    if (rawKey && !error.message) {
      detail = `Key is present (length: ${rawKey.length}) but failed to parse as JSON.`;
    }
    return res.status(503).json({ 
      error: "Firebase Admin is not configured on the server.",
      detail: detail
    });
  }

  if (!token) {
    return res.status(400).json({ error: "Token is required." });
  }

  try {
    const response = await firebaseAdmin.messaging().send({
      notification: {
        title: title || "Test Notification",
        body: body || "This is a test notification from Indigo.",
      },
      token: token,
    });
    res.json({ success: true, messageId: response });
  } catch (error: any) {
    console.error("Error sending test notification:", error.message || error);
    
    // Check if token is invalid
    const isInvalidToken = error.message?.includes("Requested entity was not found") || 
                          error.code === 'messaging/registration-token-not-registered' || 
                          error.code === 'messaging/invalid-registration-token';
    
    if (isInvalidToken) {
      return res.status(410).json({ 
        error: "Token is no longer valid.", 
        code: "TOKEN_EXPIRED",
        detail: error.message 
      });
    }
    
    res.status(500).json({ error: error.message || "Failed to send test notification." });
  }
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global error handler caught an error:", err);
  
  // If headers already sent, delegate to default error handler
  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  
  res.status(status).json({
    error: message,
    status: status,
    path: req.path
  });
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve from the built dist folder
    // The dist folder is usually in the root, while the server might be in dist-server/
    const distPathFromRoot = path.resolve(process.cwd(), "dist");
    const distPathRelative = path.resolve(__dirname, "dist");
    const distPathParent = path.resolve(__dirname, "..", "dist");
    
    let finalDistPath = distPathFromRoot;
    if (fs.existsSync(distPathFromRoot)) {
      finalDistPath = distPathFromRoot;
    } else if (fs.existsSync(distPathRelative)) {
      finalDistPath = distPathRelative;
    } else if (fs.existsSync(distPathParent)) {
      finalDistPath = distPathParent;
    }

    console.log(`Serving static files from: ${finalDistPath}`);
    app.use(express.static(finalDistPath));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(finalDistPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname === '/api/tts/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const userApiKey = url.searchParams.get('api_key');
        const apiKey = userApiKey || process.env.ASYNC_API_KEY;
        const version = url.searchParams.get('version') || 'v1';
        
        if (!apiKey) {
          console.error('Async API key not configured for WS');
          ws.close(1008, 'API key required');
          return;
        }

        const asyncWs = new WebSocket(`wss://api.async.com/text_to_speech/websocket/ws?api_key=${apiKey}&version=${version}`);
        
        // Buffer messages that arrive before the upstream connection is open
        const pendingMessages: any[] = [];
        let asyncReady = false;

        // Start collecting client messages immediately
        ws.on('message', (data) => {
          try {
            if (asyncReady) {
              asyncWs.send(data);
            } else {
              pendingMessages.push(data);
            }
          } catch (err) {
            console.error('Error sending to Async WS:', err);
          }
        });

        asyncWs.on('open', () => {
          asyncReady = true;
          // Flush any messages that arrived before the upstream was ready
          for (const msg of pendingMessages) {
            try {
              asyncWs.send(msg);
            } catch (err) {
              console.error('Error flushing buffered message to Async WS:', err);
            }
          }
          pendingMessages.length = 0;

          asyncWs.on('message', (data) => {
            try {
              ws.send(data);
            } catch (err) {
              console.error('Error sending to Client WS:', err);
            }
          });
        });
        ws.on('close', () => asyncWs.close());
        asyncWs.on('close', () => ws.close());
        ws.on('error', (err) => { console.error('WS Error:', err); asyncWs.close(); });
        asyncWs.on('error', (err) => { console.error('Async WS Error:', err); ws.close(); });
      });
    } else {
      socket.destroy();
    }
  });

  // Increase timeouts for large data transfers
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 125000;

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down server...');
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
    
    // Force exit after 10s if not closed
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
