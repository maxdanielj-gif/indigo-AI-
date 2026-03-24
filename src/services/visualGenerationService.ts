import { GoogleGenAI } from "@google/genai";
import { AIProfile, Background } from "../types";

export interface GenerationResult {
  url: string;
  type: 'image' | 'video';
}

export const generateVisual = async (
  model: string,
  prompt: string,
  aiProfile: AIProfile,
  apiKey: string | null,
  selectedBackground: Background | null,
  poseReferenceImage: string | null,
  imageStyle: string,
  aspectRatio: string,
  resolution?: '720p' | '1080p',
  onProgress?: (message: string) => void
): Promise<GenerationResult> => {
  // @ts-ignore
  const apiKeyToUse = process.env.API_KEY || apiKey || process.env.GEMINI_API_KEY!;
  const ai = new GoogleGenAI({ apiKey: apiKeyToUse });

  if (model.startsWith('veo')) {
    return await generateVideo(ai, model, prompt, aiProfile, selectedBackground, poseReferenceImage, imageStyle, aspectRatio, resolution || '720p', apiKeyToUse, onProgress);
  } else if (model.startsWith('imagen')) {
    return await generateImagenImage(ai, model, prompt, aiProfile, selectedBackground, poseReferenceImage, imageStyle, aspectRatio, onProgress);
  } else {
    return await generateGeminiImage(ai, model, prompt, aiProfile, selectedBackground, poseReferenceImage, imageStyle, aspectRatio, onProgress);
  }
};

const constructPrompt = (prompt: string, aiProfile: AIProfile, selectedBackground: Background | null, poseReferenceImage: string | null, imageStyle: string) => {
  const stylePrompt = (imageStyle && imageStyle !== 'none') ? ` The output should be in ${imageStyle} style.` : "";
  let instruction = `Generate a high-quality image based on this prompt: ${prompt}. You MUST return an image.`;
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
  if (selectedBackground) {
      reinforcement += `\n- BACKGROUND: The character MUST be rendered inside the provided background image (Environment: ${selectedBackground.name}), scaled realistically to the furniture and objects.`;
  }
  if (poseReferenceImage) {
      reinforcement += "\n- POSE: Use the provided pose reference image as a guide for the character's posture.";
  }

  return instruction + reinforcement;
};

const generateGeminiImage = async (ai: any, model: string, prompt: string, aiProfile: AIProfile, selectedBackground: Background | null, poseReferenceImage: string | null, imageStyle: string, aspectRatio: string, onProgress?: (msg: string) => void): Promise<GenerationResult> => {
  onProgress?.("Generating image with Gemini...");
  const fullPrompt = constructPrompt(prompt, aiProfile, selectedBackground, poseReferenceImage, imageStyle);
  const parts: any[] = [];

  if (aiProfile.referenceImage) {
    const [header, data] = aiProfile.referenceImage.split(',');
    const mimeType = header.split(':')[1].split(';')[0];
    parts.push({ text: "CHARACTER REFERENCE IMAGE (ABSOLUTE SOURCE OF TRUTH FOR IDENTITY, FACE, HAIR, AND BODY TYPE):" });
    parts.push({ inlineData: { data, mimeType } });
  }

  if (selectedBackground) {
    const [header, data] = selectedBackground.url.split(',');
    const mimeType = header.split(':')[1].split(';')[0];
    parts.push({ text: `BACKGROUND REFERENCE IMAGE (USE THIS EXACT ROOM/ENVIRONMENT: ${selectedBackground.name}):` });
    parts.push({ inlineData: { data, mimeType } });
  }

  if (poseReferenceImage) {
    const [header, data] = poseReferenceImage.split(',');
    const mimeType = header.split(':')[1].split(';')[0];
    parts.push({ text: "POSE REFERENCE IMAGE (USE THIS POSTURE/POSE):" });
    parts.push({ inlineData: { data, mimeType } });
  }

  parts.push({ text: fullPrompt });

  const imageConfig: any = {
    aspectRatio: aspectRatio,
  };
  
  if (model.includes('3.1') || model.includes('3-pro')) {
    imageConfig.imageSize = "1K";
  }

  const response = await ai.models.generateContent({
    model: model,
    contents: { parts },
    config: {
      imageConfig,
      systemInstruction: "You are an image generation AI. Your task is to generate an image based on the provided prompt and reference images. You MUST return an image in your response."
    }
  });

  console.log("Gemini image generation response:", JSON.stringify(response, null, 2));

  let base64Image;
  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        base64Image = part.inlineData.data;
        break;
      }
    }
  }

  if (base64Image) {
    return { url: `data:image/png;base64,${base64Image}`, type: 'image' };
  } else {
    const textResponse = response.text;
    if (textResponse) {
      throw new Error(`Gemini returned text instead of an image: ${textResponse}`);
    }
    
    const safetyRatings = response.candidates?.[0]?.safetyRatings;
    if (safetyRatings?.some((r: any) => r.blocked)) {
      throw new Error("Image generation was blocked by safety filters.");
    }
    
    throw new Error("No image data returned from Gemini. The model might have failed to generate a visual for this prompt.");
  }
};

