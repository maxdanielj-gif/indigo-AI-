import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { useApp } from '../context/AppContext';
import { Upload, X, Image as ImageIcon, Plus, Maximize2 } from 'lucide-react';
import { generateVisual } from '../services/visualGenerationService';
import { Background } from '../types';
import ImageModal from '../components/ImageModal';

const ImageGeneratorScreen: React.FC = () => {
  const { aiProfile, addToGallery, apiKey, addToast } = useApp();
  const [activeTab, setActiveTab] = useState<'image' | 'video'>('image');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [imageStyle, setImageStyle] = useState(aiProfile.imageStyle || 'none');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [poseReferenceImage, setPoseReferenceImage] = useState<string | null>(null);
  const [selectedBackground, setSelectedBackground] = useState<Background | null>(null);
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash-image');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [showErrorPopup, setShowErrorPopup] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setPoseReferenceImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const [hasKey, setHasKey] = useState(false);

  React.useEffect(() => {
    const checkKey = async () => {
        // @ts-ignore
        if (window.aistudio && await window.aistudio.hasSelectedApiKey()) {
            setHasKey(true);
        }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    // @ts-ignore
    if (window.aistudio) {
        // @ts-ignore
        await window.aistudio.openSelectKey();
        setHasKey(true);
    }
  };

  // Initialize AI client with user key or default env key
  const getAiClient = () => {
      // @ts-ignore
      return new GoogleGenAI({ apiKey: process.env.API_KEY || apiKey || process.env.GEMINI_API_KEY! });
  };

  const isPaidModel = selectedModel.includes('3.1') || selectedModel.includes('3-pro') || selectedModel.includes('veo') || selectedModel.includes('imagen');

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    // For paid models, key selection is mandatory
    if (isPaidModel) {
        // @ts-ignore
        if (window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
            alert("Please select an API key to use this model.");
            return;
        }
    }

    setIsLoading(true);
    if (activeTab === 'video') {
        setGeneratedVideoUrl(null);
    } else {
        setGeneratedImage(null);
    }
    setLoadingMessage("Request recognized. Starting generation process...");
    addToast({ 
        title: activeTab === 'video' ? "Video Generation" : "Image Generation", 
        message: "Request recognized. Starting generation process...", 
        type: "info" 
    });
    
    try {
      const result = await generateVisual(
        selectedModel,
        prompt,
        aiProfile,
        apiKey,
        selectedBackground,
        poseReferenceImage,
        imageStyle,
        aspectRatio,
        activeTab === 'video' ? resolution : undefined,
        (msg) => setLoadingMessage(msg)
      );

      if (result.type === 'video') {
        setGeneratedVideoUrl(result.url);
      } else {
        setGeneratedImage(result.url);
      }

      addToGallery({
        id: Date.now().toString(),
        type: 'generated',
        mediaType: activeTab === 'video' ? 'video' : 'image',
        url: result.url,
        prompt: prompt,
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('Error generating content:', error);
      let errorMessage = "An unexpected error occurred.";
      if (error.message) {
          errorMessage = error.message;
      }
      if (errorMessage.includes("Requested entity was not found")) {
          errorMessage = "API Key error: The requested model was not found or the API key is invalid for this project. Please try re-selecting your API key.";
      } else if (errorMessage.includes("safety") || errorMessage.includes("VEO_ERROR_EMPTY_RESPONSE")) {
          errorMessage = "Safety Filter: The request was blocked by the safety filters. This often happens with complex prompts or reference images. Please try a simpler, more neutral prompt.";
      } else if (errorMessage.includes("VEO_ERROR_NO_URI")) {
          errorMessage = "The video generation completed but the model failed to produce a downloadable file. This can happen if the content was flagged at the final stage. Try a different scene.";
      } else if (errorMessage.includes("VEO_ERROR_DOWNLOAD_FAILED")) {
          errorMessage = "The video was generated successfully but there was a network error downloading it. Please try again in a few moments.";
      }
      setErrorReason(errorMessage);
      setShowErrorPopup(true);
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

  useEffect(() => {
      let currentUrl: string | null = null;

      const convertToBlob = async () => {
          if (generatedVideoUrl && generatedVideoUrl.startsWith('data:')) {
              try {
                  const response = await fetch(generatedVideoUrl);
                  const blob = await response.blob();
                  currentUrl = URL.createObjectURL(blob);
                  setPreviewVideoUrl(currentUrl);
              } catch (err) {
                  console.error("Failed to convert data URL to blob URL in generator preview", err);
                  setPreviewVideoUrl(generatedVideoUrl);
              }
          } else {
              setPreviewVideoUrl(generatedVideoUrl);
          }
      };

      convertToBlob();

      return () => {
          if (currentUrl && currentUrl.startsWith('blob:')) {
              URL.revokeObjectURL(currentUrl);
          }
      };
  }, [generatedVideoUrl]);

  return (
    <div className="p-6 bg-transparent transition-colors duration-500 rounded-lg shadow-md max-w-5xl mx-auto">
      {/* Error Popup */}
      {showErrorPopup && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
                  <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-bold text-red-600 flex items-center">
                          <X className="w-6 h-6 mr-2 bg-red-100 rounded-full p-1" />
                          Generation Failed
                      </h3>
                      <button 
                          onClick={() => setShowErrorPopup(false)}
                          className="text-gray-400 hover:text-gray-600 transition-colors"
                      >
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  
                  <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-6">
                      <p className="text-sm text-red-800 font-medium leading-relaxed">
                          {errorReason}
                      </p>
                  </div>

                  <div className="space-y-3">
                      <p className="text-xs text-gray-500 italic">
                          Common reasons for failure:
                      </p>
                      <ul className="text-xs text-gray-600 list-disc list-inside space-y-1">
                          <li>Safety filters blocked the content</li>
                          <li>Invalid or expired API key</li>
                          <li>Model-specific constraints or limitations</li>
                          <li>Network connectivity issues</li>
                      </ul>
                  </div>

                  <button
                      onClick={() => setShowErrorPopup(false)}
                      className="w-full mt-8 bg-gray-900 text-white py-3 rounded-xl font-bold hover:bg-gray-800 transition-all transform active:scale-95"
                  >
                      Got it
                  </button>
              </div>
          </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
            <h2 className="text-3xl font-black text-gray-900 dark:text-indigo-50 tracking-tight">
                AI <span className="text-indigo-600">Studio</span> Visuals
            </h2>
            <p className="text-gray-500 dark:text-indigo-300 text-sm mt-1">Create consistent characters in any scene</p>
        </div>

        <div className="flex bg-gray-100 dark:bg-indigo-800 p-1 rounded-xl">
            <button
                onClick={() => {
                    setActiveTab('image');
                    setSelectedModel('gemini-2.5-flash-image');
                }}
                className={`flex items-center px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === 'image' ? 'bg-white dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-gray-500 dark:text-indigo-400 hover:text-gray-700 dark:hover:text-indigo-200'}`}
            >
                <ImageIcon className="w-4 h-4 mr-2" />
                Images
            </button>
            <button
                onClick={() => {
                    setActiveTab('video');
                    setSelectedModel('veo-3.1-fast-generate-preview');
                }}
                className={`flex items-center px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === 'video' ? 'bg-white dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-gray-500 dark:text-indigo-400 hover:text-gray-700 dark:hover:text-indigo-200'}`}
            >
                <div className="w-4 h-4 mr-2 bg-indigo-100 rounded flex items-center justify-center">
                    <div className="w-0 h-0 border-t-[3px] border-t-transparent border-l-[5px] border-l-indigo-600 border-b-[3px] border-b-transparent ml-0.5"></div>
                </div>
                Videos
            </button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Controls */}
        <div className="lg:col-span-1 space-y-6">
            <section className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-indigo-100 border-b pb-2">1. Scene Configuration</h3>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-indigo-200 mb-1">What should happen?</label>
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={3}
                        className="w-full p-3 border border-gray-300 dark:border-indigo-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100"
                        placeholder="e.g. A person reading a book..."
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-indigo-200 mb-1">AI Model</label>
                    <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    >
                        {activeTab === 'image' ? (
                            <>
                                <option value="gemini-2.5-flash-image">Gemini 2.5 Flash (Free)</option>
                                <option value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Preview (Paid)</option>
                                <option value="imagen-4.0-generate-001">Imagen 4.0 (Paid)</option>
                            </>
                        ) : (
                            <>
                                <option value="veo-3.1-fast-generate-preview">Veo Fast (Paid - Video)</option>
                                <option value="veo-3.1-generate-preview">Veo (Paid - Video)</option>
                            </>
                        )}
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Aspect Ratio</label>
                    <select
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    >
                        {activeTab === 'video' ? (
                            <>
                                <option value="16:9">16:9 (Landscape)</option>
                                <option value="9:16">9:16 (Portrait)</option>
                            </>
                        ) : (
                            <>
                                <option value="1:1">1:1 (Square)</option>
                                <option value="3:4">3:4 (Portrait)</option>
                                <option value="4:3">4:3 (Landscape)</option>
                                <option value="9:16">9:16 (Tall Portrait)</option>
                                <option value="16:9">16:9 (Wide Landscape)</option>
                            </>
                        )}
                    </select>
                </div>

                {activeTab === 'video' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Resolution</label>
                        <select
                            value={resolution}
                            onChange={(e) => setResolution(e.target.value as '720p' | '1080p')}
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                        >
                            <option value="720p">720p (HD)</option>
                            <option value="1080p">1080p (Full HD)</option>
                        </select>
                    </div>
                )}

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Visual Style</label>
                    <select
                        value={imageStyle}
                        onChange={(e) => setImageStyle(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    >
                        <option value="none">No Style (Default)</option>
                        <option value="photograph">Photograph</option>
                        <option value="anime">Anime</option>
                    </select>
                </div>
            </section>

            <section className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2">2. Environment Consistency</h3>
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-medium text-gray-700">Select Background</label>
                    </div>

                    <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                        <button 
                            onClick={() => setSelectedBackground(null)}
                            className={`aspect-square rounded-md border-2 flex flex-col items-center justify-center text-[10px] ${!selectedBackground ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}
                        >
                            <X className="w-4 h-4 mb-1" />
                            None
                        </button>
                        {aiProfile.backgroundImages && aiProfile.backgroundImages.map(bg => (
                            <div key={bg.id} className="relative group">
                                <button 
                                    onClick={() => setSelectedBackground(bg)}
                                    className={`w-full aspect-square rounded-md border-2 overflow-hidden ${selectedBackground?.id === bg.id ? 'border-indigo-500' : 'border-transparent hover:border-gray-300'}`}
                                >
                                    <img src={bg.url} alt={bg.name} className="w-full h-full object-cover" />
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[8px] p-0.5 truncate">
                                        {bg.name}
                                    </div>
                                </button>
                            </div>
                        ))}
                    </div>
                    {selectedBackground && (
                        <p className="text-[10px] text-indigo-600 mt-1 font-medium italic">
                            Active: {selectedBackground.name} ({selectedBackground.category})
                        </p>
                    )}
                </div>
            </section>

            <section className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2">
                    3. {activeTab === 'video' ? 'Starting Frame Reference' : 'Pose Reference'}
                </h3>
                <div>
                    <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleImageSelect} 
                        className="hidden" 
                        ref={fileInputRef}
                    />
                    {poseReferenceImage ? (
                        <div className="relative inline-block">
                            <img src={poseReferenceImage} alt="Reference" className="h-20 w-20 object-cover rounded-md border border-gray-300" />
                            <button 
                                onClick={() => setPoseReferenceImage(null)}
                                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 shadow-sm"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ) : (
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center justify-center w-full p-3 border-2 border-dashed border-gray-300 rounded-md text-gray-500 hover:bg-gray-50 hover:border-indigo-300 transition-colors text-sm"
                        >
                            <Upload className="w-4 h-4 mr-2" />
                            {activeTab === 'video' ? 'Upload Starting Frame' : 'Upload Pose'}
                        </button>
                    )}
                </div>
            </section>

            {isPaidModel && !hasKey && (
                <button
                    onClick={handleSelectKey}
                    className="w-full bg-amber-600 text-white py-4 px-4 rounded-lg hover:bg-amber-700 transition-all font-bold shadow-lg flex items-center justify-center transform active:scale-95 mb-4"
                >
                    Select API Key (Required for Paid Model)
                </button>
            )}
            <button
                onClick={handleGenerate}
                disabled={isLoading || !prompt.trim() || (isPaidModel && !hasKey)}
                className="w-full bg-indigo-600 text-white py-4 px-4 rounded-lg hover:bg-indigo-700 transition-all disabled:opacity-50 font-bold shadow-lg flex items-center justify-center transform active:scale-95"
            >
                {isLoading ? (
                    <>
                        <div className="w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin mr-3"></div>
                        Generating {activeTab === 'video' ? 'Video' : 'Scene'}...
                    </>
                ) : (
                    <>
                        {activeTab === 'video' ? (
                            <div className="w-5 h-5 mr-2 bg-white rounded flex items-center justify-center">
                                <div className="w-0 h-0 border-t-[4px] border-t-transparent border-l-[6px] border-l-indigo-600 border-b-[4px] border-b-transparent ml-0.5"></div>
                            </div>
                        ) : (
                            <ImageIcon className="w-5 h-5 mr-2" />
                        )}
                        Generate Final {activeTab === 'video' ? 'Video' : 'Image'}
                    </>
                )}
            </button>
        </div>

        {/* Right Column: Preview */}
        <div className="lg:col-span-2 flex flex-col space-y-4">
            <div className="flex-1 flex items-center justify-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 min-h-[400px] relative overflow-hidden shadow-inner group">
                {isLoading ? (
                    <div className="text-center p-8 animate-in fade-in duration-500">
                        <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
                        <p className="text-lg font-medium text-gray-700 mb-2">Generating your masterpiece...</p>
                        <p className="text-sm text-gray-500 italic max-w-xs mx-auto">{loadingMessage}</p>
                    </div>
                ) : generatedVideoUrl ? (
                    <div 
                        className="relative w-full h-full group flex items-center justify-center p-4 cursor-pointer"
                        onClick={() => setIsModalOpen(true)}
                    >
                        <video 
                            src={previewVideoUrl || generatedVideoUrl} 
                            className="max-w-full max-h-full rounded-lg shadow-2xl"
                            autoPlay
                            loop
                            muted
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <Maximize2 className="w-12 h-12 text-white drop-shadow-lg" />
                        </div>
                        <div className="absolute top-4 right-4">
                            <a 
                                href={previewVideoUrl || generatedVideoUrl} 
                                download={`generated-video-${Date.now()}.mp4`}
                                className="bg-white/90 backdrop-blur-sm text-gray-800 px-4 py-2 rounded-full shadow-lg text-sm font-bold transition-all hover:bg-white"
                                onClick={(e) => e.stopPropagation()}
                            >
                                Download Video
                            </a>
                        </div>
                    </div>
                ) : generatedImage ? (
                    <div 
                        className="relative w-full h-full group flex items-center justify-center p-4 cursor-pointer"
                        onClick={() => setIsModalOpen(true)}
                    >
                        <img src={generatedImage} alt="Generated" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <Maximize2 className="w-12 h-12 text-white drop-shadow-lg" />
                        </div>
                        <div className="absolute top-4 right-4 flex gap-2">
                            <a 
                                href={generatedImage} 
                                download={`generated-${Date.now()}.png`}
                                className="bg-white/90 backdrop-blur-sm text-gray-800 px-4 py-2 rounded-full shadow-lg text-sm font-bold lg:opacity-0 lg:group-hover:opacity-100 transition-all hover:bg-white"
                                onClick={(e) => e.stopPropagation()}
                            >
                                Download
                            </a>
                        </div>
                    </div>
                ) : (
                    <div className="text-center text-gray-400 p-8">
                        <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
                        <p className="text-lg font-medium">Your creation will appear here</p>
                    </div>
                )}
            </div>

            <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider mb-2">Consistency Settings</h4>
                <div className="grid grid-cols-2 gap-4 text-[11px]">
                    <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full ${aiProfile.appearance ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                        <span className="text-gray-700">Character Persona: {aiProfile.name}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full ${selectedBackground ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                        <span className="text-gray-700">Background: {selectedBackground ? selectedBackground.category : 'None'}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full ${aiProfile.referenceImage ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                        <span className="text-gray-700">Face Consistency: {aiProfile.referenceImage ? 'Active' : 'Inactive'}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full ${poseReferenceImage ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                        <span className="text-gray-700">Pose Guidance: {poseReferenceImage ? 'Active' : 'Inactive'}</span>
                    </div>
                </div>
            </div>
        </div>
      </div>

      <ImageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        imageUrl={activeTab === 'video' ? generatedVideoUrl || '' : generatedImage || ''}
        mediaType={activeTab === 'video' ? 'video' : 'image'}
        prompt={prompt}
        onCopyPrompt={(p) => {
            navigator.clipboard.writeText(p);
            addToast({ title: "Copied", message: "Prompt copied to clipboard!", type: "success" });
        }}
      />
    </div>
  );
};

export default ImageGeneratorScreen;
