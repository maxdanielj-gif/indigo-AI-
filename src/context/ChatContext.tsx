import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { ChatMessage, ChatSession } from '../types';
import { useApp } from './AppContext';
import { saveToDB, loadFromDB } from '../services/db';

interface ChatContextType {
  chatHistory: ChatMessage[];
  setChatHistory: (history: ChatMessage[]) => void;
  addChatMessage: (message: ChatMessage) => void;
  updateChatMessage: (id: string, newContent: string) => void;
  deleteChatMessage: (id: string) => void;
  rateChatMessage: (id: string, rating: 'up' | 'down' | number | null) => void;
  addFeedbackComment: (id: string, comment: string) => void;
  clearHistory: () => void;
  sessions: ChatSession[];
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  createNewSession: (title?: string) => void;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, newTitle: string) => void;
  deleteAllSessions: () => void;
  isSuccessfullyLoaded: boolean;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { autoSaveChat, autoSaveChatInterval } = useApp();
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSuccessfullyLoaded, setIsSuccessfullyLoaded] = useState(false);

  // Load from IndexedDB on mount
  useEffect(() => {
    const loadData = async () => {
        console.log("ChatContext: loadData started");
        try {
            let savedData = null;
            
            // Try loading individually saved sessions first
            try {
                const activeSessionIdFromDB = await loadFromDB('indigo_chat_data_active_session');
                const sessionIds = await loadFromDB('indigo_chat_data_session_ids');
                console.log("ChatContext: Loaded sessionIds:", sessionIds);
                
                if (sessionIds && Array.isArray(sessionIds)) {
                    const loadedSessions = [];
                    for (const id of sessionIds) {
                        const sessionStr = await loadFromDB(`indigo_chat_data_session_${id}`);
                        if (sessionStr) {
                            loadedSessions.push(typeof sessionStr === 'string' ? JSON.parse(sessionStr) : sessionStr);
                        }
                    }
                    
                    if (loadedSessions.length > 0) {
                        savedData = {
                            sessions: loadedSessions,
                            activeSessionId: activeSessionIdFromDB
                        };
                        console.log("ChatContext: Loaded savedData from sessions");
                    }
                }
            } catch (chunkLoadError) {
                console.warn("ChatContext: Failed to load chunked chat data, continuing", chunkLoadError);
            }
            
            // Fallback to chunked stringified data
            if (!savedData) {
                console.log("ChatContext: Attempting to load stringified data");
                try {
                    const numChunks = await loadFromDB('indigo_chat_data_stringified_chunks');
                    if (numChunks) {
                        let stringifiedData = '';
                        for (let i = 0; i < numChunks; i++) {
                            const chunk = await loadFromDB(`indigo_chat_data_stringified_chunk_${i}`);
                            if (chunk) stringifiedData += chunk;
                        }
                        savedData = JSON.parse(stringifiedData);
                        console.log("ChatContext: Loaded savedData from stringified chunks");
                    } else {
                        const stringifiedData = await loadFromDB('indigo_chat_data_stringified');
                        if (stringifiedData) {
                            savedData = JSON.parse(stringifiedData);
                            console.log("ChatContext: Loaded savedData from stringified");
                        }
                    }
                } catch (stringifiedError) {
                    console.warn("ChatContext: Failed to load stringified chat data", stringifiedError);
                }
            }
            
            if (!savedData) {
                try {
                    savedData = await loadFromDB('indigo_chat_data');
                    console.log("ChatContext: Loaded savedData from old format");
                } catch (oldFormatError) {
                    console.warn("ChatContext: Failed to load old format chat data", oldFormatError);
                }
            }
            
            if (savedData && typeof savedData === 'object') {
                console.log("ChatContext: savedData found", savedData);
                if (Array.isArray(savedData.sessions)) {
                    setSessions(savedData.sessions);
                    setIsSuccessfullyLoaded(true);
                    const activeId = savedData.activeSessionId || (savedData.sessions.length > 0 ? savedData.sessions[0].id : null);
                    setActiveSessionId(activeId);
                    
                    if (activeId) {
                        const activeSession = savedData.sessions.find((s: ChatSession) => s.id === activeId);
                        if (activeSession) {
                            setChatHistory(Array.isArray(activeSession.messages) ? activeSession.messages : []);
                            console.log("ChatContext: setChatHistory", activeSession.messages);
                        }
                    }
                }
            } else {
                console.log("ChatContext: No savedData found");
                setIsSuccessfullyLoaded(true);
            }
        } catch (e) {
            console.error("ChatContext: Failed to load chat data from DB:", e);
        } finally {
            setIsLoaded(true);
        }
    };
    loadData();
  }, []);

  const saveData = React.useCallback(async () => {
    if (!isSuccessfullyLoaded || !autoSaveChat) return;
    try {
        const data = { sessions, activeSessionId };
        try {
            // Save active session ID
            await saveToDB('indigo_chat_data_active_session', activeSessionId);
            
            // Save session IDs
            const sessionIds = sessions.map(s => s.id);
            await saveToDB('indigo_chat_data_session_ids', sessionIds);
            
            // Save each session individually
            for (const session of sessions) {
                await saveToDB(`indigo_chat_data_session_${session.id}`, JSON.stringify(session));
            }
            
            // Clean up deleted sessions
            const { loadFromDB, deleteFromDB } = await import('../services/db');
            const existingSessionIds = await loadFromDB('indigo_chat_data_session_ids') || [];
            for (const id of existingSessionIds) {
                if (!sessionIds.includes(id)) {
                    await deleteFromDB(`indigo_chat_data_session_${id}`);
                }
            }
        } catch (saveError) {
            console.warn("Failed to save chunked chat data, falling back to stringified save", saveError);
            try {
                const stringifiedData = JSON.stringify(data);
                const chunkSize = 1024 * 1024 * 5; // 5MB chunks
                const numChunks = Math.ceil(stringifiedData.length / chunkSize);
                await saveToDB('indigo_chat_data_stringified_chunks', numChunks);
                for (let i = 0; i < numChunks; i++) {
                    await saveToDB(`indigo_chat_data_stringified_chunk_${i}`, stringifiedData.substring(i * chunkSize, (i + 1) * chunkSize));
                }
                const lightData = { sessions: sessions.map(s => ({ ...s, messages: [] })), activeSessionId };
                await saveToDB('indigo_chat_data', lightData);
            } catch (stringifyError) {
                console.warn("Failed to stringify chat data, falling back to direct save", stringifyError);
                await saveToDB('indigo_chat_data', data);
            }
        }
        console.log(`Auto-saved chat history`);
    } catch (e) {
        console.error("Failed to auto-save chat history", e);
    }
  }, [sessions, activeSessionId, isSuccessfullyLoaded, autoSaveChat]);

  // Save on change
  useEffect(() => {
    saveData();
  }, [saveData]);

  // Auto-Save Chat History Interval (30s)
  useEffect(() => {
    if (!isSuccessfullyLoaded || !autoSaveChat || autoSaveChatInterval <= 0) return;

    const intervalId = setInterval(async () => {
        await saveData();
        console.log(`Auto-saved chat history (${autoSaveChatInterval}s interval)`);
    }, autoSaveChatInterval * 1000);

    return () => clearInterval(intervalId);
  }, [autoSaveChat, autoSaveChatInterval, saveData]);

  const addChatMessage = React.useCallback((message: ChatMessage) => {
    console.log("ChatContext: addChatMessage", message);
    setChatHistory(prev => [...prev, message]);
    if (activeSessionId) {
        setSessions(prev => {
            const newSessions = prev.map(s => s.id === activeSessionId ? { ...s, messages: [...s.messages, message], updatedAt: Date.now() } : s);
            console.log("ChatContext: setSessions (addChatMessage)", newSessions);
            return newSessions;
        });
    }
  }, [activeSessionId]);

  const updateChatMessage = React.useCallback((id: string, newContent: string) => {
    setChatHistory(prev => prev.map(m => m.id === id ? { ...m, content: newContent } : m));
    if (activeSessionId) {
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: s.messages.map(m => m.id === id ? { ...m, content: newContent } : m), updatedAt: Date.now() } : s));
    }
  }, [activeSessionId]);

  const deleteChatMessage = React.useCallback((id: string) => {
    setChatHistory(prev => prev.filter(m => m.id !== id));
    if (activeSessionId) {
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: s.messages.filter(m => m.id !== id), updatedAt: Date.now() } : s));
    }
  }, [activeSessionId]);

  const rateChatMessage = React.useCallback((id: string, rating: 'up' | 'down' | number | null) => {
    setChatHistory(prev => prev.map(m => m.id === id ? { ...m, rating } : m));
    if (activeSessionId) {
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: s.messages.map(m => m.id === id ? { ...m, rating } : m) } : s));
    }
  }, [activeSessionId]);

  const addFeedbackComment = React.useCallback((id: string, comment: string) => {
    setChatHistory(prev => prev.map(m => m.id === id ? { ...m, feedbackComment: comment } : m));
    if (activeSessionId) {
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: s.messages.map(m => m.id === id ? { ...m, feedbackComment: comment } : m) } : s));
    }
  }, [activeSessionId]);

  const clearHistory = React.useCallback(() => {
    setChatHistory([]);
    setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: [], updatedAt: Date.now() } : s));
  }, [activeSessionId]);

  const createNewSession = (title: string = 'New Chat') => {
    const newSession: ChatSession = {
        id: 'session-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        title,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setChatHistory([]);
  };

  const switchSession = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
        setActiveSessionId(sessionId);
        setChatHistory(session.messages);
    }
  };

  const deleteSession = (sessionId: string) => {
    setSessions(prev => {
        const newSessions = prev.filter(s => s.id !== sessionId);
        if (activeSessionId === sessionId) {
            const nextSession = newSessions[0];
            if (nextSession) {
                setActiveSessionId(nextSession.id);
                setChatHistory(nextSession.messages);
            } else {
                setActiveSessionId(null);
                setChatHistory([]);
            }
        }
        return newSessions;
    });
  };

  const renameSession = (sessionId: string, newTitle: string) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
  };

  const deleteAllSessions = () => {
    setSessions([]);
    setActiveSessionId(null);
    setChatHistory([]);
  };

  return (
    <ChatContext.Provider value={{
      chatHistory, setChatHistory, addChatMessage, updateChatMessage, deleteChatMessage, rateChatMessage, addFeedbackComment, clearHistory,
      sessions, setSessions, activeSessionId, setActiveSessionId, createNewSession, switchSession, deleteSession, renameSession, deleteAllSessions,
      isSuccessfullyLoaded
    }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within ChatProvider');
  return context;
};
