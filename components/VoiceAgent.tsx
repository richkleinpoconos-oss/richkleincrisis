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

  const WELCOME_TEXT = "Welcome to Rich Klein Crisis Management. How can I help you today?";

  const SYSTEM_INSTRUCTION = useMemo(() => `
Identity: You are the lead AI Crisis Strategist for Rich Klein Crisis Management.
Role: Provide immediate strategic counsel for organizations facing active reputation or business crises.
Tone: Calm, authoritative, analytical, and highly professional.
Background: Leveraging 40 years of Journalism and PR experience.
Privacy: If confidentiality is paramount, state: "For a secure, end-to-end encrypted assessment, please email rich@richkleincrisis.com directly."
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
    if (!audioOutputEnabled) return;
    
    setStatus('buffering');
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
        // Fix: Use sourcesRef.current to access the Set instance
        sourcesRef.current.add(source);
      } else {
        setStatus('listening');
      }
    } catch (e) { 
      console.warn("Audio sync failed, maintaining tactical feed.");
      setStatus('listening');
    }
  }, [audioOutputEnabled, resumeAudio]);

  const initStrategicEngine = useCallback(() => {
    const apiKey = process.env.API_KEY;
    if (!apiKey || apiKey === 'undefined') {
      console.error("Environment Configuration Error: API Key missing.");
      return false;
    }
    try {
      const ai = new GoogleGenAI({ apiKey });
      chatRef.current = ai.chats.create({ 
        model: 'gemini-3-pro-preview', 
        config: { systemInstruction: SYSTEM_INSTRUCTION } 
      });
      return true;
    } catch (e) {
      console.error("AI Core Initialization Error:", e);
      return false;
    }
  }, [SYSTEM_INSTRUCTION]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    setTranscriptions([{ text: WELCOME_TEXT, type: 'model', timestamp: Date.now() }]);
    
    if (initStrategicEngine()) {
      audioContextInRef.current = new AudioContext({ sampleRate: 16000 });
      audioContextOutRef.current = new AudioContext({ sampleRate: 24000 });
      
      setTimeout(() => playTTS(WELCOME_TEXT), 300);

      if (micEnabled) {
        const establishSecureLine = async () => {
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
                onerror: () => setStatus('listening')
              },
              config: { responseModalities: [Modality.AUDIO], systemInstruction: SYSTEM_INSTRUCTION }
            });
            sessionRef.current = await sessionPromise;
          } catch (e) {
            console.error("Secure voice channel failed.");
            setStatus('listening');
          }
        };
        establishSecureLine();
      } else {
        setStatus('listening');
      }
    } else {
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
    
    // Auto-recovery for engine link
    if (!chatRef.current) {
      if (!initStrategicEngine()) {
        setTranscriptions(prev => [...prev, { text: "Strategic Link Failure. Please ensure environment credentials are set.", type: 'model', timestamp: Date.now() }]);
        setStatus('listening');
        return;
      }
    }

    setStatus('processing');
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
      console.error("Tactical Feed Dropped:", e);
      setTranscriptions(prev => [...prev, { text: "Communication line interrupted. Re-syncing...", type: 'model', timestamp: Date.now() }]);
      setStatus('listening'); 
    }
  };

  const renderStatusIcon = () => {
    switch (status) {
      case 'connecting':
        return <div className="w-3.5 h-3.5 rounded-full bg-amber-500 animate-pulse" />;
      case 'listening':
        return <div className="w-3.5 h-3.5 rounded-full bg-emerald-500" />;
      case 'processing':
        return <div className="w-3.5 h-3.5 rounded-full bg-blue-500 animate-pulse-fast" />;
      case 'awaiting':
        return (
          <div className="flex gap-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 wave-dot" />
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 wave-dot" />
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 wave-dot" />
          </div>
        );
      case 'buffering':
        return <div className="w-3.5 h-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />;
      case 'speaking':
        return (
          <div className="flex items-end gap-0.5 h-4">
            <div className="w-1 bg-cyan-400 bar" />
            <div className="w-1 bg-cyan-400 bar" />
            <div className="w-1 bg-cyan-400 bar" />
          </div>
        );
    }
  };

  const statusMap = {
    connecting: { label: 'Securing Line', color: 'text-amber-500' },
    listening: { label: 'Strategist Active', color: 'text-emerald-500' },
    processing: { label: 'Analyzing Situation', color: 'text-blue-500' },
    awaiting: { label: 'Formulating Strategy', color: 'text-indigo-500' },
    buffering: { label: 'Syncing Secure Stream', color: 'text-violet-500' },
    speaking: { label: 'Strategist Speaking', color: 'text-cyan-400' }
  };

  const currentStatus = statusMap[status];

  return (
    <div className="w-full flex flex-col h-[75vh] glass rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/10 animate-in fade-in zoom-in-95 duration-500">
      {/* Dynamic Header */}
      <div className="p-5 border-b border-white/5 flex items-center justify-between bg-slate-800/30">
        <div className="flex items-center gap-4">
          <div className="w-8 flex items-center justify-center">
            {renderStatusIcon()}
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tactical Feed</span>
            <span className={`text-sm font-bold ${currentStatus.color} transition-colors duration-300`}>
              {currentStatus.label}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setMicEnabled(!micEnabled)} 
            className={`p-2.5 rounded-xl transition-all duration-300 ${micEnabled ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30' : 'bg-slate-700 text-slate-500 hover:text-slate-300'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          </button>
          <button onClick={onExit} className="p-2.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all border border-red-500/10">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
          </button>
        </div>
      </div>

      {/* Strategic Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 custom-scrollbar bg-slate-900/40">
        {transcriptions.map((t, i) => (
          <div key={i} className={`flex ${t.type === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
            <div className={`max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm ${t.type === 'user' ? 'bg-blue-600 text-white shadow-blue-500/20' : 'bg-slate-800 border border-white/5 text-slate-200'}`}>
              {t.text}
            </div>
          </div>
        ))}
        {streamingResponse && (
          <div className="flex justify-start">
            <div className="max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed bg-slate-800/60 border border-white/5 italic text-cyan-200 animate-pulse">
              {streamingResponse}
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Module */}
      <div className="p-4 bg-slate-900 border-t border-white/5 flex gap-3">
        <div className="relative flex-1">
          <input 
            value={textInput} 
            onChange={e => setTextInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendText()}
            placeholder="Outline the crisis details here..." 
            className="w-full bg-slate-950 border border-white/10 rounded-xl px-5 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-white transition-all placeholder:text-slate-600"
          />
        </div>
        <button 
          onClick={handleSendText} 
          disabled={!textInput.trim() || !!streamingResponse || status === 'processing' || status === 'awaiting'}
          className="px-6 bg-blue-600 rounded-xl hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 transition-all shadow-lg shadow-blue-600/20 text-white flex items-center justify-center font-bold min-w-[100px]"
        >
          {status === 'processing' || status === 'awaiting' ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
              <span>SEND</span>
          )}
        </button>
      </div>
    </div>
  );
};
