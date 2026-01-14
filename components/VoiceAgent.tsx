import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Chat } from '@google/genai';
import { Transcription } from '../types';
import { decode, decodeAudioData } from '../services/audioUtils';

type AgentStatus = 'connecting' | 'listening' | 'processing' | 'awaiting' | 'buffering' | 'speaking';

interface VoiceAgentProps {
  onExit: () => void;
  preferredMode: 'voice' | 'message';
}

export const VoiceAgent: React.FC<VoiceAgentProps> = ({ onExit, preferredMode }) => {
  const [status, setStatus] = useState<AgentStatus>('connecting');
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
  const initialized = useRef(false);

  // Exact greeting requested by the user
  const WELCOME_TEXT = "Welcome to Rich Klein Crisis Management. How can I help you today?";

  const SYSTEM_INSTRUCTION = useMemo(() => `
Identity: You are the AI Crisis Strategist for Rich Klein Crisis Management.
Role: Provide elite strategic counsel for active reputation, media, and business crises.
Tone: Calm, professional, authoritative, and strategic. 
Background: You represent Rich Klein, leveraging 40 years of Journalism and PR experience.
Protocol: If a situation is highly sensitive, advise: "I understand the sensitivity. Please connect via WhatsApp or email: rich@richkleincrisis.com for a secure, confidential assessment."
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
    
    setStatus('buffering');
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
      } else {
        setStatus('listening');
      }
    } catch (e) { 
      console.warn("TTS Audio fallback triggered.");
      setStatus('listening');
    }
  }, [audioOutputEnabled, resumeAudio]);

  const initStrategicEngine = useCallback(() => {
    const apiKey = process.env.API_KEY;
    if (!apiKey || apiKey === 'undefined') return false;
    try {
      const ai = new GoogleGenAI({ apiKey });
      chatRef.current = ai.chats.create({ 
        model: 'gemini-3-pro-preview', 
        config: { systemInstruction: SYSTEM_INSTRUCTION } 
      });
      return true;
    } catch (e) {
      console.error("Engine Init Error:", e);
      return false;
    }
  }, [SYSTEM_INSTRUCTION]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Greeting is always displayed first
    setTranscriptions([{ text: WELCOME_TEXT, type: 'model', timestamp: Date.now() }]);
    
    const engineReady = initStrategicEngine();
    
    if (engineReady) {
      // Audio Setup
      if (!audioContextInRef.current) audioContextInRef.current = new AudioContext({ sampleRate: 16000 });
      if (!audioContextOutRef.current) audioContextOutRef.current = new AudioContext({ sampleRate: 24000 });
      
      playTTS(WELCOME_TEXT);

      if (micEnabled) {
        const setupVoiceLine = async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const sessionPromise = ai.live.connect({
              model: 'gemini-2.5-flash-native-audio-preview-12-2025',
              callbacks: {
                onopen: () => setStatus('listening'),
                onmessage: async (message: LiveServerMessage) => {
                  if (message.serverContent?.interrupted) stopAllAudio();
                  const base64Audio = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
                  if (base64Audio && audioOutputEnabled && audioContextOutRef.current) {
                    setStatus('buffering');
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
                onerror: (e) => {
                  console.error("Live Stream Error:", e);
                  setStatus('listening');
                }
              },
              config: { responseModalities: [Modality.AUDIO], systemInstruction: SYSTEM_INSTRUCTION }
            });
            sessionRef.current = await sessionPromise;
          } catch (e) {
            console.warn("Microphone access unavailable.");
            setStatus('listening');
          }
        };
        setupVoiceLine();
      } else {
        setStatus('listening');
      }
    } else {
      // If engine isn't ready, we still want to show the strategist as "Ready" for text input
      // but the first message will trigger a retry
      setStatus('listening');
    }

    return () => {
      sessionRef.current?.close();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [SYSTEM_INSTRUCTION, WELCOME_TEXT, playTTS, initStrategicEngine, micEnabled, stopAllAudio, audioOutputEnabled]);

  useEffect(() => { 
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptions, streamingResponse]);

  const handleSendText = async () => {
    const msg = textInput.trim();
    if (!msg) return;

    await resumeAudio();
    setTranscriptions(prev => [...prev, { text: msg, type: 'user', timestamp: Date.now() }]);
    setTextInput('');
    stopAllAudio();
    setStatus('processing');

    // Robust engine check
    if (!chatRef.current && !initStrategicEngine()) {
      setTranscriptions(prev => [...prev, { text: "Strategic advisor line is offline. Please check your credentials.", type: 'model', timestamp: Date.now() }]);
      setStatus('listening');
      return;
    }

    try {
      setStatus('awaiting');
      const stream = await chatRef.current!.sendMessageStream({ message: msg });
      let fullText = '';
      for await (const chunk of stream) { 
        fullText += chunk.text || ''; 
        setStreamingResponse(fullText); 
      }
      setTranscriptions(prev => [...prev, { text: fullText, type: 'model', timestamp: Date.now() }]);
      setStreamingResponse('');
      playTTS(fullText);
    } catch (e) { 
      console.error("Transmission Failure:", e);
      setTranscriptions(prev => [...prev, { text: "Communication interrupted. Let's try that again.", type: 'model', timestamp: Date.now() }]);
      setStatus('listening'); 
    }
  };

  const getStatusConfig = (s: AgentStatus) => {
    switch (s) {
      case 'connecting': return { label: 'Securing Line', color: 'bg-amber-500', pulse: true, icon: 'M12 15v5m-3-2l3 2 3-2M4 11a8 8 0 0116 0c0 4.97-4.03 8-8 8s-8-3.03-8-8z' };
      case 'listening': return { label: 'Strategist Active', color: 'bg-emerald-500', pulse: false, icon: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z' };
      case 'processing': return { label: 'Analyzing Situation', color: 'bg-blue-500', pulse: true, icon: 'M13 10V3L4 14h7v7l9-11h-7z' };
      case 'awaiting': return { label: 'Formulating Strategy', color: 'bg-indigo-500', pulse: true, icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' };
      case 'buffering': return { label: 'Syncing Secure Stream', color: 'bg-violet-500', pulse: true, icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' };
      case 'speaking': return { label: 'Strategist Speaking', color: 'bg-cyan-400', pulse: true, icon: 'M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M12 8v8m-4-4v4m8-4v4' };
    }
  };

  const currentStatus = getStatusConfig(status);

  return (
    <div className="w-full flex flex-col h-[75vh] glass rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/10 animate-in fade-in zoom-in-95 duration-500">
      {/* Visual Header with Granular Status */}
      <div className="p-5 border-b border-white/5 flex items-center justify-between bg-slate-800/20">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className={`w-3 h-3 rounded-full ${currentStatus.color} ${currentStatus.pulse ? 'animate-ping opacity-75' : ''} absolute inset-0`} />
            <div className={`w-3 h-3 rounded-full ${currentStatus.color} relative z-10 shadow-[0_0_10px_rgba(255,255,255,0.2)]`} />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">System Status</span>
            <span className={`text-sm font-semibold ${status === 'speaking' ? 'text-cyan-400' : 'text-white'} transition-colors duration-300`}>
              {currentStatus.label}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setMicEnabled(!micEnabled)} 
            className={`p-2 rounded-xl transition-all duration-300 ${micEnabled ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700 text-slate-500 hover:text-slate-300'}`}
            title={micEnabled ? "Disable Secure Voice" : "Enable Secure Voice"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          </button>
          <button 
            onClick={onExit} 
            className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all duration-300 group"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="group-hover:rotate-90 transition-transform"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 custom-scrollbar bg-slate-900/40">
        {transcriptions.map((t, i) => (
          <div key={i} className={`flex ${t.type === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
            <div className={`max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm ${t.type === 'user' ? 'bg-blue-600 text-white shadow-blue-500/10' : 'bg-slate-800 border border-white/5 text-slate-200'}`}>
              {t.text}
            </div>
          </div>
        ))}
        {streamingResponse && (
          <div className="flex justify-start">
            <div className="max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed bg-slate-800/80 border border-white/5 italic text-cyan-200 animate-pulse">
              {streamingResponse}
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-slate-900 border-t border-white/5 flex gap-3">
        <div className="relative flex-1">
          <input 
            value={textInput} 
            onChange={e => setTextInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendText()}
            placeholder="Describe your crisis situation..." 
            className="w-full bg-slate-950 border border-white/10 rounded-xl px-5 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-white transition-all placeholder:text-slate-600"
          />
          {status !== 'listening' && status !== 'speaking' && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
               <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" />
            </div>
          )}
        </div>
        <button 
          onClick={handleSendText} 
          disabled={!textInput.trim() || !!streamingResponse || status === 'processing' || status === 'awaiting'}
          className="p-3.5 bg-blue-600 rounded-xl hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 transition-all shadow-lg shadow-blue-600/20 text-white flex items-center justify-center min-w-[50px]"
        >
          {status === 'processing' || status === 'awaiting' ? (
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          )}
        </button>
      </div>
    </div>
  );
