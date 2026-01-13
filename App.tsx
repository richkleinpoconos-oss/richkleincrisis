import React, { useState } from 'react';
import { VoiceAgent } from './components/VoiceAgent';

const App: React.FC = () => {
  const [consultationMode, setConsultationMode] = useState<'voice' | 'message' | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white flex flex-col">
      {/* Header */}
      <header className="p-6 border-b border-white/10 flex justify-between items-center backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
            <span className="text-xl font-bold">RK</span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold tracking-tight leading-none">Rich Klein</h1>
            <span className="text-[10px] uppercase tracking-[0.2em] text-blue-400 font-bold">Crisis Management</span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm">
          <div className="text-slate-400 font-medium">
            Global Strategic PR & Media Relations
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={`flex-1 container mx-auto px-4 ${consultationMode ? 'py-4' : 'py-8 md:py-12'} flex flex-col items-center ${consultationMode ? 'justify-start' : 'justify-center'} max-w-4xl`}>
        {!consultationMode ? (
          <div className="text-center space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="space-y-4">
              <div className="inline-block px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-widest">
                Available 24/7 Worldwide
              </div>
              <h2 className="text-4xl md:text-6xl font-bold tracking-tight">
                Immediate Strategic <br />
                <span className="text-blue-500">Crisis Response.</span>
              </h2>
              <p className="text-lg text-slate-400 max-w-xl mx-auto leading-relaxed">
                Connect with an agent trained on Rich Klein's combined 40 years of journalism and public relations experience.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl mx-auto">
              {/* Voice Option */}
              <button
                onClick={() => setConsultationMode('voice')}
                className="group relative flex flex-col items-center p-8 bg-white/5 border border-white/10 rounded-[2.5rem] hover:bg-blue-600/10 hover:border-blue-500/30 transition-all duration-300 hover:scale-[1.02] active:scale-95 cursor-pointer"
              >
                <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-blue-600/20 group-hover:scale-110 transition-transform">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                </div>
                <h3 className="text-xl font-bold mb-2">Secure Voice Line</h3>
                <p className="text-sm text-slate-400 text-center">Speak directly with the strategist for rapid, hands-free assessment.</p>
                <div className="mt-6 px-4 py-2 bg-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  Start Call
                </div>
              </button>

              {/* Message Option */}
              <button
                onClick={() => setConsultationMode('message')}
                className="group relative flex flex-col items-center p-8 bg-white/5 border border-white/10 rounded-[2.5rem] hover:bg-slate-800 transition-all duration-300 hover:scale-[1.02] active:scale-95 cursor-pointer"
              >
                <div className="w-16 h-16 bg-slate-700 rounded-2xl flex items-center justify-center mb-6 shadow-xl group-hover:scale-110 transition-transform">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </div>
                <h3 className="text-xl font-bold mb-2">Tactical Message</h3>
                <p className="text-sm text-slate-400 text-center">Provide sensitive details via secure text-only consultation.</p>
                <div className="mt-6 px-4 py-2 bg-white/10 text-slate-400 text-[10px] font-bold uppercase tracking-widest rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  Open Chat
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full animate-in zoom-in-95 duration-500">
             <VoiceAgent preferredMode={consultationMode} onExit={() => setConsultationMode(null)} />
          </div>
        )}
      </main>

      <footer className="p-6 text-center text-slate-500 text-xs border-t border-white/10">
        © {new Date().getFullYear()} Rich Klein Crisis Management. Confidential Tactical Assessment.
      </footer>
    </div>
  );
};

export default App;