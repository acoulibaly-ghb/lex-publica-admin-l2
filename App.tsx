import React, { useState, useEffect } from 'react';
import { MessageSquare, Mic, GraduationCap, Lock, Unlock, Moon, Sun, X } from 'lucide-react'; // Ajout de X pour fermer
import { TextChat } from './components/TextChat';
import { VoiceChat } from './components/VoiceChat';
import { CourseEditor } from './components/CourseEditor';
import { AppMode } from './types';
import { useChatStore } from './hooks/useChatStore';
import { DEFAULT_COURSE_CONTENT, DEFAULT_VOICE_SUMMARY, SYSTEM_INSTRUCTION, VOICE_SYSTEM_INSTRUCTION, DEFAULT_THEME_COLOR } from './constants';

const themeStyles: Record<string, { bg: string, text: string }> = {
  blue: { bg: 'bg-blue-600', text: 'text-blue-600' },
  emerald: { bg: 'bg-emerald-600', text: 'text-emerald-600' },
  indigo: { bg: 'bg-indigo-600', text: 'text-indigo-600' },
  rose: { bg: 'bg-[#ad5c51]', text: 'text-[#ad5c51]' },
  amber: { bg: 'bg-amber-600', text: 'text-amber-600' },
};

const App = () => {
  const { profiles, refreshProfiles, lastSync, saveConfigToCloud, fetchConfigFromCloud } = useChatStore();
  const [activeMode, setActiveMode] = useState<AppMode>(AppMode.TEXT);
  const [courseTitle, setCourseTitle] = useState<string>("Droit administratif général");
  const [courseContent, setCourseContent] = useState<string>(DEFAULT_COURSE_CONTENT);
  const [voiceSummary, setVoiceSummary] = useState<string>(DEFAULT_VOICE_SUMMARY);
  const [systemInstruction, setSystemInstruction] = useState<string>(SYSTEM_INSTRUCTION);
  const [voiceInstruction, setVoiceInstruction] = useState<string>(VOICE_SYSTEM_INSTRUCTION);
  const [themeColor, setThemeColor] = useState<string>(DEFAULT_THEME_COLOR);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // État pour le menu mobile

  const apiKey = ((import.meta as any).env?.VITE_API_KEY as string) || '';
  const teacherPassword = process.env.TEACHER_PASSWORD || 'admin';

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  useEffect(() => {
    if (isDarkMode) { document.documentElement.classList.add('dark'); localStorage.setItem('theme', 'dark'); }
    else { document.documentElement.classList.remove('dark'); localStorage.setItem('theme', 'light'); }
  }, [isDarkMode]);

  useEffect(() => {
    const items = [
      { key: 'course_title', setter: setCourseTitle },
      { key: 'course_content', setter: setCourseContent },
      { key: 'voice_summary', setter: setVoiceSummary },
      { key: 'system_instruction', setter: setSystemInstruction },
      { key: 'voice_instruction', setter: setVoiceInstruction },
      { key: 'theme_color', setter: setThemeColor }
    ];
    items.forEach(item => {
      const stored = localStorage.getItem(item.key);
      if (stored) item.setter(stored);
    });
  }, []);

  useEffect(() => {
    const loadCloudConfig = async () => {
      const cloudConfig = await fetchConfigFromCloud();
      if (cloudConfig && cloudConfig.course_content) {
        if (cloudConfig.course_title) setCourseTitle(cloudConfig.course_title);
        setCourseContent(cloudConfig.course_content);
        setVoiceSummary(cloudConfig.voice_summary);
        setSystemInstruction(cloudConfig.system_instruction);
        setVoiceInstruction(cloudConfig.voice_instruction);
        setThemeColor(cloudConfig.theme_color);

        // On met aussi à jour le localStorage pour que ce soit dispo hors ligne
        if (cloudConfig.course_title) localStorage.setItem('course_title', cloudConfig.course_title);
        localStorage.setItem('course_content', cloudConfig.course_content);
        localStorage.setItem('voice_summary', cloudConfig.voice_summary);
        localStorage.setItem('system_instruction', cloudConfig.system_instruction);
        localStorage.setItem('voice_instruction', cloudConfig.voice_instruction);
        localStorage.setItem('theme_color', cloudConfig.theme_color);
      }
    };
    loadCloudConfig();
  }, []);

  // Save changes to localStorage (existants)
  useEffect(() => { localStorage.setItem('course_title', courseTitle); }, [courseTitle]);
  useEffect(() => { localStorage.setItem('course_content', courseContent); }, [courseContent]);
  useEffect(() => { localStorage.setItem('voice_summary', voiceSummary); }, [voiceSummary]);
  useEffect(() => { localStorage.setItem('system_instruction', systemInstruction); }, [systemInstruction]);
  useEffect(() => { localStorage.setItem('voice_instruction', voiceInstruction); }, [voiceInstruction]);
  useEffect(() => { localStorage.setItem('theme_color', themeColor); }, [themeColor]);

  const handleResetDefaults = () => {
    if (window.confirm("Voulez-vous vraiment réinitialiser Ada ? Cela effacera tous les changements apportés au cours et aux instructions.")) {
      setCourseContent(DEFAULT_COURSE_CONTENT);
      setVoiceSummary(DEFAULT_VOICE_SUMMARY);
      setSystemInstruction(SYSTEM_INSTRUCTION);
      setVoiceInstruction(VOICE_SYSTEM_INSTRUCTION);
      setThemeColor(DEFAULT_THEME_COLOR);

      localStorage.removeItem('course_content');
      localStorage.removeItem('voice_summary');
      localStorage.removeItem('system_instruction');
      localStorage.removeItem('voice_instruction');
      localStorage.removeItem('theme_color');
    }
  };

  const handleModeChange = (mode: AppMode) => {
    setActiveMode(mode);
    setIsSidebarOpen(false); // Ferme le menu auto sur mobile après sélection
  };

  const activeTheme = themeStyles[themeColor] || themeStyles.blue;

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === teacherPassword) { setIsAuthenticated(true); setPasswordInput(''); }
    else { alert('Mot de passe incorrect'); }
  };

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-slate-950 overflow-hidden text-slate-900 dark:text-slate-100 font-sans transition-colors duration-300">

      {/* OVERLAY MOBILE : Fond sombre quand le menu est ouvert */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* ASIDE : Maintenant totalement responsive */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 dark:bg-black text-slate-300 flex flex-col border-r border-slate-800 transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
        md:relative md:translate-x-0 md:flex md:w-64
      `}>
        <div className="p-6 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 ${activeTheme.bg} rounded-lg flex items-center justify-center text-white shrink-0 shadow-lg`}>
              <GraduationCap size={24} />
            </div>
            <span className="font-montserrat font-bold text-xl text-white tracking-wide">Droit Public</span>
          </div>
          {/* Bouton fermer visible seulement sur mobile */}
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-slate-400">
            <X size={24} />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button onClick={() => handleModeChange(AppMode.TEXT)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeMode === AppMode.TEXT ? `${activeTheme.bg} text-white shadow-md` : 'hover:bg-slate-800'}`}>
            <MessageSquare size={20} /><span className="font-medium">Discussion</span>
          </button>
          <button onClick={() => handleModeChange(AppMode.VOICE)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeMode === AppMode.VOICE ? `${activeTheme.bg} text-white shadow-md` : 'hover:bg-slate-800'}`}>
            <Mic size={20} /><span className="font-medium">Mode vocal</span>
          </button>
          <button onClick={() => handleModeChange(AppMode.SETTINGS)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeMode === AppMode.SETTINGS ? `${activeTheme.bg} text-white shadow-md` : 'hover:bg-slate-800'}`}>
            {isAuthenticated ? <Unlock size={20} /> : <Lock size={20} />}<span className="font-medium">Configuration</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button onClick={() => setIsDarkMode(!isDarkMode)} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}<span className="text-sm">{isDarkMode ? 'Mode clair' : 'Mode sombre'}</span>
          </button>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 text-xs text-slate-500 hidden md:block">
          <p>Version 1.0.0 2025</p>
          <p>Propulsé par Gemini-2.0-flash</p>
          <p>Designed by A. Coulibaly</p>
          <p className="text-xs text-white"><a className={`hover:${activeTheme.bg}`} href="https://www.lex-publica.com/" target="_blank">www.lex publica.com</a></p>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-x-hidden relative">
        <header className="h-16 md:h-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 md:px-8 shrink-0 z-10 pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 -ml-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <div className="min-w-0">
              <h1 className="font-montserrat tracking-tight text-slate-900 dark:text-white leading-tight">
                {activeMode === AppMode.TEXT && (
                  <div className="flex items-baseline gap-2">
                    <span className={`text-lg md:text-2xl font-semibold truncate ${activeTheme.text}`}>
                      Ada
                    </span>
                    <span className="text-xs md:text-xl font-medium truncate opacity-80 md:opacity-100">
                      Lex publica <span className="font-normal opacity-70">IA</span>
                    </span>
                  </div>
                )}

                {activeMode === AppMode.VOICE && (
                  <span className="block text-lg md:text-2xl font-semibold truncate">
                    Entretien Virtuel
                  </span>
                )}

                {activeMode === AppMode.SETTINGS && (
                  <span className="block text-lg md:text-2xl font-semibold truncate">
                    Administration
                  </span>
                )}
              </h1>

              {/* 3) Garantie académique */}
              <p className="hidden md:block mt-0.5 text-[10px] md:text-xs text-slate-500 dark:text-slate-400 truncate uppercase tracking-wider font-medium">
                <span className={`${activeTheme.text}`}>A. Coulibaly</span> — {courseTitle}
              </p>
            </div>
          </div>

          <div className="ml-4 hidden sm:flex items-center gap-2 shrink-0">
            <span className={`h-2 w-2 rounded-full ${activeTheme.bg}`} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Système prêt</span>
          </div>
        </header>

        <div className="flex-1 p-2 md:p-6 overflow-x-hidden relative">
          {activeMode === AppMode.TEXT && (
            <TextChat courseContent={courseContent} systemInstruction={systemInstruction} apiKey={apiKey} themeColor={themeColor} />
          )}
          {activeMode === AppMode.VOICE && (
            <VoiceChat courseContent={voiceSummary} systemInstruction={voiceInstruction} apiKey={apiKey} themeColor={themeColor} />
          )}
          {activeMode === AppMode.SETTINGS && (
            isAuthenticated ? (
              <CourseEditor
                initialCourseTitle={courseTitle} onSaveCourseTitle={setCourseTitle}
                initialContent={courseContent} onSaveContent={setCourseContent}
                initialVoiceSummary={voiceSummary} onSaveVoiceSummary={setVoiceSummary}
                initialInstruction={systemInstruction} onSaveInstruction={setSystemInstruction}
                initialVoiceInstruction={voiceInstruction} onSaveVoiceInstruction={setVoiceInstruction}
                initialThemeColor={themeColor} onSaveThemeColor={setThemeColor}
                onResetAll={handleResetDefaults}
                profiles={profiles}
                onRefreshProfiles={refreshProfiles}
                lastSync={lastSync}
                onSaveToCloud={saveConfigToCloud}
                onFetchFromCloud={fetchConfigFromCloud}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <form onSubmit={handleLogin} className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8 space-y-6">
                  <h2 className="text-xl font-serif font-bold text-center text-slate-800 dark:text-white">Accès Professeur</h2>
                  <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className="block w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="Mot de passe" autoFocus />
                  <button type="submit" className={`w-full py-3 ${activeTheme.bg} text-white font-medium rounded-xl shadow-lg active:scale-95 transition-transform`}>Accéder</button>
                </form>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
};

export default App;



