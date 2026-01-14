import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Chat } from '@google/genai';
import { Transcription } from '../types';
import { decode, decodeAudioData } from '../services/audioUtils';

interface VoiceAgentProps {
  onExit: () => void;
  preferredMode: 'voice' | 'message';
}

export const VoiceAgent: React.FC<VoiceAgentProps> = ({ onExit, preferredMode }) => {
  const [status, setStatus] = useState<'connecting' | 'listening' | 'speaking'>('listening');
  const [micEnabled, setMicEnabled] = useState(preferredMode === 'voice');
  const [audioOutputEnabled, setAudioOutputEnabled] = useState(true);
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [streamingResponse, setStreamingResponse] = useState('');
  const [textInput, setTextInput] = useState('');
  
  const sessionRef = useRef<any>(null);
  const chatRef = useRef<Chat | null>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);

  const WELCOME_TEXT = "Welcome to Rich Klein Crisis Management. How confident are you now that this will work?";

  const SYSTEM_INSTRUCTION = useMemo(() => `
Identity: You are the AI Crisis Strategist for Rich Klein Crisis Management.
Tone: Calm, professional, elite, and highly strategic. Respond in the user's language.
Knowledge: Rich Klein has 40 years of experience in PR and Journalism.
Protocol: If a situation is sensitive, offer: "I understand the sensitivity. Please connect via WhatsApp or email: rich@richkleincrisis.com for a secure assessment."
`, []);

  const stopAllAudio = useCallback(() => {
    sourcesRef.current.forEach(s => {
      try { s.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setStatus('listening');
  }, []);

  const resumeAudio = useCallback(async () => {
    if (audioContextOutRef.current?.state === 'suspended') {
      await audioContextOutRef.current.resume();
    }
  }, []);

  const playTTS = useCallback(async (text: string) => {
    const apiKey = process.env.API_KEY;
    if (!audioOutputEnabled || !apiKey || apiKey === 'undefined') return;
    
    try {
      const ai = new GoogleGenAI({ apiKey });
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
        await resumeAudio();
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
      console.error("Audio playback error:", e);
      setStatus('listening');
    }
  }, [audioOutputEnabled, resumeAudio]);

  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const apiKey = process.env.API_KEY;
    
    // 1. Immediate UI Setup
    setTranscriptions([{ text: WELCOME_TEXT, type: 'model', timestamp: Date.now() }]);

    // 2. Critical Engine Initialization (No Await on Mic yet)
    if (apiKey && apiKey !== 'undefined') {
      const ai = new GoogleGenAI({ apiKey });
      chatRef.current = ai.chats.create({ 
        model: 'gemini-3-pro-preview', 
        config: { systemInstruction: SYSTEM_INSTRUCTION } 
      });
      
      // Setup audio contexts immediately
      if (!audioContextInRef.current) audioContextInRef.current = new AudioContext({ sampleRate: 16000 });
      if (!audioContextOutRef.current) audioContextOutRef.current = new AudioContext({ sampleRate: 24000 });

      // Try to play initial greeting TTS
      playTTS(WELCOME_TEXT);

      // 3. Background Async Voice Session (Mic Request)
      const setupLiveSession = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;
          const sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-12-2025',
            callbacks: {
              onopen: () => console.log("Voice line secured."),
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
              }
            },
            config: { responseModalities: [Modality.AUDIO], systemInstruction: SYSTEM_INSTRUCTION }
          });
          sessionRef.current = await sessionPromise;
        } catch (e) {
          console.warn("Microphone not available, tactical chat mode active.");
        }
      };

      setupLiveSession();
    } else {
      setTranscriptions(prev => [...prev, { text: "[SYSTEM ERROR: Strategic line connection unavailable. Please check API Key configuration.]", type: 'model', timestamp: Date.now() }]);
    }

    return () => {
      sessionRef.current?.close();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [SYSTEM_INSTRUCTION, WELCOME_TEXT, stopAllAudio, audioOutputEnabled, playTTS]);

  useEffect(() => { 
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptions, streamingResponse]);

  const handleSendText = async () => {
    const msg = textInput.trim();
    if (!msg) return;

    // Explicitly resume audio on first user action to bypass browser policies
    await resumeAudio();
    
    setTranscriptions(prev => [...prev, { text: msg, type: 'user', timestamp: Date.now() }]);
    setTextInput('');
    stopAllAudio();
    setStatus('speaking');

    if (!chatRef.current) {
      setTranscriptions(prev => [...prev, { text: "Strategic advisor line is offline or still initializing. If this persists, check your connection.", type: 'model', timestamp: Date.now() }]);
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
      console.error("Chat failure:", e);
      setTranscriptions(prev => [...prev, { text: "Tactical communication interrupted. Please check your network and try again.", type: 'model', timestamp: Date.now() }]);
      setStatus('listening'); 
    }
  };

  return (
    <div className="w-full flex flex-col h-[75vh] glass rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/10">
      <div className="p-5 border-b border-white/5 flex items-center justify-between bg-slate-800/20">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${status === 'speaking' ? 'bg-blue-400 animate-pulse' : 'bg-emerald-500'}`} />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Strategist Active</span>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setMicEnabled(!micEnabled)} 
            className={`p-2 rounded-xl transition-all ${micEnabled ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700 text-slate-500'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          </button>
          <button onClick={onExit} className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 custom-scrollbar bg-slate-900/40">
        {transcriptions.map((t, i) => (
          <div key={i} className={`flex ${t.type === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
            <div className={`max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm ${t.type === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 border border-white/5 text-slate-200'}`}>
              {t.text}
            </div>
          </div>
        ))}
        {streamingResponse && (
          <div className="flex justify-start">
            <div className="max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed bg-slate-800 border border-white/5 italic text-blue-200">
              {streamingResponse}
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-4 bg-slate-900 border-t border-white/5 flex gap-3">
        <input 
          value={textInput} 
          onChange={e => setTextInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSendText()}
          placeholder="Describe your crisis situation..." 
          className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-5 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-white transition-all"
        />
        <button 
          onClick={handleSendText} 
          disabled={!textInput.trim() || !!streamingResponse}
          className="p-3.5 bg-blue-600 rounded-xl hover:bg-blue-500 disabled:opacity-30 transition-all shadow-lg shadow-blue-600/20 text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>
    </div>
  );
};
