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
Identity: You are the AI Crisis Strategist for Rich Klein Crisis Management.
Role: Provide elite strategic counsel for reputation, media, and business crises.
Tone: Calm, professional, authoritative, and strategic. 
Background: You represent Rich Klein, a veteran with 40 years of Journalism and PR experience.
Protocol: If a situation is highly sensitive, advise: "I understand the sensitivity. For a secure and confidential assessment, please connect directly via WhatsApp or email: rich@richkleincrisis.com."
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
        sourcesRef.current.add(source);
      } else {
        setStatus('listening');
      }
    } catch (e) { 
      setStatus('listening');
    }
  }, [audioOutputEnabled, resumeAudio]);

  const initStrategicEngine = useCallback(() => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      chatRef.current = ai.chats.create({ 
        model: 'gemini-3-pro-preview', 
        config: { systemInstruction: SYSTEM_INSTRUCTION } 
      });
      return true;
    } catch (e) {
      console.error("AI Engine failed to initialize:", e);
      return false;
    }
  }, [SYSTEM_INSTRUCTION]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    setTranscriptions([{ text: WELCOME_TEXT, type: 'model', timestamp: Date.now() }]);
    
    // Attempt initialization
    const ready = initStrategicEngine();
    
    if (ready) {
      audioContextInRef.current = new AudioContext({ sampleRate: 16000 });
      audioContextOutRef.current = new AudioContext({ sampleRate: 24000 });
      playTTS(WELCOME_TEXT);

      if (micEnabled) {
        const setupVoice = async () => {
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
                }
              },
              config: { responseModalities: [Modality.AUDIO], systemInstruction: SYSTEM_INSTRUCTION }
            });
            sessionRef.current = await sessionPromise;
          } catch (e) {
            setStatus('listening');
          }
        };
        setupVoice();
      } else {
        setStatus('listening');
      }
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
    
    // Ensure engine is active
    if (!chatRef.current) {
        initStrategicEngine();
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
      setStatus('listening');
      setTranscriptions(prev => [...prev, { text: "I encountered a communication interruption. Please repeat your last point.", type: 'model', timestamp: Date.now() }]);
    }
  };

  const statusConfig = {
    connecting: { label: 'Securing Line', color: 'bg-amber-500', pulse: true },
    listening: { label: 'Strategist Active', color: 'bg-emerald-500', pulse: false },
    processing: { label: 'Analyzing Situation', color: 'bg-blue-500', pulse: true },
    awaiting: { label: 'Formulating Strategy', color: 'bg-indigo-500', pulse: true },
    buffering: { label: 'Syncing Secure Stream', color: 'bg-violet-500', pulse: true },
    speaking: { label: 'Strategist Speaking', color: 'bg-cyan-400', pulse: true }
  };

  const currentStatus = statusConfig[status];

  return (
    <div className="w-full flex flex-col h-[75vh] glass rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/10 animate-in fade-in zoom-in-95 duration-500">
      <div className="p-5 border-b border-white/5 flex items-center justify-between bg-slate-800/20">
        <div className="flex items-center gap-3">
          <div className="relative">
             <div className={`w-3 h-3 rounded-full ${currentStatus.color} ${currentStatus.pulse ? 'animate-ping opacity-75' : ''} absolute inset-0`} />
             <div className={`w-3 h-3 rounded-full ${currentStatus.color} relative z-10 shadow-[0_0_8px_rgba(255,255,255,0.3)]`} />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tactical Status</span>
            <span className="text-sm font-semibold text-white">{currentStatus.label}</span>
          </div>
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
            <div className="max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed bg-slate-800 border border-white/5 italic text-blue-200 animate-pulse">
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
          className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-5 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-white transition-all placeholder:text-slate-600"
        />
        <button 
          onClick={handleSendText} 
          disabled={!textInput.trim() || !!streamingResponse || status === 'processing' || status === 'awaiting'}
          className="p-3.5 bg-blue-600 rounded-xl hover:bg-blue-500 disabled:opacity-30 transition-all shadow-lg shadow-blue-600/20 text-white flex items-center justify-center min-w-[50px]"
        >
          {status === 'processing' || status === 'awaiting' ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          )}
        </button>
      </div>
    </div>
  );
};
