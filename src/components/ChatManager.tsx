import React, { useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useChat } from '../context/ChatContext';
import { onForegroundMessage } from '../services/firebaseService';
import { showNativeNotification } from '../services/notificationService';

const ChatManager: React.FC = () => {
    const { 
    aiProfile, 
    setAIProfile,
    userProfile, 
    apiKey, 
    fcmToken, 
    timeZone, 
    isLoaded, 
    addToGallery,
    userId,
    lastInteractionTime,
    setLastInteractionTime,
    autoJsonBackup,
    autoJsonBackupInterval,
    autoDriveBackup,
    autoDriveBackupInterval,
    isGoogleDriveConnected,
    googleClientId,
    googleClientSecret,
    exportData,
    firebaseServiceAccountKey,
    fetchWithRetry
  } = useApp();
  
  const { addChatMessage, chatHistory, sessions, activeSessionId } = useChat();

  // Persona Growth Analysis
  useEffect(() => {
    if (!isLoaded || chatHistory.length === 0 || chatHistory.length % 10 !== 0) return;

    const analyzePersona = async () => {
      try {
        const response = await fetch('/api/analyze-persona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            messages: chatHistory.slice(-20), // Analyze last 20 messages
            aiProfile,
            apiKey: apiKey || undefined
          }),
        });

        if (!response.ok) return;

        let updatedFields = {};
        try {
          updatedFields = await response.json();
        } catch (jsonError) {
          console.warn("Failed to parse persona analysis as JSON", jsonError);
          return;
        }

        if (Object.keys(updatedFields).length > 0) {
          setAIProfile({ ...aiProfile, ...updatedFields });
          console.log("Persona updated based on conversation trends:", updatedFields);
        }
      } catch (e) {
        console.error("Failed to analyze persona", e);
      }
    };

    analyzePersona();
  }, [chatHistory, isLoaded, aiProfile, apiKey, setAIProfile]);

  // Auto JSON Backup Interval
  useEffect(() => {
    if (!isLoaded || !autoJsonBackup || autoJsonBackupInterval <= 0) return;

    const intervalId = setInterval(async () => {
        try {
            const data = await exportData(chatHistory, sessions, activeSessionId);
            const now = new Date();
            const filename = `${aiProfile.name}_backup_${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}_${now.getSeconds().toString().padStart(2, '0')}.json`;
            
            console.log(`Auto-backup triggered: Would save as file '${filename}'`);
        } catch (e) {
            console.error("Failed to auto-backup JSON", e);
        }
    }, autoJsonBackupInterval * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [isLoaded, autoJsonBackup, autoJsonBackupInterval, chatHistory, sessions, activeSessionId, exportData, aiProfile.name]);

  // Auto Google Drive Backup Interval
  useEffect(() => {
    if (!isLoaded || !autoDriveBackup || autoDriveBackupInterval <= 0 || !isGoogleDriveConnected) return;

    const intervalId = setInterval(async () => {
      try {
        const exportObject = await exportData(chatHistory, sessions, activeSessionId);
        const now = new Date();
        const filename = `${aiProfile.name}_backup_${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}_${now.getSeconds().toString().padStart(2, '0')}.json`;

        const res = await fetchWithRetry('/api/drive/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            filename, 
            content: JSON.stringify(exportObject), // Stringify once here
            clientId: googleClientId,
            clientSecret: googleClientSecret
          }),
        });

        if (res.ok) {
          console.log(`Auto-backed up to Google Drive (filename: ${filename})`);
        } else {
          const contentType = res.headers.get("content-type");
          let errorMsg;
          if (contentType && contentType.includes("application/json")) {
            const errorData = await res.json();
            errorMsg = errorData.error || JSON.stringify(errorData);
          } else {
            errorMsg = await res.text();
          }
          console.error("Failed to auto-backup to Google Drive", errorMsg);
        }
      } catch (e) {
        console.error("Failed to auto-backup to Google Drive", e);
      }
    }, autoDriveBackupInterval * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [isLoaded, autoDriveBackup, autoDriveBackupInterval, isGoogleDriveConnected, chatHistory, sessions, activeSessionId, exportData, aiProfile.name, googleClientId, googleClientSecret, fetchWithRetry]);

  // Firebase Message Handler
  useEffect(() => {
    if (!isLoaded) return;

    const unsubscribe = onForegroundMessage((payload) => {
      console.log('Foreground message received in ChatManager:', payload);
      
      // Check if this message ID already exists in the chat history to prevent duplicates
      const messageId = payload.messageId;
      if (messageId && chatHistoryRef.current.some(msg => msg.id === messageId)) {
        console.log('Duplicate message detected, ignoring:', messageId);
        return;
      }
      
      // Show native notification if in foreground
      if (payload.notification) {
        showNativeNotification(payload.notification.title, {
          body: payload.notification.body,
          icon: '/indigo-icon.png',
          badge: '/indigo-icon.png',
          tag: 'indigo-notification',
          data: payload.data
        });
      }
      
      // We don't add the message to chat history here because the API response
      // handler already adds it. This prevents duplicate messages.
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [isLoaded]);

  const lastInteractionTimeRef = React.useRef(lastInteractionTime);
  useEffect(() => {
    lastInteractionTimeRef.current = lastInteractionTime;
  }, [lastInteractionTime]);

  const chatHistoryRef = React.useRef(chatHistory);
  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  const aiProfileRef = React.useRef(aiProfile);
  useEffect(() => {
    aiProfileRef.current = aiProfile;
  }, [aiProfile]);

  const userProfileRef = React.useRef(userProfile);
  useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);

  const sessionStartTimeRef = React.useRef(Date.now());
  const userIdRef = React.useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);
  const isProcessingRef = React.useRef(false);
  const lastProactiveTriggerTimeRef = React.useRef(0);
  const lastAmbientTriggerTimeRef = React.useRef(0);

  // Helper to get interval in ms
  const getIntervalMs = (frequency: '1h' | '6h' | '12h' | '24h' | 'off' | 'low' | 'medium' | 'high') => {
    switch (frequency) {
      case '1h': return 1 * 60 * 60 * 1000; // 1 hour
      case '6h': return 6 * 60 * 60 * 1000; // 6 hours
      case '12h': return 12 * 60 * 60 * 1000; // 12 hours
      case '24h': return 24 * 60 * 60 * 1000; // 24 hours
      case 'low': return 15 * 60 * 1000; // 15 mins
      case 'medium': return 5 * 60 * 1000; // 5 mins
      case 'high': return 2 * 60 * 1000; // 2 mins
      default: return Infinity;
    }
  };

  // Proactive Message Trigger (When user is AWAY)
  useEffect(() => {
    if (!isLoaded || aiProfile.proactiveMessageFrequency === 'off') return;

    const interval = getIntervalMs(aiProfile.proactiveMessageFrequency);
    if (interval === Infinity) return;

    const checkProactiveMessage = async () => {
      if (isProcessingRef.current) return;

      const now = Date.now();
      const timeSinceLastInteraction = now - lastInteractionTimeRef.current;
      const timeSinceSessionStart = now - sessionStartTimeRef.current;
      const timeSinceLastTrigger = now - lastProactiveTriggerTimeRef.current;

      // Check if user has said something first
      const hasUserMessaged = chatHistoryRef.current.some(msg => msg.role === 'user');

      // Proactive messages trigger when:
      // 1. User has been INACTIVE for the interval
      // 2. App has been open for at least 1 HOUR
      // 3. Last proactive trigger was at least the interval ago
      // 4. User has sent at least one message in the chat
      if (timeSinceLastInteraction >= interval && 
          timeSinceSessionStart >= 1 * 60 * 60 * 1000 && // At least 1 hour after opening app
          timeSinceLastTrigger >= interval &&
          hasUserMessaged) {
        
        isProcessingRef.current = true;
        lastProactiveTriggerTimeRef.current = now;
        try {
          const res = await fetchWithRetry('/api/proactive-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: userIdRef.current,
              chatHistory: chatHistoryRef.current.slice(-5),
              aiProfile: aiProfileRef.current,
              userProfile: userProfileRef.current,
              apiKey: apiKey || undefined,
              fcmToken: fcmToken || undefined,
              timeZone,
              firebaseServiceAccountKey,
              type: 'message' // Explicitly proactive message
            }),
          });

          if (res.ok) {
            const { message, generatedImage } = await res.json();
            
            if (message === "IN_PROGRESS") return; // Ignore

            if (generatedImage) {
              const imageUrl = `data:image/png;base64,${generatedImage}`;
              addToGallery({
                id: `generated-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
                type: 'generated',
                mediaType: 'image',
                url: imageUrl,
                prompt: message || "AI generated image",
                timestamp: Date.now(),
              });
              addChatMessage({
                id: `proactive-${Date.now()}-1`,
                role: 'model',
                content: message || "Here's an image I thought you'd like!",
                timestamp: Date.now(),
                attachments: [{ type: 'image', content: imageUrl, name: 'Generated Image' }]
              });
            } else if (message) {
              addChatMessage({
                id: `proactive-${Date.now()}-2`,
                role: 'model',
                content: message,
                timestamp: Date.now(),
              });
            }
            
            // Note: We don't update lastInteractionTime here because it was a proactive message,
            // not a user interaction. But we might want to prevent immediate follow-up.
          }
        } catch (e) {
          console.error("Error sending proactive message:", e);
        } finally {
          isProcessingRef.current = false;
        }
      }
    };

    const intervalId = setInterval(checkProactiveMessage, 30000); // Check every 30 seconds
    
    return () => clearInterval(intervalId);
  }, [isLoaded, aiProfile.proactiveMessageFrequency, addChatMessage, addToGallery, apiKey, fcmToken, timeZone, firebaseServiceAccountKey, fetchWithRetry, userId]);

  // Ambient Mode Trigger (Spontaneous comments while ACTIVE or OPEN)
  useEffect(() => {
    if (!isLoaded || !aiProfile.ambientMode || aiProfile.ambientFrequency === 'off') return;

    const interval = getIntervalMs(aiProfile.ambientFrequency);
    if (interval === Infinity) return;

    const checkAmbientMessage = async () => {
      if (isProcessingRef.current) return;

      const now = Date.now();
      const timeSinceSessionStart = now - sessionStartTimeRef.current;
      const timeSinceLastTrigger = now - lastAmbientTriggerTimeRef.current;

      // Ambient messages trigger based on time passed, regardless of interaction
      // (But we might want a small buffer after interaction to not interrupt)
      const timeSinceLastInteraction = now - lastInteractionTimeRef.current;
      const proactiveInterval = getIntervalMs(aiProfileRef.current.proactiveMessageFrequency);

      // Check if user has said something first
      const hasUserMessaged = chatHistoryRef.current.some(msg => msg.role === 'user');

      if (timeSinceSessionStart >= interval && 
          timeSinceLastTrigger >= interval &&
          timeSinceLastInteraction >= 30000 &&
          timeSinceLastInteraction < proactiveInterval &&
          hasUserMessaged) { // Wait at least 30s after last user message and require user message first
        
        isProcessingRef.current = true;
        lastAmbientTriggerTimeRef.current = now;
        try {
          const res = await fetchWithRetry('/api/proactive-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: userIdRef.current,
              chatHistory: chatHistoryRef.current.slice(-5),
              aiProfile: aiProfileRef.current,
              userProfile: userProfileRef.current,
              apiKey: apiKey || undefined,
              fcmToken: fcmToken || undefined,
              timeZone,
              firebaseServiceAccountKey,
              isAmbient: true // Flag for ambient mode
            }),
          });

          if (res.ok) {
            const { message } = await res.json();
            if (message) {
              addChatMessage({
                id: `ambient-${Date.now()}`,
                role: 'model',
                content: message,
                timestamp: Date.now(),
              });
            }
          }
        } catch (e) {
          console.error("Error sending ambient message:", e);
        } finally {
          isProcessingRef.current = false;
        }
      }
    };

    const intervalId = setInterval(checkAmbientMessage, 30000); // Check every 30 seconds
    
    return () => clearInterval(intervalId);
  }, [isLoaded, aiProfile.ambientMode, aiProfile.ambientFrequency, addChatMessage, apiKey, fcmToken, timeZone, firebaseServiceAccountKey, fetchWithRetry, userId]);

  return null;
};

export default ChatManager;
