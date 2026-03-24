import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

export interface FirebaseConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId: string;
  appId: string;
}

const getFirebaseApp = (config?: FirebaseConfig) => {
  const finalConfig = config || {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  };

  if (!finalConfig.apiKey || !finalConfig.projectId) return null;

  try {
    // Check if app is already initialized
    const apps = getApps();
    const existingApp = apps.find(a => a.name === '[DEFAULT]');
    if (existingApp) return existingApp;
    return initializeApp(finalConfig);
  } catch (e) {
    // If it fails, try to get existing app
    try {
      return initializeApp(finalConfig, "user-config-" + Date.now());
    } catch (err) {
      return null;
    }
  }
};

export const requestNotificationPermission = async (config?: FirebaseConfig, vapidKey?: string): Promise<{ success: boolean; token?: string; message: string }> => {
  const app = getFirebaseApp(config);
  const messaging = (app && typeof window !== 'undefined') ? getMessaging(app) : null;
  
  if (!messaging) {
    return { success: false, message: "Firebase Messaging is not initialized. Check Firebase config and environment." };
  }

  const finalVapidKey = vapidKey || import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!finalVapidKey) {
    return { success: false, message: "VAPID Key is missing. Push notifications require a VAPID key." };
  }

  try {
    let permission = Notification.permission;
    console.log("Current notification permission:", permission);
    
    if (permission === 'default') {
      console.log("Requesting notification permission...");
      permission = await Notification.requestPermission();
      console.log("Permission request result:", permission);
    }
    
    if (permission === 'granted') {
      console.log("Permission granted, getting FCM token...");
      try {
        const token = await getToken(messaging, { 
          vapidKey: finalVapidKey 
        });
        
        if (token) {
          console.log("FCM Token obtained:", token);
          return { success: true, token, message: "Push notifications enabled and token generated." };
        } else {
          console.warn("FCM Token is empty.");
          return { success: false, message: "Failed to generate FCM token. Check Firebase project settings." };
        }
      } catch (tokenError: any) {
        console.error("Error getting FCM token:", tokenError);
        if (tokenError.code === 'messaging/permission-blocked') {
          return { success: false, message: "Notification permission is blocked. Please enable it in your browser settings." };
        }
        throw tokenError;
      }
    } else if (permission === 'denied') {
      console.warn("Notification permission was denied.");
      return { success: false, message: "Notification permission denied by the user. Please enable it in browser settings." };
    } else {
      console.warn("Notification permission state:", permission);
      return { success: false, message: `Notification permission state: '${permission}'. User dismissed or blocked.` };
    }
  } catch (error: any) {
    console.error('Error requesting notification permission:', error);
    if (error.code === 'messaging/permission-blocked') {
      return { success: false, message: "Notification permission is blocked. Please enable it in your browser settings." };
    }
    return { success: false, message: `An unexpected error occurred: ${error.message || 'Unknown error'}.` };
  }
};

export const onForegroundMessage = (callback: (payload: any) => void, config?: FirebaseConfig) => {
  const app = getFirebaseApp(config);
  const messaging = (app && typeof window !== 'undefined') ? getMessaging(app) : null;
  if (!messaging) {
    console.log('Firebase Messaging not initialized');
    return;
  }
  console.log('Setting up foreground message listener...');
  return onMessage(messaging, (payload) => {
    console.log('Message received in foreground: ', payload);
    callback(payload);
  });
};
