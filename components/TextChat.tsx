
import React, { useState, useRef, useEffect } from 'react';
import {
  Send, User, Loader2, Plus, MessageSquare, X,
  PanelLeftClose, PanelLeft, Lightbulb,
  FileText, Paperclip, Trash2, BookOpen, Scale,
  FileSignature, CheckCircle2, Circle, Trophy, LogOut, Search
} from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import { SYSTEM_INSTRUCTION } from '../constants';
import { useChatStore } from '../hooks/useChatStore';
import { AttachedFile, ScoreRecord, StudentProfile } from '../types';

mermaid.initialize({
  startOnLoad: true,
  theme: 'neutral',
  securityLevel: 'loose',
  fontFamily: 'inherit'
});

const MermaidRenderer: React.FC<{ chart: string }> = ({ chart }) => {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    const render = async () => {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      try {
        const { svg } = await mermaid.render(id, chart);
        setSvg(svg);
      } catch (e) { console.error(e); }
    };
    render();
  }, [chart]);
  return <div className="mt-4 mb-6 flex justify-center bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
};

interface TextChatProps {
  courseContent: string;
  systemInstruction: string;
  apiKey: string;
  themeColor?: string;
}

const colorMap: Record<string, { primary: string, hover: string, text: string }> = {
  blue: { primary: 'bg-blue-700', hover: 'hover:bg-blue-800', text: 'text-blue-700' },
  emerald: { primary: 'bg-emerald-700', hover: 'hover:bg-emerald-800', text: 'text-emerald-700' },
  indigo: { primary: 'bg-indigo-700', hover: 'hover:bg-indigo-800', text: 'text-indigo-700' },
  rose: { primary: 'bg-[#ad5c51]', hover: 'hover:bg-[#914a41]', text: 'text-[#ad5c51]' },
  amber: { primary: 'bg-amber-700', hover: 'hover:bg-amber-800', text: 'text-amber-700' },
};