const generateImagenImage = async (ai: any, model: string, prompt: string, aiProfile: AIProfile, selectedBackground: Background | null, poseReferenceImage: string | null, imageStyle: string, aspectRatio: string, onProgress?: (msg: string) => void): Promise<GenerationResult> => {
  onProgress?.("Generating image with Imagen...");
  const fullPrompt = constructPrompt(prompt, aiProfile, selectedBackground, poseReferenceImage, imageStyle);
  const response = await ai.models.generateImages({
    model: model,
    prompt: fullPrompt,
    config: {
      numberOfImages: 1,
      outputMimeType: 'image/jpeg',
      aspectRatio: aspectRatio,
    },
  });

  if (response.generatedImages?.[0]?.image?.imageBytes) {
    return { url: `data:image/png;base64,${response.generatedImages[0].image.imageBytes}`, type: 'image' };
  } else {
    throw new Error("No image data returned from Imagen.");
  }
};

const generateVideo = async (
  ai: any, 
  model: string, 
  prompt: string, 
  aiProfile: AIProfile, 
  selectedBackground: Background | null, 
  poseReferenceImage: string | null, 
  imageStyle: string, 
  aspectRatio: string, 
  resolution: '720p' | '1080p',
  apiKey: string, 
  onProgress?: (msg: string) => void
): Promise<GenerationResult> => {
  onProgress?.("Initializing video generation... This may take a few minutes.");
  
  // Simplify prompt for video generation to avoid triggering safety filters with complex instructions
  const stylePrompt = (imageStyle && imageStyle !== 'none') ? ` in ${imageStyle} style` : "";
  const fullPrompt = `A high-quality video of ${aiProfile.name} (${aiProfile.appearance}): ${prompt}${stylePrompt}. Maintain visual consistency with the reference image.`;
  
  const videoConfig: any = {
    numberOfVideos: 1,
    resolution: resolution,
    aspectRatio: (aspectRatio === '9:16' || aspectRatio === '3:4') ? '9:16' : '16:9'
  };

  let imagePart = undefined;
  if (poseReferenceImage) {
    const [header, data] = poseReferenceImage.split(',');
    const mimeType = header.split(':')[1].split(';')[0];
    imagePart = {
      imageBytes: data,
      mimeType: mimeType
    };
  } else if (aiProfile.referenceImage) {
    const [header, data] = aiProfile.referenceImage.split(',');
    const mimeType = header.split(':')[1].split(';')[0];
    imagePart = {
      imageBytes: data,
      mimeType: mimeType
    };
  }

  let operation = await ai.models.generateVideos({
    model: model,
    prompt: fullPrompt,
    image: imagePart,
    config: videoConfig
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  if (operation.error) {
    throw new Error(`Video generation failed: ${operation.error.message || JSON.stringify(operation.error)}`);
  }

  onProgress?.("Video generated! Fetching content...");

  const generatedVideos = operation.response?.generatedVideos;
  if (!generatedVideos || generatedVideos.length === 0) {
    // Check for safety filters in the response if available
    const safetyRatings = operation.response?.candidates?.[0]?.safetyRatings;
    if (safetyRatings?.some((r: any) => r.blocked)) {
      throw new Error("Video generation was blocked by safety filters. Please try a more neutral prompt.");
    }
    
    console.error("Operation response:", JSON.stringify(operation, null, 2));
    throw new Error("[VEO_ERROR_EMPTY_RESPONSE] No video was produced. The operation completed but the response was empty. This often happens due to safety filters or model limitations.");
  }

  const downloadLink = generatedVideos[0]?.video?.uri;
  if (!downloadLink) {
    console.error("Operation response:", JSON.stringify(operation, null, 2));
    throw new Error("[VEO_ERROR_NO_URI] No video download link returned. The operation might have completed without producing a video file.");
  }

  const response = await fetch(downloadLink, {
    method: 'GET',
    headers: {
      'x-goog-api-key': apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Video download failed:", response.status, errorText);
    throw new Error(`[VEO_ERROR_DOWNLOAD_FAILED] Failed to download generated video (Status: ${response.status}).`);
  }

  const blob = await response.blob();
  
  // Convert blob to base64 data URL for persistence in gallery
  const base64Video = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  
  return { url: base64Video, type: 'video' };
};
