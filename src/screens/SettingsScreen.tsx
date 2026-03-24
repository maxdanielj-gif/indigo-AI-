import React, { useRef, useState } from 'react';
import { gzipSync, strToU8 } from 'fflate';
import { useApp } from '../context/AppContext';
import { useChat } from '../context/ChatContext';
import { requestNotificationPermission } from '../services/firebaseService';
import { showNativeNotification } from '../services/notificationService';
import { Download, Upload, Trash2, Bell, FileText, File, Key, HelpCircle, Save, Database, MapPin, Copy, Smartphone, Cloud, RefreshCw, LogOut, Clock, Shield, Edit2, Globe, Mail, BookOpen } from 'lucide-react';
import { performOCR, processFile } from '../services/ocrService';
import { sendEmail } from '../services/emailService';

const SettingsScreen: React.FC = () => {
  const { 
    importData, knowledgeBase, addToKnowledgeBase, apiKey, setApiKey, 
    asyncApiKey, setAsyncApiKey,
    firebaseApiKey, firebaseProjectId, firebaseAppId, firebaseMessagingSenderId, firebaseVapidKey, setFirebaseConfig,
    firebaseServiceAccountKey, setFirebaseServiceAccountKey,
    googleClientId, googleClientSecret, setGoogleConfig,
    setShowTutorial, autoSaveChat, setAutoSaveChat, autoSaveChatInterval, 
    setAutoSaveChatInterval, autoJsonBackup, setAutoJsonBackup, 
    autoJsonBackupInterval, setAutoJsonBackupInterval, resetApp, 
    isGoogleDriveConnected, setIsGoogleDriveConnected, autoDriveBackup, 
    setAutoDriveBackup, autoDriveBackupInterval, setAutoDriveBackupInterval, proactiveMessageFrequency, setProactiveMessageFrequency,
    aiProfile, userProfile, notificationsEnabled, setNotificationsEnabled,
    fcmToken, setFcmToken, exportData, addToast,
    showTimestamps, setShowTimestamps, isDebuggerEnabled, setIsDebuggerEnabled, timeZone, setTimeZone, addToGallery,
    userId, setUserId, isSyncing, setIsSyncing,
    isSyncEnabled, setIsSyncEnabled, syncFrequency, setSyncFrequency, updateAIProfile
  } = useApp();
  const { chatHistory, addChatMessage, setChatHistory, sessions, setSessions, activeSessionId, setActiveSessionId } = useChat();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const kbInputRef = useRef<HTMLInputElement>(null);
  const [localApiKey, setLocalApiKey] = useState(apiKey || '');
  const [localAsyncApiKey, setLocalAsyncApiKey] = useState(asyncApiKey || '');
  
  const [localFirebaseApiKey, setLocalFirebaseApiKey] = useState(firebaseApiKey || '');
  const [localFirebaseProjectId, setLocalFirebaseProjectId] = useState(firebaseProjectId || '');
  const [localFirebaseAppId, setLocalFirebaseAppId] = useState(firebaseAppId || '');
  const [localFirebaseMessagingSenderId, setLocalFirebaseMessagingSenderId] = useState(firebaseMessagingSenderId || '');
  const [localFirebaseVapidKey, setLocalFirebaseVapidKey] = useState(firebaseVapidKey || '');
  const [localFirebaseServiceAccountKey, setLocalFirebaseServiceAccountKey] = useState(firebaseServiceAccountKey || '');
  const [localGoogleClientId, setLocalGoogleClientId] = useState(googleClientId || '');
  const [localGoogleClientSecret, setLocalGoogleClientSecret] = useState(googleClientSecret || '');
  const [localSyncId, setLocalSyncId] = useState(userId || '');
  const [recoveryId, setRecoveryId] = useState('');
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [isFetchingDrive, setIsFetchingDrive] = useState(false);
  const [isBackingUpDrive, setIsBackingUpDrive] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);

  const handleSync = async () => {
    console.log(`[${new Date().toLocaleTimeString()}] SettingsScreen.tsx: handleSync started`);
    setIsSyncing(true);
    addToast({ title: "Sync", message: "Starting sync to cloud...", type: "info" });
    try {
      const data = await exportData(chatHistory, sessions, activeSessionId);
      console.log(`[${new Date().toLocaleTimeString()}] SettingsScreen.tsx: data exported, size: ${JSON.stringify(data).length} bytes`);
      const jsonString = JSON.stringify({ userId: localSyncId, data });
      const compressed = gzipSync(strToU8(jsonString));
      console.log(`[${new Date().toLocaleTimeString()}] SettingsScreen.tsx: data compressed, size: ${compressed.length} bytes`);
      
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: compressed,
      });
      if (!response.ok) throw new Error('Sync failed');
      console.log(`[${new Date().toLocaleTimeString()}] SettingsScreen.tsx: sync complete`);
      addToast({ title: "Sync", message: "Data synced to cloud!", type: "success" });
    } catch (e: any) {
      console.error(`[${new Date().toLocaleTimeString()}] SettingsScreen.tsx: Sync failed`, e);
      addToast({ title: "Sync Failed", message: e.message || "An error occurred during sync.", type: "error" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRecover = async () => {
    if (!recoveryId.trim()) {
        addToast({ title: "Recovery", message: "Please enter a Sync ID to recover.", type: "warning" });
        return;
    }
    if (recoveryId !== userId) {
        addToast({ title: "Recovery Warning", message: "The Sync ID you entered does not match your current User ID. This might lead to data inconsistencies.", type: "warning" });
    }
    setIsSyncing(true);
    try {
      const response = await fetch(`/api/sync/${recoveryId}`);
      if (!response.ok) throw new Error('Recovery failed');
      const data = await response.json();
      importData(JSON.stringify(data), setChatHistory, setSessions, setActiveSessionId);
      addToast({ title: "Recovery", message: "Data recovered from cloud!", type: "success" });
    } catch (e: any) {
      console.error("Recovery failed", e);
      addToast({ title: "Recovery Failed", message: e.message || "An error occurred during recovery.", type: "error" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGoogleDriveConnect = async () => {
    try {
      const params = new URLSearchParams();
      if (googleClientId) params.append('clientId', googleClientId);
      if (googleClientSecret) params.append('clientSecret', googleClientSecret);
      
      const res = await fetch(`/api/auth/google/url?${params.toString()}`, { credentials: 'include' });
      const { url } = await res.json();
      window.open(url, 'google_oauth', 'width=600,height=700');
    } catch (e) {
      console.error("Failed to get Google OAuth URL", e);
    }
  };

  const handleGoogleDriveDisconnect = async () => {
    try {
      await fetch('/api/auth/google/logout', { method: 'POST', credentials: 'include' });
      setIsGoogleDriveConnected(false);
      setDriveFiles([]);
    } catch (e) {
      console.error("Failed to logout from Google Drive", e);
    }
  };

  const fetchDriveFiles = async () => {
    setIsFetchingDrive(true);
    try {
      const params = new URLSearchParams();
      if (googleClientId) params.append('clientId', googleClientId);
      if (googleClientSecret) params.append('clientSecret', googleClientSecret);
      
      const res = await fetch(`/api/drive/files?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDriveFiles(data.files || []);
      } else {
        const err = await res.json();
        console.error("Failed to fetch drive files", err);
        addToast({ title: "Drive Error", message: err.error || "Failed to fetch drive files", type: "error" });
      }
    } catch (e: any) {
      console.error("Failed to fetch drive files", e);
      addToast({ title: "Drive Error", message: e.message || "Failed to fetch drive files", type: "error" });
    } finally {
      setIsFetchingDrive(false);
    }
  };

  const importFromDrive = async (fileId: string) => {
    setIsImporting(true);
    addToast({ title: "Importing", message: "Fetching file from Google Drive...", type: "info" });
    try {
      const params = new URLSearchParams();
      if (googleClientId) params.append('clientId', googleClientId);
      if (googleClientSecret) params.append('clientSecret', googleClientSecret);
      
      const res = await fetch(`/api/drive/file/${fileId}?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const { name, content } = await res.json();
        addToKnowledgeBase({ name, content });
        addToast({ title: "Import Successful", message: `Imported ${name} from Google Drive!`, type: "success" });
      }
    } catch (e) {
      console.error("Failed to import file from drive", e);
      addToast({ title: "Import Failed", message: "Failed to import file from Google Drive.", type: "error" });
    } finally {
      setIsImporting(false);
    }
  };

  React.useEffect(() => {
    if (userId) setLocalSyncId(userId);
  }, [userId]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'google') {
        setIsGoogleDriveConnected(true);
        fetchDriveFiles();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  React.useEffect(() => {
    if (isGoogleDriveConnected) {
      fetchDriveFiles();
    }
  }, [isGoogleDriveConnected]);

  // Browser Integration Handlers (moved from ChatScreen)
  const handleLocation = async () => {
    addToast({ title: "Location", message: "Requesting your current location...", type: "info" });
    await new Promise(resolve => setTimeout(resolve, 600));
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            addToast({ title: "Location", message: `Current location: ${position.coords.latitude}, ${position.coords.longitude}`, type: "info" });
        }, (error) => {
            addToast({ title: "Location Error", message: error.message, type: "error" });
        });
    } else {
        addToast({ title: "Not Supported", message: "Geolocation is not supported by this browser.", type: "warning" });
    }
  };

  const handleClipboardCopy = async () => {
    // This will copy the entire app's exported data to clipboard for easy sharing/backup
    setIsExporting(true);
    addToast({ title: "Exporting", message: "Preparing data for clipboard...", type: "info" });
    await new Promise(resolve => setTimeout(resolve, 700));
    exportData(chatHistory, sessions, activeSessionId).then(data => {
      const jsonString = JSON.stringify(data);
      // If data is over 10MB, warn the user before copying to clipboard
      if (jsonString.length > 10 * 1024 * 1024) {
        if (!confirm(`The backup data is very large (${(jsonString.length / (1024 * 1024)).toFixed(2)} MB). Copying this much data to the clipboard might slow down or crash your browser. Do you want to continue?`)) {
          setIsExporting(false);
          return;
        }
      }
      navigator.clipboard.writeText(jsonString).then(() => {
        addToast({ title: "Copied", message: "All app data copied to clipboard!", type: "success" });
      }).finally(() => {
        setIsExporting(false);
      });
    }).catch(e => {
      console.error("Clipboard copy failed", e);
      addToast({ title: "Export Failed", message: "Failed to copy data to clipboard.", type: "error" });
      setIsExporting(false);
    });
  };

  const handleNotificationTest = () => {
    const title = "Browser Integration";
    const body = "Notifications are working!";
    
    addToast({ title, message: body, type: "info" });
    showNativeNotification(title, { body });
  };

  const handleDownloadChat = async () => {
    // This will download the *entire* chat history from AppContext
    setIsExporting(true);
    addToast({ title: "Exporting", message: "Preparing chat history file...", type: "info" });
    await new Promise(resolve => setTimeout(resolve, 700));
    try {
      const text = chatHistory.map(m => `${new Date(m.timestamp).toLocaleString()} - ${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `full_chat_history_${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setIsExporting(false);
      }, 100);
      addToast({ title: "Export Successful", message: "Chat history downloaded!", type: "success" });
    } catch (e) {
      console.error("Chat download failed", e);
      addToast({ title: "Export Failed", message: "Failed to download chat history.", type: "error" });
      setIsExporting(false);
    }
  };

  const handleStorageCheck = async () => {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
        const { usage, quota } = await navigator.storage.estimate();
        const usageMB = (usage ? usage / 1024 / 1024 : 0).toFixed(2);
        const quotaMB = (quota ? quota / 1024 / 1024 : 0).toFixed(2);
        addToast({ title: "Storage Usage", message: `${usageMB} MB of ${quotaMB} MB used.`, type: "info" });
    } else {
        addToast({ title: "Not Supported", message: "Storage estimation not supported.", type: "warning" });
    }
  };

  const handleSaveApiKey = async () => {
      addToast({ title: "Settings", message: "Updating Gemini API Key...", type: "info" });
      await new Promise(resolve => setTimeout(resolve, 500));
      setApiKey(localApiKey.trim() || null);
      addToast({ title: "Saved", message: "Gemini API Key saved successfully!", type: "success" });
  };

  const handleSaveAsyncApiKey = async () => {
      addToast({ title: "Settings", message: "Updating Async API Key...", type: "info" });
      await new Promise(resolve => setTimeout(resolve, 500));
      setAsyncApiKey(localAsyncApiKey.trim() || null);
      addToast({ title: "Saved", message: "Async API Key saved successfully!", type: "success" });
  };

  const handleSaveFirebaseConfig = async () => {
      addToast({ title: "Settings", message: "Updating Firebase configuration...", type: "info" });
      await new Promise(resolve => setTimeout(resolve, 500));
      setFirebaseConfig({
          apiKey: localFirebaseApiKey.trim() || null,
          projectId: localFirebaseProjectId.trim() || null,
          appId: localFirebaseAppId.trim() || null,
          messagingSenderId: localFirebaseMessagingSenderId.trim() || null,
          vapidKey: localFirebaseVapidKey.trim() || null,
      });
      addToast({ title: "Saved", message: "Firebase configuration saved successfully!", type: "success" });
  };

  const handleSaveFirebaseServiceAccount = async () => {
      addToast({ title: "Settings", message: "Updating Firebase Service Account...", type: "info" });
      await new Promise(resolve => setTimeout(resolve, 500));
      setFirebaseServiceAccountKey(localFirebaseServiceAccountKey.trim() || null);
      addToast({ title: "Saved", message: "Firebase Service Account Key saved successfully!", type: "success" });
  };

  const handleSaveGoogleConfig = async () => {
      addToast({ title: "Settings", message: "Updating Google Drive configuration...", type: "info" });
      await new Promise(resolve => setTimeout(resolve, 500));
      setGoogleConfig(
          localGoogleClientId.trim() || "",
          localGoogleClientSecret.trim() || ""
      );
      addToast({ title: "Saved", message: "Google Drive API configuration saved successfully!", type: "success" });
  };

  const handleSaveSyncId = async () => {
      if (!localSyncId.trim()) {
          addToast({ title: "Settings", message: "Sync ID cannot be empty.", type: "warning" });
          return;
      }
      addToast({ title: "Settings", message: "Updating Sync ID...", type: "info" });
      await new Promise(resolve => setTimeout(resolve, 500));
      setUserId(localSyncId.trim());
      localStorage.setItem('indigo_user_id', localSyncId.trim());
      addToast({ title: "Saved", message: "Sync ID updated! Your data will now sync to this ID.", type: "success" });
  };

  const handleSaveAll = async () => {
      if (!localSyncId.trim()) {
          addToast({ title: "Settings", message: "Sync ID cannot be empty.", type: "warning" });
          return;
      }

      addToast({ title: "Settings", message: "Saving all settings...", type: "info" });
      
      // Update all settings
      setApiKey(localApiKey.trim() || null);
      setAsyncApiKey(localAsyncApiKey.trim() || null);
      setFirebaseConfig({
          apiKey: localFirebaseApiKey.trim() || null,
          projectId: localFirebaseProjectId.trim() || null,
          appId: localFirebaseAppId.trim() || null,
          messagingSenderId: localFirebaseMessagingSenderId.trim() || null,
          vapidKey: localFirebaseVapidKey.trim() || null,
      });
      setFirebaseServiceAccountKey(localFirebaseServiceAccountKey.trim() || null);
      setGoogleConfig(
          localGoogleClientId.trim() || "",
          localGoogleClientSecret.trim() || ""
      );
      setUserId(localSyncId.trim());
      localStorage.setItem('indigo_user_id', localSyncId.trim());

      // Wait a bit to ensure state updates are processed
      await new Promise(resolve => setTimeout(resolve, 500));
      
      addToast({ title: "Saved", message: "All settings saved successfully!", type: "success" });
  };

  const handleEnablePushNotifications = async () => {
    console.log("Enabling push notifications...");
    const config = (firebaseApiKey && firebaseProjectId && firebaseAppId && firebaseMessagingSenderId) ? {
        apiKey: firebaseApiKey,
        projectId: firebaseProjectId,
        appId: firebaseAppId,
        messagingSenderId: firebaseMessagingSenderId,
    } : undefined;

    const result = await requestNotificationPermission(config, firebaseVapidKey || undefined);
    console.log("Push notification permission result:", result);
    if (result.success && result.token) {
      setFcmToken(result.token);
      addToast({
        title: "Push Notifications",
        message: result.message,
        type: "success"
      });
    } else {
      addToast({
        title: "Push Notifications",
        message: result.message,
        type: "error"
      });
    }
  };

  const handleNotificationToggle = async () => {
    if (typeof Notification === 'undefined') {
      addToast({ title: "Not Supported", message: "Notifications are not supported in this browser.", type: "warning" });
      return;
    }

    const nextState = !notificationsEnabled;
    setNotificationsEnabled(nextState);

    if (nextState) {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          addToast({ 
            title: "Permission Required", 
            message: `Notification permission is currently "${permission}". You may need to enable notifications in your browser settings for desktop alerts.`, 
            type: "warning" 
          });
        } else {
          addToast({ title: "Enabled", message: "Notifications enabled!", type: "success" });
        }
      } catch (e) {
        console.error("Error requesting notification permission:", e);
        addToast({
          title: "Permission Blocked",
          message: "Could not request notification permission. It might be blocked by your browser or environment. In-app notifications will still work.",
          type: "warning"
        });
      }
    } else {
      addToast({
        title: "Notifications",
        message: "Notifications are disabled in-app settings.",
        type: "warning"
      });
    }
  };

  const [isTestingProactive, setIsTestingProactive] = useState(false);
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [isTestingBlog, setIsTestingBlog] = useState(false);

  const handleTestProactiveMessage = async () => {
    const hasNotificationSupport = typeof Notification !== 'undefined';
    
    if (hasNotificationSupport && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    setIsTestingProactive(true);
    addToast({ title: "Proactive Message", message: "Generating message and sending push...", type: "info" });

    try {
      const res = await fetch('/api/proactive-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatHistory: chatHistory.slice(-5),
          aiProfile,
          userProfile,
          apiKey: apiKey || undefined,
          fcmToken: fcmToken || undefined,
          userId: userId,
          firebaseServiceAccountKey: localFirebaseServiceAccountKey
        }),
      });

        if (res.ok) {
          const data = await res.json();
          if (data.message === "IN_PROGRESS") {
            addToast({ title: "Proactive Message", message: "Generation is already in progress.", type: "info" });
            return;
          }
          console.log("Proactive message response:", JSON.stringify(data));
          const { message, generatedImage } = data;
          
          if (generatedImage) {
            const imageUrl = `data:image/png;base64,${generatedImage}`;
            addToGallery({
            id: `generated-${Date.now()}-test`,
              type: 'generated',
              mediaType: 'image',
              url: imageUrl,
              prompt: message || "AI generated image",
              timestamp: Date.now(),
            });
            addChatMessage({
              id: `proactive-${Date.now()}-test-1`,
              role: 'model',
              content: message || "Here's an image I thought you'd like!",
              timestamp: Date.now(),
              attachments: [{ type: 'image', content: imageUrl, name: 'Generated Image' }]
            });
          } else if (message) {
            addChatMessage({
              id: `proactive-${Date.now()}-test-2`,
              role: 'model',
              content: message,
              timestamp: Date.now()
            });
          }
          console.log("Proactive message generated and sent via FCM.");
        } else {
        const err = await res.json();
        console.error("Failed to generate test proactive message:", err);
        const displayError = err.source ? `${err.error} (Source: ${err.source})` : (err.error || 'Unknown error');
        addToast({
          title: "AI Error",
          message: displayError,
          type: 'error'
        });
      }
    } catch (e: any) {
      console.error("Error sending test proactive message:", e);
      addToast({
        title: "Error",
        message: `Error sending test proactive message: ${e.message || 'Unknown error'}`,
        type: 'error'
      });
    } finally {
      setIsTestingProactive(false);
    }
  };

  const handleTestProactiveEmail = async () => {
    if (!userProfile.email) {
      addToast({ title: "Email Not Enabled", message: "Please enable proactive emails and provide your email address first.", type: "warning" });
      return;
    }

    setIsTestingEmail(true);
    addToast({ title: "Proactive Email", message: "Generating and sending proactive email...", type: "info" });

    try {
      // First generate the email content
      const res = await fetch('/api/proactive-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'email',
          chatHistory: chatHistory.slice(-5),
          aiProfile,
          userProfile,
          apiKey: apiKey || undefined,
          userId: userId
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to generate proactive email.");
      }
      
      const { message } = await res.json();
      if (message === "IN_PROGRESS") {
        addToast({ title: "Proactive Email", message: "Generation is already in progress.", type: "info" });
        return;
      }

      // Now send it using the unified email service
      await sendEmail(userProfile.email, `Proactive check-in from ${aiProfile.name}`, message, googleClientId, googleClientSecret);

      addToast({ title: "Email Sent", message: "Proactive email sent successfully!", type: "success" });
    } catch (e: any) {
      console.error('Error sending proactive email:', e);
      addToast({ title: "Error", message: e.message || "An error occurred.", type: "error" });
    } finally {
      setIsTestingEmail(false);
    }
  };

  const handleTestProactiveBlog = async () => {
    if (!aiProfile.proactiveBlogId) {
      addToast({ title: "Blog Not Configured", message: "Please select a blog for proactive posting first.", type: "warning" });
      return;
    }

    setIsTestingBlog(true);
    addToast({ title: "Proactive Blog", message: "Generating and posting proactive blog entry...", type: "info" });

    try {
      const res = await fetch('/api/proactive-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'blog',
          chatHistory: chatHistory.slice(-5),
          aiProfile,
          userProfile,
          apiKey: apiKey || undefined,
          userId: userId
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.message === "IN_PROGRESS") {
          addToast({ title: "Proactive Blog", message: "Generation is already in progress.", type: "info" });
          return;
        }
        addToast({ title: "Blog Posted", message: "Proactive blog entry posted successfully!", type: "success" });
      } else {
        const err = await res.json();
        addToast({ title: "Blog Failed", message: err.error || "Failed to post proactive blog entry.", type: "error" });
      }
    } catch (e: any) {
      addToast({ title: "Error", message: e.message || "An error occurred.", type: "error" });
    } finally {
      setIsTestingBlog(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    addToast({ title: "Exporting", message: "Preparing full app backup...", type: "info" });
    await new Promise(resolve => setTimeout(resolve, 800));
    try {
      const exportObject = await exportData(chatHistory, sessions, activeSessionId);
      const data = JSON.stringify(exportObject);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}_${now.getSeconds().toString().padStart(2, '0')}`;
      a.download = `${aiProfile.name}_backup_${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setIsExporting(false);
      }, 100);
      addToast({ title: "Export Successful", message: "Full app backup downloaded!", type: "success" });
    } catch (error) {
      console.error("Export failed:", error);
      addToast({ title: "Export Failed", message: "Failed to export data.", type: "error" });
      setIsExporting(false);
    }
  };

  const handleTestNotification = async () => {
    if (!fcmToken) {
      addToast({ title: "No Token", message: "Please enable push notifications first to get a token.", type: "warning" });
      return;
    }

    try {
      console.log("Sending test notification...");
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: fcmToken,
          title: "Indigo Test",
          body: "This is a test push notification!",
          firebaseServiceAccountKey: localFirebaseServiceAccountKey
        }),
      });

      console.log("Notification response status:", res.status);
      if (res.ok) {
        addToast({ title: "Test Sent", message: "Test notification request sent to server.", type: "success" });
      } else {
        const error = await res.json();
        console.error("Test notification failed:", error);
        
        if (error.code === 'TOKEN_EXPIRED') {
          setFcmToken("");
          addToast({ 
            title: "Token Expired", 
            message: "Your push notification token is no longer valid. Please re-enable notifications.", 
            type: "warning" 
          });
          return;
        }

        const errorMessage = error.detail ? `${error.error} (${error.detail})` : (error.error || "Failed to send test notification.");
        addToast({ title: "Test Failed", message: errorMessage, type: "error" });
      }
    } catch (e: any) {
      console.error("Test notification fetch error:", e);
      addToast({ title: "Test Failed", message: e.message || "Failed to send test notification.", type: "error" });
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsImporting(true);
      addToast({ title: "Importing", message: "Restoring data from file...", type: "info" });
      await new Promise(resolve => setTimeout(resolve, 800));
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          try {
            importData(event.target.result as string, setChatHistory, setSessions, setActiveSessionId);
          } finally {
            setIsImporting(false);
          }
        } else {
          setIsImporting(false);
        }
      };
      reader.onerror = () => {
        addToast({ title: "Import Failed", message: "Failed to read backup file.", type: "error" });
        setIsImporting(false);
      };
      reader.readAsText(file);
    }
  };

  const handleKBUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsImporting(true);
    addToast({ title: "Knowledge Base", message: `Processing ${files.length} document(s)...`, type: "info" });
    
    try {
      for (let i = 0; i < files.length; i++) {
          const file = files[i];
          try {
            const processedFiles = await processFile(file, file.name, apiKey || undefined);
            for (const processed of processedFiles) {
              addToKnowledgeBase({ 
                  name: processed.name, 
                  content: processed.content || `[Empty Document: ${processed.name}]`
              });
            }
          } catch (err) {
            console.error(`Failed to process ${file.name}:`, err);
            addToast({ title: "Processing Error", message: `Failed to process ${file.name}`, type: "error" });
          }
      }
      addToast({ title: "Knowledge Base", message: "All documents processed!", type: "success" });
    } catch (e) {
      console.error("KB upload failed", e);
      addToast({ title: "Upload Failed", message: "Failed to upload documents to Knowledge Base.", type: "error" });
    } finally {
      setIsImporting(false);
    }
  };

  const handleManualDriveBackup = async () => {
    setIsBackingUpDrive(true);
    addToast({ title: "Google Drive Backup", message: "Initiating manual backup to Google Drive...", type: "info" });
    await new Promise(resolve => setTimeout(resolve, 800));
    try {
      const exportObject = await exportData(chatHistory, sessions, activeSessionId);
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}_${now.getSeconds().toString().padStart(2, '0')}`;
      const filename = `${aiProfile.name}_backup_${timestamp}.json`;
      const res = await fetch('/api/drive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          filename, 
          content: JSON.stringify(exportObject), // Stringify once here
          clientId: googleClientId,
          clientSecret: googleClientSecret
        }),
      });

      if (res.ok) {
        addToast({ title: "Backup Successful", message: "App data successfully backed up to Google Drive!", type: "success" });
      } else {
        const errorData = await res.text();
        addToast({ title: "Backup Failed", message: `Failed to backup to Google Drive: ${errorData}`, type: "error" });
      }
    } catch (e: any) {
      console.error("Manual Google Drive backup failed:", e);
      addToast({ title: "Backup Failed", message: `Failed to backup to Google Drive: ${e.message || 'Unknown error'}`, type: "error" });
    } finally {
      setIsBackingUpDrive(false);
    }
  };

  return (
    <div className="w-full h-full p-4 overflow-y-auto bg-transparent transition-colors duration-500">
      <h2 
        className="text-2xl font-bold mb-6 text-indigo-600 dark:text-indigo-400 cursor-pointer"
        onClick={() => {
            const count = (parseInt(localStorage.getItem('debug_tap_count') || '0') + 1);
            if (count >= 5) {
                setIsDebuggerEnabled(true);
                localStorage.setItem('indigo_debugger_enabled', 'true');
                localStorage.setItem('debug_tap_count', '0');
                window.dispatchEvent(new Event('indigo_debugger_toggle'));
                addToast({ title: "Debugger", message: "Debugger enabled!", type: "success" });
            } else {
                localStorage.setItem('debug_tap_count', count.toString());
            }
        }}
      >Settings</h2>
      
      {isSyncing && (
          <div className="w-full h-1 bg-indigo-100 dark:bg-indigo-900 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-indigo-600 dark:bg-indigo-500 animate-pulse w-full" />
          </div>
      )}

      <div className="space-y-8">
        {/* API Key Management */}
        <section>
            <h3 className="text-lg font-semibold text-indigo-900 dark:text-indigo-100 mb-4 border-b border-indigo-200 dark:border-indigo-800 pb-2">API Configuration</h3>
            <div className="space-y-6">
                {/* Gemini */}
                <div>
                    <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Gemini API Key (Optional)</label>
                    <div className="flex space-x-2">
                        <div className="relative flex-1">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Key className="h-5 w-5 text-indigo-400 dark:text-indigo-500" />
                            </div>
                            <input
                                id="gemini-api-key"
                                type="password"
                                value={localApiKey}
                                onChange={(e) => setLocalApiKey(e.target.value)}
                                className="pl-10 block w-full border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-indigo-950 dark:text-indigo-50 placeholder-indigo-400 dark:placeholder-indigo-600"
                                placeholder="Enter your Gemini API Key"
                            />
                        </div>
                        <button
                            onClick={handleSaveApiKey}
                            className="bg-indigo-600 dark:bg-indigo-500 text-white px-4 py-2 rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors text-sm font-medium"
                        >
                            Save
                        </button>
                    </div>
                </div>

                {/* Async API Key */}
                <div>
                    <label className="block text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Async API Key (Optional)</label>
                    <div className="flex space-x-2">
                        <div className="relative flex-1">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Key className="h-5 w-5 text-indigo-400 dark:text-indigo-500" />
                            </div>
                            <input
                                id="async-api-key"
                                type="password"
                                value={localAsyncApiKey}
                                onChange={(e) => setLocalAsyncApiKey(e.target.value)}
                                className="pl-10 block w-full border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-indigo-950 dark:text-indigo-50 placeholder-indigo-400 dark:placeholder-indigo-600"
                                placeholder="Enter your Async API Key"
                            />
                        </div>
                        <button
                            onClick={handleSaveAsyncApiKey}
                            className="bg-indigo-600 dark:bg-indigo-500 text-white px-4 py-2 rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors text-sm font-medium"
                        >
                            Save
                        </button>
                    </div>
                </div>

                {/* Firebase */}
                <div className="bg-indigo-50 dark:bg-indigo-900 p-4 rounded-lg border border-indigo-200 dark:border-indigo-800">
                    <h4 className="text-sm font-bold text-indigo-700 dark:text-indigo-200 mb-3 uppercase tracking-wider">Firebase Configuration (Push Notifications)</h4>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase mb-1">API Key</label>
                            <input
                                type="password"
                                value={localFirebaseApiKey}
                                onChange={(e) => setLocalFirebaseApiKey(e.target.value)}
                                className="block w-full border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-1 px-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-xs dark:bg-indigo-950 dark:text-indigo-50 placeholder-indigo-400 dark:placeholder-indigo-600"
                                placeholder="Firebase API Key"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase mb-1">Project ID</label>
                                <input
                                    type="text"
                                    value={localFirebaseProjectId}
                                    onChange={(e) => setLocalFirebaseProjectId(e.target.value)}
                                    className="block w-full border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-1 px-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-xs dark:bg-indigo-950 dark:text-indigo-50 placeholder-indigo-400 dark:placeholder-indigo-600"
                                    placeholder="Project ID"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase mb-1">App ID</label>
                                <input
                                    type="text"
                                    value={localFirebaseAppId}
                                    onChange={(e) => setLocalFirebaseAppId(e.target.value)}
                                    className="block w-full border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-1 px-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-xs dark:bg-indigo-950 dark:text-indigo-50 placeholder-indigo-400 dark:placeholder-indigo-600"
                                    placeholder="App ID"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase mb-1">Sender ID</label>
                                <input
                                    type="text"
                                    value={localFirebaseMessagingSenderId}
                                    onChange={(e) => setLocalFirebaseMessagingSenderId(e.target.value)}
                                    className="block w-full border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-1 px-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-xs dark:bg-indigo-950 dark:text-indigo-50 placeholder-indigo-400 dark:placeholder-indigo-600"
                                    placeholder="Sender ID"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase mb-1">VAPID Key</label>
                                <input
                                    type="text"
                                    value={localFirebaseVapidKey}
                                    onChange={(e) => setLocalFirebaseVapidKey(e.target.value)}
                                    className="block w-full border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-1 px-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-xs dark:bg-indigo-950 dark:text-indigo-50 placeholder-indigo-400 dark:placeholder-indigo-600"
                                    placeholder="VAPID Public Key"
                                />
                            </div>
                        </div>
                        <div className="mt-4 p-3 bg-white dark:bg-indigo-950 rounded-lg border border-indigo-200 dark:border-indigo-800 shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-200 uppercase tracking-wider">Push Status</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${fcmToken ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'}`}>
                                    {fcmToken ? 'Enabled' : 'Disabled'}
                                </span>
                            </div>
                            {fcmToken && (
                                <div className="space-y-1">
                                    <div className="text-[10px] text-indigo-500 dark:text-indigo-400 truncate">Token: {fcmToken.substring(0, 30)}...</div>
                                    <button 
                                        onClick={() => navigator.clipboard.writeText(fcmToken)}
                                        className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium flex items-center"
                                    >
                                        <Copy className="w-3 h-3 mr-2" /> Copy Full Token
                                    </button>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={handleSaveFirebaseConfig}
                            className="w-full mt-2 bg-indigo-600 dark:bg-indigo-500 text-white px-4 py-2 rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors text-xs font-bold uppercase tracking-widest"
                        >
                            Save Firebase Config
                        </button>
                    </div>
                </div>
                
                <p className="text-[10px] text-indigo-500 dark:text-indigo-400 italic">
                    Note: Providing your own keys overrides the system defaults. This is recommended for high-volume usage or custom integrations.
                </p>
            </div>
        </section>

        {/* Advanced Server-Side Configuration */}
        <section className="bg-red-50 dark:bg-red-950/30 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
            <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-4 border-b border-red-200 dark:border-red-800 pb-2 flex items-center">
                <Shield className="w-5 h-5 mr-2" />
                Advanced Server-Side Keys
            </h3>
            <div className="space-y-6">
                {/* Google Drive Advanced */}
                <div>
                    <h4 className="text-xs font-bold text-red-700 dark:text-red-300 mb-2 uppercase tracking-wider">Google Drive API (OAuth)</h4>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase mb-1">Client ID</label>
                            <input
                                type="text"
                                value={localGoogleClientId}
                                onChange={(e) => setLocalGoogleClientId(e.target.value)}
                                className="block w-full border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-1 px-2 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-xs dark:bg-indigo-950 dark:text-indigo-50 placeholder-indigo-400 dark:placeholder-indigo-600"
                                placeholder="Google Client ID"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase mb-1">Client Secret</label>
                            <input
                                type="password"
                                value={localGoogleClientSecret}
                                onChange={(e) => setLocalGoogleClientSecret(e.target.value)}
                                className="block w-full border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-1 px-2 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-xs dark:bg-indigo-950 dark:text-indigo-50 placeholder-indigo-400 dark:placeholder-indigo-600"
                                placeholder="Google Client Secret"
                            />
                        </div>
                        <button
                            onClick={handleSaveGoogleConfig}
                            className="w-full bg-red-600 dark:bg-red-700 text-white px-4 py-2 rounded-md hover:bg-red-700 dark:hover:bg-red-600 transition-colors text-xs font-bold uppercase tracking-widest"
                        >
                            Save Google Config
                        </button>
                    </div>
                </div>

                {/* Firebase Service Account */}
                <div>
                    <h4 className="text-xs font-bold text-red-700 dark:text-red-300 mb-2 uppercase tracking-wider">Firebase Service Account (JSON)</h4>
                    <p className="text-[10px] text-red-600 dark:text-red-400 mb-2">Required for the server to send push notifications using your own Firebase project.</p>
                    <textarea
                        value={localFirebaseServiceAccountKey}
                        onChange={(e) => setLocalFirebaseServiceAccountKey(e.target.value)}
                        className="block w-full border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-xs h-32 font-mono dark:bg-indigo-950 dark:text-indigo-50 placeholder-indigo-400 dark:placeholder-indigo-600"
                        placeholder='{ "type": "service_account", ... }'
                    />
                    <button
                        onClick={handleSaveFirebaseServiceAccount}
                        className="w-full mt-2 bg-red-600 dark:bg-red-700 text-white px-4 py-2 rounded-md hover:bg-red-700 dark:hover:bg-red-600 transition-colors text-xs font-bold uppercase tracking-widest"
                    >
                        Save Service Account Key
                    </button>
                </div>
                
                <p className="text-[10px] text-red-500 dark:text-red-400 italic">
                    Warning: These keys are sensitive. They are stored locally in your browser's IndexedDB and sent to the server for processing.
                </p>
            </div>
        </section>

        {/* AI Integrations */}
        <section className="bg-white dark:bg-indigo-950 p-6 rounded-2xl shadow-sm border border-indigo-100 dark:border-indigo-800 mb-8">
            <h3 className="text-lg font-semibold text-indigo-900 dark:text-indigo-100 mb-4 flex items-center">
                <Globe className="w-5 h-5 mr-2 text-indigo-600 dark:text-indigo-400" />
                AI Integrations
            </h3>
            <p className="text-sm text-indigo-600 dark:text-indigo-400 mb-6">
                Enable or disable specific capabilities for your AI persona. These integrations allow the AI to access real-time information and external services.
            </p>

            <div className="space-y-6">
                {/* Image Generation */}
                <div className="flex items-start justify-between">
                    <div className="flex-1 pr-4">
                        <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100 mb-1">AI Can Generate Images</h4>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400">
                            Allows the AI to create visual content based on your descriptions. It uses the persona's reference image and background settings for consistency.
                        </p>
                    </div>
                    <button 
                        onClick={() => updateAIProfile({ aiCanGenerateImages: !aiProfile.aiCanGenerateImages })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${aiProfile.aiCanGenerateImages ? 'bg-indigo-600' : 'bg-indigo-200 dark:bg-indigo-800'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiProfile.aiCanGenerateImages ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Web Search */}
                <div className="flex items-start justify-between">
                    <div className="flex-1 pr-4">
                        <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100 mb-1">AI Can Use Web Search</h4>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400">
                            Enables real-time fact-checking and information retrieval from the web. The AI will prioritize scientific consensus and verified sources.
                        </p>
                    </div>
                    <button 
                        onClick={() => updateAIProfile({ aiCanUseWebSearch: !aiProfile.aiCanUseWebSearch })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${aiProfile.aiCanUseWebSearch ? 'bg-indigo-600' : 'bg-indigo-200 dark:bg-indigo-800'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiProfile.aiCanUseWebSearch ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Google Calendar */}
                <div className="flex items-start justify-between">
                    <div className="flex-1 pr-4">
                        <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100 mb-1">AI Can Use Calendar</h4>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400">
                            Allows the AI to view, add, and manage events in your Google Calendar. Useful for scheduling and reminders.
                        </p>
                    </div>
                    <button 
                        onClick={() => updateAIProfile({ aiCanUseCalendar: !aiProfile.aiCanUseCalendar })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${aiProfile.aiCanUseCalendar ? 'bg-indigo-600' : 'bg-indigo-200 dark:bg-indigo-800'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiProfile.aiCanUseCalendar ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Gmail */}
                <div className="flex items-start justify-between">
                    <div className="flex-1 pr-4">
                        <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100 mb-1">AI Can Use Gmail</h4>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400">
                            Enables the AI to read, summarize, and help you draft emails. It can provide context from your recent conversations.
                        </p>
                    </div>
                    <button 
                        onClick={() => updateAIProfile({ aiCanUseGmail: !aiProfile.aiCanUseGmail })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${aiProfile.aiCanUseGmail ? 'bg-indigo-600' : 'bg-indigo-200 dark:bg-indigo-800'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiProfile.aiCanUseGmail ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* YouTube */}
                <div className="flex items-start justify-between">
                    <div className="flex-1 pr-4">
                        <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100 mb-1">AI Can Use YouTube</h4>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400">
                            Allows the AI to search for videos, provide summaries, and find visual tutorials or entertainment based on your interests.
                        </p>
                    </div>
                    <button 
                        onClick={() => updateAIProfile({ aiCanUseYouTube: !aiProfile.aiCanUseYouTube })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${aiProfile.aiCanUseYouTube ? 'bg-indigo-600' : 'bg-indigo-200 dark:bg-indigo-800'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiProfile.aiCanUseYouTube ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Google Maps */}
                <div className="flex items-start justify-between">
                    <div className="flex-1 pr-4">
                        <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100 mb-1">AI Can Use Google Maps</h4>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400">
                            Enables the AI to provide directions, find local businesses, check traffic, and give travel recommendations.
                        </p>
                    </div>
                    <button 
                        onClick={() => updateAIProfile({ aiCanUseGoogleMaps: !aiProfile.aiCanUseGoogleMaps })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${aiProfile.aiCanUseGoogleMaps ? 'bg-indigo-600' : 'bg-indigo-200 dark:bg-indigo-800'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiProfile.aiCanUseGoogleMaps ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Blogger */}
                <div className="flex items-start justify-between">
                    <div className="flex-1 pr-4">
                        <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100 mb-1">AI Can Use Blogger</h4>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400">
                            Allows the AI to draft and publish blog posts to your Blogger account.
                        </p>
                    </div>
                    <button 
                        onClick={() => updateAIProfile({ aiCanUseBlogger: !aiProfile.aiCanUseBlogger })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${aiProfile.aiCanUseBlogger ? 'bg-indigo-600' : 'bg-indigo-200 dark:bg-indigo-800'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiProfile.aiCanUseBlogger ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
            </div>
        </section>

        {/* Cloud Sync & Recovery */}
        <section className="bg-white dark:bg-indigo-950 p-4 sm:p-6 rounded-2xl shadow-sm border border-indigo-100 dark:border-indigo-800 mb-8">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                    <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900 rounded-xl flex items-center justify-center mr-3 sm:mr-4 flex-shrink-0">
                        <Cloud className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-base sm:text-lg font-semibold text-indigo-900 dark:text-indigo-100">Cloud Sync & Recovery</h3>
                        <p className="text-xs sm:text-sm text-indigo-500 dark:text-indigo-400">Keep your data safe and synced across devices.</p>
                    </div>
                </div>
            </div>

            <div className="space-y-6">
                <div className="p-3 sm:p-4 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl border border-indigo-200 dark:border-indigo-800">
                    <label className="block text-xs font-semibold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider mb-2">Cloud Sync Settings</label>
                    <div className="flex items-center justify-between mb-4">
                        <span className="text-sm text-indigo-700 dark:text-indigo-300">Enable Cloud Sync</span>
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={() => setIsSyncEnabled(!isSyncEnabled)}
                                className={`w-10 h-6 rounded-full transition-colors ${isSyncEnabled ? 'bg-indigo-600' : 'bg-indigo-200 dark:bg-indigo-800'}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${isSyncEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                            </button>
                        </div>
                    </div>
                    {isSyncEnabled && (
                        <div className="mb-4">
                            <label className="block text-xs text-indigo-500 dark:text-indigo-400 mb-1">Sync Frequency (minutes)</label>
                            <input
                                type="number"
                                min="1"
                                value={syncFrequency}
                                onChange={(e) => setSyncFrequency(parseInt(e.target.value) || 5)}
                                className="w-full p-2 bg-white dark:bg-indigo-900 rounded border border-indigo-200 dark:border-indigo-700 text-sm text-indigo-900 dark:text-indigo-100 focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    )}
                    
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/50 rounded-xl border border-indigo-100 dark:border-indigo-800 mb-4">
                        <label className="block text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider mb-2">Your Sync ID</label>
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
                            <input
                                type="text"
                                value={localSyncId}
                                onChange={(e) => setLocalSyncId(e.target.value)}
                                className="flex-1 p-2 bg-white dark:bg-indigo-950 rounded-lg border border-indigo-200 dark:border-indigo-700 text-sm font-mono text-indigo-600 dark:text-indigo-400 break-all focus:ring-2 focus:ring-indigo-500 outline-none placeholder-indigo-400 dark:placeholder-indigo-600"
                                placeholder="Enter your custom Sync ID"
                            />
                            <div className="flex space-x-2">
                                <button 
                                    onClick={handleSaveSyncId}
                                    className="flex-1 sm:flex-none flex items-center justify-center p-2 bg-indigo-600 dark:bg-indigo-500 text-white hover:bg-indigo-700 dark:hover:bg-indigo-600 rounded-lg transition-colors shadow-sm"
                                    title="Save Sync ID"
                                >
                                    <Save className="w-4 h-4 mr-2 sm:mr-0" />
                                    <span className="sm:hidden text-xs font-medium">Save ID</span>
                                </button>
                                <button 
                                    onClick={() => {
                                        navigator.clipboard.writeText(localSyncId);
                                        addToast({ title: "Copied", message: "Sync ID copied to clipboard", type: "success" });
                                    }}
                                    className="flex-1 sm:flex-none flex items-center justify-center p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-800 rounded-lg transition-colors border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-indigo-900"
                                    title="Copy Sync ID"
                                >
                                    <Copy className="w-4 h-4 mr-2 sm:mr-0" />
                                    <span className="sm:hidden text-xs font-medium">Copy ID</span>
                                </button>
                            </div>
                        </div>
                        <p className="mt-2 text-[10px] text-indigo-500 dark:text-indigo-400 italic">
                            Save this ID! You can use a custom ID to sync across devices. Make sure it's unique.
                        </p>
                    </div>

                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className={`w-full flex items-center justify-center px-4 py-3 bg-indigo-600 dark:bg-indigo-500 text-white rounded-xl hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors text-sm font-medium shadow-sm ${isSyncing ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Syncing to Cloud...' : 'Sync Now'}
                    </button>
                </div>

                <div className="p-3 sm:p-4 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl border border-indigo-200 dark:border-indigo-800">
                    <label className="block text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider mb-2">Current User ID</label>
                    <p className="text-xs text-indigo-500 dark:text-indigo-400 mb-4 font-mono">{userId}</p>

                    <label className="block text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider mb-2">Data Recovery</label>
                    <p className="text-xs text-indigo-500 dark:text-indigo-400 mb-4">Recover your data from the cloud using a Sync ID.</p>
                    
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-2 mb-4">
                        <input
                            type="text"
                            value={recoveryId}
                            onChange={(e) => setRecoveryId(e.target.value)}
                            className="flex-1 p-2 bg-white dark:bg-indigo-950 rounded-lg border border-indigo-300 dark:border-indigo-700 text-sm font-mono text-indigo-600 dark:text-indigo-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-indigo-400 dark:placeholder-indigo-600"
                            placeholder="Enter Sync ID to recover"
                        />
                        <button
                            onClick={() => {
                                if (!recoveryId) {
                                    addToast({ title: "Recovery", message: "Please enter a Sync ID first.", type: "warning" });
                                    return;
                                }
                                if (chatHistory.length > 0) {
                                    setShowOverwriteConfirm(true);
                                } else {
                                    handleRecover();
                                }
                            }}
                            disabled={isSyncing || !recoveryId}
                            className={`px-4 py-2 bg-indigo-900 dark:bg-indigo-500 text-white rounded-lg hover:bg-black dark:hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center`}
                        >
                            <Download className="w-4 h-4 mr-2" />
                            Recover Data
                        </button>
                    </div>

                    {/* Data recovery status removed */}
                </div>
            </div>
        </section>

        {/* Cloud Integration */}
        <section>
            {!isGoogleDriveConnected ? (
                <div className="space-y-4">
                    <button
                        onClick={handleGoogleDriveConnect}
                        className="flex items-center justify-center w-full p-4 border border-indigo-300 dark:border-indigo-700 rounded-lg bg-white dark:bg-indigo-900 hover:bg-indigo-50 dark:hover:bg-indigo-800 transition-colors"
                    >
                        <Cloud className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
                        <span className="text-indigo-700 dark:text-indigo-300 font-medium">Connect Google Drive</span>
                    </button>
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-md border border-indigo-200 dark:border-indigo-800 space-y-3">
                        <div>
                            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-1 uppercase tracking-wider">1. Authorized JavaScript Origin:</p>
                            <code className="text-[10px] break-all text-indigo-600 dark:text-indigo-400 bg-white dark:bg-indigo-950 p-1 rounded border border-indigo-100 dark:border-indigo-800 block">
                                {window.location.origin}
                            </code>
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-1 uppercase tracking-wider">2. Authorized Redirect URI:</p>
                            <code className="text-[10px] break-all text-indigo-600 dark:text-indigo-400 bg-white dark:bg-indigo-950 p-1 rounded border border-indigo-100 dark:border-indigo-800 block">
                                {window.location.origin}/auth/google/callback
                            </code>
                        </div>
                        <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-2 leading-relaxed">
                            In Google Cloud Console, add <span className="font-mono font-bold">#1</span> to "Authorized JavaScript origins" and <span className="font-mono font-bold">#2</span> to "Authorized redirect URIs".
                        </p>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                        <div className="flex items-center">
                            <Cloud className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-3" />
                            <div>
                                <span className="text-blue-800 dark:text-blue-200 font-medium block">Google Drive Connected</span>
                                <span className="text-xs text-blue-600 dark:text-blue-400">You can now import documents directly.</span>
                            </div>
                        </div>
                        <div className="flex space-x-2">
                            <button 
                                onClick={fetchDriveFiles}
                                className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full transition-colors"
                                title="Refresh Files"
                            >
                                <RefreshCw className={`w-4 h-4 ${isFetchingDrive ? 'animate-spin' : ''}`} />
                            </button>
                            <button 
                                onClick={handleManualDriveBackup}
                                className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full transition-colors"
                                title="Backup Now"
                            >
                                <Cloud className={`w-4 h-4 ${isBackingUpDrive ? 'animate-spin' : ''}`} />
                            </button>
                            <button 
                                onClick={handleGoogleDriveDisconnect}
                                className="p-2 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-800 rounded-full transition-colors"
                                title="Disconnect"
                            >
                                <LogOut className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {driveFiles.length > 0 && (
                        <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-lg p-4 max-h-60 overflow-y-auto border border-indigo-100 dark:border-indigo-800">
                            <h4 className="text-sm font-medium text-indigo-900 dark:text-indigo-100 mb-2">Recent Drive Files</h4>
                            <div className="space-y-2">
                                {driveFiles.map((file) => (
                                    <div key={file.id} className="flex items-center justify-between bg-white dark:bg-indigo-900 p-2 rounded border border-indigo-200 dark:border-indigo-700 text-sm">
                                        <div className="flex items-center truncate flex-1 mr-2">
                                            <File className="w-4 h-4 mr-2 text-indigo-400 dark:text-indigo-500" />
                                            <span className="truncate text-indigo-900 dark:text-indigo-100">{file.name}</span>
                                        </div>
                                        <button 
                                            onClick={() => importFromDrive(file.id)}
                                            disabled={isImporting}
                                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium disabled:opacity-50"
                                        >
                                            {isImporting ? "Importing..." : "Import"}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </section>

        {/* Knowledge Base Management */}
        <section>
            <h3 className="text-lg font-semibold text-indigo-900 dark:text-indigo-100 mb-4 border-b border-indigo-100 dark:border-indigo-800 pb-2">Knowledge Base</h3>
            <div className="mb-4">
                <button
                    onClick={() => kbInputRef.current?.click()}
                    disabled={isImporting}
                    className="flex items-center justify-center w-full p-4 border-2 border-dashed border-indigo-200 dark:border-indigo-700 rounded-lg bg-white dark:bg-indigo-950 hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-colors text-indigo-600 dark:text-indigo-400 disabled:opacity-50"
                >
                    {isImporting ? (
                        <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                        <Upload className="w-5 h-5 mr-2" />
                    )}
                    <span className="font-medium">{isImporting ? "Processing..." : "Upload Documents to Knowledge Base"}</span>
                </button>
                <input 
                    type="file" 
                    ref={kbInputRef} 
                    onChange={handleKBUpload} 
                    accept=".txt,.md,.pdf,.rtf,.json,.csv,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.h,.hpp,.go,.rb,.php,.swift,.kt,.sql,.yml,.yaml,.toml,.ini,.log"
                    multiple
                    className="hidden" 
                />
                <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-2 text-center">
                    Supported formats: .txt, .md, .rtf, .pdf, .json, .csv, .xml, .html, .css, .js, .ts, .tsx, .jsx, .py, .java, .c, .cpp, .h, .hpp, .go, .rb, .php, .swift, .kt, .sql, .yml, .yaml, .toml, .ini, .log
                </p>
            </div>
            
            {knowledgeBase.length > 0 && (
                <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-lg p-3 sm:p-4 max-h-60 overflow-y-auto border border-indigo-100 dark:border-indigo-800">
                    <h4 className="text-xs sm:text-sm font-medium text-indigo-900 dark:text-indigo-100 mb-2">Indexed Files ({knowledgeBase.length})</h4>
                    <ul className="space-y-2">
                        {knowledgeBase.map((file, idx) => (
                            <li key={idx} className="flex items-center text-xs sm:text-sm text-indigo-700 dark:text-indigo-300 bg-white dark:bg-indigo-900 p-2 rounded border border-indigo-200 dark:border-indigo-700">
                                <FileText className="w-4 h-4 mr-2 text-indigo-400 dark:text-indigo-500 flex-shrink-0" />
                                <span className="truncate flex-1 min-w-0">{file.name}</span>
                                <span className="text-[10px] sm:text-xs text-indigo-400 dark:text-indigo-500 ml-2 flex-shrink-0">
                                    {file.content.length > 100 ? `${Math.round(file.content.length / 1024)} KB` : `${file.content.length} B`}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>

        {/* Data Management */}
        <section>
            <h3 className="text-lg font-semibold text-indigo-900 dark:text-indigo-100 mb-4 border-b border-indigo-100 dark:border-indigo-800 pb-2">Data Management</h3>
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg">
                <p className="text-sm font-bold text-red-600 dark:text-red-400">
                    Warning: JSON backups do NOT include images or videos. Please backup your images and videos separately using the "Download All (ZIP)" feature in the Gallery.
                </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="flex items-center justify-center p-4 border border-indigo-300 dark:border-indigo-700 rounded-lg bg-white dark:bg-indigo-900 hover:bg-indigo-50 dark:hover:bg-indigo-800 transition-colors disabled:opacity-50"
                >
                    {isExporting ? (
                        <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                        <Download className="w-5 h-5 mr-2 text-indigo-600 dark:text-indigo-400" />
                    )}
                    <span className="text-indigo-700 dark:text-indigo-300">{isExporting ? "Exporting..." : "Export Data (JSON)"}</span>
                </button>
                
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                    className="flex items-center justify-center p-4 border border-indigo-300 dark:border-indigo-700 rounded-lg bg-white dark:bg-indigo-900 hover:bg-indigo-50 dark:hover:bg-indigo-800 transition-colors disabled:opacity-50"
                >
                    {isImporting ? (
                        <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                        <Upload className="w-5 h-5 mr-2 text-indigo-600 dark:text-indigo-400" />
                    )}
                    <span className="text-indigo-700 dark:text-indigo-300">{isImporting ? "Importing..." : "Import Data (JSON)"}</span>
                </button>
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImport} 
                    accept=".json" 
                    className="hidden" 
                />
            </div>
            <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-2">
                Export your chat history, profiles, and journal to a JSON file for backup or transfer.
            </p>
        </section>

        {/* App Preferences */}
        <section>
            <h3 className="text-lg font-semibold text-indigo-900 dark:text-indigo-100 mb-4 border-b border-indigo-100 dark:border-indigo-800 pb-2">Preferences</h3>
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <Save className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mr-3" />
                        <div>
                            <span className="text-indigo-900 dark:text-indigo-100 block">Auto-Save Chat History</span>
                            <span className="text-xs text-indigo-500 dark:text-indigo-400">Automatically save chat history. Set to 0 to disable interval saving.</span>
                        </div>
                    </div>
                    <div className="flex items-center space-x-2">
                        <input
                            type="number"
                            min="0"
                            value={autoSaveChatInterval}
                            onChange={(e) => setAutoSaveChatInterval(Number(e.target.value))}
                            className="w-20 border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-1 px-2 text-sm text-center focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-50"
                        />
                        <span className="text-sm text-indigo-600 dark:text-indigo-400">seconds</span>
                        <button 
                            onClick={() => setAutoSaveChat(!autoSaveChat)}
                            className={`${autoSaveChat ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-indigo-200 dark:bg-indigo-800'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none`}
                        >
                            <span className={`${autoSaveChat ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}></span>
                        </button>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <Database className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mr-3" />
                        <div>
                            <span className="text-indigo-900 dark:text-indigo-100 block">Auto-Backup JSON Interval</span>
                            <span className="text-xs text-indigo-500 dark:text-indigo-400">Interval for JSON backups. Set to 0 to disable. (Note: JSON backups do not include images or videos).</span>
                        </div>
                    </div>
                    <div className="flex items-center space-x-2">
                        <input
                            type="number"
                            min="0"
                            value={autoJsonBackupInterval}
                            onChange={(e) => setAutoJsonBackupInterval(Number(e.target.value))}
                            className="w-20 border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-1 px-2 text-sm text-center focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-50"
                        />
                        <span className="text-sm text-indigo-600 dark:text-indigo-400">minutes</span>
                        <button 
                            onClick={() => setAutoJsonBackup(!autoJsonBackup)}
                            className={`${autoJsonBackup ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-indigo-200 dark:bg-indigo-800'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none`}
                        >
                            <span className={`${autoJsonBackup ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}></span>
                        </button>
                    </div>
                </div>


                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <Cloud className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mr-3" />
                        <div>
                            <span className="text-indigo-900 dark:text-indigo-100 block">Auto-Backup to Google Drive</span>
                            <span className="text-xs text-indigo-500 dark:text-indigo-400">Automatically backup full state to Google Drive. (Note: Cloud Sync and Google Drive Backup are separate functions with independent intervals).</span>
                            <span className="text-xs text-red-600 dark:text-red-400 block mt-1 font-medium italic">Please occasionally delete older backups from your Google Drive to save space.</span>
                        </div>
                    </div>
                    <div className="flex items-center space-x-2">
                        <button 
                            onClick={() => setAutoDriveBackup(!autoDriveBackup)}
                            disabled={!isGoogleDriveConnected}
                            className={`${autoDriveBackup && isGoogleDriveConnected ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-indigo-200 dark:bg-indigo-800'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${!isGoogleDriveConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <span className={`${autoDriveBackup && isGoogleDriveConnected ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}></span>
                        </button>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <Clock className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mr-3" />
                        <div>
                            <span className="text-indigo-900 dark:text-indigo-100 block">Google Drive Backup Interval</span>
                            <span className="text-xs text-indigo-500 dark:text-indigo-400">How frequently (in minutes) to backup to Google Drive.</span>
                        </div>
                    </div>
                    <div className="flex items-center space-x-2">
                        <input
                            type="number"
                            min="1"
                            value={autoDriveBackupInterval}
                            onChange={(e) => setAutoDriveBackupInterval(Number(e.target.value))}
                            className="w-20 border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-1 px-2 text-sm text-center focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-50"
                        />
                        <span className="text-sm text-indigo-600 dark:text-indigo-400">minutes</span>
                    </div>
                </div>




                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <Bell className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mr-3" />
                        <div>
                            <span className="text-indigo-900 dark:text-indigo-100 block">Test Proactive Message</span>
                            <span className="text-xs text-indigo-500 dark:text-indigo-400">Trigger a proactive message immediately.</span>
                        </div>
                    </div>
                    <button
                        onClick={handleTestProactiveMessage}
                        disabled={isTestingProactive}
                        className={`${isTestingProactive ? 'bg-indigo-400 dark:bg-indigo-600 cursor-not-allowed' : 'bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 dark:hover:bg-indigo-400'} text-white px-4 py-2 rounded-md transition-colors text-sm font-medium flex items-center`}
                    >
                        {isTestingProactive && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                        {isTestingProactive ? 'Generating...' : 'Test Now'}
                    </button>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <Mail className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mr-3" />
                        <div>
                            <span className="text-indigo-900 dark:text-indigo-100 block">Test Proactive Email</span>
                            <span className="text-xs text-indigo-500 dark:text-indigo-400">Trigger a proactive email immediately.</span>
                        </div>
                    </div>
                    <button
                        onClick={handleTestProactiveEmail}
                        disabled={isTestingEmail}
                        className={`${isTestingEmail ? 'bg-indigo-400 dark:bg-indigo-600 cursor-not-allowed' : 'bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 dark:hover:bg-indigo-400'} text-white px-4 py-2 rounded-md transition-colors text-sm font-medium flex items-center`}
                    >
                        {isTestingEmail && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                        {isTestingEmail ? 'Sending...' : 'Test Now'}
                    </button>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <BookOpen className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mr-3" />
                        <div>
                            <span className="text-indigo-900 dark:text-indigo-100 block">Test Proactive Blog</span>
                            <span className="text-xs text-indigo-500 dark:text-indigo-400">Trigger a proactive blog post immediately.</span>
                        </div>
                    </div>
                    <button
                        onClick={handleTestProactiveBlog}
                        disabled={isTestingBlog}
                        className={`${isTestingBlog ? 'bg-indigo-400 dark:bg-indigo-600 cursor-not-allowed' : 'bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 dark:hover:bg-indigo-400'} text-white px-4 py-2 rounded-md transition-colors text-sm font-medium flex items-center`}
                    >
                        {isTestingBlog && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                        {isTestingBlog ? 'Posting...' : 'Test Now'}
                    </button>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <Bell className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mr-3" />
                        <span className="text-indigo-900 dark:text-indigo-100">Notifications</span>
                    </div>
                    <button
                        onClick={handleNotificationToggle}
                        className={`${notificationsEnabled ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-indigo-200 dark:bg-indigo-800'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none`}
                    >
                        <span className={`${notificationsEnabled ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}></span>
                    </button>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <Clock className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mr-3" />
                        <div>
                            <span className="text-indigo-900 dark:text-indigo-100 block">Show Message Timestamps</span>
                            <span className="text-xs text-indigo-500 dark:text-indigo-400">Display date and time on each message.</span>
                        </div>
                    </div>
                    <button 
                        onClick={() => setShowTimestamps(!showTimestamps)}
                        className={`${showTimestamps ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-indigo-200 dark:bg-indigo-800'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none`}
                    >
                        <span className={`${showTimestamps ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}></span>
                    </button>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <Smartphone className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mr-3" />
                        <div>
                            <span className="text-indigo-900 dark:text-indigo-100 block">Mobile Debugger</span>
                            <span className="text-xs text-indigo-500 dark:text-indigo-400">Enable the in-app console for debugging.</span>
                        </div>
                    </div>
                    <button 
                        onClick={() => setIsDebuggerEnabled(!isDebuggerEnabled)}
                        className={`${isDebuggerEnabled ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-indigo-200 dark:bg-indigo-800'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none`}
                    >
                        <span className={`${isDebuggerEnabled ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}></span>
                    </button>
                </div>

                <div className="flex flex-col space-y-2">
                    <div className="flex items-center">
                        <Clock className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mr-3" />
                        <div>
                            <span className="text-indigo-900 dark:text-indigo-100 block">Time Zone</span>
                            <span className="text-xs text-indigo-500 dark:text-indigo-400">Set your local time zone for all timestamps.</span>
                        </div>
                    </div>
                    <select
                        value={timeZone}
                        onChange={(e) => setTimeZone(e.target.value)}
                        className="block w-full border border-indigo-300 dark:border-indigo-700 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-indigo-950 dark:text-indigo-50"
                    >
                        {Intl.supportedValuesOf('timeZone').map((tz) => (
                            <option key={tz} value={tz}>
                                {tz}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        </section>

        {/* Browser Integrations */}
        <section>
            <h3 className="text-lg font-semibold text-indigo-900 dark:text-indigo-100 mb-4 border-b border-indigo-100 dark:border-indigo-800 pb-2">Browser Integrations</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <button onClick={handleLocation} className="flex flex-col items-center justify-center p-4 border border-indigo-200 dark:border-indigo-800 rounded-xl bg-white dark:bg-indigo-950 hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-all group">
                    <MapPin className="w-6 h-6 mb-2 text-indigo-400 dark:text-indigo-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Location</span>
                </button>
                <button 
                    onClick={handleClipboardCopy} 
                    disabled={isExporting}
                    className="flex flex-col items-center justify-center p-4 border border-indigo-200 dark:border-indigo-800 rounded-xl bg-white dark:bg-indigo-950 hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-all group disabled:opacity-50"
                >
                    {isExporting ? (
                        <RefreshCw className="w-6 h-6 mb-2 text-indigo-600 dark:text-indigo-400 animate-spin" />
                    ) : (
                        <Copy className="w-6 h-6 mb-2 text-indigo-400 dark:text-indigo-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                    )}
                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">{isExporting ? "Exporting..." : "Copy Data"}</span>
                </button>
                <button onClick={handleNotificationTest} className="flex flex-col items-center justify-center p-4 border border-indigo-200 dark:border-indigo-800 rounded-xl bg-white dark:bg-indigo-950 hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-all group">
                    <Bell className="w-6 h-6 mb-2 text-indigo-400 dark:text-indigo-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Local Test</span>
                </button>
                <button 
                    onClick={handleDownloadChat} 
                    disabled={isExporting}
                    className="flex flex-col items-center justify-center p-4 border border-indigo-200 dark:border-indigo-800 rounded-xl bg-white dark:bg-indigo-950 hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-all group disabled:opacity-50"
                >
                    {isExporting ? (
                        <RefreshCw className="w-6 h-6 mb-2 text-indigo-600 dark:text-indigo-400 animate-spin" />
                    ) : (
                        <Download className="w-6 h-6 mb-2 text-indigo-400 dark:text-indigo-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                    )}
                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">{isExporting ? "Exporting..." : "Save Chat"}</span>
                </button>
                <button onClick={handleStorageCheck} className="flex flex-col items-center justify-center p-4 border border-indigo-200 dark:border-indigo-800 rounded-xl bg-white dark:bg-indigo-950 hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-all group">
                    <Database className="w-6 h-6 mb-2 text-indigo-400 dark:text-indigo-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Site Data</span>
                </button>
                <button onClick={handleEnablePushNotifications} className="flex flex-col items-center justify-center p-4 border border-indigo-200 dark:border-indigo-800 rounded-xl bg-white dark:bg-indigo-950 hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-all group">
                    <Smartphone className="w-6 h-6 mb-2 text-indigo-400 dark:text-indigo-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Enable Push</span>
                </button>
                <button onClick={handleTestNotification} className="flex flex-col items-center justify-center p-4 border border-indigo-200 dark:border-indigo-800 rounded-xl bg-white dark:bg-indigo-950 hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-all group">
                    <Bell className="w-6 h-6 mb-2 text-indigo-400 dark:text-indigo-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Server Push</span>
                </button>
            </div>
            {fcmToken ? (
                <div className="mt-6 p-4 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg border border-indigo-200 dark:border-indigo-800">
                    <h4 className="text-sm font-medium text-indigo-900 dark:text-indigo-100 mb-2">Your FCM Token:</h4>
                    <div className="flex items-center space-x-2">
                        <code className="flex-1 text-xs break-all bg-white dark:bg-indigo-950 p-2 rounded border border-indigo-100 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400">
                            {fcmToken}
                        </code>
                        <button
                            onClick={() => navigator.clipboard.writeText(fcmToken)}
                            className="p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-800 rounded-full transition-colors"
                            title="Copy FCM Token"
                        >
                            <Copy className="w-4 h-4" />
                        </button>
                    </div>
                    <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-2">
                        Use this token to send test push notifications from your server.
                    </p>
                </div>
            ) : (
                <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-900/30 rounded-lg border border-amber-200 dark:border-amber-800">
                    <p className="text-sm text-amber-700 dark:text-amber-300">Push notifications are not enabled or the token has expired.</p>
                    <button
                        onClick={handleEnablePushNotifications}
                        className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 underline"
                    >
                        Enable Push Notifications
                    </button>
                </div>
            )}
            <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-3 italic">
                These tools allow the AI to interact with your browser's native capabilities.
            </p>
        </section>

        {/* Help & Tutorial */}
        <section>
            <h3 className="text-lg font-semibold text-indigo-900 dark:text-indigo-100 mb-4 border-b border-indigo-100 dark:border-indigo-800 pb-2">Help & Support</h3>
            <button
                onClick={() => setShowTutorial(true)}
                className="flex items-center justify-center w-full p-4 border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-800 transition-colors text-indigo-700 dark:text-indigo-300 font-medium"
            >
                <HelpCircle className="w-5 h-5 mr-2" />
                Start Interactive Tutorial
            </button>
        </section>

        {/* Danger Zone */}
        <section>
            <button
                onClick={handleSaveAll}
                className="w-full bg-indigo-600 dark:bg-indigo-500 text-white py-3 px-4 rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors font-medium shadow-sm flex items-center justify-center mb-8"
            >
                <Save className="w-5 h-5 mr-2" />
                Save All Settings
            </button>
        </section>

        <section>
            <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-4 border-b border-red-100 dark:border-red-900/30 pb-2">Danger Zone</h3>
            <div>
                <button
                    onClick={async () => {
                        if (window.confirm("Are you sure? This will wipe all local data and reset the app.")) {
                            try {
                                await resetApp();
                            } catch (e) {
                                console.error("Reset failed", e);
                                addToast({ title: "Reset Failed", message: "Failed to reset data. Please try again.", type: "error" });
                            }
                        }
                    }}
                    className="flex items-center text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
                >
                    <Trash2 className="w-5 h-5 mr-2" />
                    Reset All Data
                </button>
                <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-1">
                    This action cannot be undone. It will clear all local storage and database.
                </p>
            </div>
        </section>
        {showOverwriteConfirm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-indigo-950 p-6 rounded-2xl shadow-2xl max-w-sm w-full border border-indigo-100 dark:border-indigo-800">
              <h3 className="text-lg font-bold mb-4 text-indigo-900 dark:text-indigo-100">Overwrite Active Chat?</h3>
              <p className="mb-6 text-indigo-600 dark:text-indigo-400 text-sm">You have an active chat. Overwriting it with cloud data will lose your current progress.</p>
              <div className="flex justify-end space-x-3">
                <button 
                  onClick={() => setShowOverwriteConfirm(false)} 
                  className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-800 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                    setShowOverwriteConfirm(false);
                    handleRecover();
                  }} 
                  className="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors text-sm font-medium"
                >
                  Overwrite
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsScreen;
