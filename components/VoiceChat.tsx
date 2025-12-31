
import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Phone, PhoneOff, AlertCircle, User, UserRound } from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { AudioVisualizer } from './AudioVisualizer';
import { decodeAudioData, createPcmBlob } from '../services/audioUtils';

interface VoiceChatProps {
  courseContent: string;
  systemInstruction: string;
  apiKey: string;
  themeColor?: string;
}

type VoiceOption = 'Fenrir' | 'Kore';

const colorMap: Record<string, { primary: string, hover: string }> = {
  blue: { primary: 'bg-blue-600', hover: 'hover:bg-blue-500' },
  emerald: { primary: 'bg-emerald-600', hover: 'hover:bg-emerald-500' },
  indigo: { primary: 'bg-indigo-600', hover: 'hover:bg-indigo-500' },
  rose: { primary: 'bg-[#ad5c51]', hover: 'hover:bg-[#914a41]' },
  amber: { primary: 'bg-amber-600', hover: 'hover:bg-amber-500' },
};

export const VoiceChat: React.FC<VoiceChatProps> = ({ courseContent, systemInstruction, apiKey, themeColor = 'blue' }) => {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [isMuted, setIsMuted] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>('Kore');

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  const colors = colorMap[themeColor] || colorMap.blue;
  const fullSystemInstruction = `${systemInstruction}\n\nCONTENU DU COURS (Source Unique de Vérité) :\n${courseContent}`;

  const disconnect = () => {
    if (processorRef.current) processorRef.current.disconnect();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();
    audioSourcesRef.current.forEach(s => { try { s.stop(); } catch (e) { } });
    audioSourcesRef.current.clear();
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    streamRef.current = null;
    processorRef.current = null;
    sessionPromiseRef.current = null;
    nextStartTimeRef.current = 0;
    setStatus('disconnected');
    setVolumeLevel(0);
  };

  const connect = async () => {
    if (status !== 'disconnected') return;
    setStatus('connecting');
    setErrorMsg(null);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      outputAudioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
      outputNodeRef.current = outputAudioContextRef.current.createGain();
      outputNodeRef.current.connect(outputAudioContextRef.current.destination);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.0-flash-exp',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: fullSystemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
          },
        },
        callbacks: {
          onopen: () => { setStatus('connected'); startMic(); },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              const audioBuffer = await decodeAudioData(audioData, ctx);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNodeRef.current!);
              const now = ctx.currentTime;
              if (nextStartTimeRef.current < now) nextStartTimeRef.current = now;
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              audioSourcesRef.current.add(source);
              source.onended = () => audioSourcesRef.current.delete(source);
            }
            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => { try { s.stop(); } catch (e) { } });
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onclose: () => disconnect(),
          onerror: (e) => { setStatus('error'); setErrorMsg("Erreur de connexion vocale."); }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err) { setStatus('error'); setErrorMsg("Erreur d'initialisation."); }
  };

  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      inputAudioContextRef.current = new AudioContextClass({ sampleRate: 16000 });
      const source = inputAudioContextRef.current.createMediaStreamSource(stream);
      const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (isMuted) return;
        const inputData = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
        setVolumeLevel(Math.min(1, Math.sqrt(sum / inputData.length) * 5));
        const pcmBlob = createPcmBlob(inputData);
        sessionPromiseRef.current?.then(session => { session.sendRealtimeInput({ media: pcmBlob }); });
      };
      source.connect(processor);
      processor.connect(inputAudioContextRef.current.destination);
      processorRef.current = processor;
    } catch (err) { setErrorMsg("Accès micro refusé."); setStatus('error'); }
  };

  useEffect(() => { return () => disconnect(); }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full max-w-4xl mx-auto w-full bg-slate-900 rounded-2xl shadow-2xl overflow-hidden relative border border-slate-800">
      <div className="z-10 flex flex-col items-center gap-8 p-10 text-center w-full">
        <h2 className="text-3xl font-serif font-bold text-white tracking-tight">Vocal (Live)</h2>
        <AudioVisualizer level={volumeLevel} isActive={status === 'connected'} themeColor={themeColor} />
        <div className="flex items-center gap-6">
          {status === 'connected' ? (
            <button onClick={disconnect} className="p-8 rounded-full bg-red-600 text-white hover:bg-red-700 shadow-2xl transform transition-all active:scale-95"><PhoneOff size={36} /></button>
          ) : (
            <button onClick={connect} disabled={status === 'connecting'} className={`flex items-center gap-4 px-12 py-6 rounded-full ${colors.primary} text-white font-serif font-bold text-xl ${colors.hover} shadow-2xl transition-all active:scale-95 disabled:opacity-50`}>
              {status === 'connecting' ? <AlertCircle className="animate-pulse" size={28} /> : <Phone size={28} />}
              <span>{status === 'connecting' ? 'Appel en cours...' : 'Appeler Ada'}</span>
            </button>
          )}
        </div>
        {status === 'disconnected' && (
          <div className="flex p-1 bg-slate-800/50 rounded-2xl border border-slate-700">
            <button onClick={() => setSelectedVoice('Kore')} className={`px-4 py-2 rounded-xl text-xs font-semibold ${selectedVoice === 'Kore' ? 'bg-pink-600 text-white' : 'text-slate-400'}`}>F&eacute;minine</button>
            <button onClick={() => setSelectedVoice('Fenrir')} className={`px-4 py-2 rounded-xl text-xs font-semibold ${selectedVoice === 'Fenrir' ? `${colors.primary} text-white` : 'text-slate-400'}`}>Masculine</button>
          </div>
        )}
        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl max-w-sm">
            <p className="text-red-400 text-sm font-medium mb-1">Désolée, une petite coupure technique !</p>
            <p className="text-red-100/70 text-xs">Le mode vocal utilise une technologie expérimentale. N'hésitez pas à continuer notre échange par écrit dans l'onglet "Discussion".</p>
          </div>
        )}
      </div>
    </div>
  );
};





