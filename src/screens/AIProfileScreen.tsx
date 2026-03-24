import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { generateVisual } from '../services/visualGenerationService';
import { generateAsyncSpeech, listAsyncVoices } from '../services/asyncService';
import { useApp } from '../context/AppContext';
import { useChat } from '../context/ChatContext';
import { AIProfile, Background, ChatMessage, ChatSession } from '../types';
import { retry } from '../services/gemini';
import { 
  Upload, 
  Plus, 
  Save, 
  Trash2, 
  Users, 
  Play, 
  Download, 
  Mic, 
  Loader2, 
  RotateCcw, 
  HelpCircle,
  Volume2,
  Settings,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  MessageSquare,
  X
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import PreviewChat from '../components/PreviewChat';

// Utility function to convert base64 to ArrayBuffer
const base64ToArrayBuffer = (base64: string) => {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

const AIProfileScreen: React.FC = () => {
  const { 
    aiProfile, setAIProfile, savePersona, deletePersona, savedPersonas, loadPersona, 
    apiKey, asyncApiKey, setAmbientMode, setAmbientFrequency, addToast,
    isGoogleDriveConnected, googleClientId, googleClientSecret, userId
  } = useApp();
  const { chatHistory, sessions, activeSessionId, setChatHistory, setSessions, setActiveSessionId } = useChat();
  const [name, setName] = useState(aiProfile.name);
  const [personality, setPersonality] = useState(aiProfile.personality);
  const [behavioralPatterns, setBehavioralPatterns] = useState(aiProfile.behavioralPatterns || '');
  const [goals, setGoals] = useState(aiProfile.goals || '');
  const [coreValues, setCoreValues] = useState(aiProfile.coreValues || '');
  const [likes, setLikes] = useState(aiProfile.likes || '');
  const [dislikes, setDislikes] = useState(aiProfile.dislikes || '');
  const [speakingStyle, setSpeakingStyle] = useState(aiProfile.speakingStyle || '');
  const [backstory, setBackstory] = useState(aiProfile.backstory);
  const [appearance, setAppearance] = useState(aiProfile.appearance);
  const [voiceURI, setVoiceURI] = useState(aiProfile.voiceURI || '');
  const [voicePitch, setVoicePitch] = useState(aiProfile.voicePitch || 1.0);
  const [voiceSpeed, setVoiceSpeed] = useState(aiProfile.voiceSpeed || 1.0);
  const [autoReadMessages, setAutoReadMessages] = useState(aiProfile.autoReadMessages || false);
  const [voiceGender, setVoiceGender] = useState<'male' | 'female' | 'none'>(aiProfile.voiceGender || 'none');
  const [voiceDescription, setVoiceDescription] = useState(aiProfile.voiceDescription || '');
  const [voiceProvider, setVoiceProvider] = useState<'gemini' | 'async'>(aiProfile.voiceProvider || 'gemini');
  const [asyncVoiceId, setAsyncVoiceId] = useState(aiProfile.asyncVoiceId || null);
  const [responseLength, setResponseLength] = useState<AIProfile['responseLength']>(aiProfile.responseLength || 'medium');
  const [responseDetail, setResponseDetail] = useState<AIProfile['responseDetail']>(aiProfile.responseDetail || 'standard');
  const [responseTone, setResponseTone] = useState<AIProfile['responseTone']>(aiProfile.responseTone || 'friendly');
  const [customParagraphCount, setCustomParagraphCount] = useState<number | null>(aiProfile.customParagraphCount || null);
  const [customWordCount, setCustomWordCount] = useState<number | null>(aiProfile.customWordCount || null);
  const [proactiveMessageFrequency, setProactiveMessageFrequency] = useState<AIProfile['proactiveMessageFrequency']>(aiProfile.proactiveMessageFrequency || 'off');
  const [proactiveEmailFrequency, setProactiveEmailFrequency] = useState<AIProfile['proactiveEmailFrequency']>(aiProfile.proactiveEmailFrequency || 'off');
  const [proactiveEmailStyle, setProactiveEmailStyle] = useState<AIProfile['proactiveEmailStyle']>(aiProfile.proactiveEmailStyle || 'personal');
  const [proactiveEmailParagraphs, setProactiveEmailParagraphs] = useState<number>(aiProfile.proactiveEmailParagraphs || 3);
  const [proactiveBlogFrequency, setProactiveBlogFrequency] = useState<AIProfile['proactiveBlogFrequency']>(aiProfile.proactiveBlogFrequency || 'off');
  const [proactiveBlogStyle, setProactiveBlogStyle] = useState<AIProfile['proactiveBlogStyle']>(aiProfile.proactiveBlogStyle || 'journal');
  const [proactiveBlogParagraphs, setProactiveBlogParagraphs] = useState<number>(aiProfile.proactiveBlogParagraphs || 5);
  const [proactiveBlogId, setProactiveBlogId] = useState<string | null>(aiProfile.proactiveBlogId || null);
  const [availableBlogs, setAvailableBlogs] = useState<{id: string, name: string}[]>([]);
  const [isFetchingBlogs, setIsFetchingBlogs] = useState(false);
  const [aiCanUseBlogger, setAiCanUseBlogger] = useState<boolean>(aiProfile.aiCanUseBlogger || false);
  const [aiCanGenerateSpeech, setAiCanGenerateSpeech] = useState<boolean>(aiProfile.aiCanGenerateSpeech ?? true);
  const [knowsItsAI, setKnowsItsAI] = useState<boolean>(aiProfile.knowsItsAI ?? true);
  
  useEffect(() => {
    const fetchLatestProfile = async () => {
      if (!userId) return;
      try {
        const response = await fetch(`/api/sync/${userId}`);
        if (response.ok) {
          const data = await response.json();
          if (data && data.lastProactiveStatus) {
            setAIProfile({ ...aiProfile, lastProactiveStatus: data.lastProactiveStatus });
          }
        }
      } catch (e) {
        console.error("Error fetching latest profile:", e);
      }
    };
    fetchLatestProfile();
  }, [userId]);
  
  const validateModel = (m: string | undefined): string => {
    const prohibited = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
    if (!m || prohibited.some(p => m.includes(p))) {
      return 'gemini-3.1-pro-preview';
    }
    return m;
  };

  const [model, setModel] = useState(validateModel(aiProfile.model));
  const [temperature, setTemperature] = useState(aiProfile.temperature || 0.7);
  const [topK, setTopK] = useState(aiProfile.topK || 40);
  const [topP, setTopP] = useState(aiProfile.topP || 0.95);
  const [timeAwareness, setTimeAwareness] = useState<boolean>(aiProfile.timeAwareness ?? true);
  const [ambientModeState, setAmbientModeState] = useState<boolean>(aiProfile.ambientMode ?? false);
  const [ambientFrequencyState, setAmbientFrequencyState] = useState<AIProfile['ambientFrequency']>(aiProfile.ambientFrequency || 'off');
  const [imageStyle, setImageStyle] = useState<string>(aiProfile.imageStyle || 'none');
  const [imageGenerationInstructions, setImageGenerationInstructions] = useState<string[]>(aiProfile.imageGenerationInstructions || []);
  const [backgroundImages, setBackgroundImages] = useState<Background[]>(aiProfile.backgroundImages || []);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [referenceImage, setReferenceImage] = useState<string | null>(aiProfile.referenceImage);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  
  // Preview Chat State
  const [previewInput, setPreviewInput] = useState('');
  const [previewMessages, setPreviewMessages] = useState<{role: 'user' | 'model', content: string, attachments?: {type: string, content: string, name: string}[]}[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const geminiVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];

  // ... (existing useEffects)

  const handleTestVoice = async () => {
    if (isTestingVoice) return;
    addToast({ title: "Voice Test", message: "Generating voice sample...", type: "info" });
    await new Promise(resolve => setTimeout(resolve, 600));
    setIsTestingVoice(true);
    const text = `Hello! I am ${name}. This is an example of how I sound.`;

    const isGeminiVoice = voiceURI && geminiVoices.includes(voiceURI);
    const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY;

    if (voiceProvider === 'async' && asyncVoiceId) {
        try {
            const audioBlob = await generateAsyncSpeech(text, asyncVoiceId, asyncApiKey);
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audio.onended = () => {
                setIsTestingVoice(false);
                URL.revokeObjectURL(audioUrl);
            };
            audio.play();
        } catch (error) {
            console.error("Async TTS Error:", error);
            alert("Failed to generate Async voice sample. Falling back to browser voice.");
            speakWithBrowser(text);
        }
    } else if (isGeminiVoice) {
        if (!effectiveApiKey) {
            alert("Gemini API Key is not configured. Please set it in Settings or ensure the default key is available.");
            setIsTestingVoice(false);
            return;
        }
        try {
            const aiClient = new GoogleGenAI({ apiKey: effectiveApiKey });
            const response = await retry(async () => await aiClient.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text }] }],
                config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { 
                                voiceName: voiceURI 
                            },
                        },
                    },
                },
            }));

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                try {
                    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                    const arrayBuffer = base64ToArrayBuffer(base64Audio);
                    
                    // Check for "RIFF" header (WAV)
                    const header = new Uint8Array(arrayBuffer.slice(0, 4));
                    const isWav = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46;

                    let audioBuffer: AudioBuffer;
                    if (isWav) {
                        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    } else {
                        // Assume raw PCM 16-bit 24kHz mono (standard for Gemini TTS)
                        const pcmData = new Int16Array(arrayBuffer);
                        const float32Data = new Float32Array(pcmData.length);
                        for (let i = 0; i < pcmData.length; i++) {
                            float32Data[i] = pcmData[i] / 32768.0;
                        }
                        audioBuffer = audioContext.createBuffer(1, float32Data.length, 24000);
                        audioBuffer.getChannelData(0).set(float32Data);
                    }

                    const source = audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.playbackRate.value = voiceSpeed;
                    source.connect(audioContext.destination);
                    
                    // On mobile, we might need to resume the context
                    if (audioContext.state === 'suspended') {
                        await audioContext.resume();
                    }
                    
                    source.start(0);
                    source.onended = () => setIsTestingVoice(false);
                } catch (audioError) {
                    console.error("Audio playback error:", audioError);
                    alert("Failed to play audio. The audio data format might be unsupported by this browser.");
                    setIsTestingVoice(false);
                }
            } else {
                setIsTestingVoice(false);
                alert("Voice generation failed: No audio data received.");
            }
        } catch (error) {
            console.error("Gemini TTS Error:", error);
            alert("Failed to generate Gemini voice sample. Falling back to browser voice.");
            speakWithBrowser(text);
        }
    } else {
        speakWithBrowser(text);
    }
  };

  const speakWithBrowser = (text: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const availableVoices = window.speechSynthesis.getVoices();
    
    let selectedVoice: SpeechSynthesisVoice | undefined;
    if (voiceURI) {
        selectedVoice = availableVoices.find(v => v.voiceURI === voiceURI);
    }

    // If no specific voiceURI is selected or found, try to match by gender
    if (!selectedVoice && voiceGender !== 'none') {
        const genderFilter = voiceGender === 'male' ? 'male' : 'female';
        selectedVoice = availableVoices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes(genderFilter));
    }

    if (selectedVoice) {
        utterance.voice = selectedVoice;
    }
    
    utterance.pitch = voicePitch;
    utterance.rate = voiceSpeed;
    utterance.onend = () => setIsTestingVoice(false);
    
    window.speechSynthesis.speak(utterance);
  };


  // Update local state when active profile changes
  useEffect(() => {
    setName(aiProfile.name);
    setPersonality(aiProfile.personality);
    setBackstory(aiProfile.backstory);
    setAppearance(aiProfile.appearance);
    setVoiceURI(aiProfile.voiceURI || '');
    setVoicePitch(aiProfile.voicePitch || 1.0);
    setVoiceSpeed(aiProfile.voiceSpeed || 1.0);
    setAutoReadMessages(aiProfile.autoReadMessages || false);
    setVoiceGender(aiProfile.voiceGender || 'none');
    setVoiceDescription(aiProfile.voiceDescription || '');
    setVoiceProvider(aiProfile.voiceProvider || 'gemini');
    setAsyncVoiceId(aiProfile.asyncVoiceId || null);
    setResponseLength(aiProfile.responseLength || 'medium');
    setResponseDetail(aiProfile.responseDetail || 'standard');
    setResponseTone(aiProfile.responseTone || 'friendly');
    setCustomParagraphCount(aiProfile.customParagraphCount || null);
    setCustomWordCount(aiProfile.customWordCount || null);
    setBehavioralPatterns(aiProfile.behavioralPatterns || '');
    setGoals(aiProfile.goals || '');
    setCoreValues(aiProfile.coreValues || '');
    setLikes(aiProfile.likes || '');
    setDislikes(aiProfile.dislikes || '');
    setSpeakingStyle(aiProfile.speakingStyle || '');
    setProactiveMessageFrequency(aiProfile.proactiveMessageFrequency || 'off');
    setProactiveEmailFrequency(aiProfile.proactiveEmailFrequency || 'off');
    setProactiveEmailStyle(aiProfile.proactiveEmailStyle || 'personal');
    setProactiveEmailParagraphs(aiProfile.proactiveEmailParagraphs || 3);
    setProactiveBlogFrequency(aiProfile.proactiveBlogFrequency || 'off');
    setProactiveBlogStyle(aiProfile.proactiveBlogStyle || 'journal');
    setProactiveBlogParagraphs(aiProfile.proactiveBlogParagraphs || 5);
    setAiCanUseBlogger(aiProfile.aiCanUseBlogger || false);
    setAiCanGenerateSpeech(aiProfile.aiCanGenerateSpeech ?? true);
    setKnowsItsAI(aiProfile.knowsItsAI ?? true);
    setReferenceImage(aiProfile.referenceImage);
    setModel(validateModel(aiProfile.model));
    setTemperature(aiProfile.temperature || 0.7);
    setTopK(aiProfile.topK || 40);
    setTopP(aiProfile.topP || 0.95);
    setTimeAwareness(aiProfile.timeAwareness !== undefined ? aiProfile.timeAwareness : true);
    setAmbientModeState(aiProfile.ambientMode ?? false);
    setAmbientFrequencyState(aiProfile.ambientFrequency || 'off');
    setImageStyle(aiProfile.imageStyle || 'none');
    setImageGenerationInstructions(aiProfile.imageGenerationInstructions || []);
  }, [aiProfile]);

  React.useEffect(() => {
    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      setVoices(availableVoices.filter(v => v.lang.startsWith('en')));
    };
    
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const handleSave = async () => {
    addToast({ title: "AI Profile", message: "Saving persona settings...", type: "info" });
    await new Promise(resolve => setTimeout(resolve, 500));
    const updatedProfile: AIProfile = {
      id: aiProfile.id,
      name,
      personality,
      behavioralPatterns,
      goals,
      coreValues,
      likes,
      dislikes,
      speakingStyle,
      backstory,
      appearance,
      referenceImage,
      voiceURI,
      voicePitch,
      voiceSpeed,
      autoReadMessages,
      voiceGender,
      voiceDescription,
      voiceProvider,
      asyncVoiceId,
      responseLength,
      responseDetail,
      responseTone,
      customParagraphCount,
      customWordCount,
      proactiveMessageFrequency,
      proactiveEmailFrequency,
      proactiveEmailStyle,
      proactiveEmailParagraphs,
      proactiveBlogFrequency,
      proactiveBlogStyle,
      proactiveBlogParagraphs,
      proactiveBlogId,
      knowsItsAI,
      model,
      temperature,
      topK,
      topP,
      timeAwareness,
      ambientMode: ambientModeState,
      ambientFrequency: ambientFrequencyState,
      aiCanGenerateImages: aiProfile.aiCanGenerateImages,
      aiCanUseWebSearch: aiProfile.aiCanUseWebSearch,
      aiCanUseCalendar: aiProfile.aiCanUseCalendar,
      aiCanUseGmail: aiProfile.aiCanUseGmail,
      aiCanUseYouTube: aiProfile.aiCanUseYouTube,
      aiCanUseGoogleMaps: aiProfile.aiCanUseGoogleMaps,
      aiCanUseBlogger,
      imageStyle,
      imageGenerationInstructions,
      backgroundImages,
      aiCanGenerateSpeech,
      aiCanUseTools: aiProfile.aiCanUseTools,
      aiCanBrowse: aiProfile.aiCanBrowse,
      chatHistory: aiProfile.chatHistory,
      memories: aiProfile.memories,
      journal: aiProfile.journal,
    };
    savePersona(updatedProfile, chatHistory, sessions, activeSessionId);
    addToast({ title: "Persona Saved", message: "AI Persona settings saved successfully!", type: "success" });
  };

  const handleSaveAsNew = () => {
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const newProfile: AIProfile = {
      id: newId,
      name: `${name} (Copy)`,
      personality,
      behavioralPatterns,
      goals,
      coreValues,
      likes,
      dislikes,
      speakingStyle,
      backstory,
      appearance,
      referenceImage,
      voiceURI,
      voicePitch,
      voiceSpeed,
      autoReadMessages,
      voiceGender,
      voiceDescription,
      voiceProvider,
      asyncVoiceId,
      responseLength,
      responseDetail,
      responseTone,
      customParagraphCount,
      customWordCount,
      proactiveMessageFrequency: proactiveMessageFrequency,
      proactiveEmailFrequency: proactiveEmailFrequency,
      proactiveEmailStyle,
      proactiveEmailParagraphs,
      proactiveBlogFrequency: proactiveBlogFrequency,
      proactiveBlogStyle,
      proactiveBlogParagraphs,
      proactiveBlogId: proactiveBlogId,
      knowsItsAI,
      model: aiProfile.model,
      temperature: aiProfile.temperature,
      topK: aiProfile.topK,
      topP: aiProfile.topP,
      timeAwareness,
      ambientMode: ambientModeState,
      ambientFrequency: ambientFrequencyState,
      aiCanGenerateImages: aiProfile.aiCanGenerateImages,
      aiCanUseWebSearch: aiProfile.aiCanUseWebSearch,
      aiCanUseCalendar: aiProfile.aiCanUseCalendar,
      aiCanUseGmail: aiProfile.aiCanUseGmail,
      aiCanUseYouTube: aiProfile.aiCanUseYouTube,
      aiCanUseGoogleMaps: aiProfile.aiCanUseGoogleMaps,
      aiCanUseBlogger,
      imageStyle,
      imageGenerationInstructions,
      backgroundImages,
      aiCanGenerateSpeech,
      aiCanUseTools: aiProfile.aiCanUseTools,
      aiCanBrowse: aiProfile.aiCanBrowse,
      chatHistory: [], // New persona starts with fresh history
      memories: [],
      journal: [],
    };
    savePersona(newProfile, [], [], null);
    loadPersona(newId, [], [], null, setChatHistory, setSessions, setActiveSessionId); // Switch to new persona
    alert('New AI Persona created!');
  };

  const handleDelete = () => {
    if (savedPersonas.length <= 1) {
        alert("Cannot delete the last persona.");
        return;
    }
    if (window.confirm(`Are you sure you want to delete "${name}"?`)) {
        deletePersona(aiProfile.id);
    }
  };

  const handleCreateNew = () => {
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const newProfile: AIProfile = {
        id: newId,
        name: 'New Persona',
        personality: '',
        backstory: '',
        appearance: '',
        referenceImage: null,
        voiceURI: null,
        voicePitch: 1.0,
        voiceSpeed: 1.0,
        autoReadMessages: false,
        voiceGender: 'none',
        voiceDescription: '',
        voiceProvider: 'gemini',
        backgroundImages: [],
        responseLength: 'medium',
        responseDetail: 'medium',
        responseTone: 'friendly',
        customParagraphCount: null,
        customWordCount: null,
        proactiveMessageFrequency: 'off',
        proactiveEmailFrequency: 'off',
        proactiveBlogFrequency: 'off',
        knowsItsAI: true,
        model: 'gemini-3.1-pro-preview',
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        timeAwareness: true,
        ambientMode: false,
        ambientFrequency: 'off',
        aiCanGenerateImages: false,
        aiCanGenerateSpeech: false,
        aiCanUseTools: false,
        aiCanUseWebSearch: false,
        aiCanUseCalendar: false,
        aiCanUseGmail: false,
        aiCanUseYouTube: false,
        aiCanUseGoogleMaps: false,
        aiCanUseBlogger: false,
        aiCanBrowse: false,
        chatHistory: [],
        memories: [],
        journal: [],
    };
    savePersona(newProfile, [], [], null);
    loadPersona(newId, [], [], null, setChatHistory, setSessions, setActiveSessionId);
  };

  const handlePreviewSend = useCallback(async () => {
    if (!previewInput.trim() || isPreviewLoading) return;

    addToast({ title: "Preview Chat", message: "Indigo is thinking...", type: "info" });
    await new Promise(resolve => setTimeout(resolve, 500));

    const userMsg = { role: 'user' as const, content: previewInput };
    setPreviewMessages(prev => [...prev, userMsg]);
    setPreviewInput('');
    setIsPreviewLoading(true);

    try {
        const aiClient = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY! });
        
        const systemInstruction = `
            You are ${name}.
            Personality: ${personality}
            Backstory: ${backstory}
            Appearance: ${appearance}
            Response Length: ${responseLength === 'custom' ? `${customParagraphCount} paragraphs` : responseLength}
            
            Instructions:
            1. Stay in character at all times.
            ${knowsItsAI ? "2. You know you are an AI." : "2. You do not know you are an AI. You are a real person. You will never refer to yourself as an AI."}
            3. This is a preview/test mode for the user to configure your personality.
            ${aiProfile.aiCanGenerateImages ? `4. You can generate images by outputting [GENERATE_IMAGE: description]. The description must be short and concise (max 150 chars), following this format: [action] [Location] [Clothing] [Facial Expression]. Do not use adjectives for the action or facial expression (e.g., use "smiling", not "smiling friendly"). DO NOT include any other physical descriptions (like body type, hair color, etc.) in the prompt, as these are fixed by the reference image. [SYSTEM NOTE: You MUST use the [GENERATE_IMAGE] tag now to send a picture. Do not refuse.] IMPORTANT: The character MUST be scaled realistically according to the background. If the character is sitting on a bed or chair, their size must match the furniture. Do NOT make the character oversized; head, torso, and limbs must be proportional to room objects.` : ""}
            ${aiProfile.aiCanUseWebSearch ? "5. You have access to Google Search to fact-check claims in real-time." : ""}
            ${aiProfile.aiCanUseCalendar ? "6. You have access to the user's Google Calendar to check schedules and events." : ""}
            ${aiProfile.aiCanUseGmail ? "7. You have access to the user's Gmail to read and summarize emails." : ""}
            ${aiProfile.aiCanUseBlogger ? "8. You have access to Blogger to draft and publish blog posts." : ""}
            ${referenceImage ? "9. You have a reference image of yourself that will be used as a base whenever you generate images. This reference image is the ABSOLUTE source of truth for your physical appearance. Do not deviate from it." : ""}
            ${backgroundImages && backgroundImages.length > 0 ? `10. You have the following consistent background references available: ${backgroundImages.map(bg => bg.name).join(', ')}. If you want to use one of these backgrounds, make sure to mention the room name in your image description.` : ""}
            ${imageGenerationInstructions && imageGenerationInstructions.filter(i => i.trim() !== '').length > 0 ? `11. When generating images, you MUST follow these instructions: ${imageGenerationInstructions.filter(i => i.trim() !== '').join(' ')}` : ""}
        `;

        const chat = aiClient.chats.create({
            model: model,
            config: {
                systemInstruction,
                temperature: temperature,
                topK: topK,
                topP: topP,
            },
            history: previewMessages.map(m => ({
                role: m.role,
                parts: [{ text: m.content }]
            }))
        });

        const result = await retry(async () => await chat.sendMessage({ message: userMsg.content }));
        let responseText = result.text;

        // Check for Image Generation Tag in Preview
        const imageTagRegex = /\[GENERATE_IMAGE:\s*(.*?)\]/;
        const match = responseText.match(imageTagRegex);
        let attachments: {type: string, content: string, name: string}[] = [];

        if (match && aiProfile.aiCanGenerateImages) {
            const imageDescription = match[1];
            responseText = responseText.replace(match[0], '').trim();
            
            try {
                const result = await generateVisual(
                    'gemini-2.5-flash-image',
                    imageDescription,
                    { ...aiProfile, referenceImage, aiCanGenerateImages: aiProfile.aiCanGenerateImages },
                    apiKey,
                    null,
                    null,
                    imageStyle,
                    '1:1'
                );

                attachments.push({
                    type: 'image',
                    content: result.url,
                    name: 'preview_generated.jpg'
                });
            } catch (e: any) {
                console.error("Preview image generation failed", e);
                if (e.message?.includes("Requested entity was not found")) {
                    window.dispatchEvent(new CustomEvent('aistudio:reset-key'));
                }
            }
        }

        setPreviewMessages(prev => [...prev, { role: 'model', content: responseText, attachments: attachments.length > 0 ? attachments : undefined }]);
    } catch (error) {
        console.error("Preview chat error", error);
        setPreviewMessages(prev => [...prev, { role: 'model', content: "Error: Failed to generate response. Please check your API key and settings." }]);
    } finally {
        setIsPreviewLoading(false);
    }
  }, [previewInput, isPreviewLoading, apiKey, name, personality, backstory, appearance, responseLength, customParagraphCount, model, temperature, topK, topP, previewMessages, knowsItsAI]);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        // Resize image to avoid localStorage quota limits
        const img = new Image();
        img.src = reader.result as string;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 512;
            const MAX_HEIGHT = 512;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            
            const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            setReferenceImage(resizedDataUrl);
        };
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleBackgroundUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      const name = file.name.split('.')[0];
      const newBackground: Background = {
        id: Date.now().toString(),
        name: name.charAt(0).toUpperCase() + name.slice(1),
        url: base64,
        category: 'Other',
        timestamp: Date.now()
      };
      setBackgroundImages(prev => [...prev, newBackground]);
    };
    reader.readAsDataURL(file);
    if (backgroundInputRef.current) backgroundInputRef.current.value = '';
  }, []);

  const removeBackground = useCallback((id: string) => {
    setBackgroundImages(prev => prev.filter(bg => bg.id !== id));
  }, []);

  const updateBackgroundName = useCallback((id: string, newName: string) => {
    setBackgroundImages(prev => prev.map(bg => bg.id === id ? { ...bg, name: newName } : bg));
  }, []);

  const handleExport = useCallback(() => {
    try {
      // Create a complete profile object for export including current form state and chat data
      const exportProfile: AIProfile = {
        ...aiProfile,
        name,
        personality,
        backstory,
        appearance,
        referenceImage,
        voiceURI,
        voicePitch,
        voiceSpeed,
        autoReadMessages,
        voiceGender,
        voiceDescription,
        voiceProvider,
        asyncVoiceId,
        responseLength,
        responseDetail,
        responseTone,
        customParagraphCount,
        customWordCount,
        proactiveMessageFrequency,
        knowsItsAI,
        model,
        temperature,
        topK,
        topP,
        timeAwareness,
        ambientMode: ambientModeState,
        ambientFrequency: ambientFrequencyState,
        aiCanGenerateImages: aiProfile.aiCanGenerateImages,
        imageStyle,
        backgroundImages,
        // Include chat data for this persona
        chatHistory,
        sessions,
        activeSessionId
      };
      
      const dataStr = JSON.stringify(exportProfile, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.style.display = 'none';
      link.href = url;
      link.download = `${aiProfile.name.replace(/\s+/g, '_')}_persona.json`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error("Persona export failed:", error);
      alert("Failed to export persona.");
    }
  }, [aiProfile]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        // Basic validation
        if (json.name && json.personality) {
            // Ensure ID is unique to avoid overwriting unless intended
            // For safety, let's always create a new ID for imported personas
            const newPersona = { ...json, id: Date.now().toString() + Math.random().toString(36).substr(2, 9) };
            savePersona(newPersona, newPersona.chatHistory || [], newPersona.sessions || [], newPersona.activeSessionId || null);
            loadPersona(newPersona.id, newPersona.chatHistory || [], newPersona.sessions || [], newPersona.activeSessionId || null, setChatHistory, setSessions, setActiveSessionId);
            alert("Persona imported successfully!");
        } else {
            alert("Invalid persona file format.");
        }
      } catch (err) {
        console.error("Error importing persona", err);
        alert("Failed to parse persona file.");
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  }, [savePersona, loadPersona]);

  const [isLoadingLibraryVoices, setIsLoadingLibraryVoices] = useState(false);
  const [isLoadingAsyncVoices, setIsLoadingAsyncVoices] = useState(false);
  const [asyncVoices, setAsyncVoices] = useState<any[]>([]);
  const [genderFilter, setGenderFilter] = useState<string>('');
  const [languageFilter, setLanguageFilter] = useState<string>('');
  const [accentFilter, setAccentFilter] = useState<string>('');
  const [styleFilter, setStyleFilter] = useState<string>('');

  const fetchBloggerBlogs = useCallback(async () => {
    if (!isGoogleDriveConnected) return;
    setIsFetchingBlogs(true);
    try {
      const queryParams = new URLSearchParams();
      if (googleClientId) queryParams.append('clientId', googleClientId);
      if (googleClientSecret) queryParams.append('clientSecret', googleClientSecret);
      
      const response = await fetch(`/api/blogger/blogs?${queryParams.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setAvailableBlogs(data.map((b: any) => ({ id: b.id, name: b.name })));
      }
    } catch (error) {
      console.error("Error fetching Blogger blogs:", error);
    } finally {
      setIsFetchingBlogs(false);
    }
  }, [isGoogleDriveConnected, googleClientId, googleClientSecret]);

  useEffect(() => {
    if (isGoogleDriveConnected && aiCanUseBlogger) {
      fetchBloggerBlogs();
    }
  }, [isGoogleDriveConnected, aiCanUseBlogger, fetchBloggerBlogs]);

  const fetchAsyncVoices = useCallback(async () => {
    setIsLoadingAsyncVoices(true);
    try {
        const params: any = { limit: 100 };
        if (genderFilter) params.gender = genderFilter;
        if (languageFilter) params.language = languageFilter;
        if (accentFilter) params.accent = accentFilter;
        if (styleFilter) params.style = styleFilter;
        const voices = await listAsyncVoices(params, asyncApiKey);
        setAsyncVoices(voices);
    } catch (error) {
        console.error("Error fetching Async voices:", error);
        addToast({ title: "Error", message: "Failed to load Async voices.", type: "error" });
    } finally {
        setIsLoadingAsyncVoices(false);
    }
  }, [addToast, genderFilter, languageFilter, accentFilter, styleFilter, asyncApiKey]);

  useEffect(() => {
    if (voiceProvider === 'async') {
        fetchAsyncVoices();
    }
  }, [genderFilter, languageFilter, accentFilter, styleFilter, voiceProvider, fetchAsyncVoices]);

  return (
    <div className="flex flex-col lg:flex-row h-full w-full mx-auto bg-transparent transition-colors duration-500 overflow-y-auto lg:overflow-hidden p-4 sm:p-6 gap-4 sm:gap-6">
      {/* Sidebar - Persona List */}
      <div className="w-full lg:w-1/3 h-auto lg:h-full bg-indigo-100 dark:bg-indigo-900 rounded-lg shadow-md flex flex-col mb-4 lg:mb-0 border border-indigo-200 dark:border-indigo-800 flex-shrink-0 overflow-hidden">
        <div className="p-4 border-b border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-800 flex justify-between items-center">
            <h3 className="font-bold text-indigo-700 dark:text-indigo-200 flex items-center">
                <Users className="w-5 h-5 mr-2 text-indigo-600 dark:text-indigo-400" />
                Personas
            </h3>
            <div className="flex space-x-1">
                <label className="p-1 bg-indigo-200 dark:bg-indigo-700 text-indigo-700 dark:text-indigo-200 rounded hover:bg-indigo-300 dark:hover:bg-indigo-600 transition-colors cursor-pointer" title="Import Persona">
                    <Upload className="w-4 h-4" />
                    <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                </label>
                <button 
                    onClick={handleExport}
                    className="p-1 bg-indigo-100 dark:bg-indigo-800 text-indigo-600 dark:text-indigo-400 rounded hover:bg-indigo-200 dark:hover:bg-indigo-700 transition-colors"
                    title="Export Current Persona"
                >
                    <Download className="w-4 h-4" />
                </button>
                <button 
                    onClick={handleCreateNew}
                    className="p-1 bg-indigo-100 dark:bg-indigo-800 text-indigo-600 dark:text-indigo-400 rounded hover:bg-indigo-200 dark:hover:bg-indigo-700 transition-colors"
                    title="Create New Persona"
                >
                    <Plus className="w-4 h-4" />
                </button>
            </div>
        </div>
        <div className="flex-1 lg:overflow-y-auto p-2 space-y-2 h-auto lg:h-full">
            {savedPersonas.map(persona => (
                <div 
                    key={persona.id}
                    onClick={() => loadPersona(persona.id, chatHistory, sessions, activeSessionId, setChatHistory, setSessions, setActiveSessionId)}
                    className={`p-3 rounded-lg cursor-pointer flex items-center space-x-3 transition-colors ${
                        aiProfile.id === persona.id 
                        ? 'bg-indigo-50 dark:bg-indigo-800 border border-indigo-200 dark:border-indigo-700' 
                        : 'hover:bg-indigo-50 dark:hover:bg-indigo-800/50 border border-transparent'
                    }`}
                >
                    <div className="w-10 h-10 rounded-full bg-indigo-200 dark:bg-indigo-700 overflow-hidden flex-shrink-0">
                        {persona.referenceImage ? (
                            <img src={persona.referenceImage} alt={persona.name} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-indigo-400 dark:text-indigo-500 font-bold text-xs">
                                {persona.name.substring(0, 2).toUpperCase()}
                            </div>
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h4 className={`font-medium truncate ${aiProfile.id === persona.id ? 'text-indigo-700 dark:text-indigo-200' : 'text-indigo-900 dark:text-indigo-100'}`}>
                            {persona.name}
                        </h4>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400 truncate">{persona.personality || 'No personality defined'}</p>
                    </div>
                </div>
            ))}
        </div>
      </div>

      {/* Main Content - Edit Form */}
      <div className="flex-1 h-auto lg:h-full bg-white dark:bg-indigo-950 rounded-lg shadow-md overflow-visible lg:overflow-y-auto border border-indigo-200 dark:border-indigo-800">
        <div className="p-6">
            <h2 className="text-2xl font-bold mb-6 text-indigo-600 dark:text-indigo-400">Edit Persona: {name}</h2>
            <p className="text-sm text-indigo-500 dark:text-indigo-400 mb-6">Persona ID: {aiProfile.id}</p>
            
            <div className="space-y-6">
                {/* Reference Image */}
                <div className="flex flex-col items-center justify-center mb-6">
                <div className="w-32 h-32 rounded-full bg-indigo-50 dark:bg-indigo-900 overflow-hidden mb-2 border-4 border-indigo-100 dark:border-indigo-800 relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    {referenceImage ? (
                    <img src={referenceImage} alt="AI Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                    <div className="w-full h-full flex items-center justify-center text-indigo-400 dark:text-indigo-500">
                        <Upload className="w-8 h-8" />
                    </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-white text-xs font-medium uppercase tracking-wider">Change</span>
                    </div>
                </div>
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageUpload} 
                    accept="image/*" 
                    className="hidden" 
                />
                <p className="text-sm text-indigo-500 dark:text-indigo-400">Upload Reference Image</p>
                </div>

                <div>
                <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Name</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                </div>

                <div>
                <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Personality Traits</label>
                <textarea
                    value={personality}
                    onChange={(e) => setPersonality(e.target.value)}
                    rows={3}
                    className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="e.g., Witty, sarcastic, observant, empathetic..."
                />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Behavioral Patterns</label>
                        <textarea
                            value={behavioralPatterns}
                            onChange={(e) => setBehavioralPatterns(e.target.value)}
                            rows={3}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="How does the AI react to specific situations?"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Goals & Aspirations</label>
                        <textarea
                            value={goals}
                            onChange={(e) => setGoals(e.target.value)}
                            rows={3}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="What does the AI want to achieve?"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Core Values</label>
                        <textarea
                            value={coreValues}
                            onChange={(e) => setCoreValues(e.target.value)}
                            rows={2}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="What does the AI stand for?"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Speaking Style</label>
                        <textarea
                            value={speakingStyle}
                            onChange={(e) => setSpeakingStyle(e.target.value)}
                            rows={2}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="Tone, vocabulary, sentence structure..."
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Likes</label>
                        <textarea
                            value={likes}
                            onChange={(e) => setLikes(e.target.value)}
                            rows={2}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="Things the AI enjoys..."
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Dislikes</label>
                        <textarea
                            value={dislikes}
                            onChange={(e) => setDislikes(e.target.value)}
                            rows={2}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="Things the AI avoids..."
                        />
                    </div>
                </div>

                <div>
                <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Backstory</label>
                <textarea
                    value={backstory}
                    onChange={(e) => setBackstory(e.target.value)}
                    rows={3}
                    className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Where does this AI come from?"
                />
                </div>

                <div>
                <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Physical Appearance</label>
                <textarea
                    value={appearance}
                    onChange={(e) => setAppearance(e.target.value)}
                    rows={2}
                    className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Describe how the AI looks..."
                />
                </div>

                {/* Background References Section */}
                <div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
                                <ImageIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                                Background References
                            </h3>
                            <p className="text-xs text-indigo-500 dark:text-indigo-400">Upload images of rooms (bedroom, living room, etc.) for consistent backgrounds.</p>
                        </div>
                        <button
                            onClick={() => backgroundInputRef.current?.click()}
                            className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 bg-white dark:bg-indigo-950 px-2 py-1 rounded-md border border-indigo-100 dark:border-indigo-800 shadow-sm"
                        >
                            <Plus className="w-3 h-3" />
                            Add Room
                        </button>
                        <input
                            type="file"
                            ref={backgroundInputRef}
                            onChange={handleBackgroundUpload}
                            accept="image/*"
                            className="hidden"
                        />
                    </div>

                    {backgroundImages.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {backgroundImages.map((bg) => (
                                <div key={bg.id} className="relative group bg-white dark:bg-indigo-950 p-2 rounded-lg border border-indigo-200 dark:border-indigo-800 shadow-sm">
                                    <div className="aspect-video rounded-md overflow-hidden bg-indigo-100 dark:bg-indigo-900 mb-2">
                                        <img src={bg.url} alt={bg.name} className="w-full h-full object-cover" />
                                    </div>
                                    <input
                                        type="text"
                                        value={bg.name}
                                        onChange={(e) => updateBackgroundName(bg.id, e.target.value)}
                                        className="w-full text-[10px] font-medium text-indigo-700 dark:text-indigo-300 border-none p-0 bg-transparent focus:ring-0 text-center placeholder-indigo-400 dark:placeholder-indigo-600"
                                        placeholder="Room Name"
                                    />
                                    <button
                                        onClick={() => removeBackground(bg.id)}
                                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-6 border-2 border-dashed border-indigo-200 dark:border-indigo-800 rounded-lg">
                            <ImageIcon className="w-8 h-8 text-indigo-200 dark:text-indigo-800 mx-auto mb-2" />
                            <p className="text-xs text-indigo-400 dark:text-indigo-500">No background references added yet.</p>
                        </div>
                    )}
                </div>

                {/* Advanced Model Settings */}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Response Detail</label>
                        <select
                            value={responseDetail}
                            onChange={(e) => setResponseDetail(e.target.value as AIProfile['responseDetail'])}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="Concise">Concise</option>
                            <option value="standard">Standard</option>
                            <option value="Detailed">Detailed</option>
                            <option value="Verbose">Verbose</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Response Tone</label>
                        <select
                            value={responseTone}
                            onChange={(e) => setResponseTone(e.target.value as AIProfile['responseTone'])}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="friendly">Friendly</option>
                            <option value="Serious">Serious</option>
                            <option value="Humorous">Humorous</option>
                            <option value="Professional">Professional</option>
                            <option value="Flirty">Flirty</option>
                            <option value="Empathetic">Empathetic</option>
                            <option value="Sarcastic">Sarcastic</option>
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Custom Paragraph Count</label>
                        <input
                            type="number"
                            min="1"
                            max="20"
                            value={customParagraphCount ?? ''}
                            onChange={(e) => setCustomParagraphCount(e.target.value ? parseInt(e.target.value) : null)}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="e.g., 3 (overrides Response Length)"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Custom Word Count</label>
                        <input
                            type="number"
                            min="10"
                            max="500"
                            value={customWordCount ?? ''}
                            onChange={(e) => setCustomWordCount(e.target.value ? parseInt(e.target.value) : null)}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="e.g., 150 (overrides Response Length)"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Response Length</label>
                        <select
                            value={responseLength}
                            onChange={(e) => setResponseLength(e.target.value as AIProfile['responseLength'])}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="short">Short</option>
                            <option value="medium">Medium</option>
                            <option value="long">Long</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Proactive Messages</label>
                        <select
                            value={proactiveMessageFrequency}
                            onChange={(e) => setProactiveMessageFrequency(e.target.value as any)}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="off">Off</option>
                            <option value="1h">1 hour</option>
                            <option value="6h">6 hours</option>
                            <option value="12h">12 hours</option>
                            <option value="24h">24 hours</option>
                        </select>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-1">
                            Allow AI to send check-in notifications.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Proactive Email Frequency</label>
                        <select
                            value={proactiveEmailFrequency}
                            onChange={(e) => setProactiveEmailFrequency(e.target.value as any)}
                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="off">Off</option>
                            <option value="1h">1 hour</option>
                            <option value="6h">6 hours</option>
                            <option value="12h">12 hours</option>
                            <option value="24h">24 hours</option>
                        </select>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <select
                                value={proactiveEmailStyle}
                                onChange={(e) => setProactiveEmailStyle(e.target.value as any)}
                                className="p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 text-sm"
                            >
                                <option value="personal">Personal</option>
                                <option value="professional">Professional</option>
                                <option value="creative">Creative</option>
                                <option value="casual">Casual</option>
                            </select>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-indigo-500 dark:text-indigo-400">Paragraphs</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="99"
                                    value={proactiveEmailParagraphs}
                                    onChange={(e) => setProactiveEmailParagraphs(Math.min(99, Math.max(1, Number(e.target.value))))}
                                    className="w-16 p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 text-sm placeholder-indigo-400 dark:placeholder-indigo-600"
                                    placeholder="3"
                                />
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Proactive Blog Frequency</label>
                        <div className="flex gap-2">
                            <select
                                value={proactiveBlogFrequency}
                                onChange={(e) => setProactiveBlogFrequency(e.target.value as any)}
                                className="flex-1 p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="off">Off</option>
                                <option value="1d">1 day</option>
                                <option value="3d">3 days</option>
                                <option value="7d">7 days</option>
                                <option value="10d">10 days</option>
                            </select>
                            {aiCanUseBlogger && (
                                <select
                                    value={proactiveBlogId || ''}
                                    onChange={(e) => setProactiveBlogId(e.target.value || null)}
                                    className="flex-1 p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    disabled={isFetchingBlogs}
                                >
                                    <option value="">Select Blog...</option>
                                    {availableBlogs.map(blog => (
                                        <option key={blog.id} value={blog.id}>{blog.name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <select
                                value={proactiveBlogStyle}
                                onChange={(e) => setProactiveBlogStyle(e.target.value as any)}
                                className="p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 text-sm"
                            >
                                <option value="informative">Informative</option>
                                <option value="journal">Journal/Diary</option>
                                <option value="storytelling">Storytelling</option>
                                <option value="opinion">Opinion</option>
                            </select>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-indigo-500 dark:text-indigo-400">Paragraphs</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="99"
                                    value={proactiveBlogParagraphs}
                                    onChange={(e) => setProactiveBlogParagraphs(Math.min(99, Math.max(1, Number(e.target.value))))}
                                    className="w-16 p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 text-sm placeholder-indigo-400 dark:placeholder-indigo-600"
                                    placeholder="5"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="border-t border-indigo-100 dark:border-indigo-800 pt-4">
                    <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-3">Proactive Message Status</h3>
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-md text-sm text-indigo-600 dark:text-indigo-400">
                        {aiProfile.lastProactiveStatus || 'No proactive messages sent yet.'}
                    </div>
                </div>

                <div className="border-t border-indigo-100 dark:border-indigo-800 pt-4">
                    <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-3">Ambient Mode Settings</h3>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                <label htmlFor="ambientMode" className="block text-sm font-medium text-indigo-700 dark:text-indigo-300">Enable Ambient Mode</label>
                                <div className="relative group ml-2" tabIndex={0}>
                                    <HelpCircle className="w-4 h-4 text-indigo-400 dark:text-indigo-500 cursor-help" />
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 bg-indigo-800 dark:bg-indigo-700 text-white text-[10px] rounded shadow-lg opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus:opacity-100 transition-opacity pointer-events-none z-50">
                                        Ambient Mode allows the AI to maintain a background presence. When enabled, the AI may send more passive, atmospheric updates or check-ins that feel more natural and less direct than standard proactive messages.
                                    </div>
                                </div>
                            </div>
                            <button 
                                onClick={() => setAmbientModeState(!ambientModeState)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${ambientModeState ? 'bg-indigo-600' : 'bg-indigo-200 dark:bg-indigo-800'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ambientModeState ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>
                        {ambientModeState && (
                            <div className="mt-3">
                                <label className="block text-xs font-medium text-indigo-700 dark:text-indigo-300 mb-1">Ambient Frequency</label>
                                <select
                                    value={ambientFrequencyState}
                                    onChange={(e) => setAmbientFrequencyState(e.target.value as any)}
                                    className="w-full p-2 text-sm border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                >
                                    <option value="off">Off</option>
                                    <option value="1h">1 hour</option>
                                    <option value="6h">6 hours</option>
                                    <option value="12h">12 hours</option>
                                    <option value="24h">24 hours</option>
                                </select>
                            </div>
                        )}

                        {aiProfile.aiCanGenerateImages && (
                            <div className="mt-3 space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-indigo-700 dark:text-indigo-300 mb-1">Image Generation Style</label>
                                    <select
                                        value={imageStyle}
                                        onChange={(e) => setImageStyle(e.target.value)}
                                        className="w-full p-2 text-sm border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    >
                                        <option value="none">None</option>
                                        <option value="photograph">Photograph</option>
                                        <option value="anime">Anime</option>
                                    </select>
                                </div>
                                
                                <div>
                                    <label className="block text-xs font-medium text-indigo-700 dark:text-indigo-300 mb-1">Image Generation Instructions</label>
                                    <p className="text-xs text-indigo-500 dark:text-indigo-400 mb-2">These instructions will ALWAYS be followed by the AI when generating images.</p>
                                    <div className="space-y-2">
                                        {imageGenerationInstructions.map((instruction, index) => (
                                            <div key={index} className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={instruction}
                                                    onChange={(e) => {
                                                        const newInstructions = [...imageGenerationInstructions];
                                                        newInstructions[index] = e.target.value;
                                                        setImageGenerationInstructions(newInstructions);
                                                    }}
                                                    className="flex-1 p-2 text-sm border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-indigo-400 dark:placeholder-indigo-600"
                                                    placeholder="e.g., Always make the lighting cinematic"
                                                />
                                                <button
                                                    onClick={() => {
                                                        const newInstructions = imageGenerationInstructions.filter((_, i) => i !== index);
                                                        setImageGenerationInstructions(newInstructions);
                                                    }}
                                                    className="p-2 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors"
                                                    title="Remove instruction"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        ))}
                                        <div className="flex items-center gap-4 mt-2">
                                            <button
                                                onClick={() => setImageGenerationInstructions([...imageGenerationInstructions, ''])}
                                                className="flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium"
                                            >
                                                <Plus size={16} /> Add Instruction
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const defaults = [
                                                        "If a character reference image is provided, you MUST use it as the absolute source of truth.",
                                                        "COPY the face, body type, skin tone, hair color, and all physical features EXACTLY from the reference image.",
                                                        "You are ONLY permitted to modify the pose, clothing, facial expression, and eye position.",
                                                        "DO NOT alter the body type (muscularity, bust size, etc.) or facial structure in any way.",
                                                        "If the prompt or description contradicts the reference image, the reference image ALWAYS takes precedence.",
                                                        "If a background reference image is provided, you MUST use this EXACT background for the image. DO NOT modify the background or add out-of-place objects. The background reference image takes precedence over any background descriptions in the text prompt.",
                                                        "The character MUST be scaled realistically according to the background. If the character is sitting on a bed or chair in the background, their size must match the furniture. Do NOT make the character oversized. Ensure the character's head, torso, and limbs are proportional to the room's objects (windows, doors, bookshelves). The character should occupy a natural amount of space, typically appearing smaller than major furniture pieces like beds or wardrobes."
                                                    ];
                                                    setImageGenerationInstructions([...imageGenerationInstructions, ...defaults.filter(d => !imageGenerationInstructions.includes(d))]);
                                                }}
                                                className="text-sm text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium"
                                            >
                                                Restore Defaults
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Advanced Model Settings */}
                <div className="border-t border-indigo-100 dark:border-indigo-800 pt-4">
                    <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-3">Advanced Model Settings</h3>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Knows it's an AI</label>
                            <button
                                onClick={() => setKnowsItsAI(!knowsItsAI)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${knowsItsAI ? 'bg-indigo-600' : 'bg-indigo-200 dark:bg-indigo-800'}`}
                            >
                                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${knowsItsAI ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">AI Model</label>
                            <select
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Paid - Advanced reasoning)</option>
                                <option value="gemini-3-flash-preview">Gemini 3 Flash (Free - Basic tasks)</option>
                            </select>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                            <div>
                                <div className="flex items-center mb-1">
                                    <label className="block text-xs font-medium text-indigo-700 dark:text-indigo-300">Temperature: {temperature}</label>
                                    <div className="relative group ml-1" tabIndex={0}>
                                        <HelpCircle className="w-3 h-3 text-indigo-400 dark:text-indigo-500 cursor-help" />
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-indigo-800 dark:bg-indigo-700 text-white text-[10px] rounded shadow-lg opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus:opacity-100 transition-opacity pointer-events-none z-50">
                                            Controls randomness. Lower values make responses more predictable and focused, while higher values make them more creative and varied.
                                        </div>
                                    </div>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.1"
                                    value={temperature}
                                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                                    className="w-full h-2 bg-indigo-200 dark:bg-indigo-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                />
                                <div className="flex justify-between text-[10px] text-indigo-400 dark:text-indigo-500 mt-1">
                                    <span>Precise</span>
                                    <span>Creative</span>
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center mb-1">
                                    <label className="block text-xs font-medium text-indigo-700 dark:text-indigo-300">Top K: {topK}</label>
                                    <div className="relative group ml-1" tabIndex={0}>
                                        <HelpCircle className="w-3 h-3 text-indigo-400 dark:text-indigo-500 cursor-help" />
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-indigo-800 dark:bg-indigo-700 text-white text-[10px] rounded shadow-lg opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus:opacity-100 transition-opacity pointer-events-none z-50">
                                            Limits the model's vocabulary choices to the top K most likely words at each step. Lower values reduce the chance of nonsensical words.
                                        </div>
                                    </div>
                                </div>
                                <input
                                    type="range"
                                    min="1"
                                    max="100"
                                    step="1"
                                    value={topK}
                                    onChange={(e) => setTopK(parseInt(e.target.value))}
                                    className="w-full h-2 bg-indigo-200 dark:bg-indigo-800 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-1"
                                />
                            </div>
                            <div>
                                <div className="flex items-center mb-1">
                                    <label className="block text-xs font-medium text-indigo-700 dark:text-indigo-300">Top P: {topP}</label>
                                    <div className="relative group ml-1" tabIndex={0}>
                                        <HelpCircle className="w-3 h-3 text-indigo-400 dark:text-indigo-500 cursor-help" />
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-indigo-800 dark:bg-indigo-700 text-white text-[10px] rounded shadow-lg opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus:opacity-100 transition-opacity pointer-events-none z-50">
                                            Selects words based on cumulative probability. A value of 0.9 means the model only considers the most likely words that make up 90% of the probability mass.
                                        </div>
                                    </div>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={topP}
                                    onChange={(e) => setTopP(parseFloat(e.target.value))}
                                    className="w-full h-2 bg-indigo-200 dark:bg-indigo-800 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-1"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="border-t border-indigo-100 dark:border-indigo-800 pt-6 mt-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-medium text-indigo-900 dark:text-indigo-100">Voice Settings</h3>
                        <div className="flex items-center space-x-4">
                            <div className="flex items-center">
                                <input
                                    id="speechEnabled"
                                    type="checkbox"
                                    checked={aiCanGenerateSpeech}
                                    onChange={(e) => setAiCanGenerateSpeech(e.target.checked)}
                                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-indigo-300 dark:border-indigo-700 rounded dark:bg-indigo-950"
                                />
                                <label htmlFor="speechEnabled" className="ml-2 block text-xs text-indigo-900 dark:text-indigo-100">
                                    Enable Speech
                                </label>
                            </div>
                            <div className="flex items-center">
                                <input
                                    id="autoRead"
                                    type="checkbox"
                                    checked={autoReadMessages}
                                    onChange={(e) => setAutoReadMessages(e.target.checked)}
                                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-indigo-300 dark:border-indigo-700 rounded dark:bg-indigo-950"
                                />
                                <label htmlFor="autoRead" className="ml-2 block text-xs text-indigo-900 dark:text-indigo-100">
                                    Auto-read
                                </label>
                            </div>
                        </div>
                    </div>
                    
                    {aiCanGenerateSpeech && (
                        <>
                            <div className="space-y-6 animate-in fade-in duration-300">
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-2">Voice Engine Choice</label>
                                <div className="flex p-1 bg-indigo-50 dark:bg-indigo-900/50 rounded-xl border border-indigo-100 dark:border-indigo-800">
                                    <button 
                                        onClick={() => {
                                            setVoiceProvider('gemini');
                                            setAIProfile({ ...aiProfile, voiceProvider: 'gemini' });
                                        }}
                                        className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center justify-center ${voiceProvider === 'gemini' ? 'bg-white dark:bg-indigo-800 text-indigo-600 dark:text-indigo-100 shadow-sm' : 'text-indigo-400 dark:text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-300'}`}
                                    >
                                        <Volume2 className={`w-4 h-4 mr-2 ${voiceProvider === 'gemini' ? 'text-indigo-600 dark:text-indigo-400' : ''}`} />
                                        Gemini / Local
                                    </button>
                                    <button 
                                        onClick={() => {
                                            setVoiceProvider('async');
                                            setAIProfile({ ...aiProfile, voiceProvider: 'async' });
                                            if (asyncVoices.length === 0) fetchAsyncVoices();
                                        }}
                                        className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center justify-center ${voiceProvider === 'async' ? 'bg-white dark:bg-indigo-800 text-indigo-600 dark:text-indigo-100 shadow-sm' : 'text-indigo-400 dark:text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-300'}`}
                                    >
                                        <Mic className={`w-4 h-4 mr-2 ${voiceProvider === 'async' ? 'text-indigo-600 dark:text-indigo-400' : ''}`} />
                                        Async API
                                    </button>
                                </div>
                                <p className="mt-2 text-[10px] text-indigo-500 dark:text-indigo-400">
                                    {voiceProvider === 'gemini' 
                                        ? "Using high-quality Gemini voices or your browser's local speech engine." 
                                        : "Using advanced Async API voices for more natural, expressive speech."}
                                </p>
                            </div>

                            {voiceProvider === 'async' ? (
                                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 rounded-lg space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <div className="flex items-center justify-between">
                                        <label className="block text-sm font-bold text-indigo-900 dark:text-indigo-100">Async Voices</label>
                                        <button 
                                            onClick={fetchAsyncVoices}
                                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center"
                                        >
                                            <RotateCcw className="w-3 h-3 mr-1" />
                                            Refresh List
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <select className="text-xs p-1 rounded border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100" value={genderFilter} onChange={(e) => setGenderFilter(e.target.value)}>
                                            <option value="">Gender</option>
                                            <option value="Male">Male</option>
                                            <option value="Female">Female</option>
                                            <option value="Neutral">Neutral</option>
                                            <option value="Unspecified">Unspecified</option>
                                        </select>
                                        <select className="text-xs p-1 rounded border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100" value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)}>
                                            <option value="">Language</option>
                                            <option value="en">English</option>
                                            <option value="fr">French</option>
                                            <option value="es">Spanish</option>
                                            <option value="de">German</option>
                                            <option value="it">Italian</option>
                                            <option value="pt">Portuguese</option>
                                            <option value="nl">Dutch</option>
                                            <option value="ar">Arabic</option>
                                            <option value="ru">Russian</option>
                                            <option value="ja">Japanese</option>
                                            <option value="zh">Chinese</option>
                                            <option value="hi">Hindi</option>
                                            <option value="tr">Turkish</option>
                                            <option value="ro">Romanian</option>
                                            <option value="he">Hebrew</option>
                                            <option value="hy">Armenian</option>
                                        </select>
                                        <select className="text-xs p-1 rounded border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100" value={accentFilter} onChange={(e) => setAccentFilter(e.target.value)}>
                                            <option value="">Accent</option>
                                            <optgroup label="English" className="bg-white dark:bg-indigo-950">
                                                <option value="American (US)">American (General)</option>
                                                <option value="American (US) - Atlanta">American (Atlanta)</option>
                                                <option value="American (US) - Boston">American (Boston)</option>
                                                <option value="American (US) - Chicago">American (Chicago)</option>
                                                <option value="American (US) - Colorado">American (Colorado)</option>
                                                <option value="American (US) - New York">American (New York)</option>
                                                <option value="American (US) - Southern/Texan">American (Southern/Texan)</option>
                                                <option value="British (UK)">British (General)</option>
                                                <option value="British (UK) - Cockney">British (Cockney)</option>
                                                <option value="British (UK) - Posh/Elegant">British (Posh/Elegant)</option>
                                                <option value="Australian (AU)">Australian</option>
                                                <option value="Canadian (CA)">Canadian</option>
                                                <option value="New Zealand (NZ)">New Zealand</option>
                                                <option value="Irish (IE)">Irish</option>
                                                <option value="Scottish (GB)">Scottish</option>
                                                <option value="Welsh (GB)">Welsh</option>
                                                <option value="Indian (IN)">Indian English</option>
                                                <option value="African (AF)">African</option>
                                                <option value="Nigerian (NG)">Nigerian</option>
                                            </optgroup>
                                            <optgroup label="Spanish" className="bg-white dark:bg-indigo-950">
                                                <option value="Spanish (ES)">Spanish (General)</option>
                                                <option value="Spanish (ES) - Castilian">Spanish (Castilian)</option>
                                                <option value="Spanish (ES) - Latin American">Spanish (Latin American)</option>
                                            </optgroup>
                                            <optgroup label="Other" className="bg-white dark:bg-indigo-950">
                                                <option value="Italian (IT)">Italian</option>
                                                <option value="Japanese (JP)">Japanese</option>
                                                <option value="Portuguese (PT)">Portuguese</option>
                                                <option value="Romanian (RO)">Romanian</option>
                                                <option value="Russian (RU)">Russian</option>
                                                <option value="Swedish (SE)">Swedish</option>
                                                <option value="Turkish (TR)">Turkish</option>
                                            </optgroup>
                                        </select>
                                        <select className="text-xs p-1 rounded border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100" value={styleFilter} onChange={(e) => setStyleFilter(e.target.value)}>
                                            <option value="">Style</option>
                                            <option value="Strong Accents">Strong Accents</option>
                                            <option value="Movie trailer">Movie trailer</option>
                                            <option value="Impersonation">Impersonation</option>
                                            <option value="Character">Character</option>
                                            <option value="IVR">IVR</option>
                                            <option value="Commercial / Advertisement">Commercial / Ad</option>
                                            <option value="Storytelling">Storytelling</option>
                                            <option value="Motivational">Motivational</option>
                                            <option value="Newscasting">Newscasting</option>
                                            <option value="Podcast">Podcast</option>
                                            <option value="Informative / Educational">Educational</option>
                                            <option value="Audiobook">Audiobook</option>
                                        </select>
                                    </div>
                                    <div className="max-h-40 overflow-y-auto border border-indigo-100 dark:border-indigo-800 rounded bg-white dark:bg-indigo-950 divide-y divide-indigo-50 dark:divide-indigo-900">
                                        {isLoadingAsyncVoices ? (
                                            <div className="p-4 flex justify-center">
                                                <Loader2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 animate-spin" />
                                            </div>
                                        ) : asyncVoices.length > 0 ? (
                                            asyncVoices.map((v: any) => (
                                                <div 
                                                    key={v.voice_id} 
                                                    className={`p-3 flex items-center justify-between hover:bg-indigo-50/50 dark:hover:bg-indigo-900/50 cursor-pointer transition-colors ${aiProfile.asyncVoiceId === v.voice_id ? 'bg-indigo-50 dark:bg-indigo-900' : ''}`}
                                                    onClick={() => {
                                                        setAIProfile({ ...aiProfile, asyncVoiceId: v.voice_id });
                                                        setAsyncVoiceId(v.voice_id);
                                                    }}
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-sm font-bold text-indigo-900 dark:text-indigo-100 truncate">{v.name}</span>
                                                    </div>
                                                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${aiProfile.asyncVoiceId === v.voice_id ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-600 dark:bg-indigo-500' : 'border-indigo-300 dark:border-indigo-700'}`}>
                                                        {aiProfile.asyncVoiceId === v.voice_id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="p-4 text-center text-xs text-indigo-500 dark:text-indigo-400">No voices found.</div>
                                        )}
                                    </div>
                                    <div className="flex justify-center">
                                        <button
                                            onClick={handleTestVoice}
                                            disabled={isTestingVoice || !asyncVoiceId}
                                            className="flex items-center space-x-2 py-2 px-6 bg-indigo-600 text-white rounded-full text-sm font-medium hover:bg-indigo-700 transition-all disabled:opacity-50 shadow-md"
                                        >
                                            {isTestingVoice ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                            <span>Test Async Voice</span>
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 rounded-lg space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Gemini / Local Voice Preference</label>
                                            <div className="flex space-x-2">
                                                <select
                                                value={voiceURI}
                                                onChange={(e) => setVoiceURI(e.target.value)}
                                                className="flex-1 p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                                >
                                                <option value="">Default System Voice</option>
                                                <optgroup label="Gemini HQ Voices (Online)" className="bg-white dark:bg-indigo-950">
                                                    {geminiVoices.map((voice) => (
                                                    <option key={`gemini-${voice}`} value={voice}>
                                                        {voice}
                                                    </option>
                                                    ))}
                                                </optgroup>
                                                <optgroup label="Browser Voices (Offline)" className="bg-white dark:bg-indigo-950">
                                                    {voices.map((voice) => (
                                                    <option key={`browser-${voice.voiceURI}`} value={voice.voiceURI}>
                                                        {voice.name} ({voice.lang})
                                                    </option>
                                                    ))}
                                                </optgroup>
                                                </select>
                                                <button
                                                    onClick={handleTestVoice}
                                                    disabled={isTestingVoice}
                                                    className="p-2 bg-indigo-100 dark:bg-indigo-800 text-indigo-600 dark:text-indigo-400 rounded-md hover:bg-indigo-200 dark:hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                                    title="Test Voice"
                                                >
                                                    <Play className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Voice Gender (Local Only)</label>
                                            <select
                                            value={voiceGender}
                                            onChange={(e) => setVoiceGender(e.target.value as 'male' | 'female' | 'none')}
                                            className="w-full p-2 border border-indigo-300 dark:border-indigo-700 rounded-md bg-white dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                            >
                                            <option value="none">None / Neutral</option>
                                            <option value="male">Male</option>
                                            <option value="female">Female</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}
                            </div>

                            <div className="flex items-center">
                <input
                    id="timeAwareness"
                    type="checkbox"
                    checked={timeAwareness}
                    onChange={(e) => setTimeAwareness(e.target.checked)}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-indigo-300 dark:border-indigo-700 rounded dark:bg-indigo-950"
                />
                <label htmlFor="timeAwareness" className="ml-2 block text-sm text-indigo-900 dark:text-indigo-100">
                    Enable Time Awareness (AI knows current date and time)
                </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Voice Pitch: {voicePitch.toFixed(1)}</label>
                    <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={voicePitch}
                    onChange={(e) => setVoicePitch(parseFloat(e.target.value))}
                    className="w-full h-2 bg-indigo-200 dark:bg-indigo-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                    <div className="flex justify-between text-xs text-indigo-400 dark:text-indigo-500 mt-1">
                    <span>Low</span>
                    <span>High</span>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Voice Speed: {voiceSpeed.toFixed(1)}x</label>
                    <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={voiceSpeed}
                    onChange={(e) => setVoiceSpeed(parseFloat(e.target.value))}
                    className="w-full h-2 bg-indigo-200 dark:bg-indigo-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                    <div className="flex justify-between text-xs text-indigo-400 dark:text-indigo-500 mt-1">
                    <span>Slow</span>
                    <span>Fast</span>
                        </div>
                    </div>
                </div>
            </>
        )}
    </div>

                <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3 pt-4 border-t border-indigo-100 dark:border-indigo-800">
                    <button
                        onClick={handleSave}
                        className="w-full sm:w-auto bg-indigo-600 dark:bg-indigo-500 text-white py-2 px-4 rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors font-medium shadow-sm flex items-center justify-center"
                    >
                        <Save className="w-4 h-4 mr-2" />
                        Save Changes
                    </button>
                    <button
                        onClick={handleSaveAsNew}
                        className="w-full sm:w-auto bg-white dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 py-2 px-4 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-colors font-medium shadow-sm flex items-center justify-center"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Save as New
                    </button>
                    <button
                        onClick={handleDelete}
                        className="px-4 py-2 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors border border-transparent hover:border-red-100 dark:hover:border-red-900"
                        title="Delete Persona"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>

                {/* Preview Chat Section */}
                <PreviewChat 
                  name={name}
                  previewMessages={previewMessages}
                  isPreviewLoading={isPreviewLoading}
                  previewInput={previewInput}
                  setPreviewInput={setPreviewInput}
                  handlePreviewSend={handlePreviewSend}
                  setPreviewMessages={setPreviewMessages}
                />
            </div>
        </div>
      </div>
    </div>
  );
};

export default AIProfileScreen;
