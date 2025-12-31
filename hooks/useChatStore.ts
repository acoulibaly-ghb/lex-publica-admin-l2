
import { useState, useEffect } from 'react';
import { ChatSession, ChatMessage, StudentProfile, ScoreRecord } from '../types';

const STORAGE_KEY = 'droit_public_sessions';
const PROFILES_KEY = 'droit_public_profiles';
const ACTIVE_PROFILE_KEY = 'droit_public_active_profile';

export const useChatStore = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    try {
      return JSON.parse(stored).map((s: any) => ({
        ...s,
        messages: s.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
      }));
    } catch (e) { return []; }
  });

  const [profiles, setProfiles] = useState<StudentProfile[]>(() => {
    const stored = localStorage.getItem(PROFILES_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const revived = JSON.parse(stored);
        return revived.length > 0 ? revived[0].id : null;
      } catch (e) { return null; }
    }
    return null;
  });

  const [currentProfileId, setCurrentProfileId] = useState<string | null>(() => {
    return localStorage.getItem(ACTIVE_PROFILE_KEY);
  });

  const [lastSync, setLastSync] = useState<Date | null>(null);

  const refreshProfiles = async () => {
    try {
      const res = await fetch('/api/sync');
      const cloudProfiles = await res.json();
      if (Array.isArray(cloudProfiles)) {
        setProfiles(prev => {
          const merged = [...prev];

          // 1. On intègre les données du cloud
          cloudProfiles.forEach(cp => {
            const idx = merged.findIndex(p => p.id === cp.id);
            if (idx === -1) merged.push(cp);
            else if (cp.scores.length > merged[idx].scores.length) merged[idx] = cp;
          });

          // 2. On pousse les profils locaux qui ne sont pas encore sur le Cloud (cas d'Alice)
          prev.forEach(lp => {
            const inCloud = cloudProfiles.find(cp => cp.id === lp.id);
            if (!inCloud || lp.scores.length > inCloud.scores.length) {
              fetch('/api/sync', {
                method: 'POST',
                body: JSON.stringify({ profile: lp })
              }).catch(() => { });
            }
          });

          return merged;
        });
        setLastSync(new Date());
      }
    } catch (e) { console.log("Erreur synchro cloud", e); }
  };

  useEffect(() => {
    if (sessions.length === 0) {
      createNewSession();
    }
    refreshProfiles();
  }, []);

  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    }
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    if (currentProfileId) localStorage.setItem(ACTIVE_PROFILE_KEY, currentProfileId);
    else localStorage.removeItem(ACTIVE_PROFILE_KEY);
  }, [currentProfileId]);

  const createNewSession = () => {
    const profile = getCurrentProfile();
    const isVisitor = !profile || profile.name === 'Visiteur';

    const newSession: ChatSession = {
      id: crypto.randomUUID(),
      title: 'Nouvelle conversation',
      messages: [
        {
          role: 'model',
          text: isVisitor
            ? `Bonjour ! Je suis **Ada**, l'assistante virtuelle du Professeur **Coulibaly**. Pour que je puisse suivre votre progression, souhaitez-vous vous identifier ?\n\n[ ] Je veux bien me présenter\n[ ] Je préfère rester anonyme`
            : `Ravie de vous retrouver pour une nouvelle session formation ou de révision, **${profile.name}** ! Sur quel point du Droit administratif général souhaitez-vous travailler aujourd'hui ?`,
          timestamp: new Date()
        }
      ],
      updatedAt: Date.now()
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    return newSession.id;
  };

  const deleteSession = (id: string, e?: any) => {
    e?.stopPropagation();
    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);
    if (activeSessionId === id) {
      if (newSessions.length > 0) setActiveSessionId(newSessions[0].id);
      else createNewSession();
    }
  };

  const addMessageToSession = (sessionId: string, message: ChatMessage) => {
    setSessions(prev => {
      const updated = prev.map(s => {
        if (s.id === sessionId) {
          let newTitle = s.title;
          if (s.messages.length === 1 && message.role === 'user' && s.title === 'Nouvelle conversation') {
            newTitle = message.text.slice(0, 30) + (message.text.length > 30 ? '...' : '');
          }
          return { ...s, title: newTitle, messages: [...s.messages, message], updatedAt: Date.now() };
        }
        return s;
      });
      return [...updated].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  };

  const selectOptionInMessage = (sessionId: string, msgIndex: number, option: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        const newMessages = [...s.messages];
        if (newMessages[msgIndex]) {
          newMessages[msgIndex] = { ...newMessages[msgIndex], selectedOption: option };
        }
        return { ...s, messages: newMessages };
      }
      return s;
    }));
  };

  const selectOptionsInMessage = (sessionId: string, msgIndex: number, options: string[]) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        const newMessages = [...s.messages];
        if (newMessages[msgIndex]) {
          newMessages[msgIndex] = { ...newMessages[msgIndex], selectedOptions: options };
        }
        return { ...s, messages: newMessages };
      }
      return s;
    }));
  };

  const findProfilesByName = (name: string) => {
    return profiles.filter(p => p.name.toLowerCase() === name.trim().toLowerCase());
  };

  const createNewProfile = (name: string): StudentProfile => {
    const cleanName = name.trim();

    // Si c'est un visiteur, on regarde si on en a déjà un
    if (cleanName === 'Visiteur') {
      const existingVisitor = profiles.find(p => p.name === 'Visiteur');
      if (existingVisitor) {
        setCurrentProfileId(existingVisitor.id);
        return existingVisitor;
      }
    }

    const suffix = Math.floor(100 + Math.random() * 900);
    const newProfile: StudentProfile = {
      id: `${cleanName} #${suffix}`,
      name: cleanName,
      scores: []
    };
    setProfiles(prev => [...prev, newProfile]);
    setCurrentProfileId(newProfile.id);

    // Sync Cloud
    fetch('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ profile: newProfile })
    }).catch(() => { });

    return newProfile;
  };

  const loginToProfile = (id: string) => {
    const found = profiles.find(p => p.id === id);
    if (found) setCurrentProfileId(found.id);
  };

  const logoutProfile = () => setCurrentProfileId(null);

  const saveScore = (profileId: string, score: ScoreRecord) => {
    setProfiles(prev => {
      const updated = prev.map(p => {
        if (p.id === profileId) {
          const newProfile = { ...p, scores: [...p.scores, score] };
          // Sync Cloud asynchrone
          fetch('/api/sync', {
            method: 'POST',
            body: JSON.stringify({ profile: newProfile })
          }).catch(() => { });
          return newProfile;
        }
        return p;
      });
      return updated;
    });
  };

  const saveConfigToCloud = async (configData: any) => {
    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'config', data: configData })
      });
      return true;
    } catch (e) {
      console.error("Erreur sauvegarde config cloud", e);
      return false;
    }
  };

  const fetchConfigFromCloud = async () => {
    try {
      const res = await fetch('/api/sync?type=config');
      const data = await res.json();
      return data;
    } catch (e) {
      console.error("Erreur récupération config cloud", e);
      return null;
    }
  };

  const getActiveSession = () => sessions.find(s => s.id === activeSessionId);
  const getCurrentProfile = () => profiles.find(p => p.id === currentProfileId);

  return {
    sessions,
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
    profiles,
    refreshProfiles,
    lastSync,
    saveConfigToCloud,
    fetchConfigFromCloud,
    currentProfile: getCurrentProfile(),
    activeSession: getActiveSession()
  };
};
