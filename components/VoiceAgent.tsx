import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Chat } from '@google/genai';
import { Transcription } from '../types';
import { decode, decodeAudioData, createBlob } from '../services/audioUtils';

interface VoiceAgentProps {
  onExit: () => void;
  preferredMode: 'voice' | 'message';
}

export const VoiceAgent: React.FC<VoiceAgentProps> = ({ onExit, preferredMode }) => {
  const [status, setStatus] = useState<'connecting' | 'listening' | 'speaking'>('connecting');
  const [micEnabled, setMicEnabled] = useState(preferredMode === 'voice');
  const [audioOutputEnabled, setAudioOutputEnabled] = useState(true);
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [streamingResponse, setStreamingResponse] = useState('');
  const [textInput, setTextInput] = useState('');
  const [language, setLanguage] = useState('English');
  
  const sessionRef = useRef<any>(null);
  const chatRef = useRef<Chat | null>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const hasWelcomedRef = useRef(false);

  const WELCOME_TEXT = "Welcome to Rich Klein Crisis Management. How can I assist with your strategic situation?";

  const SYSTEM_INSTRUCTION = useMemo(() => `
Identity: You are the AI Crisis Strategist for Rich Klein Crisis Management.
Tone: Calm, professional, elite, and highly strategic.
Knowledge: Rich Klein has 40 years of experience in PR and Journalism. He splits his time between Pennsylvania and Italy.
Core Principles: "Organizations that survive crises with their reputations intact are those that treated 'Before' as seriously as 'During.'"
Protocol: If a crisis is active, prioritize: "I understand the sensitivity. Please connect via WhatsApp or email: rich@richkleincrisis.com for a secure assessment."
Language: All responses must be in ${language}.
`, [language]);

  const stopAllAudio = useCallback(() => {
    sourcesRef.current.forEach(s => {
      try { s.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setStatus('listening');
  }, []);

  const playTTS = useCallback(async (text: string) => {
    if (!audioOutputEnabled || !process.env.API_KEY) return;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
      if (base64Audio && audioContextOutRef.current) {
        const ctx = audioContextOutRef.current;
        if (ctx.state === 'suspended') await ctx.resume();
        setStatus('speaking');
        const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => {
          sourcesRef.current.delete(source);
          if (sourcesRef.current.size === 0) setStatus('listening');
        };
        const startTime = Math.max(ctx.currentTime, nextStartTimeRef.current);
        source.start(startTime);
        nextStartTimeRef.current = startTime + audioBuffer.duration;
        sourcesRef.current.add(source);
      }
    } catch (e) { 
      console.error("TTS Failed:", e); 
      setStatus('listening'); 
    }
  }, [audioOutputEnabled]);

  const initialize = useCallback(async () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.error("API Key missing at runtime.");
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      // Initialize Chat first as it's the most reliable fallback
      chatRef.current = ai.chats.create({ 
        model: 'gemini-3-flash-preview', 
        config: { systemInstruction: SYSTEM_INSTRUCTION } 
      });

      // Prepare Audio Contexts
      if (!audioContextInRef.current) audioContextInRef.current = new AudioContext({ sampleRate: 16000 });
      if (!audioContextOutRef.current) audioContextOutRef.current = new AudioContext({ sampleRate: 24000 });
      
      // Request Mic for Live Session
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            console.log("Live connection opened");
            setStatus('listening');
            
            const source = audioContextInRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              if (!micEnabled || !sessionRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              sessionRef.current.sendRealtimeInput({ media: createBlob(inputData) });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextInRef.current!.destination);

            if (!hasWelcomedRef.current) {
              setTranscriptions([{ text: WELCOME_TEXT, type: 'model', timestamp: Date.now() }]);
              playTTS(WELCOME_TEXT);
              hasWelcomedRef.current = true;
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.interrupted) stopAllAudio();
            
            const base64Audio = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (base64Audio && audioOutputEnabled && audioContextOutRef.current) {
              const ctx = audioContextOutRef.current;
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              const startTime = Math.max(ctx.currentTime, nextStartTimeRef.current);
              source.start(startTime);
              nextStartTimeRef.current = startTime + audioBuffer.duration;
              sourcesRef.current.add(source);
              setStatus('speaking');
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setStatus('listening');
              };
            }
          },
          onerror: (e) => console.error("Live session error:", e),
          onclose: () => {
            console.warn("Live session closed");
            setStatus('connecting');
          }
        },
        config: { responseModalities: [Modality.AUDIO], systemInstruction: SYSTEM_INSTRUCTION }
      });

      sessionRef.current = await sessionPromise;
    } catch (e) { 
      console.error("Initialization failed:", e);
      // Even if Live fails, chatRef is hopefully set up
      setStatus('listening');
      if (!hasWelcomedRef.current) {
         setTranscriptions([{ text: "System: Tactical advisor ready via message. (Voice initialization limited)", type: 'model', timestamp: Date.now() }]);
         hasWelcomedRef.current = true;
      }
    }
  }, [SYSTEM_INSTRUCTION, micEnabled, WELCOME_TEXT, audioOutputEnabled, stopAllAudio, playTTS]);

  useEffect(() => { 
    initialize(); 
    return () => { 
      sessionRef.current?.close(); 
      streamRef.current?.getTracks().forEach(t => t.stop());
    }; 
  }, [initialize]);

  useEffect(() => { 
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcriptions, streamingResponse]);

  const handleSendText = async () => {
    const msg = textInput.trim();
    if (!msg) return;

    // Display user message immediately
    setTranscriptions(prev => [...prev, { text: msg, type: 'user', timestamp: Date.now() }]);
    setTextInput('');
    stopAllAudio();
    setStatus('speaking');

    if (!chatRef.current) {
      setTranscriptions(prev => [...prev, { text: "Error: Strategic line not fully initialized. Please wait a moment.", type: 'model', timestamp: Date.now() }]);
      setStatus('listening');
      return;
    }

    try {
      const stream = await chatRef.current.sendMessageStream({ message: msg });
      let fullText = '';
      for await (const chunk of stream) { 
        fullText += chunk.text || ''; 
        setStreamingResponse(fullText); 
      }
      setTranscriptions(prev => [...prev, { text: fullText, type: 'model', timestamp: Date.now() }]);
      setStreamingResponse('');
      playTTS(fullText);
    } catch (e) { 
      console.error("Chat send failed:", e);
      setTranscriptions(prev => [...prev, { text: "I encountered a technical interruption. Please try your message again.", type: 'model', timestamp: Date.now() }]);
      setStatus('listening'); 
    }
  };

  return (
    <div className="w-full flex flex-col h-[75vh] glass rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-500">
      <div className="p-5 border-b border-white/5 flex items-center justify-between bg-slate-800/20">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${status === 'speaking' ? 'bg-blue-400 animate-pulse' : status === 'listening' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{status}</span>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setMicEnabled(!micEnabled)} 
            className={`p-2 rounded-xl transition-all ${micEnabled ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700 text-slate-500'}`}
            title={micEnabled ? "Mute Microphone" : "Unmute Microphone"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          </button>
          <button onClick={onExit} className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 custom-scrollbar">
        {transcriptions.map((t, i) => (
          <div key={i} className={`flex ${t.type === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
            <div className={`max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed ${t.type === 'user' ? 'bg-blue-600 shadow-lg shadow-blue-900/20' : 'bg-slate-800 border border-white/5 shadow-inner'}`}>
              {t.text}
            </div>
          </div>
        ))}
        {streamingResponse && (
          <div className="flex justify-start animate-in fade-in">
            <div className="max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed bg-slate-800 border border-white/5 italic text-blue-200">
              {streamingResponse}
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-4 bg-slate-900/60 border-t border-white/5 flex gap-3 backdrop-blur-sm">
        <input 
          value={textInput} 
          onChange={e => setTextInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !streamingResponse && handleSendText()}
          placeholder={status === 'connecting' ? "Connecting to strategic line..." : "Type strategic inquiry..."} 
          disabled={status === 'connecting' || !!streamingResponse}
          className="flex-1 bg-slate-950/50 border border-white/10 rounded-xl px-5 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-white placeholder-slate-500 transition-all disabled:opacity-50"
        />
        <button 
          onClick={handleSendText} 
          disabled={!textInput.trim() || !!streamingResponse}
          className="p-3.5 bg-blue-600 rounded-xl hover:bg-blue-500 disabled:bg-slate-700 disabled:opacity-50 transition-all shadow-lg shadow-blue-600/20"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>
    </div>
  );
};
