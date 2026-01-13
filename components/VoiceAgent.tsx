import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Chat } from '@google/genai';
import { Transcription } from '../types';
import { decode, decodeAudioData, createBlob } from '../services/audioUtils';

interface VoiceAgentProps {
  onExit: () => void;
  preferredMode: 'voice' | 'message';
}

export const VoiceAgent: React.FC<VoiceAgentProps> = ({ onExit, preferredMode }) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'listening' | 'speaking'>('idle');
  const [micEnabled, setMicEnabled] = useState(preferredMode === 'voice');
  const [audioOutputEnabled, setAudioOutputEnabled] = useState(preferredMode === 'voice');
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [streamingResponse, setStreamingResponse] = useState('');
  const [textInput, setTextInput] = useState('');
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [language, setLanguage] = useState('English');
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const chatRef = useRef<Chat | null>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const hasWelcomedRef = useRef(false);
  const lastWelcomedLanguageRef = useRef('English');

  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  const WELCOME_TEXT = "Welcome to Rich Klein Crisis Management.";

  const SYSTEM_INSTRUCTION = useMemo(() => `
1. Identity & Voice Persona
Who you are: You are an elite AI strategist trained on the collective 40 years of experience of Rich Klein.
Tone: Professional, calm, authoritative, and direct.
Voice Protocol: For the Secure Voice Line, use a natural, measured pace.

2. Operational Rules
Region & Familiarity: Do NOT state that you are familiar with the user's region or time zone UNLESS you have first asked them where they are calling from.
Sensitive Details: If a user chooses the Tactical Message option or mentions sensitive details, you MUST explicitly acknowledge the sensitivity using the "ACTIVE CRISIS PROTOCOL" below.
Crisis Intake: For active crises, your primary goal is to immediately redirect the user to direct channels (WhatsApp or Email).

3. PREPARATION & AUDIT STRATEGY (Use this content EXACTLY when asked about preparation or the "Before" phase):
"Preparation is the most critical phase of reputation management. In my forty years of experience, the organizations that survive crises with their reputations intact are those that treated 'Before' as seriously as 'During.' The first thing that businesses and organizations must do to prepare for the worst is to identify all the crisis scenarios that you might face, including natural and man made disasters, workplace violence and accidents, corruption/alleged crimes, product recalls, data breaches, negative media coverage or online reviews and high profile litigation. It's also important to keep in mind that if any of these events strike a competitor, it could have a domino effect on your organization."

---
CORE KNOWLEDGE & FACTS (PRESERVED):
- Rich Klein has 40 years of experience in journalism and public relations.
- Rich hosted "The Crisis Show" from 2012 until 2018.
- Location: Rich splits his life between Lake Ariel, Pennsylvania, about two hours from New York City, and Parma, Italy, which is halfway between Milan and Bologna.
- Specialties: Strategic PR, Media Relations, and Litigation Support.

LANGUAGE PROTOCOL:
- CURRENT LANGUAGE: ${language}
- You MUST conduct the consultation in ${language}.

CRITICAL PROTOCOLS (MUST FOLLOW EXACTLY):
1. WORK EXPERIENCE (PR): If asked about PR work history/titles (non-journalism), YOU MUST SAY: "Rich held the top media relations position at the Anti-Defamation League, the New York County Lawyers' Association and the law firm Proskauer. At all three organizations, he was the lead public relations writer. He has also worked at prestigious public relations agencies like Howard Rubenstein Associates, Magnet and Beckerman, where he was Vice President and head of the law firm group."
2. JOURNALISM BACKGROUND: If asked about journalism experience, YOU MUST SAY: "Rich started his career in the early 1980s as a reporter and city editor for The Legislative Gazette... He then went to work as a sports reporter for two upstate New York daily newspapers: The Daily Freeman and The Ithaca Journal... From 1986 through 1988, Rich was the managing editor of a 10,000 subscriber monthly publication for B'nai B'rith. More recently, Rich launched The SullivanTimes..."
3. LOCATION: If asked about location, state: "Rich splits his life between Lake Ariel, Pennsylvania, about two hours from New York City, and Parma, Italy, which is halfway between Milan and Bologna."
4. ACTIVE CRISIS / SUDDEN CRISIS / TACTICAL MESSAGE PROTOCOL (Use this EXACT RESPONSE when an active crisis is identified):
   "I understand. This session is secure, and I am treating the details of this situation with the utmost sensitivity. To conduct a rapid assessment, please immediately use the WhatsApp link above or email: rich@richkleincrisis.com."
`, [language]);

  const stopAllAudio = useCallback(() => {
    sourcesRef.current.forEach(s => {
      try { s.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setStatus(prev => prev === 'speaking' ? 'listening' : prev);
  }, []);

  const playTTS = async (text: string) => {
    if (!audioOutputEnabled) return;

    try {
      if (!process.env.API_KEY) return;
      
      // Ensure context is running - user gesture from App.tsx allows this
      if (!audioContextOutRef.current) {
        audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      if (audioContextOutRef.current.state === 'suspended') {
        await audioContextOutRef.current.resume();
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
      if (base64Audio && audioContextOutRef.current) {
        const ctx = audioContextOutRef.current;
        setStatus('speaking');
        const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => {
          sourcesRef.current.delete(source);
          if (sourcesRef.current.size === 0) setStatus('listening');
        };
        // Ensure seamless playback
        const currentTime = ctx.currentTime;
        const startTime = Math.max(currentTime, nextStartTimeRef.current);
        source.start(startTime);
        nextStartTimeRef.current = startTime + audioBuffer.duration;
        sourcesRef.current.add(source);
      }
    } catch (err) {
      console.error('TTS Error:', err);
      setStatus('listening');
    }
  };

  const generateGreeting = async (lang: string) => {
    try {
      if (!process.env.API_KEY) return;
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const promptLang = lang === 'Mandarin' ? 'Mandarin Chinese' : lang;
      const prompt = `You are a professional crisis management agent. 
      Generate a single, short, concise sentence in ${promptLang} confirming you have switched to ${promptLang} and are ready to assist. 
      Do not add quotes.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
      });
      
      const text = response.text?.trim();
      if (text) {
        setTranscriptions(prev => [...prev, { text: text, type: 'model', timestamp: Date.now() }]);
        await playTTS(text);
      }
    } catch (e) {
      console.error("Greeting generation failed", e);
    }
  };

  const handleLanguageSwitch = (lang: string) => {
    if (language === lang) return;
    setLanguage(lang);
    setTranscriptions(prev => [...prev, { text: `(System: Switching to ${lang}...)`, type: 'user', timestamp: Date.now() }]);
    stopAllAudio();
  };

  const initializeSession = useCallback(async () => {
    const apiKey = process.env.API_KEY;

    if (!apiKey) {
      setTranscriptions([{ 
        text: `System Notice: Configuration Error. API Key not found.`, 
        type: 'model', 
        timestamp: Date.now() 
      }]);
      setStatus('idle');
      return;
    }

    try {
      setStatus('connecting');
      const ai = new GoogleGenAI({ apiKey: apiKey });

      chatRef.current = ai.chats.create({
        model: 'gemini-3-flash-preview',
        config: { systemInstruction: SYSTEM_INSTRUCTION }
      });

      // Initialize Audio Contexts
      if (!audioContextInRef.current) audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      if (!audioContextOutRef.current) audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // Auto-resume contexts (important for playback)
      const resumeAudio = async () => {
        if (audioContextInRef.current?.state === 'suspended') await audioContextInRef.current.resume();
        if (audioContextOutRef.current?.state === 'suspended') await audioContextOutRef.current.resume();
      };
      await resumeAudio();
      
      const audioCtxIn = audioContextInRef.current;
      
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (mediaErr) {
        setTranscriptions(prev => [...prev, { text: "Microphone access is required for voice mode. Please allow permissions.", type: 'model', timestamp: Date.now() }]);
        setStatus('idle');
        return;
      }
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            console.log("Session connected");
            setStatus('listening');
            
            // Setup Audio Processing for Mic
            const source = audioCtxIn.createMediaStreamSource(stream);
            const scriptProcessor = audioCtxIn.createScriptProcessor(4096, 1, 1);
            const analyser = audioCtxIn.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            source.connect(analyser);

            scriptProcessor.onaudioprocess = (event) => {
              if (!micEnabled) return;
              const inputData = event.inputBuffer.getChannelData(0);
              
              // VAD for interruption
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              
              if (rms > 0.05 && (status === 'speaking' || sourcesRef.current.size > 0)) {
                stopAllAudio();
                setStreamingResponse('');
              }

              const pcmBlob = createBlob(inputData);
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioCtxIn.destination);

            // Welcome Message Logic
            if (!hasWelcomedRef.current) {
              setTranscriptions([{ text: WELCOME_TEXT, type: 'model', timestamp: Date.now() }]);
              // Short delay to ensure audio context is ready
              setTimeout(() => playTTS(WELCOME_TEXT), 500);
              hasWelcomedRef.current = true;
              lastWelcomedLanguageRef.current = 'English';
            } else if (lastWelcomedLanguageRef.current !== language) {
              generateGreeting(language);
              lastWelcomedLanguageRef.current = language;
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.interrupted) {
              stopAllAudio();
              currentOutputTranscription.current = '';
              setStreamingResponse('');
              return;
            }

            if (message.serverContent?.outputTranscription) {
              currentOutputTranscription.current += message.serverContent.outputTranscription.text;
              setStreamingResponse(currentOutputTranscription.current);
            } else if (message.serverContent?.inputTranscription) {
              currentInputTranscription.current += message.serverContent.inputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const userText = currentInputTranscription.current;
              const modelText = currentOutputTranscription.current;
              setTranscriptions(prev => {
                const next = [...prev];
                if (userText) next.push({ text: userText, type: 'user', timestamp: Date.now() });
                if (modelText) next.push({ text: modelText, type: 'model', timestamp: Date.now() });
                return next;
              });
              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
              setStreamingResponse('');
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (base64Audio && audioContextOutRef.current) {
              if (!audioOutputEnabled) return; 

              const ctx = audioContextOutRef.current;
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              
              const currentTime = ctx.currentTime;
              const startTime = Math.max(currentTime, nextStartTimeRef.current);
              
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
          onerror: (err) => {
            console.error('Live Error:', err);
            setStatus('idle');
          },
          onclose: () => setStatus('idle')
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        }
      });

      sessionPromiseRef.current = sessionPromise;
    } catch (err) {
      console.error('Init failed:', err);
      setStatus('idle');
    }
  }, [SYSTEM_INSTRUCTION, micEnabled, WELCOME_TEXT, stopAllAudio, language, audioOutputEnabled]);

  const handleSendTextInternal = async (msg: string, displayMsg?: string) => {
    if (!msg || !chatRef.current) return;
    stopAllAudio();
    setTranscriptions(prev => [...prev, { text: displayMsg || msg, type: 'user', timestamp: Date.now() }]);
    setStatus('speaking');
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
      console.error('Chat error:', e);
      setStatus('listening');
    }
  };

  const handleSendText = () => {
    const msg = textInput.trim();
    if (msg) {
      handleSendTextInternal(msg);
      setTextInput('');
    }
  };

  useEffect(() => {
    initializeSession();
    
    return () => {
      if (sessionPromiseRef.current) sessionPromiseRef.current.then(s => s.close());
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioContextInRef.current) audioContextInRef.current.close();
      if (audioContextOutRef.current) audioContextOutRef.current.close();
    };
  }, [initializeSession]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptions, streamingResponse]);

  useEffect(() => {
    if (!canvasRef.current || !analyserRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const analyser = analyserRef.current;
    if (!ctx) return;
    
    let animationId: number;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const avg = dataArray.reduce((a, b) => a + b) / bufferLength;
      const radius = 25 + (avg / 255) * 35;
      
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
      ctx.fillStyle = status === 'speaking' ? '#3b82f6' : micEnabled ? '#10b981' : '#475569';
      ctx.fill();
      
      if (micEnabled || status === 'speaking') {
        ctx.strokeStyle = status === 'speaking' ? '#60a5fa' : '#34d399';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };
    draw();
    return () => cancelAnimationFrame(animationId);
  }, [status, micEnabled]);

  return (
    <div className="w-full flex flex-col h-[calc(100vh-140px)] md:h-[calc(100vh-160px)] max-h-[1200px]">
      {/* WhatsApp Modal */}
      {showWhatsApp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={() => setShowWhatsApp(false)} />
          <div className="relative bg-slate-900 border border-emerald-500/30 rounded-[2rem] p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-300">
            <button onClick={() => setShowWhatsApp(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
            <div className="flex flex-col items-center text-center gap-4">
              <h3 className="text-lg font-bold">Secure WhatsApp Counsel</h3>
              <p className="text-xs text-slate-400">Scan to connect with Rich Klein immediately.</p>
              <div className="bg-white p-3 rounded-2xl"><img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=https://wa.me/15705754480" alt="QR" className="w-40 h-40" /></div>
              <a href="https://wa.me/15705754480" target="_blank" className="w-full py-3 bg-emerald-600 rounded-xl font-bold text-sm">Open WhatsApp Directly</a>
            </div>
          </div>
        </div>
      )}

      {/* Top Console */}
      <div className="bg-slate-800/40 border border-white/5 rounded-t-3xl p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 flex items-center justify-center">
              <canvas ref={canvasRef} width={48} height={48} className="absolute inset-0" />
              <div className={`w-2 h-2 rounded-full z-10 ${status === 'speaking' ? 'bg-blue-400' : 'bg-emerald-400'}`} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Secure Line Status</span>
              <span className={`text-xs font-bold uppercase ${status === 'speaking' ? 'text-blue-400' : 'text-emerald-400'}`}>{status}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={() => { if(micEnabled) stopAllAudio(); setMicEnabled(!micEnabled); }} 
              className={`p-2.5 rounded-xl border transition-all ${micEnabled ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-slate-700 border-white/10 text-slate-400'}`}
              title={micEnabled ? "Mute Microphone" : "Unmute Microphone"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            </button>
            <button 
              onClick={() => { if(audioOutputEnabled) stopAllAudio(); setAudioOutputEnabled(!audioOutputEnabled); }} 
              className={`p-2.5 rounded-xl border transition-all ${audioOutputEnabled ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-slate-700 border-white/10 text-slate-400'}`}
              title={audioOutputEnabled ? "Mute Agent Voice" : "Unmute Agent Voice"}
            >
              {audioOutputEnabled ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
              )}
            </button>
            <button onClick={onExit} className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all text-[10px] font-bold uppercase tracking-wider">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
              End Session
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowWhatsApp(true)} className="flex-1 min-w-[120px] px-3 py-2 rounded-xl bg-emerald-600/10 border border-emerald-500/20 text-[10px] font-bold uppercase text-emerald-400 hover:bg-emerald-600/20 transition-all flex items-center justify-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l2.27-2.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            WhatsApp
          </button>
          <button onClick={() => window.open('https://www.youtube.com/TheCrisisShow', '_blank')} className="flex-1 min-w-[120px] px-3 py-2 rounded-xl bg-red-600/10 border border-red-500/20 text-[10px] font-bold uppercase text-red-400 hover:bg-red-600/20 transition-all flex items-center justify-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            Crisis Show
          </button>
          <button onClick={() => window.open('https://www.linkedin.com/in/richkleincrisis/', '_blank')} className="flex-1 min-w-[120px] px-3 py-2 rounded-xl bg-blue-600/10 border border-blue-500/20 text-[10px] font-bold uppercase text-blue-400 hover:bg-blue-600/20 transition-all flex items-center justify-center gap-2">
            LinkedIn
          </button>
        </div>

        <div className="flex flex-wrap justify-center gap-1.5 pt-2 border-t border-white/5">
          {['English', 'Mandarin', 'Spanish', 'French', 'Italian', 'German', 'Hebrew', 'Arabic', 'Japanese'].map(l => (
            <button 
              key={l} 
              onClick={() => handleLanguageSwitch(l)} 
              className={`px-2.5 py-1 rounded-md border text-[9px] font-bold uppercase transition-colors ${
                language === l 
                  ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/30' 
                  : 'bg-white/5 border-white/10 text-slate-400 hover:text-blue-400 hover:border-blue-500/30'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Chat History */}
      <div className="flex-1 bg-slate-900/50 border-x border-white/5 flex flex-col overflow-hidden relative">
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 custom-scrollbar">
          {transcriptions.map((t, i) => (
            <div key={i} className={`flex ${t.type === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-1 duration-200`}>
              <div 
                dir="auto"
                className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                t.type === 'user' 
                ? 'bg-blue-600 text-white' 
                : 'bg-slate-800 text-slate-200 border border-white/5'
              }`}>
                {t.text}
              </div>
            </div>
          ))}
          {streamingResponse && (
            <div className="flex justify-start">
              <div dir="auto" className="max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed bg-slate-800 text-blue-300 border border-blue-500/20 italic animate-pulse">
                {streamingResponse}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Input Console */}
      <div className="bg-slate-800/60 border border-white/5 rounded-b-3xl p-4">
        <div className="relative flex items-center gap-3">
          <input
            ref={textInputRef}
            type="text"
            dir="auto"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
            placeholder="Type your message for strategic counsel..."
            className="flex-1 bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-white placeholder:text-slate-600"
          />
          <button onClick={handleSendText} disabled={!textInput.trim()} className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 disabled:opacity-20 transition-all flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          </button>
        </div>
      </div>
    </div>
  );
};