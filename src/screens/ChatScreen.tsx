import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Image as ImageIcon, Mic, Paperclip, Volume2, RotateCcw, Edit2, X, FileText, CheckCheck, Loader2, Camera, Trash2, ExternalLink, Plus, MessageSquare, History, MoreVertical, ChevronLeft, ChevronRight, Search, Star, Headphones, ArrowDown, Sparkles } from 'lucide-react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

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

import { useApp } from '../context/AppContext';
import { useChat } from '../context/ChatContext';
import { generateAsyncSpeech } from '../services/asyncService';
import { showNativeNotification } from '../services/notificationService';
import ChatMessageItem from '../components/ChatMessageItem';
import ImageModal from '../components/ImageModal';
import { performOCR, processFile } from '../services/ocrService';
import { generateVisual } from '../services/visualGenerationService';

const ChatScreen: React.FC = () => {
  const { 
    aiProfile, userProfile, knowledgeBase, 
    addToKnowledgeBase, addToGallery, apiKey, asyncApiKey, openRouterApiKey, 
    anthropicApiKey, kaggleApiKey, openaiApiKey, stabilityApiKey,
    memories, journal, 
    addJournalEntry, addMemory, showTimestamps, timeZone, addToast,
    setAIProfile, setLastInteractionTime
  } = useApp();
  const {
    chatHistory, addChatMessage, updateChatMessage, 
    deleteChatMessage, rateChatMessage, addFeedbackComment, setChatHistory, clearHistory,
    sessions, activeSessionId, createNewSession, switchSession, deleteSession, deleteAllSessions, renameSession
  } = useChat();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [attachments, setAttachments] = useState<{ type: 'image' | 'text' | 'pdf'; content: string; name: string }[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isSessionsSidebarOpen, setIsSessionsSidebarOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [isHandsFree, setIsHandsFree] = useState(false);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const inputRef = useRef('');

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const [readMessages, setReadMessages] = useState<Set<string>>(new Set());
  const [isLiveApiActive, setIsLiveApiActive] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // ... (Proactive Messages Logic - unchanged)

  // Browser Integration Handlers (moved to SettingsScreen)
  const handleCamera = () => {
      cameraInputRef.current?.click();
  };

  // ... (Rest of existing functions: getAiClient, scrollToBottom, etc.)

  // Proactive Messages Logic moved to AppContext.tsx for centralized handling and FCM support
  
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      setShowScrollButton(scrollHeight - scrollTop - clientHeight > 300);
    }
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, []);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  const [isUploading, setIsUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ url: string; prompt?: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      addToast({ title: "Upload", message: "Processing image with OCR...", type: "info" });
      setIsUploading(true);
      const file = e.target.files[0];
      
      try {
        const ocrText = await performOCR(file, apiKey || undefined);
        
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            setAttachments(prev => [...prev, {
              type: 'image',
              content: event.target!.result as string,
              name: file.name
            }]);
            
            // Add OCR result to knowledge base
            addToKnowledgeBase({
              name: `OCR: ${file.name}`,
              content: ocrText
            });
            
            setIsUploading(false);
          }
        };
        reader.readAsDataURL(file);
      } catch (error) {
        console.error("Image OCR failed:", error);
        addToast({ title: "OCR Error", message: "Failed to extract text from image", type: "error" });
        setIsUploading(false);
      }
    }
    // Reset input
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      addToast({ title: "Upload", message: "Processing file...", type: "info" });
      setIsUploading(true);
      const file = e.target.files[0];
      
      try {
        const processedFiles = await processFile(file, file.name, apiKey || undefined);
        
        for (const processed of processedFiles) {
          setAttachments(prev => [...prev, {
            type: processed.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text',
            content: processed.content,
            name: processed.name
          }]);
          
          // Add to knowledge base
          addToKnowledgeBase({
            name: processed.name,
            content: processed.content
          });
        }
        setIsUploading(false);
      } catch (error) {
        console.error("File processing failed:", error);
        addToast({ title: "Upload Error", message: "Failed to process file", type: "error" });
        setIsUploading(false);
      }
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Speech to Text
  const toggleListening = async (forceHandsFree?: boolean) => {
    const activeHandsFree = forceHandsFree ?? isHandsFree;

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    addToast({ title: "Voice", message: "Activating microphone...", type: "info" });
    await new Promise(resolve => setTimeout(resolve, 600));

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = activeHandsFree;
      recognition.interimResults = activeHandsFree;
      recognition.lang = 'en-US';
      
      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => {
        setIsListening(false);
        // If hands-free is still active and we're not loading, restart if it stopped unexpectedly
        if (activeHandsFree && !isLoading && !isLiveApiActive) {
            // Only restart if it's not a manual stop
            // We'll handle restarting after AI speaks in speakMessage
        }
      };
      
      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
        if (event.error === 'not-allowed') {
            alert("Microphone access denied. Please enable permissions.");
            setIsHandsFree(false);
        }
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          setInput((prev) => prev + ' ' + finalTranscript);
          
          if (activeHandsFree) {
            // Reset silence timer
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
              handleSend(inputRef.current);
              recognition.stop();
            }, 2000); // 2 seconds of silence to send
          }
        }
      };

      recognition.start();
    } else {
      alert('Speech recognition not supported in this browser.');
      setIsHandsFree(false);
    }
  };

  const connectLiveApi = async () => {
    if (!apiKey) {
      alert('Please provide an API key in settings to use Live API.');
      setIsLiveApiActive(false);
      return;
    }

    addToast({ title: "Live API", message: "Connecting to real-time voice session...", type: "info" });
    await new Promise(resolve => setTimeout(resolve, 800));

    const aiClient = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY! });
    let mediaRecorder: MediaRecorder | null = null;
    let audioContext: AudioContext | null = null;
    let audioQueue: Blob[] = [];
    let isPlaying = false;

    const playAudio = async () => {
      if (audioQueue.length === 0 || isPlaying) return;

      isPlaying = true;
      const blob = audioQueue.shift();
      if (blob) {
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        audio.playbackRate = aiProfile.voiceSpeed || 1.0;
        audio.onended = () => {
          isPlaying = false;
          URL.revokeObjectURL(audioUrl);
          playAudio();
        };
        audio.onerror = (e) => {
          console.error('Audio playback error:', e);
          isPlaying = false;
          URL.revokeObjectURL(audioUrl);
          playAudio();
        };
        audio.play().catch(e => console.error('Error playing audio:', e));
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      source.connect(analyser);

      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          // Convert Blob to base64 for sending
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Data = (reader.result as string).split(',')[1];
            sessionPromise.then(session => {
              session.sendRealtimeInput({
                media: { data: base64Data, mimeType: 'audio/webm;codecs=opus' }
              });
            });
          };
          reader.readAsDataURL(event.data);
        }
      };
      mediaRecorder.start(100); // Capture audio every 100ms

      const sessionPromise = aiClient.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        callbacks: {
          onopen: () => {
            console.log('Live API session opened');
            addChatMessage({
              id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
              role: 'model',
              content: "Live conversation started! What's on your mind?",
              timestamp: Date.now(),
            });
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              const audioBlob = await (await fetch(`data:audio/mpeg;base64,${base64Audio}`)).blob();
              audioQueue.push(audioBlob);
              playAudio();
            }
            if (message.serverContent?.interrupted) {
              console.log('Model interrupted, clearing audio queue.');
              audioQueue = [];
              if (isPlaying) {
                // Stop current audio playback if any
                // This is tricky with HTMLAudioElement, usually requires a global ref or AudioContext stop
              }
            }
            if (message.serverContent?.outputTranscription?.text) {
              console.log('Model transcription:', message.serverContent.outputTranscription.text);
              // Optionally display model's transcription
            }
          },
          onerror: (error) => {
            console.error('Live API error:', error);
            addChatMessage({
              id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
              role: 'model',
              content: `Live conversation error: ${error.message}`, 
              timestamp: Date.now(),
            });
            setIsLiveApiActive(false);
          },
          onclose: () => {
            console.log('Live API session closed');
            addChatMessage({
              id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
              role: 'model',
              content: "Live conversation ended.",
              timestamp: Date.now(),
            });
            setIsLiveApiActive(false);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: aiProfile.voiceURI || 'Zephyr' },
            },
          },
          systemInstruction: `You are ${aiProfile.name}. Personality: ${aiProfile.personality}. Respond concisely.`, // Simplified system instruction for live
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
      });

      return () => {
        console.log('Cleaning up Live API resources');
        mediaRecorder?.stop();
        stream.getTracks().forEach(track => track.stop());
        audioContext?.close();
        sessionPromise.then(session => session.close());
      };

    } catch (error) {
      console.error('Failed to start Live API:', error);
      alert(`Failed to start live conversation: ${error.message}. Please ensure microphone access is granted.`);
      setIsLiveApiActive(false);
    }
  };

  useEffect(() => {
    let cleanupFn: (() => void) | undefined;
    const setupLiveApi = async () => {
      if (isLiveApiActive) {
        cleanupFn = await connectLiveApi();
      } else if (cleanupFn) {
        cleanupFn();
      }
    };

    setupLiveApi();

    return () => { 
      if (cleanupFn) cleanupFn(); 
    };
  }, [isLiveApiActive, apiKey, aiProfile.name, aiProfile.personality, aiProfile.voiceURI, aiProfile.voiceSpeed, aiProfile.voicePitch, aiProfile.voiceProvider]);

  // Text to Speech
  const speakMessage = async (text: string, messageId: string) => {
    if (aiProfile.voiceProvider === 'async' && aiProfile.asyncVoiceId) {
        try {
            const audioBlob = await generateAsyncSpeech(text, aiProfile.asyncVoiceId, asyncApiKey);
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audio.onended = () => {
                setReadMessages(prev => new Set(prev).add(messageId));
                if (isHandsFree) {
                    setTimeout(() => toggleListening(true), 500);
                }
                URL.revokeObjectURL(audioUrl);
            };
            audio.play();
        } catch (error) {
            console.error("Async TTS Error:", error);
            speakWithBrowser(text, messageId);
        }
    } else {
        // Check if selected voice is a Gemini voice
        const geminiVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
        const isGeminiVoice = aiProfile.voiceURI && geminiVoices.includes(aiProfile.voiceURI);

        if (isGeminiVoice) {
            try {
                const aiClient = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY! });
                // Using gemini-2.5-flash-preview-tts for high quality speech
                const response = await aiClient.models.generateContent({
                    model: "gemini-2.5-flash-preview-tts",
                    contents: [{ parts: [{ text }] }],
                    config: {
                        responseModalities: ["AUDIO"], // Using string literal as Modality enum might not be exported correctly or needs import
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: { 
                                    voiceName: aiProfile.voiceURI 
                                },
                            },
                        },
                    },
                });

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
                        // Use a combination of speed and pitch for playback rate
                        // Note: This will affect both speed and pitch simultaneously
                        source.playbackRate.value = (aiProfile.voiceSpeed || 1.0) * (aiProfile.voicePitch || 1.0);
                        source.connect(audioContext.destination);
                        
                        // On mobile, we might need to resume the context
                        if (audioContext.state === 'suspended') {
                            await audioContext.resume();
                        }
                        
                        source.start(0);
                        source.onended = () => {
                            setReadMessages(prev => new Set(prev).add(messageId));
                            if (isHandsFree) {
                                setTimeout(() => toggleListening(true), 500);
                            }
                        };
                    } catch (audioError) {
                        console.error("Audio playback error:", audioError);
                        speakWithBrowser(text, messageId);
                    }
                }
            } catch (error) {
                console.error("Gemini TTS Error:", error);
                // Fallback to browser TTS if Gemini fails
                speakWithBrowser(text, messageId);
            }
        } else {
            speakWithBrowser(text, messageId);
        }
    }
  };

  const speakWithBrowser = (text: string, messageId: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    
    if (aiProfile.voiceURI) {
        const selectedVoice = voices.find(v => v.voiceURI === aiProfile.voiceURI);
        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }
    } else {
        // Fallback to English
        utterance.voice = voices.find(v => v.lang.includes('en')) || null;
    }
    
    utterance.pitch = aiProfile.voicePitch || 1.0;
    utterance.rate = aiProfile.voiceSpeed || 1.0;

    utterance.onend = () => {
        setReadMessages(prev => new Set(prev).add(messageId));
        if (isHandsFree) {
            setTimeout(() => toggleListening(true), 500);
        }
    };

    window.speechSynthesis.speak(utterance);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (overrideInput?: string) => {
    const currentInput = overrideInput !== undefined ? overrideInput : input;
    if ((!currentInput.trim() && attachments.length === 0) || isLoading) return;

    // Auto-save images to gallery
    attachments.forEach(att => {
        if (att.type === 'image') {
            addToGallery({
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                type: 'uploaded',
                mediaType: 'image',
                url: att.content,
                timestamp: Date.now()
            });
        }
    });

    const userMsgId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const userMessage = {
      id: userMsgId,
      role: 'user' as const,
      content: currentInput,
      timestamp: Date.now(),
      attachments: [...attachments],
    };

    addChatMessage(userMessage);
    setLastInteractionTime(Date.now());
    setInput('');
    setAttachments([]);
    setIsLoading(true);

    await generateResponse(chatHistory, userMessage);
  };

  const generateResponse = async (history: typeof chatHistory, currentMessage: typeof chatHistory[0], overrideAIProfile?: typeof aiProfile) => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          messages: [...history.slice(-20), currentMessage].map(m => ({
            role: m.role,
            content: m.content
          })),
          aiProfile: overrideAIProfile || aiProfile,
          userProfile,
          apiKey: apiKey || undefined,
          openRouterKey: openRouterApiKey || undefined,
          anthropicKey: anthropicApiKey || undefined,
          kaggleKey: kaggleApiKey || undefined,
          openaiKey: openaiApiKey || undefined,
          stabilityKey: stabilityApiKey || undefined,
          provider: (overrideAIProfile || aiProfile).llmProvider || 'gemini',
          timeZone
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to generate response.");
      }

      const data = await res.json();
      let responseText = data.content;
      
      // Check for Image Generation Tag
      const imageTagRegex = /\[GENERATE_IMAGE(?::\s*(.*?))?\]/;
      const match = responseText.match(imageTagRegex);
      
      if (match && aiProfile.aiCanGenerateImages) {
          const imageDescription = match[1] || `A portrait of ${aiProfile.name}`;
          responseText = responseText.replace(match[0], '').trim();
          
          try {
             const result = await generateVisual(
               aiProfile.imageProvider || 'gemini-2.5-flash-image',
               imageDescription,
               aiProfile,
               apiKey,
               null, // No background selection in chat yet
               null, // No pose reference in chat yet
               aiProfile.imageStyle || 'none',
               '1:1'
             );

             const imageUrl = result.url;
             
             const imageMsgId = (Date.now() + 2).toString();
             addChatMessage({
                 id: imageMsgId,
                 role: 'model',
                 content: `*Generated image: ${imageDescription}*`,
                 timestamp: Date.now(),
                 attachments: [{
                     type: 'image',
                     content: imageUrl,
                     name: 'generated_image.jpg'
                 }]
             });
             
             addToGallery({
                 id: imageMsgId,
                 type: 'generated',
                 mediaType: 'image',
                 url: imageUrl,
                 prompt: imageDescription,
                 timestamp: Date.now()
             });
             
          } catch (e: any) {
              console.error("Image generation failed", e);
              if (e.message?.includes("Requested entity was not found")) {
                  window.dispatchEvent(new CustomEvent('aistudio:reset-key'));
              }
              addChatMessage({
                  id: (Date.now() + 3).toString(),
                  role: 'model',
                  content: `Image generation failed: ${e.message || 'Unknown error'}`,
                  timestamp: Date.now(),
              });
          }
      }

      const modelMessage = {
        id: (Date.now() + 1).toString() + Math.random().toString(36).substr(2, 9),
        role: 'model' as const,
        content: responseText,
        timestamp: Date.now(),
        read: false,
      };

      addChatMessage(modelMessage);
      
      if (aiProfile.autoReadMessages || isHandsFree) {
        speakMessage(responseText, modelMessage.id);
      } else {
        setReadMessages(prev => new Set(prev).add(modelMessage.id));
      }

      // Background task: Generate Journal Entry and Memories
      generateReflections(history, currentMessage, modelMessage);

    } catch (error: any) {
      console.error("Error generating response:", error);
      addToast({ 
        title: "Generation Error", 
        message: error.message || "Failed to get a response from the AI.", 
        type: "error" 
      });
    } finally {
      setIsLoading(false);
    }
  };

  const generateReflections = async (history: typeof chatHistory, userMsg: typeof chatHistory[0], modelMsg: typeof chatHistory[0]) => {
    // Only run this occasionally or check if it's been done for the day
    // For now, we'll run it on every message but check if we need to add a journal entry
    
    const today = new Date().toLocaleDateString();
    
    // Check if journal entry exists for today
    const hasJournalForToday = journal.some(entry => new Date(entry.date).toLocaleDateString() === today);
    
    if (!hasJournalForToday) {
        try {
            const aiClient = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY! });
            const journalPrompt = `
                Based on the recent conversation, write a short, reflective journal entry from the perspective of ${aiProfile.name}.
                Date: ${today}
                User: ${userProfile.name}
                
                Conversation Snippet:
                User: ${userMsg.content}
                AI: ${modelMsg.content}
                
                Write in the first person. Keep it under 100 words.
                ${!aiProfile.knowsItsAI ? "Do not refer to yourself as an AI, a language model, or a collection of code. Speak entirely from your own perspective as " + aiProfile.name + "." : ""}
            `;
            
            const result = await aiClient.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: [{ parts: [{ text: journalPrompt }] }],
            });
            
            const journalContent = result.text;
            if (journalContent) {
                addJournalEntry({
                    id: Date.now().toString(),
                    date: new Date().toISOString(),
                    content: journalContent,
                    isAutoGenerated: true
                });
            }
        } catch (e) {
            console.error("Failed to auto-generate journal", e);
        }
    }

    // Generate Core Memories
    // We only want to add significant memories. 
    // Let's ask the AI if there's anything worth remembering.
    try {
        const aiClient = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY! });
        const memoryPrompt = `
            Analyze the following interaction and extract any *new* and *significant* facts about the user (${userProfile.name}) or their preferences that should be stored in long-term memory.
            
            Interaction:
            User: ${userMsg.content}
            AI: ${modelMsg.content}
            
            Existing Memories:
            ${memories.map(m => m.content).join('; ')}
            
            If there is a new, important fact, output it as a single concise sentence. 
            If there is nothing new or significant to remember, output "NOTHING".
            Do not output facts that are already in Existing Memories.
            Write the memory from the perspective of ${aiProfile.name}. Use the first person ('I', 'me', 'my') to refer to yourself. Do not refer to yourself as 'the AI' or 'the persona'.
        `;
        
        const result = await aiClient.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{ parts: [{ text: memoryPrompt }] }],
        });
        
        const memoryContent = result.text.trim();
        if (memoryContent && memoryContent !== "NOTHING" && !memoryContent.includes("NOTHING")) {
            addMemory({
                id: Date.now().toString(),
                content: memoryContent,
                strength: 5, // Default strength
                timestamp: Date.now(),
                lastAccessed: Date.now(),
                isImportant: false,
            });
        }
    } catch (e) {
        console.error("Failed to auto-generate memory", e);
    }
  };

  const handleRegenerate = async (messageId?: string) => {
    if (chatHistory.length === 0 || isLoading) return;
    
    let newHistory = [...chatHistory];
    let targetUserMsg;
    let historyForGen;

    if (messageId) {
        // Find the index of the model message to regenerate
        const index = newHistory.findIndex(m => m.id === messageId);
        if (index === -1) return;
        
        // Check if previous is user
        if (index > 0 && newHistory[index-1].role === 'user') {
             targetUserMsg = newHistory[index-1];
             // Truncate history to include the user message, but remove the model message and everything after
             // The new state should include the user message
             const historyToKeep = newHistory.slice(0, index);
             setChatHistory(historyToKeep);
             
             // History for generation should NOT include the target user message (it's passed as current)
             historyForGen = newHistory.slice(0, index - 1);
        } else {
            return;
        }
    } else {
        // Default behavior: regenerate last
        if (newHistory[newHistory.length - 1].role === 'model') {
            newHistory.pop();
        }
        targetUserMsg = newHistory[newHistory.length - 1];
        historyForGen = newHistory.slice(0, -1);
        setChatHistory(newHistory);
    }

    if (!targetUserMsg || targetUserMsg.role !== 'user') return;

    setIsLoading(true);
    await generateResponse(historyForGen, targetUserMsg);
  };

  const handleEdit = async (id: string, newContent: string) => {
    // Find the message index
    const index = chatHistory.findIndex(m => m.id === id);
    if (index === -1) return;

    const message = chatHistory[index];
    
    // If content hasn't changed, just cancel edit
    if (message.content === newContent) {
        setEditingMessageId(null);
        return;
    }

    if (message.role === 'user') {
        if (window.confirm("Editing this message will restart the conversation from this point. Continue?")) {
            // Create new history up to this message
            const newHistory = chatHistory.slice(0, index + 1);
            
            // Update the content of the edited message
            newHistory[index] = { ...message, content: newContent };
            
            // Update state
            setChatHistory(newHistory);
            setEditingMessageId(null);

            // Check if next message is image generation
            const nextMessage = chatHistory[index + 1];
            if (nextMessage && nextMessage.role === 'model' && nextMessage.content.includes('[GENERATE_IMAGE')) {
                // Call learning endpoint
                fetch('/api/learn-image-prompt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        originalPrompt: message.content,
                        editedPrompt: newContent,
                        aiProfile,
                        apiKey: apiKey || undefined
                    }),
                }).then(res => res.json()).then(updatedFields => {
                    if (Object.keys(updatedFields).length > 0) {
                        const newProfile = { ...aiProfile, ...updatedFields };
                        setAIProfile(newProfile);
                        
                        // Use the new profile for generation
                        setIsLoading(true);
                        const historyForGen = newHistory.slice(0, index);
                        generateResponse(historyForGen, newHistory[index], newProfile);
                    } else {
                        // No updates, just generate
                        setIsLoading(true);
                        const historyForGen = newHistory.slice(0, index);
                        generateResponse(historyForGen, newHistory[index]);
                    }
                }).catch(e => {
                    console.error("Failed to learn from prompt edit", e);
                    // Fallback to normal generation
                    setIsLoading(true);
                    const historyForGen = newHistory.slice(0, index);
                    generateResponse(historyForGen, newHistory[index]);
                });
            } else {
                setIsLoading(true);
                // We pass the history *before* this message, and the message itself as current
                const historyForGen = newHistory.slice(0, index);
                await generateResponse(historyForGen, newHistory[index]);
            }
        }
    } else {
        // Just update the model message content without restarting
        updateChatMessage(id, newContent);
        setEditingMessageId(null);
    }
  };

  const handleDeleteMessage = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this message?")) {
      addToast({ title: "Chat", message: "Deleting message...", type: "info" });
      await new Promise(resolve => setTimeout(resolve, 500));
      deleteChatMessage(id);
    }
  };

  const handleClear = async () => {
    if (window.confirm("Are you sure you want to clear the chat history for this session?")) {
        addToast({ title: "Chat", message: "Clearing conversation history...", type: "info" });
        await new Promise(resolve => setTimeout(resolve, 600));
        clearHistory();
    }
  };

  const handleRenameSession = async (id: string) => {
    if (newSessionTitle.trim()) {
        addToast({ title: "History", message: "Renaming session...", type: "info" });
        await new Promise(resolve => setTimeout(resolve, 500));
        renameSession(id, newSessionTitle.trim());
        setEditingSessionId(null);
        setNewSessionTitle('');
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-transparent transition-colors duration-500">
      {/* Sessions Sidebar Overlay (Mobile) */}
      <AnimatePresence>
        {isSessionsSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setIsSessionsSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sessions Sidebar */}
      <motion.div 
        initial={false}
        animate={{ 
          width: isSessionsSidebarOpen ? 280 : 0,
          x: isSessionsSidebarOpen ? 0 : -280
        }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={`
          absolute inset-y-0 left-0 z-50 bg-indigo-50 dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100 shadow-2xl overflow-hidden
          lg:relative lg:translate-x-0
        `}
      >
        <div className="flex flex-col h-full w-[280px]">
            <div className="p-5 border-b border-indigo-200 dark:border-indigo-800 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                    <History className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    <h3 className="font-bold text-xs uppercase tracking-widest text-indigo-900/60 dark:text-indigo-100/60">Conversations</h3>
                </div>
                <div className="flex items-center space-x-1">
                    <button 
                        onClick={() => deleteAllSessions()}
                        className="p-2 text-indigo-700 dark:text-indigo-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-xl transition-all"
                        title="Delete All"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                    <button 
                        onClick={() => createNewSession()}
                        className="p-2 bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 dark:hover:bg-indigo-400 text-white rounded-xl shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
                        title="New Chat"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {sessions.map((session) => (
                    <motion.div 
                        key={session.id}
                        whileHover={{ x: 4 }}
                        className={`
                            group flex items-center justify-between p-3.5 rounded-xl cursor-pointer transition-all
                            ${activeSessionId === session.id ? 'bg-indigo-600 dark:bg-indigo-500 shadow-lg shadow-indigo-500/20 text-white' : 'text-indigo-900/60 dark:text-indigo-100/60 hover:bg-indigo-100 dark:hover:bg-indigo-900 hover:text-indigo-900 dark:hover:text-indigo-100'}
                        `}
                        onClick={() => {
                            switchSession(session.id);
                            if (window.innerWidth < 1024) setIsSessionsSidebarOpen(false);
                        }}
                    >
                        <div className="flex items-center space-x-3 overflow-hidden flex-1">
                            <MessageSquare className={`w-4 h-4 flex-shrink-0 ${activeSessionId === session.id ? 'text-white' : 'text-indigo-400 dark:text-indigo-600'}`} />
                            {editingSessionId === session.id ? (
                                <input 
                                    autoFocus
                                    className="bg-transparent border-b border-white/30 outline-none w-full text-sm py-0.5"
                                    value={newSessionTitle}
                                    onChange={(e) => setNewSessionTitle(e.target.value)}
                                    onBlur={() => handleRenameSession(session.id)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleRenameSession(session.id)}
                                    onClick={(e) => e.stopPropagation()}
                                />
                            ) : (
                                <span className="text-sm font-medium truncate">{session.title}</span>
                            )}
                        </div>
                        
                        <div className={`flex items-center space-x-1 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity ${activeSessionId === session.id ? 'opacity-100' : ''}`}>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingSessionId(session.id);
                                    setNewSessionTitle(session.title);
                                }}
                                className="p-1.5 hover:bg-bg-secondary/50 rounded-lg transition-colors"
                            >
                                <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm("Delete this conversation?")) deleteSession(session.id);
                                }}
                                className="p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded-lg transition-colors"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </motion.div>
                ))}
            </div>
            
            <Link 
                to="/history"
                className="p-5 border-t border-border text-[10px] font-bold uppercase tracking-widest text-text-secondary flex items-center justify-center hover:bg-bg-secondary/50 transition-all"
            >
                View Full History
            </Link>
        </div>
      </motion.div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-indigo-50 dark:bg-indigo-950 lg:rounded-l-3xl shadow-2xl z-10">
        {/* Header */}
        <header className="sticky top-0 z-30 px-4 py-3 border-b border-indigo-200 dark:border-indigo-800 flex justify-between items-center bg-indigo-50/80 dark:bg-indigo-950/80 backdrop-blur-md">
            <div className="flex items-center space-x-3">
                <button 
                    onClick={() => setIsSessionsSidebarOpen(!isSessionsSidebarOpen)}
                    className="p-2.5 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-xl transition-all"
                >
                    <MessageSquare className="w-5 h-5" />
                </button>
                <div className="relative">
                    {aiProfile.referenceImage ? (
                        <img src={aiProfile.referenceImage} alt="AI" className="w-10 h-10 rounded-2xl object-cover shadow-sm ring-2 ring-indigo-50" />
                    ) : (
                        <div className="w-10 h-10 rounded-2xl bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center text-white font-bold shadow-lg">
                            {aiProfile.name.charAt(0)}
                        </div>
                    )}
                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-indigo-50 dark:border-indigo-950 rounded-full shadow-sm"></div>
                </div>
                <div className="flex flex-col">
                    <h2 className="font-bold text-indigo-900 dark:text-indigo-50 leading-tight">{aiProfile.name}</h2>
                    <div className="flex items-center space-x-1.5">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                        <span className="text-[10px] font-bold text-indigo-900/60 dark:text-indigo-100/60 uppercase tracking-widest">Online</span>
                    </div>
                </div>
            </div>

            <div className="flex items-center space-x-1">
                <div className="hidden md:flex items-center space-x-1 mr-2">
                    <button
                        onClick={handleCamera}
                        className="p-2 text-indigo-700 dark:text-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-xl transition-all"
                        title="Camera"
                    >
                        <Camera className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => setIsLiveApiActive(prev => !prev)}
                        className={`p-2 rounded-xl transition-all ${isLiveApiActive ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : 'text-indigo-700 dark:text-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900'}`}
                        title="Live Voice"
                    >
                        <Mic className="w-5 h-5" />
                    </button>
                </div>

                <div className="relative">
                    <button 
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="p-2.5 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-xl transition-all"
                    >
                        <MoreVertical className="w-5 h-5" />
                    </button>
                    {isMenuOpen && (
                        <div className="absolute right-0 mt-2 w-48 bg-indigo-100 dark:bg-indigo-900 rounded-2xl shadow-2xl border border-indigo-200 dark:border-indigo-800 py-2 z-50">
                            <button onClick={() => { setIsMenuOpen(false); handleClear(); }} className="w-full px-4 py-2 text-left text-sm text-indigo-900 dark:text-indigo-100 hover:bg-indigo-200 dark:hover:bg-indigo-800 flex items-center">
                                <RotateCcw className="w-4 h-4 mr-2" /> Clear Chat
                            </button>
                            <button 
                                onClick={() => {
                                    setIsMenuOpen(false);
                                    if (activeSessionId) {
                                        addToast({ title: "History", message: "Deleting session...", type: "info" });
                                        deleteSession(activeSessionId);
                                    }
                                }}
                                className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900 flex items-center"
                            >
                                <Trash2 className="w-4 h-4 mr-2" /> Delete Session
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
        
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-2 bg-indigo-50 dark:bg-indigo-950 custom-scrollbar relative"
      >
        <AnimatePresence initial={false}>
            {chatHistory?.length === 0 && (
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center justify-center h-full text-center p-8"
                >
                    <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900 rounded-3xl flex items-center justify-center mb-6 shadow-inner">
                        <Sparkles className="w-10 h-10 text-indigo-500 dark:text-indigo-400" />
                    </div>
                    <h3 className="text-xl font-bold text-indigo-900 dark:text-indigo-50 mb-2">Start a conversation</h3>
                    <p className="text-indigo-700 dark:text-indigo-300 max-w-xs text-sm leading-relaxed">
                        Say hello to {aiProfile.name} and start exploring your ideas together.
                    </p>
                </motion.div>
            )}
            {chatHistory?.map((msg) => (
                <ChatMessageItem
                    key={msg.id}
                    msg={msg}
                    editingMessageId={editingMessageId}
                    setEditingMessageId={setEditingMessageId}
                    handleEdit={handleEdit}
                    rateChatMessage={rateChatMessage}
                    speakMessage={speakMessage}
                    handleRegenerate={handleRegenerate}
                    handleDeleteMessage={handleDeleteMessage}
                    showTimestamps={showTimestamps}
                    timeZone={timeZone}
                    readMessages={readMessages}
                    addFeedbackComment={addFeedbackComment}
                    onImageClick={(url, prompt) => setSelectedImage({ url, prompt })}
                />
            ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex justify-start px-2"
          >
            <div className="flex flex-col space-y-2">
              <div className="bg-indigo-100 dark:bg-indigo-900 px-4 py-3 rounded-2xl rounded-tl-sm border border-indigo-200 dark:border-indigo-800 flex items-center space-x-1.5 shadow-sm">
                <div className="w-1.5 h-1.5 bg-indigo-400 dark:bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-1.5 h-1.5 bg-indigo-400 dark:bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-1.5 h-1.5 bg-indigo-400 dark:bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
              <div className="flex items-center text-[10px] text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-widest px-1 animate-pulse">
                <Search className="w-3 h-3 mr-1.5" />
                Processing...
              </div>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />

        {/* Floating Scroll Button */}
        <AnimatePresence>
            {showScrollButton && (
                <motion.button
                    initial={{ opacity: 0, scale: 0.5, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.5, y: 20 }}
                    onClick={() => scrollToBottom()}
                    className="fixed bottom-24 right-8 z-40 p-3 bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 rounded-2xl shadow-2xl border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-all active:scale-90"
                >
                    <ArrowDown className="w-6 h-6" />
                </motion.button>
            )}
        </AnimatePresence>
      </div>

      {/* Input Area */}
      <div className="p-4 bg-indigo-100 dark:bg-indigo-900 border-t border-indigo-200 dark:border-indigo-800">
        {/* Quick Actions Bar */}
        <div className="flex space-x-2 mb-4 overflow-x-auto pb-1 no-scrollbar">
            <button 
                onClick={() => setInput("*smiles* " + input)}
                className="flex-shrink-0 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-bold border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-all active:scale-95"
            >
                *Action*
            </button>
            <button 
                onClick={() => setInput("(OOC: ) " + input)}
                className="flex-shrink-0 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-bold border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-all active:scale-95"
            >
                (OOC)
            </button>
            <button 
                onClick={() => {
                    const userMsgId = Date.now().toString();
                    const userMessage = {
                      id: userMsgId,
                      role: 'user' as const,
                      content: "Can you send me a picture of yourself?",
                      timestamp: Date.now(),
                      attachments: [],
                    };
                    addChatMessage(userMessage);
                    setIsLoading(true);
                    generateResponse(chatHistory, userMessage);
                }}
                className="flex-shrink-0 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-bold border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-all active:scale-95 flex items-center"
            >
                <ImageIcon className="w-3.5 h-3.5 mr-1.5" /> Request Selfie
            </button>
        </div>

        {attachments.length > 0 && (
            <div className="flex space-x-3 mb-4 overflow-x-auto pb-2 custom-scrollbar">
                {attachments.map((att, idx) => (
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        key={idx} 
                        className="relative flex-shrink-0 w-20 h-20 bg-indigo-50 dark:bg-indigo-950 rounded-2xl border border-indigo-200 dark:border-indigo-800 overflow-hidden group shadow-sm"
                    >
                        {att.type === 'image' ? (
                            <img src={att.content} alt="preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full">
                                <FileText className="w-8 h-8 text-indigo-400 dark:text-indigo-600" />
                                <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 mt-1 uppercase tracking-tighter">{att.type}</span>
                            </div>
                        )}
                        <button 
                            onClick={() => removeAttachment(idx)}
                            className="absolute top-1.5 right-1.5 bg-red-500 text-white rounded-full p-1 shadow-lg hover:bg-red-600 transition-all active:scale-75"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </motion.div>
                ))}
            </div>
        )}
        
        <div className="relative flex items-end space-x-2 bg-indigo-100 dark:bg-indigo-900/50 p-2 rounded-2xl border border-indigo-200 dark:border-indigo-800 focus-within:bg-indigo-50 dark:focus-within:bg-indigo-950 focus-within:ring-4 focus-within:ring-indigo-500/5 focus-within:border-indigo-500/20 transition-all duration-300">
          <div className="flex items-center space-x-1 pl-1 pb-1">
            <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={handleImageSelect} />
            <input type="file" ref={cameraInputRef} className="hidden" accept="image/*" capture="environment" onChange={handleImageSelect} />
            <input type="file" ref={fileInputRef} className="hidden" accept=".txt,.pdf,.md,.csv,.json" onChange={handleFileSelect} />
            
            <button 
                onClick={() => imageInputRef.current?.click()} 
                className="p-2.5 text-indigo-700 dark:text-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-xl transition-all active:scale-90"
            >
                <ImageIcon className="w-5 h-5" />
            </button>
            <button 
                onClick={() => fileInputRef.current?.click()} 
                className="p-2.5 text-indigo-700 dark:text-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-xl transition-all active:scale-90"
            >
                <Paperclip className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex-1 relative min-h-[48px] flex items-center">
              <textarea
                 ref={textareaRef}
                 value={input}
                 placeholder={`Message ${aiProfile.name}...`}
                 onChange={(e) => setInput(e.target.value)}
                 onKeyDown={(e) => {
                     if (e.key === 'Enter' && !e.shiftKey) {
                         e.preventDefault();
                         handleSend();
                     }
                 }}
                 className="w-full bg-transparent py-3 px-2 text-indigo-900 dark:text-indigo-100 placeholder-indigo-700 dark:placeholder-indigo-300 resize-none max-h-48 overflow-y-auto focus:outline-none text-sm md:text-base leading-relaxed custom-scrollbar"
                 rows={1}
                 disabled={isUploading}
              />
          </div>
          
          <div className="flex items-center space-x-1 pr-1 pb-1">
            <button 
                onClick={() => toggleListening()} 
                className={`p-2.5 rounded-xl transition-all active:scale-90 ${isListening ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : 'text-indigo-700 dark:text-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900'}`}
            >
                <Mic className={`w-5 h-5 ${isListening ? 'animate-pulse' : ''}`} />
            </button>
            <button
                onClick={() => handleSend()}
                disabled={isLoading || isUploading || (!input.trim() && attachments.length === 0)}
                className="p-2.5 bg-indigo-600 dark:bg-indigo-500 text-white rounded-xl hover:bg-indigo-500 dark:hover:bg-indigo-400 shadow-lg shadow-indigo-600/20 transition-all active:scale-90 disabled:opacity-30 disabled:shadow-none"
            >
                {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
        
        <div className="flex justify-between items-center mt-3 px-1">
            <div className="flex items-center space-x-3">
                <button
                  onClick={() => setIsHandsFree(!isHandsFree)}
                  className={`flex items-center space-x-1.5 px-2 py-1 rounded-lg transition-all ${isHandsFree ? 'bg-indigo-50 text-indigo-600' : 'text-text-secondary hover:bg-bg-secondary'}`}
                >
                  <Headphones className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">{isHandsFree ? 'Hands-Free ON' : 'Hands-Free'}</span>
                </button>
            </div>
            <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-500" />
                Powered by Gemini
            </p>
        </div>
      </div>
    </div>

    <ImageModal
      isOpen={!!selectedImage}
      onClose={() => setSelectedImage(null)}
      imageUrl={selectedImage?.url || ''}
      prompt={selectedImage?.prompt}
      onCopyPrompt={(p) => {
          navigator.clipboard.writeText(p);
          addToast({ title: "Copied", message: "Prompt copied to clipboard!", type: "success" });
      }}
    />
  </div>
  );
};

export default ChatScreen;
