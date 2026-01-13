
export interface Transcription {
  text: string;
  type: 'user' | 'model' | 'link';
  timestamp: number;
  metadata?: {
    url?: string;
    title?: string;
  };
}

export interface VoiceConfig {
  voiceName: 'Kore' | 'Zephyr' | 'Puck' | 'Charon' | 'Fenrir';
}
