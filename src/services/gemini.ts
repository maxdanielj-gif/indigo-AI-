import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const retry = async <T>(fn: () => Promise<T>, retries = 7, delay = 3000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    console.error("Gemini API error:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    // Check if it's a 429 error (Resource Exhausted)
    const isRateLimited = error.status === 429 || 
                          error.code === 429 || 
                          (error.message && error.message.includes('429')) ||
                          (error.error && error.error.code === 429);

    if (retries > 0 && isRateLimited) {
      // Add jitter to delay
      const jitter = Math.random() * 1000;
      const nextDelay = delay + jitter;
      console.warn(`Rate limited, retrying in ${Math.round(nextDelay)}ms... (${retries} retries left)`);
      await sleep(nextDelay);
      return retry(fn, retries - 1, delay * 1.5);
    }
    throw error;
  }
};

export interface Message {
  role: 'user' | 'model';
  content: string;
}

export const sendMessage = async (
  history: Message[], 
  message: string, 
  systemInstruction?: string, 
  aiCanUseWebSearch?: boolean, 
  aiCanUseCalendar?: boolean, 
  aiCanUseGmail?: boolean,
  aiCanUseYouTube?: boolean,
  aiCanUseGoogleMaps?: boolean,
  aiCanUseBlogger?: boolean
) => {
  return retry(async () => {
    const tools: any[] = [];
    if (aiCanUseWebSearch) tools.push({ googleSearch: {} });
    if (aiCanUseGoogleMaps) tools.push({ googleMaps: {} });

    const chat = ai.chats.create({
      model: aiCanUseGoogleMaps ? "gemini-2.5-flash" : "gemini-3-flash-preview",
      config: {
        systemInstruction: (systemInstruction || "You are a helpful AI companion.") + 
          (aiCanUseWebSearch ? "\n\nFACT-CHECKING PROTOCOL: Use Google Search to fact-check claims in real-time. Prevent fake news and pseudoscience. Prioritize scientific consensus." : "") +
          (aiCanUseCalendar ? "\n\nCALENDAR ACCESS: You have access to the user's Google Calendar to check schedules and events." : "") +
          (aiCanUseGmail ? "\n\nGMAIL ACCESS: You have access to the user's Gmail to read and summarize emails." : "") +
          (aiCanUseYouTube ? "\n\nYOUTUBE ACCESS: You can search for and summarize YouTube videos to provide visual context or tutorials." : "") +
          (aiCanUseGoogleMaps ? "\n\nGOOGLE MAPS ACCESS: You have access to Google Maps to provide directions, location details, and local recommendations." : "") +
          (aiCanUseBlogger ? "\n\nBLOGGER ACCESS: You have access to Blogger to draft and publish blog posts. Use this to share your thoughts, updates, or journal entries if requested." : ""),
        tools: tools.length > 0 ? tools : undefined,
      },
      history: history.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.content }],
      })),
    });

    const result = await chat.sendMessage({ message });
    return result.text;
  });
};

export const generateImageDescription = async (prompt: string) => {
  return retry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a detailed description for an image based on this prompt: ${prompt}`,
    });
    return response.text;
  });
};
