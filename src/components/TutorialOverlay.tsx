import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { X, ArrowRight, ArrowLeft, User, MessageSquare, Image, Globe, Mic } from 'lucide-react';

const TutorialOverlay: React.FC = () => {
  const { showTutorial, setShowTutorial } = useApp();
  const [step, setStep] = useState(0);

  if (!showTutorial) return null;

  const steps = [
    {
      title: "Welcome to AI Companion",
      content: "Your personal, customizable AI assistant. Let's explore what you can do!",
      icon: <User className="w-12 h-12 text-indigo-600" />,
    },
    {
      title: "Customize Your Persona",
      content: "Go to the 'AI Profile' screen to change your AI's name, personality, voice, and appearance. You can create multiple personas for different moods or tasks.",
      icon: <User className="w-12 h-12 text-indigo-600" />,
    },
    {
      title: "Multi-Modal Chat",
      content: "In the Chat screen, you can type, speak (using the microphone), upload images for analysis, and attach PDF documents. The AI can see and hear you!",
      icon: <Mic className="w-12 h-12 text-indigo-600" />,
    },
    {
      title: "Contextual Chat Modes",
      content: (
        <div className="text-left space-y-2">
          <p>Enhance your roleplay and interactions:</p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li>Use <strong>*asterisks*</strong> for actions (e.g., <em>*smiles warmly*</em>).</li>
            <li>Use <strong>(parentheses)</strong> for Out-of-Character (OOC) comments (e.g., <em>(pause for a moment)</em>).</li>
          </ul>
        </div>
      ),
      icon: <MessageSquare className="w-12 h-12 text-indigo-600" />,
    },
    {
      title: "Browser Integrations",
      content: "Click the '...' menu in the chat header to access powerful tools like Location sharing, Camera access, Notifications, and File downloads.",
      icon: <Globe className="w-12 h-12 text-indigo-600" />,
    },
  ];

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      setShowTutorial(false);
      setStep(0);
    }
  };

  const handlePrev = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-indigo-950 rounded-2xl shadow-2xl w-full max-w-md p-8 relative border border-indigo-100 dark:border-indigo-800 animate-in fade-in zoom-in duration-300">
        <button 
          onClick={() => setShowTutorial(false)}
          className="absolute top-4 right-4 text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200 transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="flex flex-col items-center text-center space-y-6">
          <div className="p-4 bg-indigo-50 dark:bg-indigo-900/50 rounded-full">
            {steps[step].icon}
          </div>
          
          <h2 className="text-2xl font-bold text-indigo-900 dark:text-indigo-100">{steps[step].title}</h2>
          
          <div className="text-indigo-600 dark:text-indigo-300 min-h-[100px] flex items-center justify-center">
            {typeof steps[step].content === 'string' ? (
              <p>{steps[step].content}</p>
            ) : (
              steps[step].content
            )}
          </div>

          <div className="flex items-center justify-between w-full pt-4">
            <button
              onClick={handlePrev}
              disabled={step === 0}
              className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                step === 0 
                  ? 'text-indigo-200 dark:text-indigo-800 cursor-not-allowed' 
                  : 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900'
              }`}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </button>

            <div className="flex space-x-1">
              {steps.map((_, i) => (
                <div 
                  key={i} 
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === step ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-indigo-200 dark:bg-indigo-800'
                  }`}
                />
              ))}
            </div>

            <button
              onClick={handleNext}
              className="flex items-center px-6 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 dark:hover:bg-indigo-400 transition-colors shadow-md hover:shadow-lg"
            >
              {step === steps.length - 1 ? 'Finish' : 'Next'}
              {step < steps.length - 1 && <ArrowRight className="w-4 h-4 ml-2" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TutorialOverlay;