export const TextChat: React.FC<TextChatProps> = ({ courseContent, systemInstruction, apiKey, themeColor = 'blue' }) => {
  const {
    activeSessionId,
    setActiveSessionId,
    createNewSession,
    deleteSession,
    addMessageToSession,
    selectOptionInMessage,
    selectOptionsInMessage,
    findProfilesByName,
    createNewProfile,
    loginToProfile,
    logoutProfile,
    saveScore,
    currentProfile,
    activeSession,
    sessions
  } = useChatStore();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [disambiguationOptions, setDisambiguationOptions] = useState<string[]>([]);
  const [checkedOptions, setCheckedOptions] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const colors = colorMap[themeColor] || colorMap.blue;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, isLoading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Data = (reader.result as string).split(',')[1];
        setAttachedFile({ name: file.name, data: base64Data, mimeType: file.type });
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const sendMessage = async (overrideInput?: string, quizMsgIndex?: number, choiceLabel?: string) => {
    const textToSend = overrideInput !== undefined ? overrideInput : input;
    const text = textToSend.trim();
    if ((!text && !attachedFile) || isLoading || !activeSessionId) return;

    if (quizMsgIndex !== undefined && choiceLabel) {
      selectOptionInMessage(activeSessionId, quizMsgIndex, choiceLabel);
    }

    // --- LOGIQUE D'IDENTIFICATION ---
    const lastMsg = activeSession?.messages[activeSession.messages.length - 1];
    const lowerText = text.toLowerCase();

    // Heuristique : est-ce une question juridique ?
    const looksLikeQuestion = lowerText.includes("?") || lowerText.length > 25 || lowerText.includes("qu'est-ce") || lowerText.includes("pourquoi") || lowerText.includes("comment") || lowerText.includes("arrêt") || lowerText.includes("service public");

    // Scénario : L'utilisateur refuse l'anonymat ou pose une question d'emblée
    const isInitialPrompt =
      lastMsg?.text.includes("faire connaissance") ||
      lastMsg?.text.includes("souhaitez-vous vous identifier") ||
      lastMsg?.text.includes("prénom") ||
      lastMsg?.text.includes("pseudo");
    const looksLikeQuickAction = text.includes("progression") || text.includes("QCM") || text.includes("Vrai/Faux") || text.includes("Cas pratique") || text.includes("Expliquez-moi") || text.includes("Plan Dissertation") || text.includes("Listez les arrêts");

    if (isInitialPrompt && (!currentProfile || currentProfile.name === 'Visiteur')) {
      if (text === "Je préfère rester anonyme" || (looksLikeQuestion && !overrideInput) || (looksLikeQuickAction && !overrideInput)) {
        const profile = createNewProfile("Visiteur");
        addMessageToSession(activeSessionId, { role: 'user', text, timestamp: new Date() });
        setInput('');
        setIsLoading(true);

        // Si c'est une question, on laisse l'IA répondre normalement après avoir créé le profil Visiteur
        if (!looksLikeQuestion) {
          setTimeout(() => {
            addMessageToSession(activeSessionId, {
              role: 'model',
              text: "C'est entendu. Vous naviguez en tant que **Visiteur**. Vos scores ne seront pas sauvegardés d'une session à l'autre, mais je reste à votre entière disposition pour vos questions de Droit Public.",
              timestamp: new Date()
            });
            setIsLoading(false);
          }, 600);
          return;
        }
        // Sinon (c'est une question), on continue vers l'appel API avec le profil visiteur actif
      } else if (text === "Je veux bien me présenter") {
        addMessageToSession(activeSessionId, { role: 'user', text, timestamp: new Date() });
        setInput('');
        setIsLoading(true);
        setTimeout(() => {
          addMessageToSession(activeSessionId, {
            role: 'model',
            text: "Très bien ! Quel est donc votre **prénom** ou votre pseudo ?",
            timestamp: new Date()
          });
          setIsLoading(false);
        }, 600);
        return;
      } else if (!looksLikeQuestion && !looksLikeQuickAction) {
        // L'utilisateur a probablement tapé son nom directement
        const matches = findProfilesByName(text);
        if (matches.length > 0) {
          const options = [...matches.map(m => m.id), `Nouveau : ${text}`];
          setDisambiguationOptions(options);
          addMessageToSession(activeSessionId, { role: 'user', text, timestamp: new Date() });
          setInput('');
          setIsLoading(true);
          setTimeout(() => {
            const listText = options.map(o => `[ ] ${o}`).join('\n');
            addMessageToSession(activeSessionId, { role: 'model', text: `Plusieurs dossiers correspondent à "${text}". Lequel est le vôtre ?\n${listText}`, timestamp: new Date() });
            setIsLoading(false);
          }, 600);
          return;
        } else {
          const profile = createNewProfile(text);
          addMessageToSession(activeSessionId, { role: 'user', text, timestamp: new Date() });
          setInput('');
          setIsLoading(true);
          setTimeout(() => {
            addMessageToSession(activeSessionId, { role: 'model', text: `Enchantée, **${profile.name}** ! Votre dossier est prêt (ID : ${profile.id}). En quoi puis-je vous éclairer aujourd'hui ?`, timestamp: new Date() });
            setIsLoading(false);
          }, 600);
          return;
        }
      }
    }

    // Gestion de la désambiguïsation
    if (disambiguationOptions.length > 0 && overrideInput) {
      if (overrideInput.startsWith("Nouveau : ")) {
        const name = overrideInput.replace("Nouveau : ", "");
        const profile = createNewProfile(name);
        addMessageToSession(activeSessionId, { role: 'user', text: overrideInput, timestamp: new Date() });
        setDisambiguationOptions([]);
        setIsLoading(true);
        setTimeout(() => {
          addMessageToSession(activeSessionId, { role: 'model', text: `C'est noté, **${profile.id}**. Prêt pour nos révisions !`, timestamp: new Date() });
          setIsLoading(false);
        }, 600);
      } else {
        loginToProfile(overrideInput);
        addMessageToSession(activeSessionId, { role: 'user', text: overrideInput, timestamp: new Date() });
        setDisambiguationOptions([]);
        setIsLoading(true);
        setTimeout(() => {
          addMessageToSession(activeSessionId, { role: 'model', text: `Heureuse de vous revoir, **${overrideInput}** !`, timestamp: new Date() });
          setIsLoading(false);
        }, 600);
      }
      return;
    }

    // Suite normale (Appel IA)
    const currentFile = attachedFile;
    const displayMsgText = attachedFile ? `[Fichier joint : ${attachedFile.name}]\n${text}` : text;

    addMessageToSession(activeSessionId, {
      role: 'user',
      text: displayMsgText,
      timestamp: new Date(),
      file: currentFile || undefined
    });

    setInput('');
    setAttachedFile(null);
    setIsLoading(true);

    try {
      // Utilisation de fetch direct pour une structure de réponse garantie et robuste
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      const contents = (activeSession?.messages || [])
        .filter(m => !m.isError)
        .map(m => ({
          role: m.role === 'model' ? 'model' : 'user',
          parts: [{ text: m.text }]
        }));

      const userParts: any[] = [{ text }];
      if (currentFile) {
        userParts.push({ inlineData: { data: currentFile.data, mimeType: currentFile.mimeType } });
      }
      contents.push({ role: 'user', parts: userParts });

      const body = {
        contents,
        systemInstruction: {
          parts: [{ text: `${systemInstruction || SYSTEM_INSTRUCTION}${currentProfile ? `\n\nÉTUDIANT : ${currentProfile.name}. ID UNIQUE : ${currentProfile.id}. HISTORIQUE SCORES : ${JSON.stringify(currentProfile.scores)}\n(Note : Appelle toujours l'étudiant par son prénom "${currentProfile.name}", pas par son ID technique).` : ""}\n\nCOURS :\n${courseContent}` }]
        },
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Erreur API Google");

      const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "Désolée, je n'ai pas pu générer de réponse.";
      const scoreMatch = aiText.match(/\[SCORE:(\d+)\/(\d+)\|TYPE:(.*?)\]/);

      if (scoreMatch && currentProfile && currentProfile.id !== "Visiteur") {
        const score: ScoreRecord = {
          score: parseInt(scoreMatch[1]),
          total: parseInt(scoreMatch[2]),
          quizType: scoreMatch[3],
          date: Date.now()
        };
        saveScore(currentProfile.id, score);
      }

      addMessageToSession(activeSessionId, {
        role: 'model',
        text: aiText.replace(/\[SCORE:.*?\]/g, ''),
        timestamp: new Date()
      });
    } catch (error: any) {
      addMessageToSession(activeSessionId, { role: 'model', text: `Erreur : ${error.message}`, timestamp: new Date(), isError: true });
    } finally {
      setIsLoading(false);
      setCheckedOptions([]); // Reset selections after sending
    }
  };

  const toggleOption = (option: string) => {
    setCheckedOptions(prev =>
      prev.includes(option) ? prev.filter(o => o !== option) : [...prev, option]
    );
  };

  const MessageRenderer = ({ text, msgIndex, role, selectedOption, selectedOptions }: { text: string, msgIndex: number, role: string, selectedOption?: string, selectedOptions?: string[] }) => {
    const mdPlugins = { rehypePlugins: [rehypeRaw], remarkPlugins: [remarkGfm] };

    if (role === 'user') return <ReactMarkdown {...mdPlugins}>{text}</ReactMarkdown>;

    // Segmentation intelligente pour ne pas briser le markdown (tableaux, listes, mermaid)
    const lines = text.split('\n');
    const segments: { type: 'markdown' | 'button', content: string }[] = [];
    let currentMd = '';

    lines.forEach((line) => {
      const quizMatch = line.match(/^\[\s*\]\s*(.*)/);
      if (quizMatch) {
        if (currentMd.trim()) {
          segments.push({ type: 'markdown', content: currentMd });
          currentMd = '';
        }
        segments.push({ type: 'button', content: quizMatch[1].trim() });
      } else {
        currentMd += line + '\n';
      }
    });
    if (currentMd.trim()) segments.push({ type: 'markdown', content: currentMd });

    const components = {
      code: ({ inline, className, children }: any) => {
        const match = /language-(\w+)/.exec(className || '');
        return !inline && match?.[1] === 'mermaid'
          ? <MermaidRenderer chart={String(children).replace(/\n$/, '')} />
          : <code className={className}>{children}</code>;
      },
      pre: ({ children }: any) => <div className="not-prose">{children}</div>,
      table: ({ children }: any) => (
        <div className="my-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      th: ({ children }: any) => <th className="bg-slate-50 dark:bg-slate-800/50 px-3 py-2 font-bold border-b border-slate-200 dark:border-slate-700">{children}</th>,
      td: ({ children }: any) => <td className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">{children}</td>
    };

    const isMultiChoice = text.toLowerCase().includes("plusieurs réponses possibles");
    const isLastMessage = msgIndex === (activeSession?.messages.length || 0) - 1;

    return (
      <div className="space-y-3">
        {segments.map((seg, i) => {
          if (seg.type === 'button') {
            const isSelected = selectedOption === seg.content ||
              (selectedOptions?.includes(seg.content)) ||
              (disambiguationOptions.length > 0 && disambiguationOptions.includes(seg.content));

            const isChecked = checkedOptions.includes(seg.content);
            const isNavButton = seg.content.toLowerCase().includes("oui") ||
              seg.content.toLowerCase().includes("prêt") ||
              seg.content.toLowerCase().includes("suite") ||
              seg.content.toLowerCase().includes("anonyme");

            if (isMultiChoice && isLastMessage && !selectedOption && !selectedOptions) {
              return (
                <button
                  key={i}
                  disabled={isLoading}
                  onClick={() => toggleOption(seg.content)}
                  className={`flex items-center gap-3 w-full max-w-xl py-3 px-4 rounded-xl border-2 text-left transition-all active:scale-[0.98] 
                    ${isChecked
                      ? `bg-[#ad5c51]/10 ${colors.text} border-[#ad5c51] shadow-sm`
                      : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 hover:border-slate-300'}`}
                >
                  <div className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors 
                    ${isChecked ? 'border-[#ad5c51] bg-[#ad5c51] text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                    {isChecked ? <CheckCircle2 size={12} strokeWidth={3} /> : null}
                  </div>
                  <div className="font-semibold text-sm flex-1">
                    <ReactMarkdown {...mdPlugins} components={{ p: ({ children }) => <span className="m-0 p-0">{children}</span> }}>{seg.content}</ReactMarkdown>
                  </div>
                </button>
              );
            }

            return (
              <button
                key={i}
                disabled={isLoading || (!!selectedOption && disambiguationOptions.length === 0) || (!!selectedOptions)}
                onClick={() => sendMessage(seg.content, msgIndex, seg.content)}
                className={`flex items-center gap-3 w-full max-w-xl py-3 px-4 rounded-xl border-2 text-left transition-all group active:scale-[0.98] 
                  ${isSelected
                    ? `bg-[#ad5c51]/10 ${colors.text} border-[#ad5c51] shadow-sm`
                    : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 hover:border-slate-300'} 
                  ${isNavButton && !isSelected ? 'border-amber-200 bg-amber-50/20' : ''}`}
              >
                <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors 
                  ${isSelected ? 'border-[#ad5c51] bg-[#ad5c51] text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                  {isSelected ? <CheckCircle2 size={12} strokeWidth={3} /> : <Circle size={12} className="text-transparent group-hover:text-slate-300" />}
                </div>
                <div className="font-semibold text-sm flex-1">
                  <ReactMarkdown {...mdPlugins} components={{ p: ({ children }) => <span className="m-0 p-0">{children}</span> }}>{seg.content}</ReactMarkdown>
                </div>
              </button>
            );
          }
          return (
            <ReactMarkdown key={i} {...mdPlugins} components={components as any}>
              {seg.content}
            </ReactMarkdown>
          );
        })}

        {isMultiChoice && isLastMessage && !selectedOption && !selectedOptions && segments.some(s => s.type === 'button') && (
          <button
            onClick={() => {
              if (checkedOptions.length > 0) {
                const combined = checkedOptions.join(', ');
                selectOptionsInMessage(activeSessionId!, msgIndex, checkedOptions);
                sendMessage(`Mes réponses : ${combined}`);
              }
            }}
            disabled={isLoading || checkedOptions.length === 0}
            className={`mt-2 flex items-center justify-center gap-2 px-6 py-3 ${colors.primary} text-white rounded-xl font-bold shadow-lg transition-all active:scale-95 disabled:opacity-50`}
          >
            <CheckCircle2 size={18} />
            <span>Valider mes réponses</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full max-w-6xl mx-auto w-full bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden relative">
      <div className={`absolute inset-y-0 left-0 z-30 flex flex-col w-72 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-serif font-bold text-slate-700 dark:text-slate-200">Mes Révisions</h3>
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg"><PanelLeftClose size={20} /></button>
          </div>
          <button onClick={() => { createNewSession(); setIsSidebarOpen(false); }} className={`w-full flex items-center justify-center gap-2 px-4 py-3 ${colors.primary} text-white rounded-lg font-medium shadow-md transition-all active:scale-95`}><Plus size={18} /><span>Nouvelle Session</span></button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map(session => (
            <div key={session.id} onClick={() => { setActiveSessionId(session.id); setIsSidebarOpen(false); }} className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-all ${activeSessionId === session.id ? 'bg-white dark:bg-slate-800 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 font-medium' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/50'}`}>
              <MessageSquare size={16} className="shrink-0" />
              <span className="flex-1 truncate">{session.title}</span>
              <button onClick={e => deleteSession(session.id, e)} className="p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        {currentProfile && (
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-8 h-8 rounded-lg ${colors.primary} flex items-center justify-center text-white shadow-sm`}><User size={16} /></div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{currentProfile.name}</p>
                <p className="text-[10px] text-slate-500">{currentProfile.id}</p>
              </div>
              <button onClick={() => logoutProfile()} className="p-2 text-slate-400 hover:text-red-500 transition-colors" title="Changer de profil"><LogOut size={16} /></button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-w-0 bg-slate-50/30 dark:bg-slate-950">
        <header className="p-3 md:p-4 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10 shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-1 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><PanelLeft size={20} /></button>
            <span className="font-serif font-bold text-slate-800 dark:text-white truncate">{activeSession?.title || 'Session de Droit'}</span>
          </div>
          <div className="flex items-center gap-2">
            {currentProfile && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-full">
                <Trophy size={14} className="text-amber-600" />
                <span className="text-xs font-bold text-amber-700">
                  {(() => {
                    const validScores = currentProfile.scores.filter(s => s.total > 0);
                    if (validScores.length === 0) return 'Nouveau';
                    const sumPoints = validScores.reduce((acc, s) => acc + s.score, 0);
                    const sumTotal = validScores.reduce((acc, s) => acc + s.total, 0);
                    return `${Math.round((sumPoints / sumTotal) * 100)}% moy.`;
                  })()}
                </span>
              </div>
            )}
            <button onClick={() => setIsHelpOpen(true)} className="p-2 text-slate-400 hover:text-amber-500"><Lightbulb size={24} /></button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {activeSession?.messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-3 md:gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`flex-shrink-0 w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center ${msg.role === 'model' ? `${colors.primary} text-white shadow-md` : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                {msg.role === 'model' ? <Scale size={20} /> : <User size={20} />}
              </div>
              <div className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`px-4 py-3 md:px-5 md:py-3.5 rounded-2xl shadow-sm prose prose-sm md:prose-base max-w-full overflow-hidden ${msg.role === 'user' ? `${colors.primary} text-white rounded-tr-none prose-invert` : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-tl-none prose-slate dark:prose-invert'}`}>
                  <MessageRenderer
                    text={msg.text}
                    msgIndex={idx}
                    role={msg.role}
                    selectedOption={msg.selectedOption}
                    selectedOptions={msg.selectedOptions}
                  />
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-4">
              <div className={`w-10 h-10 rounded-full ${colors.primary} flex items-center justify-center text-white`}><Scale size={20} /></div>
              <div className="bg-white dark:bg-slate-800 px-5 py-3 rounded-2xl rounded-tl-none border border-slate-200 dark:border-slate-700">
                <Loader2 className="animate-spin text-slate-400 inline-block mr-2" size={16} />
                <span className="text-slate-500 text-sm italic">Analyse doctrinale...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          {attachedFile && (
            <div className="mb-2 flex items-center gap-2 p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <FileText size={16} className="text-blue-500" />
              <span className="text-xs font-medium truncate flex-1">{attachedFile.name}</span>
              <button onClick={() => setAttachedFile(null)} className="p-1 hover:text-red-500"><X size={14} /></button>
            </div>
          )}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2 no-scrollbar px-1">
            <button onClick={() => sendMessage("Quel est mon bilan de progression ?")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-700 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 rounded-lg hover:bg-amber-100 transition-all whitespace-nowrap"><Trophy size={14} /> Ma progression</button>
            <button onClick={() => sendMessage("Génère un QCM de 3 questions sur un ou plusieurs thèmes du cours que je vais t'indiquer")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 rounded-lg hover:bg-blue-100 transition-all whitespace-nowrap"><Search size={14} /> QCM</button>
            <button onClick={() => sendMessage("Propose-moi 3 affirmations Vrai/Faux sur un ou plusieurs thèmes du cours que je vais t'indiquer")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 rounded-lg hover:bg-rose-100 transition-all whitespace-nowrap"><BookOpen size={14} /> Vrai/Faux</button>
            <button onClick={() => sendMessage("Soumets-moi un petit cas pratique sur un ou plusieurs thèmes du cours que je vais t'indiquer.")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 transition-all whitespace-nowrap"><FileSignature size={14} /> Cas pratique</button>
            <button onClick={() => sendMessage("Expliquez-moi simplement la notion suivante :")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 transition-all whitespace-nowrap"><BookOpen size={14} /> Expliquez-moi...</button>
            <button onClick={() => sendMessage("Propose-moi un sujet de dissertation et un plan détaillé (I. II.) basé sur un ou plusieurs thèmes du cours que je vais t'indiquer.")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100 transition-all whitespace-nowrap"><BookOpen size={14} /> Plan Dissertation</button>
            <button onClick={() => sendMessage("Listez les arrêts liés à des définitions, SVP.")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-100 transition-all whitespace-nowrap"><BookOpen size={14} /> Arrêts & définitions</button>
            <button onClick={() => sendMessage("Listez les arrêts liés à un ou plusieurs thèmes du cours que je vais vous indiquer.")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-cyan-700 bg-cyan-50 dark:bg-cyan-900/30 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800 rounded-lg hover:bg-cyan-100 transition-all whitespace-nowrap"><BookOpen size={14} /> Arrêts & notions clés</button>
          </div>
          <div className="relative flex items-end gap-2 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-2xl border-2 border-slate-200 dark:border-slate-700">
            <button onClick={() => fileInputRef.current?.click()} className="p-3 text-slate-400 hover:text-slate-600"><Paperclip size={24} /></button>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".pdf" className="hidden" />
            <textarea ref={textareaRef} rows={1} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())} placeholder={!currentProfile ? "Choisissez une option ou présentez-vous..." : "Votre question juridique..."} className="flex-1 py-3 bg-transparent border-none outline-none resize-none text-slate-800 dark:text-white max-h-[200px]" />
            <button onClick={() => sendMessage()} disabled={(!input.trim() && !attachedFile) || isLoading} className={`p-3 ${colors.primary} text-white rounded-xl shadow-lg disabled:opacity-50 transition-all`}><Send size={20} /></button>
          </div>
        </div>
      </div>

      {isHelpOpen && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90%] overflow-hidden border border-slate-200 dark:border-slate-700">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-serif font-bold text-lg">Aide & Profils</h3>
              <button onClick={() => setIsHelpOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-600 dark:text-slate-400">
              <section className="space-y-2">
                <h4 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2"><User size={18} className={colors.text} /> Identification précise</h4>
                <p>En cas d'homonymes (ex: deux "Thomas"), Ada affichera les codes uniques pour que chacun retrouve ses propres notes de révision.</p>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};






