import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { ChatProvider } from './context/ChatContext';
import Layout from './components/Layout';
import ChatScreen from './screens/ChatScreen';
import HistoryScreen from './screens/HistoryScreen';
import AIProfileScreen from './screens/AIProfileScreen';
import UserProfileScreen from './screens/UserProfileScreen';
import MemoryScreen from './screens/MemoryScreen';
import GalleryScreen from './screens/GalleryScreen';
import ImageGeneratorScreen from './screens/ImageGeneratorScreen';
import JournalScreen from './screens/JournalScreen';
import SettingsScreen from './screens/SettingsScreen';
import EmailScreen from './screens/EmailScreen';
import ErrorBoundary from './components/ErrorBoundary';

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AppProvider>
        <ChatProvider>
          <Router>
            <Layout>
              <Routes>
                <Route path="/" element={<Navigate to="/chat" replace />} />
                <Route path="/chat" element={<ChatScreen />} />
                <Route path="/history" element={<HistoryScreen />} />
                <Route path="/ai-profile" element={<AIProfileScreen />} />
                <Route path="/user-profile" element={<UserProfileScreen />} />
                <Route path="/memory" element={<MemoryScreen />} />
                <Route path="/gallery" element={<GalleryScreen />} />
                <Route path="/image-generator" element={<ImageGeneratorScreen />} />
                <Route path="/journal" element={<JournalScreen />} />
                <Route path="/settings" element={<SettingsScreen />} />
                <Route path="/email" element={<EmailScreen />} />
                <Route path="*" element={<Navigate to="/chat" replace />} />
              </Routes>
            </Layout>
          </Router>
        </ChatProvider>
      </AppProvider>
    </ErrorBoundary>
  );
};

export default App;
